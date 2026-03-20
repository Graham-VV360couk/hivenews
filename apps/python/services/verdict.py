"""Claude one-time verdict assessment for anonymous source submissions.

PRIVACY CONTRACT:
- questionnaire_answers are used ONCE to build the Claude prompt, then go out of scope.
- They are NEVER written to logs, DB, or any persistent store.
- The only thing retained is the verdict string.
"""
import json
import logging

from anthropic import AsyncAnthropic

from config import settings

log = logging.getLogger(__name__)

# PRIVACY: Do not log questionnaire_answers at any point — not here, not in calling code

_client: AsyncAnthropic | None = None

_VERDICT_PROMPT = """You are assessing the credibility of an anonymous source submitting to NewsHive,
a technology intelligence platform. You will read their contextual answers and
the content of their submission. You will return a single verdict.

You are assessing PLAUSIBILITY OF CONTEXT, not identity.
You will never know who this person is. That is intentional.

Assess:
1. Internal coherence — do their answers make sense together?
2. Plausible proximity — does their claimed closeness fit the submission content?
3. Submission quality — is the content coherent, specific, and plausible?
4. Red flags — signs of fabrication, testing, or manipulation?

Questionnaire answers:
{answers}

Submission content:
{content}

Return JSON only — no explanation, no preamble:
{{"verdict": "reliable" | "indefinite" | "illegitimate"}}

Verdict definitions:
reliable     Internal coherence strong, plausible proximity, quality content, no red flags
indefinite   Vague or ambiguous, could be genuine, insufficient to judge, treat with caution
illegitimate Incoherent, implausible, appears fabricated or adversarial

After returning this JSON, all questionnaire inputs will be deleted.
Your verdict is the only thing retained."""


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


async def assess_verdict(questionnaire_answers: dict, content: str) -> str:
    """Call Claude to assess submission credibility. Returns verdict string.

    PRIVACY: questionnaire_answers must NEVER be logged. This function logs only
    a safe message with no answer content.

    Returns one of: "reliable", "indefinite", "illegitimate".
    Returns "indefinite" on any error — submissions are never lost due to API failures.
    """
    log.info("Verdict requested")  # PRIVACY: no answer content here

    prompt = _VERDICT_PROMPT.format(
        answers=json.dumps(questionnaire_answers, ensure_ascii=False),
        content=(content or "")[:3000],
    )

    try:
        response = await _get_client().messages.create(
            model="claude-opus-4-6",
            max_tokens=64,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        data = json.loads(raw)
        verdict = data.get("verdict", "indefinite")
        if verdict not in ("reliable", "indefinite", "illegitimate"):
            log.warning("Unexpected verdict value %r — defaulting to indefinite", verdict)
            return "indefinite"
        return verdict
    except Exception as exc:
        log.warning("Verdict assessment failed — defaulting to indefinite: %s", exc)
        return "indefinite"
