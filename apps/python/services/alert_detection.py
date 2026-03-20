"""Alert candidate creation and classification. See SCORING.md for all thresholds."""
import logging
from uuid import UUID

log = logging.getLogger(__name__)

_MAX_ALERTS_PER_DOMAIN_PER_WEEK = 2


def classify_alert_tier(composite: float, corroboration_count: int, source_tier: int) -> str | None:
    """Return alert tier or None if composite doesn't meet threshold."""
    if composite >= 9.0 and corroboration_count >= 3 and source_tier <= 2:
        return "breaking"
    if composite >= 8.5 and corroboration_count >= 2:
        return "significant"
    if composite >= 8.0:
        return "watch"
    return None


def route_confidence(
    alert_tier: str,
    corroboration_count: int,
    source_tier: int,
    too_good_to_be_true: bool = False,
) -> str:
    """Map alert tier + context to confidence label."""
    if too_good_to_be_true:
        return "pinch_of_salt"
    if alert_tier == "breaking" and corroboration_count >= 3 and source_tier <= 1:
        return "confirmed"
    if alert_tier in ("breaking", "significant") and corroboration_count >= 2:
        return "developing"
    return "pinch_of_salt"


async def _count_recent_domain_alerts(domain_tags: list[str]) -> int:
    from database import get_conn
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT COUNT(*) AS cnt FROM alert_candidates
            WHERE created_at > NOW() - INTERVAL '7 days'
              AND EXISTS (
                  SELECT 1 FROM signals s
                  WHERE s.id = ANY(alert_candidates.signal_ids)
                    AND s.domain_tags && $1
              )
            """,
            domain_tags,
        )
        return row["cnt"] if row else 0


async def check_rate_limit(domain_tags: list[str]) -> bool:
    """Return True if another alert is allowed for these domains this week."""
    count = await _count_recent_domain_alerts(domain_tags)
    return count < _MAX_ALERTS_PER_DOMAIN_PER_WEEK


async def create_alert_candidate(
    signal_id: UUID,
    scores: dict,
    reality_check: dict,
    alert_tier: str,
    confidence_level: str,
) -> UUID:
    """Insert alert_candidates row and return its UUID."""
    from database import get_conn
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            INSERT INTO alert_candidates (
                signal_ids, magnitude_score, irreversibility_score,
                blast_radius_score, velocity_score, composite_score,
                reality_check_passed, source_tier_min, corroboration_count,
                too_good_to_be_true, alert_tier, confidence_level, fired_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
            )
            RETURNING id
            """,
            [signal_id],
            scores["magnitude"], scores["irreversibility"],
            scores["blast_radius"], scores["velocity"], scores["composite"],
            reality_check["passed"],
            reality_check["source_tier"],
            reality_check["corroboration_count"],
            reality_check["too_good_to_be_true"],
            alert_tier, confidence_level,
        )
        return row["id"]
