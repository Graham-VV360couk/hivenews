"""Content pack creation and draft storage.

Orchestrates the full pipeline:
  fetch cluster/alert data → generate Claude drafts → INSERT to DB.

Tables written:
  content_packs  — one row per content pack
  content_drafts — one row per platform per pack (6 platforms)
"""
import json
import logging
from uuid import UUID

from database import get_conn
from services.draft import generate_pack_drafts

log = logging.getLogger(__name__)

_PLATFORMS = ("blog", "linkedin", "instagram", "facebook", "x", "hivecast")


async def create_content_pack(
    cluster_id: UUID | None,
    alert_candidate_id: UUID | None,
    pack_type: str,
    confidence_level: str,
    signal_ids: list[UUID],
    readiness_score: float | None,
    trigger_reason: str,
) -> UUID:
    """INSERT a new content_packs row. Returns the new pack UUID."""
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO content_packs (
                cluster_id,
                alert_candidate_id,
                pack_type,
                confidence_level,
                signal_ids,
                readiness_score,
                trigger_reason,
                status,
                triggered_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending_approval', NOW())
            RETURNING id
            """,
            cluster_id,
            alert_candidate_id,
            pack_type,
            confidence_level,
            signal_ids,
            readiness_score,
            trigger_reason,
        )
        return row["id"]


async def store_drafts(pack_id: UUID, drafts: dict) -> None:
    """INSERT one content_drafts row per platform.

    Platforms: blog, linkedin, instagram, facebook, x, hivecast.
    The full platform JSON blob is stored in draft_data; the text fields
    (title, content, script) are also stored in dedicated columns for
    quick display in the HiveDeck dashboard.
    """
    async with get_conn() as conn:
        for platform in _PLATFORMS:
            platform_data = drafts.get(platform, {})
            # Extract text content regardless of platform shape
            if platform == "blog":
                draft_text = platform_data.get("content", "")
            elif platform == "x":
                draft_text = "\n---\n".join(platform_data.get("tweets", []))
            elif platform == "hivecast":
                draft_text = platform_data.get("script", "")
            else:
                draft_text = platform_data.get("content", "")

            await conn.execute(
                """
                INSERT INTO content_drafts (
                    pack_id,
                    platform,
                    draft_text,
                    draft_data,
                    approved,
                    created_at
                ) VALUES ($1, $2, $3, $4, FALSE, NOW())
                """,
                pack_id,
                platform,
                draft_text,
                json.dumps(platform_data),
            )


async def trigger_pack_for_cluster(cluster_id: UUID) -> UUID | None:
    """Full pipeline: fetch cluster signals → generate drafts → store to DB.

    Returns:
        pack_id (UUID) on success, None if draft generation failed.
    """
    async with get_conn() as conn:
        # 1. Fetch cluster metadata
        cluster = await conn.fetchrow(
            """
            SELECT name, domain_tags, confidence_level, readiness_score, days_since_last_pack
            FROM clusters
            WHERE id = $1
            """,
            cluster_id,
        )
        if not cluster:
            log.warning("trigger_pack_for_cluster: cluster %s not found", cluster_id)
            return None

        # 2. Fetch last 50 signals ordered by importance (includes id for later use)
        signals = await conn.fetch(
            """
            SELECT id, title, content_summary, source_name, importance_composite
            FROM signals
            WHERE cluster_id = $1
            ORDER BY importance_composite DESC NULLS LAST, ingested_at DESC
            LIMIT 50
            """,
            cluster_id,
        )

    # 3. Build signal summaries string
    summary_parts = []
    for s in signals:
        title = s["title"] or ""
        summary = s["content_summary"] or ""
        source = s["source_name"] or "Unknown"
        summary_parts.append(f"[{source}] {title}: {summary}")
    signal_summaries = "\n".join(summary_parts)

    # 4. Generate Claude drafts
    drafts = await generate_pack_drafts(
        cluster_name=cluster["name"],
        confidence_level=cluster["confidence_level"] or "MEDIUM",
        pack_type="standard",
        domain_tags=cluster["domain_tags"] or [],
        signal_summaries=signal_summaries,
    )

    if drafts is None:
        log.warning("trigger_pack_for_cluster: draft generation failed for cluster %s", cluster_id)
        return None

    # 5. Persist pack + drafts
    signal_ids = [r["id"] for r in signals]
    pack_id = await create_content_pack(
        cluster_id=cluster_id,
        alert_candidate_id=None,
        pack_type="standard",
        confidence_level=cluster["confidence_level"] or "MEDIUM",
        signal_ids=signal_ids,
        readiness_score=cluster["readiness_score"],
        trigger_reason="readiness_threshold",
    )
    await store_drafts(pack_id=pack_id, drafts=drafts)

    log.info("Content pack %s created for cluster %s", pack_id, cluster_id)
    return pack_id


async def trigger_pack_for_alert(alert_candidate_id: UUID) -> UUID | None:
    """Full pipeline for alert_candidate: fetch alert + signals → generate drafts → store.

    Returns:
        pack_id (UUID) on success, None if draft generation failed.
    """
    async with get_conn() as conn:
        alert = await conn.fetchrow(
            """
            SELECT ac.id, ac.alert_type, ac.confidence_level, ac.cluster_id,
                   c.name AS cluster_name, c.domain_tags
            FROM alert_candidates ac
            LEFT JOIN clusters c ON c.id = ac.cluster_id
            WHERE ac.id = $1
            """,
            alert_candidate_id,
        )
        if not alert:
            log.warning("trigger_pack_for_alert: alert_candidate %s not found", alert_candidate_id)
            return None

        signals = await conn.fetch(
            """
            SELECT id, title, content_summary, source_name
            FROM signals
            WHERE cluster_id = $1
            ORDER BY importance_composite DESC NULLS LAST, ingested_at DESC
            LIMIT 50
            """,
            alert["cluster_id"],
        )

    summary_parts = []
    for s in signals:
        title = s["title"] or ""
        summary = s["content_summary"] or ""
        source = s["source_name"] or "Unknown"
        summary_parts.append(f"[{source}] {title}: {summary}")
    signal_summaries = "\n".join(summary_parts)

    alert_type = alert["alert_type"] or "alert_significant"
    pack_type = alert_type if alert_type in ("alert_breaking", "alert_significant") else "alert_significant"

    drafts = await generate_pack_drafts(
        cluster_name=alert["cluster_name"] or "Breaking Alert",
        confidence_level=alert["confidence_level"] or "HIGH",
        pack_type=pack_type,
        domain_tags=alert["domain_tags"] or [],
        signal_summaries=signal_summaries,
    )

    if drafts is None:
        log.warning("trigger_pack_for_alert: draft generation failed for alert %s", alert_candidate_id)
        return None

    signal_ids = [r["id"] for r in signals]
    pack_id = await create_content_pack(
        cluster_id=alert["cluster_id"],
        alert_candidate_id=alert_candidate_id,
        pack_type=pack_type,
        confidence_level=alert["confidence_level"] or "HIGH",
        signal_ids=signal_ids,
        readiness_score=None,
        trigger_reason="alert_detection",
    )
    await store_drafts(pack_id=pack_id, drafts=drafts)

    log.info("Alert content pack %s created for alert_candidate %s", pack_id, alert_candidate_id)
    return pack_id
