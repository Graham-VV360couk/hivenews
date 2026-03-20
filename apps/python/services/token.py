"""Token generation for anonymous sources. Tokens are SCOUT-NNNN or DRONE-NNNN.
Non-sequential — format conveys nothing about volume or order of submissions."""
import logging
import random

from database import get_conn

log = logging.getLogger(__name__)

PREFIXES = ["SCOUT", "DRONE"]


def generate_token() -> str:
    """Generate a candidate token. Does not check DB uniqueness."""
    prefix = random.choice(PREFIXES)
    number = random.randint(1000, 9999)
    return f"{prefix}-{number}"


async def generate_unique_token() -> str:
    """Generate a token guaranteed unique in source_tokens. Loops until one is free."""
    while True:
        candidate = generate_token()
        async with get_conn() as conn:
            existing = await conn.fetchrow(
                "SELECT id FROM source_tokens WHERE token = $1",
                candidate,
            )
        if existing is None:
            return candidate
        log.debug("Token collision on %s — retrying", candidate)


async def get_token_record(token: str) -> dict | None:
    """Fetch the full source_tokens row for a token, or None if not found."""
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM source_tokens WHERE token = $1",
            token,
        )
        return dict(row) if row else None
