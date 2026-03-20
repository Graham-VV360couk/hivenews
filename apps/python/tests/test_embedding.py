from unittest.mock import AsyncMock, MagicMock, patch


async def test_embedding_returns_1536_floats():
    mock_response = MagicMock()
    mock_response.data = [MagicMock(embedding=[0.1] * 1536)]
    mock_client = AsyncMock()
    mock_client.embeddings.create = AsyncMock(return_value=mock_response)

    with patch("services.embedding._get_client", return_value=mock_client):
        from services.embedding import generate_embedding
        result = await generate_embedding("Test signal about AI.")
        assert len(result) == 1536
        assert all(isinstance(v, float) for v in result)


async def test_embedding_truncates_long_text():
    mock_response = MagicMock()
    mock_response.data = [MagicMock(embedding=[0.0] * 1536)]
    mock_client = AsyncMock()
    mock_client.embeddings.create = AsyncMock(return_value=mock_response)

    with patch("services.embedding._get_client", return_value=mock_client):
        from services.embedding import generate_embedding
        await generate_embedding("x" * 20000)
        call_text = mock_client.embeddings.create.call_args[1]["input"]
        assert len(call_text) <= 8000


async def test_embedding_passes_text_unchanged_when_short():
    mock_response = MagicMock()
    mock_response.data = [MagicMock(embedding=[0.0] * 1536)]
    mock_client = AsyncMock()
    mock_client.embeddings.create = AsyncMock(return_value=mock_response)

    with patch("services.embedding._get_client", return_value=mock_client):
        from services.embedding import generate_embedding
        short_text = "Short signal."
        await generate_embedding(short_text)
        call_text = mock_client.embeddings.create.call_args[1]["input"]
        assert call_text == short_text
