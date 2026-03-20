"""Reality check pipeline for alert candidates. See SCORING.md for full logic."""
import json
import logging
from datetime import datetime, timezone, timedelta

from anthropic import AsyncAnthropic
from config import settings

log = logging.getLogger(__name__)
_client: AsyncAnthropic | None = None

_RECENCY_HOURS = 48
_PLAUSIBILITY_THRESHOLD = 0.6


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


async def _count_corroborating_signals(signal_id: str, domain_tags: list[str], hours: int = 24) -> int:
    from database import get_conn
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT COUNT(*) AS cnt FROM signals
            WHERE id != $1
              AND domain_tags && $2
              AND ingested_at > NOW() - ($3 || ' hours')::interval
              AND processed = TRUE
            """,
            signal_id, domain_tags, str(hours),
        )
        return row["cnt"] if row else 0


_PLAUSIBILITY_PROMPT = """You are a senior technology analyst assessing whether a signal is plausible.

Signal: {title} — {content}
Source tier: {tier}
Domain: {domain}

Does this signal:
1. Contradict established physical, legal, or market reality?
2. Require capabilities that do not currently exist?
3. Claim something so extreme it would require massive independent corroboration?
4. Appear to be satire, fiction, or deliberate misinformation?

Return JSON only:
{{"plausible": true/false, "score": 0.0-1.0, "concerns": ["list any concerns"]}}"""


async def _assess_plausibility(title: str, content: str, tier: int, domain: list[str]) -> dict:
    try:
        response = await _get_client().messages.create(
            model="claude-opus-4-6",
            max_tokens=256,
            messages=[{"role": "user", "content": _PLAUSIBILITY_PROMPT.format(
                title=title or "",
                content=(content or "")[:1000],
                tier=tier,
                domain=", ".join(domain),
            )}],
        )
        return json.loads(response.content[0].text.strip())
    except Exception as exc:
        log.warning("Plausibility check failed: %s", exc)
        # Default to plausible on error — don't suppress alerts due to API issues
        return {"plausible": True, "score": 0.5, "concerns": ["plausibility check failed"]}


async def run_reality_check(signal: dict) -> dict:
    """Run all reality checks. Returns dict with 'passed' bool and detail fields."""
    source_tier = signal.get("source_tier", 3)
    magnitude = signal.get("magnitude_score", 0.0) or 0.0
    published_at = signal.get("published_at")
    domain_tags = signal.get("domain_tags", [])
    signal_id = str(signal["id"])

    corroboration_count = await _count_corroborating_signals(signal_id, domain_tags)

    too_good_to_be_true = (
        magnitude > 9.5
        and corroboration_count < 2
        and source_tier > 1
    )

    plausibility = await _assess_plausibility(
        signal.get("title", ""),
        signal.get("content", ""),
        source_tier,
        domain_tags,
    )

    is_fresh = True
    if published_at:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=_RECENCY_HOURS)
        if published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)
        is_fresh = published_at > cutoff

    source_tier_passed = source_tier <= 2
    plausibility_passed = plausibility.get("score", 0) > _PLAUSIBILITY_THRESHOLD

    passed = (
        not too_good_to_be_true
        and plausibility_passed
        and is_fresh
        and (source_tier_passed or corroboration_count >= 3)
    )

    return {
        "passed": passed,
        "source_tier": source_tier,
        "source_tier_passed": source_tier_passed,
        "corroboration_count": corroboration_count,
        "too_good_to_be_true": too_good_to_be_true,
        "plausibility_score": plausibility.get("score"),
        "plausibility_passed": plausibility_passed,
        "plausibility_concerns": plausibility.get("concerns", []),
        "is_fresh": is_fresh,
    }
