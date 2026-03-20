"""Honeypot submission and outcome endpoints.

POST /honeypot/submit  — anonymous source submits content
POST /honeypot/outcome — editorial team records outcome (confirmed/wrong/partial)
"""
import logging
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel

from database import get_conn
from services.honeypot import process_submission

log = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Submit
# ---------------------------------------------------------------------------

class HoneypotSubmitRequest(BaseModel):
    content: str
    questionnaire_answers: dict  # Q1-Q5 answers, processed then discarded
    domain_tags: list[str] = []
    existing_token: str | None = None
    contact_method: str | None = None  # Signal/ProtonMail, stored separately


class HoneypotSubmitResponse(BaseModel):
    token: str           # shown once — source must retain
    confidence_level: str
    entered_queue: str


@router.post("/honeypot/submit", response_model=HoneypotSubmitResponse)
async def submit_honeypot(req: HoneypotSubmitRequest) -> HoneypotSubmitResponse:
    result = await process_submission(
        content=req.content,
        questionnaire_answers=req.questionnaire_answers,
        domain_tags=req.domain_tags,
        existing_token=req.existing_token,
    )
    # questionnaire_answers does not go into result — it goes out of scope here
    return HoneypotSubmitResponse(
        token=result["token"],
        confidence_level=result["confidence_level"],
        entered_queue=result["entered_queue"],
    )


# ---------------------------------------------------------------------------
# Outcome
# ---------------------------------------------------------------------------

class HoneypotOutcomeRequest(BaseModel):
    submission_id: UUID
    outcome: str  # confirmed / wrong / partial / unresolved
    outcome_notes: str | None = None
    days_to_confirmation: int | None = None


@router.post("/honeypot/outcome")
async def record_outcome(req: HoneypotOutcomeRequest) -> dict:
    """Record editorial outcome for a submission and update source token accuracy."""
    async with get_conn() as conn:
        # Update the submission row
        await conn.execute(
            """
            UPDATE honeypot_submissions
            SET outcome              = $1,
                outcome_at           = NOW(),
                outcome_notes        = $2,
                days_to_confirmation = $3
            WHERE id = $4
            """,
            req.outcome,
            req.outcome_notes,
            req.days_to_confirmation,
            req.submission_id,
        )

        # Fetch the token_id for this submission
        sub_row = await conn.fetchrow(
            "SELECT token_id FROM honeypot_submissions WHERE id = $1",
            req.submission_id,
        )
        if not sub_row:
            log.warning("Outcome recorded for unknown submission %s", req.submission_id)
            return {"status": "ok"}

        token_id = sub_row["token_id"]

        # Increment the appropriate counter on source_tokens
        if req.outcome == "confirmed":
            await conn.execute(
                "UPDATE source_tokens SET confirmed_correct = confirmed_correct + 1 WHERE id = $1",
                token_id,
            )
        elif req.outcome == "wrong":
            await conn.execute(
                "UPDATE source_tokens SET confirmed_wrong = confirmed_wrong + 1 WHERE id = $1",
                token_id,
            )
        elif req.outcome == "partial":
            await conn.execute(
                "UPDATE source_tokens SET partially_correct = partially_correct + 1 WHERE id = $1",
                token_id,
            )
        # "unresolved" — no counter change

        # Recalculate accuracy_rate and tier
        token_row = await conn.fetchrow(
            """
            SELECT submission_count, confirmed_correct, confirmed_wrong, partially_correct
            FROM source_tokens WHERE id = $1
            """,
            token_id,
        )
        if token_row:
            confirmed_correct = token_row["confirmed_correct"]
            confirmed_wrong   = token_row["confirmed_wrong"]
            partially_correct = token_row["partially_correct"]
            submission_count  = token_row["submission_count"]

            denominator = confirmed_correct + confirmed_wrong + partially_correct
            accuracy_rate = (confirmed_correct / denominator) if denominator > 0 else 0.0

            # Tier thresholds from SOURCES.md
            if submission_count >= 10 and accuracy_rate >= 0.80:
                tier = 4
            elif submission_count >= 7 and accuracy_rate >= 0.70:
                tier = 3
            elif submission_count >= 4 and accuracy_rate >= 0.60:
                tier = 2
            elif submission_count >= 2 and accuracy_rate >= 0.40:
                tier = 1
            else:
                tier = 0

            await conn.execute(
                "UPDATE source_tokens SET accuracy_rate = $1, current_tier = $2 WHERE id = $3",
                accuracy_rate,
                tier,
                token_id,
            )

    return {"status": "ok"}
