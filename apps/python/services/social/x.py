"""X (Twitter) API v2 posting via OAuth 1.0a."""
import base64
import hashlib
import hmac
import logging
import time
import urllib.parse
import uuid

import httpx

from config import settings

log = logging.getLogger(__name__)

_X_API_URL = "https://api.twitter.com/2/tweets"


def _oauth_header(method: str, url: str, body_params: dict) -> str:
    """Build OAuth 1.0a Authorization header for X API."""
    enc = lambda s: urllib.parse.quote(str(s), safe="")
    oauth = {
        "oauth_consumer_key": settings.x_api_key,
        "oauth_nonce": uuid.uuid4().hex,
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_token": settings.x_access_token,
        "oauth_version": "1.0",
    }
    all_params = {**body_params, **oauth}
    param_str = "&".join(
        f"{enc(k)}={enc(v)}" for k, v in sorted(all_params.items())
    )
    base = f"{method}&{enc(url)}&{enc(param_str)}"
    signing_key = f"{enc(settings.x_api_secret)}&{enc(settings.x_access_secret)}"
    sig = base64.b64encode(
        hmac.new(signing_key.encode(), base.encode(), hashlib.sha1).digest()
    ).decode()
    oauth["oauth_signature"] = sig
    parts = [f'{k}="{enc(v)}"' for k, v in sorted(oauth.items())]
    return "OAuth " + ", ".join(parts)


async def post_tweet(text: str) -> str | None:
    """Post a single tweet. Returns tweet ID or None on failure."""
    if not all([settings.x_api_key, settings.x_api_secret,
                settings.x_access_token, settings.x_access_secret]):
        log.debug("X credentials not set — skipping")
        return None
    try:
        headers = {
            "Authorization": _oauth_header("POST", _X_API_URL, {}),
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(_X_API_URL, headers=headers, json={"text": text})
            resp.raise_for_status()
            return str(resp.json()["data"]["id"])
    except Exception as exc:
        log.warning("X tweet failed: %s", exc)
        return None


async def post_thread(tweets: list[str]) -> str | None:
    """Post a thread. Returns the root tweet ID or None on failure."""
    if not tweets:
        return None
    root_id = await post_tweet(tweets[0])
    if root_id is None or len(tweets) == 1:
        return root_id
    reply_id = root_id
    for tweet_text in tweets[1:]:
        if not all([settings.x_api_key, settings.x_access_token]):
            break
        try:
            body = {"text": tweet_text, "reply": {"in_reply_to_tweet_id": reply_id}}
            headers = {
                "Authorization": _oauth_header("POST", _X_API_URL, {}),
                "Content-Type": "application/json",
            }
            async with httpx.AsyncClient() as client:
                resp = await client.post(_X_API_URL, headers=headers, json=body)
                resp.raise_for_status()
                reply_id = str(resp.json()["data"]["id"])
        except Exception as exc:
            log.warning("X thread reply failed: %s", exc)
            break
    return root_id
