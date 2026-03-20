"""Cluster readiness scoring. Determines when a cluster has enough signal
for a content pack. See SCORING.md for full component breakdown."""
import asyncio
import logging
from uuid import UUID

log = logging.getLogger(__name__)

READINESS_THRESHOLD = 75.0
HARD_CAP_DAYS = 5


def calculate_readiness_score(
    signal_count: int,
    unique_sources: int,
    novelty_score: float,
    trajectory_shift_score: float,
    cross_domain_score: float,
) -> float:
    """Calculate readiness score (0-100)."""
    volume_score = min(signal_count / 20 * 25, 25.0)
    diversity_score = min(unique_sources / 10 * 25, 25.0)
    total = volume_score + diversity_score + novelty_score + trajectory_shift_score + cross_domain_score
    return round(min(total, 100.0), 2)


def should_trigger_content_pack(readiness_score: float, days_since_last_pack: int | None) -> bool:
    """Return True if cluster is ready for a content pack."""
    if days_since_last_pack is not None and days_since_last_pack >= HARD_CAP_DAYS:
        return True  # hard cap — always trigger after 5 days
    return readiness_score >= READINESS_THRESHOLD


async def recalculate_cluster_readiness(cluster_id: UUID) -> float:
    """Query cluster signals and update readiness score in DB. Returns new score."""
    from database import get_conn
    async with get_conn() as conn:
        stats = await conn.fetchrow(
            """
            SELECT
                COUNT(*)                                    AS signal_count,
                COUNT(DISTINCT source_id)                  AS unique_sources,
                MAX(last_pack_triggered)                   AS last_pack_triggered,
                days_since_last_pack
            FROM clusters
            LEFT JOIN signals ON signals.cluster_id = clusters.id
            WHERE clusters.id = $1
            GROUP BY clusters.id, clusters.days_since_last_pack,
                     clusters.last_pack_triggered
            """,
            cluster_id,
        )
        if not stats:
            return 0.0

        signal_count = stats["signal_count"] or 0
        unique_sources = stats["unique_sources"] or 0

        # Novelty, trajectory shift, cross-domain default to 0 until Phase 6
        # (trajectory system). Readiness is driven by volume + diversity for now.
        novelty_score = 10.0 if signal_count > 5 else 0.0
        trajectory_shift_score = 0.0
        cross_domain_score = 0.0

        score = calculate_readiness_score(
            signal_count, unique_sources,
            novelty_score, trajectory_shift_score, cross_domain_score
        )

        await conn.execute(
            """
            UPDATE clusters SET
                readiness_score        = $1,
                signal_volume_score    = $2,
                signal_diversity_score = $3,
                novelty_score          = $4,
                last_readiness_calc    = NOW(),
                days_since_last_pack   = CASE
                    WHEN last_pack_triggered IS NOT NULL
                    THEN EXTRACT(DAY FROM NOW() - last_pack_triggered)::INTEGER
                    ELSE NULL
                END
            WHERE id = $5
            """,
            score,
            min(signal_count / 20 * 25, 25.0),
            min(unique_sources / 10 * 25, 25.0),
            novelty_score,
            cluster_id,
        )

        # Trigger content pack if readiness threshold met or hard cap reached
        days_since = stats["days_since_last_pack"]
        if should_trigger_content_pack(score, days_since):
            # Fire-and-forget — do not block readiness recalculation
            asyncio.create_task(_trigger_content_pack(cluster_id))

        return score


async def _trigger_content_pack(cluster_id: UUID) -> None:
    """Background task: trigger content pack creation without blocking."""
    try:
        from services.content_pack import trigger_pack_for_cluster
        pack_id = await trigger_pack_for_cluster(cluster_id)
        if pack_id:
            log.info("Auto-triggered content pack %s for cluster %s", pack_id, cluster_id)
        else:
            log.warning("Auto-trigger: draft generation failed for cluster %s", cluster_id)
    except Exception as exc:
        log.warning("Auto-trigger: unexpected error for cluster %s: %s", cluster_id, exc)
