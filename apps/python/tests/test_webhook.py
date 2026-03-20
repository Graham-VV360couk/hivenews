# apps/python/tests/test_webhook.py
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


async def test_fire_webhooks_posts_to_active_subscribers():
    """fire_webhooks sends POST to each active subscriber with a webhook_url."""
    pack_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=[
        {"webhook_url": "https://example.com/hook", "api_key": "key1"},
        {"webhook_url": "https://other.com/hook", "api_key": "key2"},
    ])

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    mock_resp = MagicMock()
    mock_resp.status_code = 200

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(return_value=mock_resp)

    with patch("services.webhook.get_conn", return_value=mock_ctx), \
         patch("services.webhook.httpx.AsyncClient", return_value=mock_client):
        from services.webhook import fire_webhooks
        await fire_webhooks(pack_id, "standard", ["ai"])

    assert mock_client.post.await_count == 2


async def test_fire_webhooks_skips_when_no_subscribers():
    """fire_webhooks does nothing if no subscribers have webhook URLs."""
    pack_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=[])

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.webhook.get_conn", return_value=mock_ctx):
        from services.webhook import fire_webhooks
        # Should not raise, just silently skip
        await fire_webhooks(pack_id, "standard", [])


async def test_fire_webhooks_continues_on_individual_failure():
    """If one webhook POST fails, others still fire."""
    pack_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=[
        {"webhook_url": "https://fail.example.com/hook", "api_key": "key1"},
        {"webhook_url": "https://ok.example.com/hook", "api_key": "key2"},
    ])

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    call_count = 0

    async def mock_post(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise Exception("timeout")
        return MagicMock(status_code=200)

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = mock_post

    with patch("services.webhook.get_conn", return_value=mock_ctx), \
         patch("services.webhook.httpx.AsyncClient", return_value=mock_client):
        from services.webhook import fire_webhooks
        await fire_webhooks(pack_id, "standard", ["ai"])

    assert call_count == 2
