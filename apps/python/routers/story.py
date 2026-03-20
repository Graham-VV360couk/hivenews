"""Story endpoints — public living story data."""
import logging
from fastapi import APIRouter, HTTPException
from database import get_conn
from services.narrative import synthesise_narrative

log = logging.getLogger(__name__)
router = APIRouter(prefix="/stories", tags=["stories"])


@router.get("/")
async def list_stories(limit: int = 20, offset: int = 0) -> dict:
    """List clusters that have narratives — these are the published stories."""
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name, domain_tags, signal_count, narrative,
                   narrative_updated_at, first_signal_at, last_signal_at,
                   readiness_score
            FROM clusters
            WHERE is_active = TRUE
              AND narrative IS NOT NULL
            ORDER BY narrative_updated_at DESC NULLS LAST
            LIMIT $1 OFFSET $2
            """,
            limit,
            offset,
        )
        total = await conn.fetchval(
            "SELECT COUNT(*) FROM clusters WHERE is_active = TRUE AND narrative IS NOT NULL"
        )
    return {"stories": [dict(r) for r in rows], "total": total}


@router.get("/{cluster_id}")
async def get_story(cluster_id: str) -> dict:
    """Full story data: cluster, narrative, signals, timeline events."""
    async with get_conn() as conn:
        cluster = await conn.fetchrow(
            """
            SELECT id, name, domain_tags, signal_count, narrative,
                   narrative_updated_at, first_signal_at, last_signal_at,
                   readiness_score, is_active
            FROM clusters
            WHERE id = $1 AND is_active = TRUE
            """,
            cluster_id,
        )
        if not cluster:
            raise HTTPException(status_code=404, detail="Story not found")

        signals = await conn.fetch(
            """
            SELECT s.id, s.title, s.url, s.importance_composite,
                   s.confidence_level, s.is_alert_candidate,
                   s.domain_tags,
                   COALESCE(s.published_at, s.ingested_at) AS published_at,
                   src.name AS source_name,
                   src.url AS source_url
            FROM signals s
            LEFT JOIN sources src ON src.id = s.source_id
            WHERE s.cluster_id = $1
            ORDER BY COALESCE(s.published_at, s.ingested_at) DESC NULLS LAST
            LIMIT 50
            """,
            cluster_id,
        )

        events = await conn.fetch(
            """
            SELECT event_type, confidence_level, summary, created_at
            FROM story_events
            WHERE cluster_id = $1
            ORDER BY created_at DESC
            LIMIT 30
            """,
            cluster_id,
        )

    return {
        "cluster": dict(cluster),
        "signals": [dict(s) for s in signals],
        "events": [dict(e) for e in events],
    }


@router.post("/{cluster_id}/synthesise")
async def synthesise_story(cluster_id: str) -> dict:
    """Trigger narrative synthesis for a specific cluster."""
    narrative = await synthesise_narrative(cluster_id)
    if narrative is None:
        raise HTTPException(status_code=500, detail="Synthesis failed or insufficient signals")
    return {"narrative": narrative, "ok": True}
