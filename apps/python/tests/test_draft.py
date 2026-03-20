# apps/python/tests/test_draft.py
import json
from unittest.mock import AsyncMock, MagicMock, patch


async def test_generate_pack_drafts_returns_all_platforms():
    """Mock Claude returning valid JSON — result must have all platform keys."""
    valid_response = {
        "blog": {"title": "Test Title", "content": "Test content", "meta_description": "Test desc"},
        "linkedin": {"content": "LinkedIn post", "hashtags": ["#AI", "#Tech"]},
        "instagram": {"content": "Instagram post", "hashtags": ["#AI"], "visual_suggestion": "Graph"},
        "facebook": {"content": "Facebook post"},
        "x": {"type": "single", "tweets": ["Tweet 1"]},
        "hivecast": {"script": "Script text", "lower_thirds": ["Lower 1"], "confidence_badge": "HIGH"},
        "suggested_visuals": "A clean infographic",
    }
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps(valid_response))]
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)

    with patch("services.draft._get_client", return_value=mock_client):
        from services.draft import generate_pack_drafts
        result = await generate_pack_drafts(
            cluster_name="AI Model Releases",
            confidence_level="HIGH",
            pack_type="standard",
            domain_tags=["ai"],
            signal_summaries="OpenAI releases GPT-5.",
        )

    assert result is not None
    assert "blog" in result
    assert "linkedin" in result
    assert "instagram" in result
    assert "facebook" in result
    assert "x" in result
    assert "hivecast" in result
    assert "suggested_visuals" in result


async def test_generate_pack_drafts_handles_malformed_json():
    """If Claude returns non-JSON text, returns None gracefully."""
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text="Sorry I can't do that")]
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)

    with patch("services.draft._get_client", return_value=mock_client):
        from services.draft import generate_pack_drafts
        result = await generate_pack_drafts(
            cluster_name="Test Cluster",
            confidence_level="MEDIUM",
            pack_type="standard",
            domain_tags=["seo"],
            signal_summaries="Some signals.",
        )

    assert result is None


async def test_generate_pack_drafts_handles_claude_error():
    """If Claude raises an exception, returns None without crashing."""
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(side_effect=Exception("API timeout"))

    with patch("services.draft._get_client", return_value=mock_client):
        from services.draft import generate_pack_drafts
        result = await generate_pack_drafts(
            cluster_name="Test Cluster",
            confidence_level="LOW",
            pack_type="standard",
            domain_tags=["vr"],
            signal_summaries="Some signals.",
        )

    assert result is None
