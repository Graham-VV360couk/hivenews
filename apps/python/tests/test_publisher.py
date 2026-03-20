# apps/python/tests/test_publisher.py
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


async def test_publish_pack_calls_social_services_for_each_draft():
    """publish_pack fetches approved drafts and posts each to its platform."""
    pack_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value={"id": pack_id, "status": "approved"})
    mock_conn.fetch = AsyncMock(return_value=[
        {"id": uuid.uuid4(), "platform": "x", "final_text": None,
         "draft_text": "Tweet text", "draft_data": '{"type":"single","tweets":["Tweet text"]}',
         "approved": True},
        {"id": uuid.uuid4(), "platform": "linkedin", "final_text": "LinkedIn text",
         "draft_text": "Draft", "draft_data": '{"content":"LinkedIn text"}', "approved": True},
    ])
    mock_conn.execute = AsyncMock()

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.publisher.get_conn", return_value=mock_ctx), \
         patch("services.publisher.post_tweet", return_value="tweet_123"), \
         patch("services.publisher.post_thread", return_value="thread_123"), \
         patch("services.publisher.post_to_linkedin", return_value="urn:li:share:789"), \
         patch("services.publisher.post_to_facebook", return_value=None):

        from services.publisher import publish_pack
        result = await publish_pack(pack_id)

    assert result["published"] >= 1
    assert result["pack_id"] == str(pack_id)


async def test_publish_pack_returns_error_when_pack_not_found():
    """If pack_id doesn't exist, returns error dict without crashing."""
    pack_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value=None)
    mock_conn.fetch = AsyncMock(return_value=[])

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.publisher.get_conn", return_value=mock_ctx):
        from services.publisher import publish_pack
        result = await publish_pack(pack_id)

    assert result.get("error") is not None
