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
