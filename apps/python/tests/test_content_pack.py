# apps/python/tests/test_content_pack.py
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


async def test_create_content_pack_returns_uuid():
    """create_content_pack should INSERT and return the UUID from the DB row."""
    pack_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value={"id": pack_id})

    mock_pool_ctx = MagicMock()
    mock_pool_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_pool_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.content_pack.get_conn", return_value=mock_pool_ctx):
        from services.content_pack import create_content_pack
        result = await create_content_pack(
            cluster_id=uuid.uuid4(),
            alert_candidate_id=None,
            pack_type="standard",
            confidence_level="HIGH",
            signal_ids=[uuid.uuid4(), uuid.uuid4()],
            readiness_score=82.5,
            trigger_reason="readiness_threshold",
        )

    assert result == pack_id


async def test_store_drafts_inserts_one_row_per_platform():
    """store_drafts should INSERT exactly one row per platform (6 total)."""
    pack_id = uuid.uuid4()
    drafts = {
        "blog": {"title": "T", "content": "C", "meta_description": "M"},
        "linkedin": {"content": "L", "hashtags": ["#AI"]},
        "instagram": {"content": "I", "hashtags": ["#AI"], "visual_suggestion": "V"},
        "facebook": {"content": "F"},
        "x": {"type": "single", "tweets": ["Tweet"]},
        "hivecast": {"script": "S", "lower_thirds": ["L1"], "confidence_badge": "HIGH"},
    }

    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock()

    mock_pool_ctx = MagicMock()
    mock_pool_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_pool_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.content_pack.get_conn", return_value=mock_pool_ctx):
        from services.content_pack import store_drafts
        await store_drafts(pack_id=pack_id, drafts=drafts)

    assert mock_conn.execute.call_count == 6


async def test_trigger_pack_for_cluster_returns_none_on_draft_failure():
    """If generate_pack_drafts returns None, trigger_pack_for_cluster returns None without crashing."""
    cluster_id = uuid.uuid4()

    mock_conn = AsyncMock()
    # Cluster info fetch
    mock_conn.fetchrow = AsyncMock(return_value={
        "name": "Test Cluster",
        "domain_tags": ["ai"],
        "confidence_level": "HIGH",
        "readiness_score": 82.5,
        "days_since_last_pack": 2,
    })
    # Signal rows fetch
    mock_conn.fetch = AsyncMock(return_value=[
        {"title": "Signal 1", "content_summary": "Summary 1", "source_name": "TechCrunch"},
    ])

    mock_pool_ctx = MagicMock()
    mock_pool_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_pool_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.content_pack.get_conn", return_value=mock_pool_ctx), \
         patch("services.content_pack.generate_pack_drafts", return_value=None):
        from services.content_pack import trigger_pack_for_cluster
        result = await trigger_pack_for_cluster(cluster_id=cluster_id)

    assert result is None
