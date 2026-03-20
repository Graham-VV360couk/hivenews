"""LinkedIn UGC Posts API — text post to personal profile."""
import logging

import httpx

from config import settings

log = logging.getLogger(__name__)

_LI_API_URL = "https://api.linkedin.com/v2/ugcPosts"


async def post_to_linkedin(text: str) -> str | None:
    """Post to LinkedIn. Returns post URN or None on failure."""
    if not settings.linkedin_access_token or not settings.linkedin_person_id:
        log.debug("LinkedIn credentials not set — skipping")
        return None
    payload = {
        "author": settings.linkedin_person_id,
        "lifecycleState": "PUBLISHED",
        "specificContent": {
            "com.linkedin.ugc.ShareContent": {
                "shareCommentary": {"text": text},
                "shareMediaCategory": "NONE",
            }
        },
        "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
    }
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                _LI_API_URL,
                headers={
                    "Authorization": f"Bearer {settings.linkedin_access_token}",
                    "Content-Type": "application/json",
                    "X-Restli-Protocol-Version": "2.0.0",
                },
                json=payload,
            )
            resp.raise_for_status()
            return resp.json().get("id")
    except Exception as exc:
        log.warning("LinkedIn post failed: %s", exc)
        return None
