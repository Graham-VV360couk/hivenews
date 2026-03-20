"""POST /ingest — receive a signal, deduplicate, embed, and store.

Signals with no embeddable content (no title and no content) are rejected
with HTTP 422 — a zero-vector embedding has undefined cosine similarity
and would corrupt clustering.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException

from database import get_conn
from models.signals import IngestRequest, IngestResponse
from services.alert_detection import (
    check_rate_limit,
    classify_alert_tier,
    create_alert_candidate,
    route_confidence,
)
from services.clustering import assign_cluster
from services.dedup import is_duplicate, mark_seen
from services.embedding import generate_embedding
from services.readiness import recalculate_cluster_readiness
from services.reality_check import run_reality_check
from services.scoring import (
    ALERT_CANDIDATE_THRESHOLD,
    apply_scores_to_signal,
    score_signal,
)

log = logging.getLogger(__name__)
router = APIRouter()


async def _store_signal(req: IngestRequest, embedding: list[float]) -> UUID:
    """Insert signal into DB and return its UUID."""
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO signals (
                source_id, title, content, url, published_at,
                domain_tags, source_type, is_public, provenance_url,
                embedding
            ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9,
                $10::vector
            )
            RETURNING id
            """,
            req.source_id,
            req.title,
            req.content,
            req.url,
            req.published_at,
            req.domain_tags,
            req.source_type,
            req.is_public,
            req.provenance_url or req.url,
            embedding,
        )
        return row["id"]


async def _get_source_info(source_id) -> dict | None:
    if not source_id:
        return None
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT name, tier FROM sources WHERE id = $1", source_id
        )
        return dict(row) if row else None


async def _get_signal_cluster(signal_id: str) -> UUID | None:
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT cluster_id FROM signals WHERE id = $1", signal_id
        )
        return row["cluster_id"] if row else None


@router.post("/ingest", response_model=IngestResponse)
async def ingest_signal(req: IngestRequest) -> IngestResponse:
    # Reject signals with no text to embed — zero vectors corrupt clustering
    text_to_embed = f"{req.title or ''} {req.content or ''}".strip()
    if not text_to_embed:
        raise HTTPException(
            status_code=422,
            detail="Signal must have title or content to be ingested.",
        )

    if await is_duplicate(req.url):
        return IngestResponse(id=None, deduplicated=True, message="Signal already seen — skipped.")

    embedding = await generate_embedding(text_to_embed)
    signal_id = await _store_signal(req, embedding)
    await mark_seen(req.url)
    await assign_cluster(signal_id, embedding)

    # Run scoring + alert pipeline — failures never break ingestion
    try:
        source_info = await _get_source_info(req.source_id)
        scores = await score_signal(
            title=req.title or "",
            content=req.content or "",
            source_name=source_info["name"] if source_info else "Unknown",
            source_tier=source_info["tier"] if source_info else 3,
            domain_tags=req.domain_tags,
        )
        if scores:
            await apply_scores_to_signal(str(signal_id), scores)

            if scores["composite"] >= ALERT_CANDIDATE_THRESHOLD:
                source_tier = source_info["tier"] if source_info else 3
                reality = await run_reality_check({
                    "id": str(signal_id),
                    "title": req.title,
                    "content": req.content,
                    "source_tier": source_tier,
                    "domain_tags": req.domain_tags,
                    "magnitude_score": scores["magnitude"],
                    "published_at": req.published_at,
                })
                if reality["passed"] and await check_rate_limit(req.domain_tags):
                    alert_tier = classify_alert_tier(
                        scores["composite"], reality["corroboration_count"], source_tier
                    )
                    if alert_tier:
                        confidence = route_confidence(
                            alert_tier, reality["corroboration_count"],
                            source_tier, reality["too_good_to_be_true"]
                        )
                        await create_alert_candidate(signal_id, scores, reality, alert_tier, confidence)
    except Exception as exc:
        log.warning("Post-ingest pipeline failed for signal %s: %s", signal_id, exc)

    # Recalculate cluster readiness
    if cluster_id := await _get_signal_cluster(str(signal_id)):
        try:
            await recalculate_cluster_readiness(cluster_id)
        except Exception as exc:
            log.warning("Readiness recalculation failed for cluster %s: %s", cluster_id, exc)

    return IngestResponse(id=signal_id, deduplicated=False, message="Signal ingested.")
