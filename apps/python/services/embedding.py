"""OpenAI text-embedding-3-large wrapper. Returns 1536-dimensional float vectors."""

from openai import AsyncOpenAI

from config import settings

_MODEL = "text-embedding-3-large"
_MAX_CHARS = 8000  # ~2000 tokens — safe limit for this model
_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


async def generate_embedding(text: str) -> list[float]:
    """Generate a 1536-dim embedding for the given text."""
    truncated = text[:_MAX_CHARS] if len(text) > _MAX_CHARS else text
    response = await _get_client().embeddings.create(
        model=_MODEL,
        input=truncated,
    )
    return response.data[0].embedding
