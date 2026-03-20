# apps/python/tests/test_social.py
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# X
# ---------------------------------------------------------------------------

async def test_post_tweet_returns_id():
    """When X API returns 200 with data.id, returns the tweet ID."""
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"data": {"id": "123456789"}}
    mock_resp.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(return_value=mock_resp)

    with patch("services.social.x.httpx.AsyncClient", return_value=mock_client), \
         patch("services.social.x.settings") as mock_cfg:
        mock_cfg.x_api_key = "key"
        mock_cfg.x_api_secret = "secret"
        mock_cfg.x_access_token = "token"
        mock_cfg.x_access_secret = "tsecret"

        from services.social.x import post_tweet
        result = await post_tweet("Test tweet")

    assert result == "123456789"


async def test_post_tweet_returns_none_on_error():
    """If the API call raises, returns None without crashing."""
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(side_effect=Exception("network error"))

    with patch("services.social.x.httpx.AsyncClient", return_value=mock_client), \
         patch("services.social.x.settings") as mock_cfg:
        mock_cfg.x_api_key = "key"
        mock_cfg.x_api_secret = "secret"
        mock_cfg.x_access_token = "token"
        mock_cfg.x_access_secret = "tsecret"

        from services.social.x import post_tweet
        result = await post_tweet("Test tweet")

    assert result is None


async def test_post_tweet_returns_none_when_no_credentials():
    """If X credentials not set, returns None without making any HTTP call."""
    with patch("services.social.x.settings") as mock_cfg:
        mock_cfg.x_api_key = ""
        mock_cfg.x_api_secret = ""
        mock_cfg.x_access_token = ""
        mock_cfg.x_access_secret = ""

        from services.social.x import post_tweet
        result = await post_tweet("Test tweet")

    assert result is None


# ---------------------------------------------------------------------------
# LinkedIn
# ---------------------------------------------------------------------------

async def test_post_to_linkedin_returns_urn():
    """When LinkedIn API returns 201 with id, returns the post URN."""
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"id": "urn:li:share:7234567890"}
    mock_resp.raise_for_status = MagicMock()
    mock_resp.status_code = 201

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(return_value=mock_resp)

    with patch("services.social.linkedin.httpx.AsyncClient", return_value=mock_client), \
         patch("services.social.linkedin.settings") as mock_cfg:
        mock_cfg.linkedin_access_token = "li_token"
        mock_cfg.linkedin_person_id = "urn:li:person:abc123"

        from services.social.linkedin import post_to_linkedin
        result = await post_to_linkedin("LinkedIn post text")

    assert result == "urn:li:share:7234567890"


async def test_post_to_linkedin_returns_none_when_no_credentials():
    with patch("services.social.linkedin.settings") as mock_cfg:
        mock_cfg.linkedin_access_token = ""
        mock_cfg.linkedin_person_id = ""

        from services.social.linkedin import post_to_linkedin
        result = await post_to_linkedin("Test")

    assert result is None


# ---------------------------------------------------------------------------
# Meta / Facebook
# ---------------------------------------------------------------------------

async def test_post_to_facebook_returns_id():
    """When Facebook Graph API returns post id, returns it."""
    mock_resp = MagicMock()
    mock_resp.json.return_value = {"id": "123456_789012"}
    mock_resp.raise_for_status = MagicMock()

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(return_value=mock_resp)

    with patch("services.social.meta.httpx.AsyncClient", return_value=mock_client), \
         patch("services.social.meta.settings") as mock_cfg:
        mock_cfg.facebook_page_access_token = "fb_token"
        mock_cfg.facebook_page_id = "123456"

        from services.social.meta import post_to_facebook
        result = await post_to_facebook("Facebook post text")

    assert result == "123456_789012"


async def test_post_to_facebook_returns_none_when_no_credentials():
    with patch("services.social.meta.settings") as mock_cfg:
        mock_cfg.facebook_page_access_token = ""
        mock_cfg.facebook_page_id = ""

        from services.social.meta import post_to_facebook
        result = await post_to_facebook("Test")

    assert result is None
