"""Monthly HiveReport synthesis.

Two-step process:
  1. compute_monthly_stats  — gather and store DB stats into monthly_snapshots
  2. generate_monthly_report — call Claude with all context, create content_pack

The generated report flows into the normal HiveDeck approval queue as
pack_type = 'monthly_report'. The operator reviews 7 sections, approves,
then publishes via the existing publish pipeline.
"""
import json
import logging
from uuid import UUID

import anthropic

from config import settings
from database import get_conn
from services.content_pack import create_content_pack, store_drafts

log = logging.getLogger(__name__)

_MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


async def compute_monthly_stats(year: int, month: int) -> dict:
    """Gather monthly stats from DB and upsert into monthly_snapshots.

    Returns a dict with all counts and metrics for the given month.
    """
    try:
        async with get_conn() as conn:
            start = f"{year}-{month:02d}-01"
            if month == 12:
                end = f"{year + 1}-01-01"
            else:
                end = f"{year}-{month + 1:02d}-01"

            signals_ingested = await conn.fetchval(
                "SELECT COUNT(*) FROM signals WHERE ingested_at >= $1 AND ingested_at < $2",
                start, end,
            ) or 0

            alerts_fired = await conn.fetchval(
                "SELECT COUNT(*) FROM alert_candidates WHERE created_at >= $1 AND created_at < $2",
                start, end,
            ) or 0

            alerts_confirmed = await conn.fetchval(
                "SELECT COUNT(*) FROM alert_candidates WHERE created_at >= $1 AND created_at < $2 AND outcome_accurate = TRUE",
                start, end,
            ) or 0

            pinch_of_salt_issued = await conn.fetchval(
                "SELECT COUNT(*) FROM pinch_of_salt_watch WHERE created_at >= $1 AND created_at < $2",
                start, end,
            ) or 0

            content_packs_published = await conn.fetchval(
                "SELECT COUNT(*) FROM content_packs WHERE published_at >= $1 AND published_at < $2",
                start, end,
            ) or 0

            await conn.execute(
                """
                INSERT INTO monthly_snapshots
                  (period_year, period_month, signals_ingested, alerts_fired,
                   alerts_confirmed, pinch_of_salt_issued, content_packs_published)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (period_year, period_month) DO UPDATE SET
                  signals_ingested = EXCLUDED.signals_ingested,
                  alerts_fired = EXCLUDED.alerts_fired,
                  alerts_confirmed = EXCLUDED.alerts_confirmed,
                  pinch_of_salt_issued = EXCLUDED.pinch_of_salt_issued,
                  content_packs_published = EXCLUDED.content_packs_published
                """,
                year, month, int(signals_ingested), int(alerts_fired),
                int(alerts_confirmed), int(pinch_of_salt_issued),
                int(content_packs_published),
            )

        stats = {
            "year": year,
            "month": month,
            "month_name": _MONTH_NAMES[month],
            "signals_ingested": int(signals_ingested),
            "alerts_fired": int(alerts_fired),
            "alerts_confirmed": int(alerts_confirmed),
            "pinch_of_salt_issued": int(pinch_of_salt_issued),
            "content_packs_published": int(content_packs_published),
        }
        log.info("Monthly stats computed for %s/%s", year, month)
        return stats

    except Exception as exc:
        log.error("Failed to compute monthly stats: %s", exc)
        return {"year": year, "month": month, "error": str(exc)}


async def generate_monthly_report(year: int, month: int) -> dict | None:
    """Synthesise the monthly HiveReport via Claude and create a content pack.

    Returns {"pack_id": str, "month": str, "year": int} on success, None on failure.
    """
    stats = await compute_monthly_stats(year, month)
    if "error" in stats:
        return None

    month_name = _MONTH_NAMES[month]

    # Gather context from DB
    try:
        async with get_conn() as conn:
            trajectories = await conn.fetch(
                """
                SELECT name, confidence_score, confidence_direction, description
                FROM trajectories
                WHERE status = 'active'
                ORDER BY confidence_score DESC
                LIMIT 10
                """
            )
            trajectory_summaries = "\n".join(
                f"- {t['name']} (confidence: {t['confidence_score']}/10, {t['confidence_direction']}): {t['description']}"
                for t in trajectories
            ) or "No active trajectories yet."

            recent_packs = await conn.fetch(
                """
                SELECT cp.pack_type, cp.confidence_level,
                       cd.draft_data->>'title' AS title
                FROM content_packs cp
                JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
                WHERE cp.published_at >= $1
                  AND cp.status = 'published'
                ORDER BY cp.published_at DESC
                LIMIT 20
                """,
                f"{year}-{month:02d}-01",
            )
            pack_summaries = "\n".join(
                f"- [{p['pack_type']} / {p['confidence_level']}] {p['title']}"
                for p in recent_packs
            ) or "No published packs this month."
    except Exception as exc:
        log.warning("Failed to gather report context from DB: %s", exc)
        trajectory_summaries = "No trajectory data available."
        pack_summaries = "No published packs data available."

    prompt = f"""You are generating the monthly HiveReport for NewsHive — our flagship intelligence briefing.

This report covers {month_name} {year}.

MONTHLY STATISTICS:
- Signals ingested: {stats['signals_ingested']}
- HiveAlerts fired: {stats['alerts_fired']} ({stats['alerts_confirmed']} confirmed)
- Pinch of Salt signals issued: {stats['pinch_of_salt_issued']}
- Content packs published: {stats['content_packs_published']}

ACTIVE TRAJECTORIES:
{trajectory_summaries}

CONTENT PUBLISHED THIS MONTH:
{pack_summaries}

NEWSHAI VOICE GUIDE:
Write as a thoughtful, experienced observer. Strong opinions arrived at visibly. Never hollow amplifiers. Rhythm matters — long sentences that build, short ones that land. The honest scorecard (section 3) must include every call made — correct, wrong, and partial. Do not omit misses.

Generate the full HiveReport for {month_name} {year} following the seven-section structure. Length: 2000-3000 words total.

Return as JSON with these exact keys:
{{
  "title": "The {month_name} {year} HiveReport",
  "meta_description": "one-sentence description",
  "section1_numbers": "The Month in Numbers — narrative summary of the stats",
  "section2_domains": "Domain by Domain — AI, VR/AR, Vibe Coding, SEO activity narrative",
  "section3_scorecard": "The Calls We Made — honest assessment (use ✅ ❌ ⚠️ ⏳)",
  "section4_trajectories": "Trajectory Updates — status of each named active theory",
  "section5_signal": "Signal of the Month — the single most significant development",
  "section6_watching": "What We're Watching — 3-5 specific falsifiable items for next month",
  "section7_pos": "Pinch of Salt Watch — status of outstanding unverified signals",
  "linkedin_extract": "400-word LinkedIn extract from Signal of the Month",
  "x_thread": ["Tweet 1: top takeaway", "Tweet 2", "Tweet 3", "Tweet 4", "Tweet 5: link"],
  "facebook_summary": "200-word conversational Facebook summary",
  "hivecast_script": "90-second spoken HiveCast monthly highlight script"
}}"""

    # Call Claude
    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model="claude-opus-4-6",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()

        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        report_data = json.loads(raw)

    except Exception as exc:
        log.error("Claude synthesis failed for monthly report: %s", exc)
        return None

    # Build drafts dict for content pack pipeline
    blog_content = "\n\n".join([
        report_data.get("section1_numbers", ""),
        report_data.get("section2_domains", ""),
        report_data.get("section3_scorecard", ""),
        report_data.get("section4_trajectories", ""),
        report_data.get("section5_signal", ""),
        report_data.get("section6_watching", ""),
        report_data.get("section7_pos", ""),
    ])

    drafts = {
        "blog": {
            "title": report_data.get("title", f"{month_name} {year} HiveReport"),
            "content": blog_content,
            "meta_description": report_data.get("meta_description", ""),
        },
        "linkedin": {
            "content": report_data.get("linkedin_extract", ""),
        },
        "x": {
            "type": "thread",
            "tweets": report_data.get("x_thread", []),
        },
        "facebook": {
            "content": report_data.get("facebook_summary", ""),
        },
        "hivecast": {
            "script": report_data.get("hivecast_script", ""),
        },
        "instagram": {
            "content": report_data.get("linkedin_extract", "")[:400],
            "hashtags": ["NewsHive", "HiveReport", "TechIntelligence"],
        },
        "suggested_visuals": f"NewsHive Monthly HiveReport — {month_name} {year}",
    }

    # Get a cluster_id for the pack (optional)
    cluster_id = None
    try:
        async with get_conn() as conn:
            cluster_id = await conn.fetchval(
                "SELECT id FROM clusters WHERE is_active = TRUE ORDER BY readiness_score DESC LIMIT 1"
            )
    except Exception:
        pass

    # Get recent signal_ids
    signal_ids = []
    try:
        async with get_conn() as conn:
            signals = await conn.fetch(
                "SELECT id FROM signals WHERE ingested_at >= $1 ORDER BY importance_composite DESC LIMIT 10",
                f"{year}-{month:02d}-01",
            )
            signal_ids = [r["id"] for r in signals]
    except Exception:
        pass

    # Create content pack (flows into HiveDeck approval queue)
    pack_id = await create_content_pack(
        cluster_id=cluster_id,
        alert_candidate_id=None,
        pack_type="monthly_report",
        trigger_reason="schedule",
        readiness_score=100.0,
        signal_ids=signal_ids,
    )

    if pack_id is None:
        log.error("Failed to create content pack for monthly report")
        return None

    ok = await store_drafts(pack_id, drafts)
    if not ok:
        log.error("Failed to store drafts for monthly report pack %s", pack_id)
        return None

    # Mark draft_generated_at in monthly_snapshots
    try:
        async with get_conn() as conn:
            await conn.execute(
                """
                UPDATE monthly_snapshots
                SET draft_generated_at = NOW()
                WHERE period_year = $1 AND period_month = $2
                """,
                year, month,
            )
    except Exception as exc:
        log.warning("Could not update monthly_snapshots draft_generated_at: %s", exc)

    log.info("Monthly report generated for %s/%s — pack %s", year, month, pack_id)
    return {"pack_id": str(pack_id), "month": month_name, "year": year}
