"""GET /connections — return which social platforms have credentials configured."""
from fastapi import APIRouter
from config import settings

router = APIRouter()


@router.get("/connections")
async def get_connections() -> dict:
    """
    Returns connection status for each social platform.
    Never exposes actual credential values — only whether they are set.
    """
    linkedin_author = None
    if settings.linkedin_org_id:
        linkedin_author = f"Organisation page ({settings.linkedin_org_id})"
    elif settings.linkedin_person_id:
        linkedin_author = "Personal profile"

    return {
        "x": {
            "connected": bool(settings.x_api_key and settings.x_access_token),
            "detail": "API Key + Access Token" if settings.x_api_key else None,
        },
        "facebook": {
            "connected": bool(settings.facebook_page_access_token and settings.facebook_page_id),
            "detail": f"Page ID: {settings.facebook_page_id}" if settings.facebook_page_id else None,
        },
        "instagram": {
            "connected": bool(settings.instagram_user_id and settings.facebook_page_access_token),
            "detail": f"Business Account: {settings.instagram_user_id}" if settings.instagram_user_id else None,
            "note": "Requires image/video URL — text-only posts not supported by Instagram Graph API",
        },
        "linkedin": {
            "connected": bool(settings.linkedin_access_token and (settings.linkedin_org_id or settings.linkedin_person_id)),
            "detail": linkedin_author,
        },
    }
