from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4


async def test_new_submission_creates_token():
    """New submitter (no existing_token) gets a fresh SCOUT-1234 token."""
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(side_effect=[
        {"id": str(uuid4())},  # INSERT source_tokens RETURNING id
        {"id": str(uuid4())},  # INSERT honeypot_submissions RETURNING id
    ])
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
               return_value={"id": existing_id, "token": "SCOUT-1234", "initial_verdict": "indefinite",
                             "submission_count": 1, "current_tier": 0}), \
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
        mock_conn.fetchrow = AsyncMock(side_effect=[
            {"id": str(uuid4())},
            {"id": str(uuid4())},
        ])
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
        mock_conn.fetchrow = AsyncMock(side_effect=[
            {"id": str(uuid4())},
            {"id": str(uuid4())},
        ])
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


async def test_record_outcome_updates_accuracy_rate(client):
    """POST /honeypot/outcome with outcome='confirmed' must update accuracy_rate in DB."""
    submission_id = uuid4()
    token_id = uuid4()

    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock()
    mock_conn.fetchrow = AsyncMock(side_effect=[
        {"token_id": token_id},  # SELECT token_id FROM honeypot_submissions
        {                         # SELECT stats FROM source_tokens
            "submission_count": 5,
            "confirmed_correct": 2,
            "confirmed_wrong": 1,
            "partially_correct": 0,
        },
    ])
    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=False)

    with patch("routers.honeypot.get_conn", return_value=mock_ctx):
        response = await client.post("/honeypot/outcome", json={
            "submission_id": str(submission_id),
            "outcome": "confirmed",
            "outcome_notes": "Story published and verified.",
            "days_to_confirmation": 3,
        })

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert mock_conn.execute.called
