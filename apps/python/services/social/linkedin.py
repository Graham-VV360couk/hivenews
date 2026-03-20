"""LinkedIn UGC Posts API — post to company page or personal profile.

Prefers company/organisation page (LINKEDIN_ORG_ID) over personal profile
(LINKEDIN_PERSON_ID). Set LINKEDIN_ORG_ID to your company page numeric ID.
"""
import logging

import httpx

from config import settings

log = logging.getLogger(__name__)

_LI_API_URL = "https://api.linkedin.com/v2/ugcPosts"


def _get_author_urn() -> str | None:
    """Return the URN to post as — org page preferred, personal profile fallback."""
    if settings.linkedin_org_id:
        return f"urn:li:organization:{settings.linkedin_org_id}"
    if settings.linkedin_person_id:
        # Accept either a bare numeric ID or a full URN
        pid = settings.linkedin_person_id
        return pid if pid.startswith("urn:") else f"urn:li:person:{pid}"
    return None


async def post_to_linkedin(text: str) -> str | None:
    """Post to LinkedIn company page (or personal profile as fallback).
    Returns post URN or None on failure.
    """
    author = _get_author_urn()
    if not author or not settings.linkedin_access_token:
        log.debug("LinkedIn credentials not set — skipping")
        return None

    # Org page uses MemberNetworkVisibility = PUBLIC
    # Personal profile uses the same — works for both
    payload = {
        "author": author,
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
            post_id = resp.json().get("id")
            log.info("LinkedIn posted as %s → %s", author, post_id)
            return post_id
    except Exception as exc:
        log.warning("LinkedIn post failed (author=%s): %s", author, exc)
        return None
