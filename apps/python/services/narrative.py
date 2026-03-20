"""Synthesise the living NewsHive narrative for a cluster."""
import logging
from datetime import datetime

from anthropic import AsyncAnthropic
from config import settings
from database import get_conn

log = logging.getLogger(__name__)

_VOICE_SYSTEM = """You are writing content for NewsHive — a technology intelligence platform covering AI, VR/AR, Vibe Coding, and SEO.

VOICE GUIDE:
Write as a thoughtful, experienced observer who finds the human truth inside the technical story. Speak directly without being cold. Arrive at strong opinions through visible reasoning. Use the specific detail to illuminate the general point. Be never more than one sentence away from either a dry laugh or genuine emotion.

Never open with hollow phrases ("Excited to share", "Big news").
Never use meaningless amplifiers ("huge", "massive", "game-changing").
Never summarise without adding a perspective.
Rhythm matters. Long sentences that build, followed by short ones that land.
The confidence label must appear naturally in the content — it is part of the editorial voice, not a tag."""


_NARRATIVE_PROMPT = """You are updating the NewsHive view for a developing story.

Story: {cluster_name}
Domain: {domain_tags}
Signals tracking this story: {signal_count}
Confidence level: {confidence_level}
Story first detected: {first_signal_at}

Top signals (most significant first):
{signal_summaries}

{previous_section}

Write the NewsHive View — 2-4 paragraphs synthesising what is happening, what it means, and what to watch. This is the living intelligence brief, not a summary. Use the NewsHive voice.

Use confidence language naturally in prose:
- CONFIRMED: "Multiple independent sources have now verified..."
- DEVELOPING: "The signals are strengthening — here is what we know."
- PINCH OF SALT: "We are picking up signals. We cannot yet verify them."

End with one specific watchpoint: "Keep your eye on [X]. If [Y] happens, that confirms the direction we have been tracking."

Return only the narrative paragraphs. No headlines, no labels, no JSON wrapper."""


def _confidence_from_scores(scores: list[float]) -> str:
    if not scores:
        return "PINCH OF SALT"
    avg = sum(scores) / len(scores)
    if avg >= 7.5:
        return "CONFIRMED"
    if avg >= 4.5:
        return "DEVELOPING"
    return "PINCH OF SALT"


async def synthesise_narrative(cluster_id: str) -> str | None:
    """
    Generate or update the NewsHive narrative for a cluster.
    Only re-synthesises if: no narrative yet, OR last update > 1 hour ago.
    Returns the narrative text or None on failure.
    """
    async with get_conn() as conn:
        cluster = await conn.fetchrow(
            """
            SELECT id, name, domain_tags, signal_count,
                   first_signal_at, narrative, narrative_updated_at
            FROM clusters WHERE id = $1
            """,
            cluster_id,
        )
        if not cluster:
            return None

        # Debounce: skip if synthesised within the last hour
        if cluster["narrative_updated_at"]:
            from datetime import timezone
            age_secs = (datetime.now(timezone.utc) - cluster["narrative_updated_at"]).total_seconds()
            if age_secs < 3600:
                return cluster["narrative"]

        signals = await conn.fetch(
            """
            SELECT s.title, s.url, s.importance_composite,
                   COALESCE(s.published_at, s.ingested_at) AS published_at,
                   src.name AS source_name
            FROM signals s
            LEFT JOIN sources src ON src.id = s.source_id
            WHERE s.cluster_id = $1 AND s.title IS NOT NULL
            ORDER BY s.importance_composite DESC NULLS LAST
            LIMIT 10
            """,
            cluster_id,
        )

    if not signals:
        return None

    scores = [float(s["importance_composite"]) for s in signals if s["importance_composite"]]
    confidence_level = _confidence_from_scores(scores)

    def fmt_date(d) -> str:
        if not d:
            return "recently"
        return d.strftime("%d %b") if hasattr(d, "strftime") else str(d)[:10]

    signal_summaries = "\n".join(
        f"- [{fmt_date(s['published_at'])}] {s['title']}"
        + (f" — {s['source_name']}" if s['source_name'] else "")
        + (f" (score: {float(s['importance_composite']):.1f})" if s['importance_composite'] else "")
        for s in signals
    )

    previous_section = ""
    if cluster["narrative"]:
        previous_section = (
            "Previous NewsHive view (evolve this — advance the story, preserve the analytical thread):\n"
            + cluster["narrative"][:800]
        )

    prompt = _NARRATIVE_PROMPT.format(
        cluster_name=cluster["name"] or "Unnamed cluster",
        domain_tags=", ".join(cluster["domain_tags"] or []),
        signal_count=cluster["signal_count"] or 0,
        confidence_level=confidence_level,
        first_signal_at=fmt_date(cluster["first_signal_at"]),
        signal_summaries=signal_summaries,
        previous_section=previous_section,
    )

    try:
        client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=_VOICE_SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        narrative = response.content[0].text.strip()

        async with get_conn() as conn:
            await conn.execute(
                """
                UPDATE clusters SET
                    narrative = $1,
                    narrative_updated_at = NOW(),
                    updated_at = NOW()
                WHERE id = $2
                """,
                narrative,
                cluster_id,
            )
            # Log the event
            await conn.execute(
                """
                INSERT INTO story_events (cluster_id, event_type, confidence_level, summary)
                VALUES ($1, 'narrative_updated', $2, $3)
                """,
                cluster_id,
                confidence_level,
                f"Narrative synthesised from {len(signals)} signals",
            )

        return narrative
    except Exception as exc:
        log.error("Narrative synthesis failed for cluster %s: %s", cluster_id, exc)
        return None
