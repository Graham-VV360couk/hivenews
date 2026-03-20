from unittest.mock import AsyncMock, MagicMock, patch
import json


async def test_composite_score_calculation():
    from services.scoring import calculate_composite
    score = calculate_composite(magnitude=8.0, irreversibility=7.0, blast_radius=6.0, velocity=9.0)
    expected = round(8.0*0.35 + 7.0*0.25 + 6.0*0.25 + 9.0*0.15, 1)
    assert score == expected


async def test_score_signal_returns_all_axes():
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text=json.dumps({
        "magnitude": 7.0, "irreversibility": 6.0,
        "blast_radius": 8.0, "velocity": 5.0,
        "reasoning": "Significant AI development"
    }))]
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)
    with patch("services.scoring._get_client", return_value=mock_client):
        from services.scoring import score_signal
        result = await score_signal(
            title="GPT-5 released",
            content="OpenAI releases GPT-5 with major capabilities",
            source_name="OpenAI Blog",
            source_tier=1,
            domain_tags=["ai"]
        )
    assert result["magnitude"] == 7.0
    assert result["irreversibility"] == 6.0
    assert result["blast_radius"] == 8.0
    assert result["velocity"] == 5.0
    assert "composite" in result
    assert result["composite"] == round(7.0*0.35 + 6.0*0.25 + 8.0*0.25 + 5.0*0.15, 1)


async def test_score_signal_handles_malformed_claude_response():
    """If Claude returns invalid JSON, scoring returns None gracefully."""
    mock_response = MagicMock()
    mock_response.content = [MagicMock(text="Sorry, I cannot score this.")]
    mock_client = AsyncMock()
    mock_client.messages.create = AsyncMock(return_value=mock_response)
    with patch("services.scoring._get_client", return_value=mock_client):
        from services.scoring import score_signal
        result = await score_signal("title", "content", "source", 3, ["ai"])
    assert result is None


async def test_score_above_threshold_flags_alert_candidate():
    from services.scoring import calculate_composite, ALERT_CANDIDATE_THRESHOLD
    score = calculate_composite(magnitude=9.0, irreversibility=9.0, blast_radius=9.0, velocity=9.0)
    assert score > ALERT_CANDIDATE_THRESHOLD
