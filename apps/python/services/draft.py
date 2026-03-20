"""Claude-powered multi-platform content draft generation.

Single Claude call produces all platform drafts (blog, linkedin, instagram,
facebook, x, hivecast) from cluster signals in one shot.
"""
import json
import logging

from anthropic import AsyncAnthropic

from config import settings

log = logging.getLogger(__name__)

_client: AsyncAnthropic | None = None

_SYSTEM_PROMPT = """\
You are writing content for NewsHive — a technology intelligence platform covering AI, VR/AR, Vibe Coding, and SEO.

VOICE GUIDE:
Write as a thoughtful, experienced observer who finds the human truth inside the technical story. Speak directly without being cold. Arrive at strong opinions through visible reasoning. Use the specific detail to illuminate the general point. Be never more than one sentence away from either a dry laugh or genuine emotion.

Never open with hollow phrases ("Excited to share", "Big news").
Never use meaningless amplifiers ("huge", "massive", "game-changing").
Never summarise without adding a perspective.
Rhythm matters. Long sentences that build, followed by short ones that land.\
"""

_USER_PROMPT_TEMPLATE = """\
Generate a complete content pack for NewsHive.

Pack: {cluster_name}
Confidence: {confidence_level}
Type: {pack_type}
Domains: {domain_tags}

Source signals:
{signal_summaries}

Return as JSON only — no preamble:
{{"blog": {{"title": "", "content": "", "meta_description": ""}}, "linkedin": {{"content": "", "hashtags": []}}, "instagram": {{"content": "", "hashtags": [], "visual_suggestion": ""}}, "facebook": {{"content": ""}}, "x": {{"type": "single", "tweets": []}}, "hivecast": {{"script": "", "lower_thirds": [], "confidence_badge": ""}}, "suggested_visuals": ""}}\
"""

_REQUIRED_KEYS = {"blog", "linkedin", "instagram", "facebook", "x", "hivecast", "suggested_visuals"}


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


async def generate_pack_drafts(
    cluster_name: str,
    confidence_level: str,
    pack_type: str,
    domain_tags: list[str],
    signal_summaries: str,
    trajectory_summaries: str = "",
    previous_posts: str = "",
) -> dict | None:
    """Call Claude to generate all platform drafts in a single call.

    Args:
        cluster_name: Human-readable cluster label.
        confidence_level: HIGH / MEDIUM / LOW — drives tone.
        pack_type: standard / alert_breaking / alert_significant / pinch_of_salt.
        domain_tags: List of domain strings, e.g. ["ai", "vr"].
        signal_summaries: Concatenated signal summaries (truncated to 4000 chars).
        trajectory_summaries: Optional trajectory context (Phase 6+).
        previous_posts: Optional recent published posts to avoid repetition.

    Returns:
        dict with keys blog/linkedin/instagram/facebook/x/hivecast/suggested_visuals,
        or None if Claude fails or returns unparseable output.
    """
    # Truncate signal summaries to stay within token budget
    truncated_summaries = signal_summaries[:4000]
    if len(signal_summaries) > 4000:
        truncated_summaries += "\n[...truncated]"

    user_prompt = _USER_PROMPT_TEMPLATE.format(
        cluster_name=cluster_name,
        confidence_level=confidence_level,
        pack_type=pack_type,
        domain_tags=", ".join(domain_tags) if domain_tags else "general",
        signal_summaries=truncated_summaries,
    )

    try:
        response = await _get_client().messages.create(
            model="claude-opus-4-6",
            max_tokens=4096,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        raw = response.content[0].text.strip()
        data = json.loads(raw)

        # Validate all required platform keys are present
        missing = _REQUIRED_KEYS - set(data.keys())
        if missing:
            log.warning("Draft response missing keys: %s", missing)
            return None

        return data

    except json.JSONDecodeError as exc:
        log.warning("Draft generation returned non-JSON for cluster %r: %s", cluster_name, exc)
        return None
    except Exception as exc:
        log.warning("Draft generation failed for cluster %r: %s", cluster_name, exc)
        return None
