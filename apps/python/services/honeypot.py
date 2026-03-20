"""Honeypot submission orchestrator.

Ties together: token generation, Claude verdict, AES encryption, corroboration
checking, queue routing, and DB persistence.

PRIVACY CONTRACT:
- questionnaire_answers enter this function and are passed once to assess_verdict.
- They are NEVER written to the DB, logs, or any field in the return dict.
- After the await assess_verdict(...) call they go out of scope naturally.
"""
import logging

from config import settings
from database import get_conn
from services.token import generate_unique_token, get_token_record
from services.encryption import encrypt_content
from services.verdict import assess_verdict

log = logging.getLogger(__name__)


async def _check_corroboration(domain_tags: list[str]) -> dict:
    """Check signals table for overlapping domain_tags in tight (6h) and loose (72h) windows.

    Returns:
        {"found": bool, "window": "tight" | "loose" | "none", "signal_id": UUID | None}
    """
    if not domain_tags:
        return {"found": False, "window": "none", "signal_id": None}

    async with get_conn() as conn:
        # Tight window: 6 hours
        row = await conn.fetchrow(
            """
            SELECT id FROM signals
            WHERE domain_tags && $1
              AND ingested_at > NOW() - INTERVAL '6 hours'
              AND processed = TRUE
            ORDER BY ingested_at DESC
            LIMIT 1
            """,
            domain_tags,
        )
        if row:
            return {"found": True, "window": "tight", "signal_id": row["id"]}

        # Loose window: 72 hours
        row = await conn.fetchrow(
            """
            SELECT id FROM signals
            WHERE domain_tags && $1
              AND ingested_at > NOW() - INTERVAL '72 hours'
              AND processed = TRUE
            ORDER BY ingested_at DESC
            LIMIT 1
            """,
            domain_tags,
        )
        if row:
            return {"found": True, "window": "loose", "signal_id": row["id"]}

    return {"found": False, "window": "none", "signal_id": None}


async def process_submission(
    content: str,
    questionnaire_answers: dict,  # NEVER stored, logged, or retained after this call
    domain_tags: list[str],
    existing_token: str | None = None,
) -> dict:
    """Process a honeypot submission end-to-end.

    Steps:
    1. Get or create token record
    2. Run Claude verdict (answers used once, then go out of scope)
    3. If new token: INSERT into source_tokens with verdict
    4. If returning: get existing token_id (verdict NOT updated — track record speaks louder)
    5. Encrypt content
    6. Check corroboration (6h tight, 72h loose)
    7. Route: tight → developing; loose → pinch_of_salt with note; none → pinch_of_salt
    8. INSERT into honeypot_submissions
    9. UPDATE source_tokens: submission_count+1, last_submission_at=NOW()

    Returns:
        {token, token_id, verdict, confidence_level, entered_queue,
         corroboration_found, corroboration_window}
    """
    is_returning = existing_token is not None
    token_record = None

    if is_returning:
        token_record = await get_token_record(existing_token)
        if token_record is None:
            # Token not found — treat as new submitter
            is_returning = False
            log.info("Provided token not found — creating new token")

    # Run Claude verdict — answers used here and go out of scope immediately after
    verdict = await assess_verdict(questionnaire_answers, content)
    # questionnaire_answers not referenced again below this line

    if not is_returning:
        # Create new token and source_tokens record
        token = await generate_unique_token()
        token_prefix = token.split("-")[0]  # SCOUT or DRONE
        async with get_conn() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO source_tokens (
                    token, token_prefix, initial_verdict,
                    submission_count, current_tier,
                    confirmed_correct, confirmed_wrong, partially_correct
                ) VALUES ($1, $2, $3, 0, 0, 0, 0, 0)
                RETURNING id
                """,
                token,
                token_prefix,
                verdict,
            )
            token_id = row["id"]
    else:
        token = token_record["token"]
        token_id = token_record["id"]
        # Verdict NOT updated for returning submitters — track record speaks louder

    # Encrypt content at rest (fall back to plaintext if no key configured)
    encrypted = (
        encrypt_content(content, settings.honeypot_encryption_key)
        if settings.honeypot_encryption_key
        else content
    )

    # Check corroboration
    corroboration = await _check_corroboration(domain_tags)

    # Route to queue
    if corroboration["found"] and corroboration["window"] == "tight":
        entered_queue = "developing"
        confidence_level = "developing"
    elif corroboration["found"] and corroboration["window"] == "loose":
        entered_queue = "pinch_of_salt"
        confidence_level = "pinch_of_salt"
    else:
        entered_queue = "pinch_of_salt"
        confidence_level = "pinch_of_salt"

    # Persist submission
    async with get_conn() as conn:
        submission_row = await conn.fetchrow(
            """
            INSERT INTO honeypot_submissions (
                token_id, content_encrypted,
                instant_corroboration, corroboration_signal_id, corroboration_window,
                confidence_level, entered_queue,
                submission_sequence
            ) VALUES ($1, $2, $3, $4, $5, $6, $7,
                (SELECT COALESCE(MAX(submission_sequence), 0) + 1
                 FROM honeypot_submissions WHERE token_id = $1)
            )
            RETURNING id
            """,
            token_id,
            encrypted,
            corroboration["found"],
            corroboration["signal_id"],
            corroboration["window"],
            confidence_level,
            entered_queue,
        )
        submission_id = submission_row["id"]

        # Update token stats
        await conn.execute(
            """
            UPDATE source_tokens
            SET submission_count = submission_count + 1,
                last_submission_at = NOW()
            WHERE id = $1
            """,
            token_id,
        )

    log.info("Submission %s processed — token %s, queue %s", submission_id, token, entered_queue)

    return {
        "token": token,
        "token_id": token_id,
        "verdict": verdict,
        "confidence_level": confidence_level,
        "entered_queue": entered_queue,
        "corroboration_found": corroboration["found"],
        "corroboration_window": corroboration["window"],
    }
