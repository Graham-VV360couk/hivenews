"""Meta Graph API — Facebook page post.

Instagram requires a media container upload (image/video) before posting,
which depends on having an image URL. That is deferred to a later phase.
For now only Facebook page text posts are supported.
"""
import logging

import httpx

from config import settings

log = logging.getLogger(__name__)

_FB_API_URL = "https://graph.facebook.com/v19.0/{page_id}/feed"


async def post_to_facebook(text: str) -> str | None:
    """Post to Facebook page. Returns post ID or None on failure."""
    if not settings.facebook_page_access_token or not settings.facebook_page_id:
        log.debug("Facebook credentials not set — skipping")
        return None
    url = _FB_API_URL.format(page_id=settings.facebook_page_id)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                url,
                params={"access_token": settings.facebook_page_access_token},
                json={"message": text},
            )
            resp.raise_for_status()
            return resp.json().get("id")
    except Exception as exc:
        log.warning("Facebook post failed: %s", exc)
        return None
