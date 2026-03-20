"""URL deduplication using Redis.

Same URL from multiple sources is intentional — only exact URL duplicates
(after normalisation) are suppressed. See INGESTION.md for dedup strategy.
"""

import hashlib
from urllib.parse import urlparse, urlencode, parse_qs, urlunparse

from redis_client import get_redis

_DEDUP_TTL_SECONDS = 7 * 24 * 60 * 60  # 7 days
_UTM_PARAMS = {"utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"}


def _normalise_url(url: str) -> str:
    """Strip UTM params, trailing slash, and www prefix for fingerprinting."""
    parsed = urlparse(url.rstrip("/"))
    host = parsed.netloc.removeprefix("www.")
    filtered_qs = {k: v for k, v in parse_qs(parsed.query).items() if k not in _UTM_PARAMS}
    return urlunparse((parsed.scheme, host, parsed.path, "", urlencode(filtered_qs, doseq=True), ""))


def _fingerprint(url: str) -> str:
    return hashlib.sha256(_normalise_url(url).encode()).hexdigest()


async def is_duplicate(url: str) -> bool:
    key = f"dedup:{_fingerprint(url)}"
    return bool(await get_redis().exists(key))


async def mark_seen(url: str) -> None:
    key = f"dedup:{_fingerprint(url)}"
    await get_redis().setex(key, _DEDUP_TTL_SECONDS, "1")
