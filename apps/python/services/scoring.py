"""Importance scoring via Claude API. Four axes → weighted composite.

Thresholds (from SCORING.md):
  ALERT_CANDIDATE_THRESHOLD = 8.0
  WATCH_THRESHOLD           = 6.0
"""
import json
import logging

from anthropic import AsyncAnthropic

from config import settings

log = logging.getLogger(__name__)

ALERT_CANDIDATE_THRESHOLD = 8.0
WATCH_THRESHOLD = 6.0

_WEIGHTS = {"magnitude": 0.35, "irreversibility": 0.25, "blast_radius": 0.25, "velocity": 0.15}
_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


def calculate_composite(magnitude: float, irreversibility: float, blast_radius: float, velocity: float) -> float:
    return round(
        magnitude * _WEIGHTS["magnitude"] +
        irreversibility * _WEIGHTS["irreversibility"] +
        blast_radius * _WEIGHTS["blast_radius"] +
        velocity * _WEIGHTS["velocity"],
        1
    )


_SCORING_PROMPT = """You are scoring a technology signal for NewsHive, an intelligence platform \
covering AI, VR/AR, Vibe Coding, and SEO.

Score this signal on four axes from 0-10:

MAGNITUDE: How significant is the change from the previous state?
IRREVERSIBILITY: Can this be undone, or does it permanently shift the landscape?
BLAST RADIUS: How many adjacent domains and people does this affect?
VELOCITY: How fast is this moving? How quickly must people adapt?

Signal:
Title: {title}
Content: {content}
Source: {source_name} (Tier {source_tier})
Domain: {domain_tags}

Return JSON only — no preamble, no explanation:
{{"magnitude": X, "irreversibility": X, "blast_radius": X, "velocity": X, "reasoning": "brief explanation"}}"""


async def score_signal(
    title: str,
    content: str,
    source_name: str,
    source_tier: int,
    domain_tags: list[str],
) -> dict | None:
    """Call Claude to score a signal. Returns dict with axes + composite, or None on failure."""
    prompt = _SCORING_PROMPT.format(
        title=title or "",
        content=(content or "")[:2000],
        source_name=source_name,
        source_tier=source_tier,
        domain_tags=", ".join(domain_tags),
    )
    try:
        response = await _get_client().messages.create(
            model="claude-opus-4-6",
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        data = json.loads(raw)
        return {
            "magnitude": float(data["magnitude"]),
            "irreversibility": float(data["irreversibility"]),
            "blast_radius": float(data["blast_radius"]),
            "velocity": float(data["velocity"]),
            "reasoning": data.get("reasoning", ""),
            "composite": calculate_composite(
                data["magnitude"], data["irreversibility"],
                data["blast_radius"], data["velocity"]
            ),
        }
    except Exception as exc:
        log.warning("Scoring failed for signal titled %r: %s", title, exc)
        return None


async def apply_scores_to_signal(signal_id: str, scores: dict) -> None:
    """Persist scoring results to the signals table."""
    from database import get_conn
    async with get_conn() as conn:
        await conn.execute(
            """
            UPDATE signals SET
                magnitude_score       = $1,
                irreversibility_score = $2,
                blast_radius_score    = $3,
                velocity_score        = $4,
                importance_composite  = $5,
                is_alert_candidate    = $6
            WHERE id = $7
            """,
            scores["magnitude"],
            scores["irreversibility"],
            scores["blast_radius"],
            scores["velocity"],
            scores["composite"],
            scores["composite"] >= ALERT_CANDIDATE_THRESHOLD,
            signal_id,
        )
