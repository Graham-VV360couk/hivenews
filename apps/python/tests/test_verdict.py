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
