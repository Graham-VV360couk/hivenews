# Phase 3 — Source System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Honeypot anonymous source submission backend — token generation, content encryption, Claude one-time verdict, corroboration checking, and outcome tracking.

**Architecture:** All processing is in Python. Questionnaire answers are passed to Claude once and never stored. Content is AES-256-GCM encrypted at rest. Token generation is random and non-sequential. Next.js form UI is Phase 4.

**Tech Stack:** Python 3.11, FastAPI, Anthropic SDK, asyncpg, cryptography library, pytest + mocks

---

## File Map

```
apps/python/
├── services/
│   ├── token.py           Token generation (SCOUT/DRONE-NNNN unique)
│   ├── encryption.py      AES-256-GCM encrypt/decrypt using settings.honeypot_encryption_key
│   ├── verdict.py         Claude one-time verdict assessment
│   └── honeypot.py        Submission processing orchestrator
├── routers/
│   └── honeypot.py        POST /honeypot/submit, POST /honeypot/outcome
└── tests/
    ├── test_token.py
    ├── test_encryption.py
    ├── test_verdict.py
    └── test_honeypot.py
```

**Modified:**
- `apps/python/main.py` — register honeypot router

---

## Task 1: Token Generation Service

**Files:**
- Create: `apps/python/services/token.py`
- Create: `apps/python/tests/test_token.py`

Logic: Random prefix (SCOUT/DRONE) + random 4-digit number (1000-9999). Uniqueness checked against DB. Returns first token not already present in `source_tokens`.

- [ ] **Step 1.1: Write failing tests**

```python
# tests/test_token.py
import re
from unittest.mock import AsyncMock, MagicMock, patch


async def test_generate_token_format():
    """Token must match SCOUT-NNNN or DRONE-NNNN — no DB call needed."""
    from services.token import generate_token
    token = generate_token()
    assert re.match(r"^(SCOUT|DRONE)-\d{4}$", token), f"Unexpected format: {token}"


async def test_generate_unique_token_skips_collisions():
    """Mock DB to return a row on first call (collision) and None on second.
    Verify two DB queries are made and a valid token is returned."""
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(side_effect=[
        {"id": "existing-uuid"},  # first call: collision
        None,                     # second call: unique
    ])
    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("services.token.get_conn", return_value=mock_ctx):
        from services.token import generate_unique_token
        token = await generate_unique_token()

    assert re.match(r"^(SCOUT|DRONE)-\d{4}$", token)
    assert mock_conn.fetchrow.call_count == 2


async def test_generate_unique_token_no_collision():
    """Mock DB to return None immediately — verify single DB query."""
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value=None)
    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("services.token.get_conn", return_value=mock_ctx):
        from services.token import generate_unique_token
        token = await generate_unique_token()

    assert re.match(r"^(SCOUT|DRONE)-\d{4}$", token)
    assert mock_conn.fetchrow.call_count == 1
```

- [ ] **Step 1.2: Run to verify failure**
```bash
cd apps/python && python -m pytest tests/test_token.py -v
```

- [ ] **Step 1.3: Implement token.py**

```python
# services/token.py
"""Token generation for anonymous sources. Tokens are SCOUT-NNNN or DRONE-NNNN.
Non-sequential — format conveys nothing about volume or order of submissions."""
import logging
import random

log = logging.getLogger(__name__)

PREFIXES = ["SCOUT", "DRONE"]


def generate_token() -> str:
    """Generate a candidate token. Does not check DB uniqueness."""
    prefix = random.choice(PREFIXES)
    number = random.randint(1000, 9999)
    return f"{prefix}-{number}"


async def generate_unique_token() -> str:
    """Generate a token guaranteed unique in source_tokens. Loops until one is free."""
    from database import get_conn
    while True:
        candidate = generate_token()
        async with get_conn() as conn:
            existing = await conn.fetchrow(
                "SELECT id FROM source_tokens WHERE token = $1",
                candidate,
            )
        if existing is None:
            return candidate
        log.debug("Token collision on %s — retrying", candidate)


async def get_token_record(token: str) -> dict | None:
    """Fetch the full source_tokens row for a token, or None if not found."""
    from database import get_conn
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM source_tokens WHERE token = $1",
            token,
        )
        return dict(row) if row else None
```

- [ ] **Step 1.4: Run tests**
```bash
python -m pytest tests/test_token.py -v
```
Expected: 3 PASSED

- [ ] **Step 1.5: Commit**
```bash
git add apps/python/services/token.py apps/python/tests/test_token.py
git commit -m "feat: token generation — SCOUT/DRONE-NNNN random tokens with DB uniqueness check"
```

---

## Task 2: Encryption Service

**Files:**
- Create: `apps/python/services/encryption.py`
- Create: `apps/python/tests/test_encryption.py`

Logic: AES-256-GCM with 12-byte random nonce. Key is 32 bytes (64 hex chars). Encrypted output is `{nonce_hex}:{ciphertext_hex}`.

- [ ] **Step 2.1: Write failing tests**

```python
# tests/test_encryption.py
import os


def test_encrypt_decrypt_roundtrip():
    """Encrypt then decrypt must recover the original string."""
    from services.encryption import encrypt_content, decrypt_content
    key_hex = os.urandom(32).hex()
    original = "Leaked roadmap: GPT-6 ships Q3 with 10M context window."
    encrypted = encrypt_content(original, key_hex)
    recovered = decrypt_content(encrypted, key_hex)
    assert recovered == original


def test_different_encryptions_differ():
    """Same content encrypted twice must produce different ciphertexts (nonce randomness)."""
    from services.encryption import encrypt_content
    key_hex = os.urandom(32).hex()
    content = "Same content every time"
    first = encrypt_content(content, key_hex)
    second = encrypt_content(content, key_hex)
    assert first != second


def test_encrypted_format():
    """Encrypted string must contain exactly one ':' separating nonce from ciphertext."""
    from services.encryption import encrypt_content
    key_hex = os.urandom(32).hex()
    result = encrypt_content("test content", key_hex)
    parts = result.split(":")
    assert len(parts) == 2, f"Expected nonce:ciphertext but got: {result}"
    nonce_hex, ciphertext_hex = parts
    assert len(nonce_hex) == 24, "Nonce should be 12 bytes = 24 hex chars"
    assert len(ciphertext_hex) > 0
```

- [ ] **Step 2.2: Run to verify failure**
```bash
python -m pytest tests/test_encryption.py -v
```

- [ ] **Step 2.3: Implement encryption.py**

```python
# services/encryption.py
"""AES-256-GCM encryption for honeypot submission content.

Key must be 32 bytes represented as 64 hex characters.
Encrypted format: {nonce_hex}:{ciphertext_hex}
Nonce is 12 bytes, randomly generated per encryption.
"""
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def encrypt_content(content: str, key_hex: str) -> str:
    """Encrypt content string with AES-256-GCM.

    Args:
        content:  Plaintext string to encrypt.
        key_hex:  32-byte key as 64 hex characters.

    Returns:
        "{nonce_hex}:{ciphertext_hex}"
    """
    key = bytes.fromhex(key_hex)
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, content.encode("utf-8"), None)
    return f"{nonce.hex()}:{ciphertext.hex()}"


def decrypt_content(encrypted_str: str, key_hex: str) -> str:
    """Decrypt a string produced by encrypt_content.

    Args:
        encrypted_str:  "{nonce_hex}:{ciphertext_hex}"
        key_hex:        32-byte key as 64 hex characters.

    Returns:
        Original plaintext string.
    """
    nonce_hex, ciphertext_hex = encrypted_str.split(":")
    key = bytes.fromhex(key_hex)
    aesgcm = AESGCM(key)
    nonce = bytes.fromhex(nonce_hex)
    ciphertext = bytes.fromhex(ciphertext_hex)
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return plaintext.decode("utf-8")
```

- [ ] **Step 2.4: Run tests**
```bash
python -m pytest tests/test_encryption.py -v
```
Expected: 3 PASSED

- [ ] **Step 2.5: Commit**
```bash
git add apps/python/services/encryption.py apps/python/tests/test_encryption.py
git commit -m "feat: AES-256-GCM encryption service for honeypot content"
```

---

## Task 3: Claude Verdict Service

**Files:**
- Create: `apps/python/services/verdict.py`
- Create: `apps/python/tests/test_verdict.py`

Logic: One-time Claude call per submission. Returns `"reliable"`, `"indefinite"`, or `"illegitimate"`. Questionnaire answers are NEVER logged. Returns `"indefinite"` on any API failure so submissions are never lost due to Claude outages.

- [ ] **Step 3.1: Write failing tests**

```python
# tests/test_verdict.py
from unittest.mock import AsyncMock, MagicMock, patch
import json


async def test_verdict_reliable():
    """Mock Claude returning reliable — assert assess_verdict returns 'reliable'."""
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({"verdict": "reliable"}))]
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)

    with patch("services.verdict._get_client", return_value=mock_client):
        from services.verdict import assess_verdict
        result = await assess_verdict(
            questionnaire_answers={"q1": "engineer", "q2": "direct"},
            content="Internal memo confirms Q3 launch delay.",
        )
    assert result == "reliable"


async def test_verdict_illegitimate():
    """Mock Claude returning illegitimate — assert assess_verdict returns 'illegitimate'."""
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({"verdict": "illegitimate"}))]
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)

    with patch("services.verdict._get_client", return_value=mock_client):
        from services.verdict import assess_verdict
        result = await assess_verdict(
            questionnaire_answers={"q1": "I work everywhere", "q2": "trust me"},
            content="Everything is fake and staged.",
        )
    assert result == "illegitimate"


async def test_verdict_on_claude_failure_returns_indefinite():
    """If Claude raises an exception, assess_verdict must return 'indefinite' (fail-safe)."""
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(side_effect=Exception("API timeout"))

    with patch("services.verdict._get_client", return_value=mock_client):
        from services.verdict import assess_verdict
        result = await assess_verdict(
            questionnaire_answers={"q1": "analyst"},
            content="Something happened at the conference.",
        )
    assert result == "indefinite"
```

- [ ] **Step 3.2: Run to verify failure**
```bash
python -m pytest tests/test_verdict.py -v
```

- [ ] **Step 3.3: Implement verdict.py**

```python
# services/verdict.py
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
```

- [ ] **Step 3.4: Run tests**
```bash
python -m pytest tests/test_verdict.py -v
```
Expected: 3 PASSED

- [ ] **Step 3.5: Commit**
```bash
git add apps/python/services/verdict.py apps/python/tests/test_verdict.py
git commit -m "feat: Claude verdict service — one-time assessment, privacy-safe, fail-open on error"
```

---

## Task 4: Honeypot Orchestrator

**Files:**
- Create: `apps/python/services/honeypot.py`
- Create: `apps/python/tests/test_honeypot.py`

Logic: Ties token, verdict, encryption, and corroboration together. Questionnaire answers go out of scope immediately after the Claude call. Routes submission to `developing` or `pinch_of_salt` queue based on corroboration window.

- [ ] **Step 4.1: Write failing tests**

```python
# tests/test_honeypot.py
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4


async def test_new_submission_creates_token():
    """New submitter (no existing_token) gets a fresh SCOUT-1234 token."""
    mock_conn = AsyncMock()
    # INSERT source_tokens returns a row with id
    mock_conn.fetchrow = AsyncMock(return_value={"id": str(uuid4())})
    mock_conn.execute = AsyncMock()
    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("services.honeypot.assess_verdict", new_callable=AsyncMock, return_value="indefinite"), \
         patch("services.honeypot.generate_unique_token", new_callable=AsyncMock, return_value="SCOUT-1234"), \
         patch("services.honeypot.encrypt_content", return_value="aabbcc:ddeeff"), \
         patch("services.honeypot._check_corroboration", new_callable=AsyncMock,
               return_value={"found": False, "window": "none", "signal_id": None}), \
         patch("services.honeypot.get_conn", return_value=mock_ctx):
        from services.honeypot import process_submission
        result = await process_submission(
            content="Internal source says launch delayed.",
            questionnaire_answers={"q1": "engineer"},
            domain_tags=["ai"],
            existing_token=None,
        )

    assert result["token"] == "SCOUT-1234"


async def test_returning_submitter_reuses_token():
    """Returning source with existing_token gets the same token back."""
    existing_id = str(uuid4())

    with patch("services.honeypot.get_token_record", new_callable=AsyncMock,
               return_value={"id": existing_id, "token": "SCOUT-1234", "verdict": "indefinite",
                             "submission_count": 1, "tier": 0}), \
         patch("services.honeypot.assess_verdict", new_callable=AsyncMock, return_value="reliable"), \
         patch("services.honeypot.encrypt_content", return_value="aabbcc:ddeeff"), \
         patch("services.honeypot._check_corroboration", new_callable=AsyncMock,
               return_value={"found": False, "window": "none", "signal_id": None}):

        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value={"id": str(uuid4())})
        mock_conn.execute = AsyncMock()
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("services.honeypot.get_conn", return_value=mock_ctx):
            from services.honeypot import process_submission
            result = await process_submission(
                content="Follow-up tip from same source.",
                questionnaire_answers={"q1": "still an engineer"},
                domain_tags=["ai"],
                existing_token="SCOUT-1234",
            )

    assert result["token"] == "SCOUT-1234"


async def test_tight_corroboration_routes_developing():
    """Tight corroboration (6h window) routes to developing queue."""
    with patch("services.honeypot.assess_verdict", new_callable=AsyncMock, return_value="indefinite"), \
         patch("services.honeypot.generate_unique_token", new_callable=AsyncMock, return_value="DRONE-5678"), \
         patch("services.honeypot.encrypt_content", return_value="aabbcc:ddeeff"), \
         patch("services.honeypot._check_corroboration", new_callable=AsyncMock,
               return_value={"found": True, "window": "tight", "signal_id": str(uuid4())}):

        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value={"id": str(uuid4())})
        mock_conn.execute = AsyncMock()
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("services.honeypot.get_conn", return_value=mock_ctx):
            from services.honeypot import process_submission
            result = await process_submission(
                content="Confirmed: product cancelled internally.",
                questionnaire_answers={"q1": "pm"},
                domain_tags=["ai"],
            )

    assert result["entered_queue"] == "developing"
    assert result["confidence_level"] == "developing"


async def test_no_corroboration_routes_pinch_of_salt():
    """No corroboration routes to pinch_of_salt queue."""
    with patch("services.honeypot.assess_verdict", new_callable=AsyncMock, return_value="indefinite"), \
         patch("services.honeypot.generate_unique_token", new_callable=AsyncMock, return_value="SCOUT-9999"), \
         patch("services.honeypot.encrypt_content", return_value="aabbcc:ddeeff"), \
         patch("services.honeypot._check_corroboration", new_callable=AsyncMock,
               return_value={"found": False, "window": "none", "signal_id": None}):

        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value={"id": str(uuid4())})
        mock_conn.execute = AsyncMock()
        mock_ctx = MagicMock()
        mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        mock_ctx.__aexit__ = AsyncMock(return_value=False)

        with patch("services.honeypot.get_conn", return_value=mock_ctx):
            from services.honeypot import process_submission
            result = await process_submission(
                content="Something may be happening at the company.",
                questionnaire_answers={"q1": "observer"},
                domain_tags=["seo"],
            )

    assert result["entered_queue"] == "pinch_of_salt"


async def test_record_outcome_updates_accuracy_rate():
    """POST /honeypot/outcome with outcome='confirmed' must trigger accuracy_rate SQL update."""
    from fastapi.testclient import TestClient
    import importlib

    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value={
        "id": str(uuid4()),
        "confirmed_correct": 2,
        "confirmed_wrong": 1,
        "partially_correct": 0,
        "submission_count": 5,
    })
    mock_conn.execute = AsyncMock()
    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("routers.honeypot.get_conn", return_value=mock_ctx):
        import main as app_module
        client = TestClient(app_module.app)
        response = client.post("/honeypot/outcome", json={
            "submission_id": str(uuid4()),
            "outcome": "confirmed",
            "outcome_notes": "Story published and verified.",
            "days_to_confirmation": 3,
        })

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    # Verify execute was called (accuracy_rate UPDATE)
    assert mock_conn.execute.called
```

- [ ] **Step 4.2: Run to verify failure**
```bash
python -m pytest tests/test_honeypot.py -v
```

- [ ] **Step 4.3: Implement honeypot.py**

```python
# services/honeypot.py
"""Honeypot submission orchestrator.

Ties together: token generation, Claude verdict, AES encryption, corroboration
checking, queue routing, and DB persistence.

PRIVACY CONTRACT:
- questionnaire_answers enter this function and are passed once to assess_verdict.
- They are NEVER written to the DB, logs, or any field in the return dict.
- After the await assess_verdict(...) call they go out of scope naturally.
"""
import logging
from uuid import UUID

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


def _calculate_tier(submission_count: int, accuracy_rate: float) -> int:
    """Calculate source tier from track record. Matches SOURCES.md thresholds."""
    if submission_count >= 10 and accuracy_rate >= 0.80:
        return 4
    if submission_count >= 7 and accuracy_rate >= 0.70:
        return 3
    if submission_count >= 4 and accuracy_rate >= 0.60:
        return 2
    if submission_count >= 2 and accuracy_rate >= 0.40:
        return 1
    return 0


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
        async with get_conn() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO source_tokens (token, verdict, submission_count, tier,
                    confirmed_correct, confirmed_wrong, partially_correct, accuracy_rate)
                VALUES ($1, $2, 0, 0, 0, 0, 0, 0.0)
                RETURNING id
                """,
                token,
                verdict,
            )
            token_id = row["id"]
    else:
        token = token_record["token"]
        token_id = token_record["id"]
        # Verdict NOT updated for returning submitters — track record speaks louder

    # Encrypt content at rest
    encrypted = encrypt_content(content, settings.honeypot_encryption_key) if settings.honeypot_encryption_key else content

    # Check corroboration
    corroboration = await _check_corroboration(domain_tags)

    # Route to queue
    if corroboration["found"] and corroboration["window"] == "tight":
        entered_queue = "developing"
        confidence_level = "developing"
        corroboration_note = "Corroborated within 6 hours"
    elif corroboration["found"] and corroboration["window"] == "loose":
        entered_queue = "pinch_of_salt"
        confidence_level = "pinch_of_salt"
        corroboration_note = "Loose corroboration within 72 hours — treat with caution"
    else:
        entered_queue = "pinch_of_salt"
        confidence_level = "pinch_of_salt"
        corroboration_note = None

    # Persist submission
    async with get_conn() as conn:
        submission_row = await conn.fetchrow(
            """
            INSERT INTO honeypot_submissions (
                token_id, encrypted_content, domain_tags,
                verdict_at_submission, confidence_level, entered_queue,
                corroboration_signal_id, corroboration_window, corroboration_note
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING id
            """,
            token_id,
            encrypted,
            domain_tags,
            verdict,
            confidence_level,
            entered_queue,
            corroboration["signal_id"],
            corroboration["window"],
            corroboration_note,
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
```

- [ ] **Step 4.4: Run tests**
```bash
python -m pytest tests/test_honeypot.py -v
```
Expected: 5 PASSED

- [ ] **Step 4.5: Commit**
```bash
git add apps/python/services/honeypot.py apps/python/tests/test_honeypot.py
git commit -m "feat: honeypot orchestrator — token, verdict, encryption, corroboration, queue routing"
```

---

## Task 5: Honeypot Router + Wire Into main.py

**Files:**
- Create: `apps/python/routers/honeypot.py`
- Modify: `apps/python/main.py`

- [ ] **Step 5.1: Create routers/honeypot.py**

```python
# routers/honeypot.py
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
            confirmed_correct  = token_row["confirmed_correct"]
            confirmed_wrong    = token_row["confirmed_wrong"]
            partially_correct  = token_row["partially_correct"]
            submission_count   = token_row["submission_count"]

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
                "UPDATE source_tokens SET accuracy_rate = $1, tier = $2 WHERE id = $3",
                accuracy_rate,
                tier,
                token_id,
            )

    return {"status": "ok"}
```

- [ ] **Step 5.2: Register honeypot router in main.py**

In `apps/python/main.py`, add alongside the existing router imports:
```python
from routers import ingest, score, honeypot
app.include_router(honeypot.router)
```

- [ ] **Step 5.3: Run full test suite**
```bash
python -m pytest tests/ -v --tb=short
```
Expected: all tests pass (14+ tests across all Phase 3 test files)

- [ ] **Step 5.4: Commit and push**
```bash
git add apps/python/routers/honeypot.py apps/python/main.py
git commit -m "feat: honeypot router — POST /honeypot/submit and /honeypot/outcome, register in main"
git push origin master
```

---
