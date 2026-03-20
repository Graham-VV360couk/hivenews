# Phase 5 — Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** On content pack approval, post approved drafts to X, LinkedIn, and Facebook; publish the blog post as a public Next.js page; serve RSS feeds from approved content; add a "Publish" button in HiveDeck.

**Architecture:** Python adds `services/social/` (X, LinkedIn, Meta) + `services/publisher.py` + `POST /publish` endpoint. Next.js adds public `/blog` and `/feeds` routes. HiveDeck gets a Publish button that calls the Python service.

**Tech Stack:** Python httpx (OAuth 1.0a for X, Bearer for LinkedIn/Meta), Next.js App Router, RSS 2.0 XML

---

## File Map

```
apps/python/
├── services/social/
│   ├── __init__.py
│   ├── x.py              X API v2 tweet + thread posting (OAuth 1.0a)
│   ├── linkedin.py       LinkedIn UGC Posts API
│   └── meta.py           Facebook Graph API page posts
├── services/
│   └── publisher.py      Orchestrate all social posts for a pack
├── routers/
│   └── publish.py        POST /publish endpoint
├── tests/
│   ├── test_social.py    TDD for x.py, linkedin.py, meta.py
│   └── test_publisher.py TDD for publisher.py
└── config.py             (updated: social API credentials)

apps/nextjs/
├── app/
│   ├── blog/
│   │   ├── page.tsx                  Public blog listing
│   │   └── [id]/page.tsx             Individual blog post
│   └── feeds/
│       └── [type]/route.ts           RSS feed routes (/all, /alerts, /analysis)
└── app/dashboard/
    ├── api/packs/[id]/
    │   └── publish/route.ts          POST — triggers Python /publish
    └── packs/[id]/page.tsx           (updated: add Publish button)
```

---

## Task 1 — Update `config.py` + create social services skeleton

### Step 1.1 — Add social API credentials to config.py

```python
# Append to Settings class in config.py:
x_api_key: str = ""
x_api_secret: str = ""
x_access_token: str = ""
x_access_secret: str = ""
linkedin_access_token: str = ""
linkedin_person_id: str = ""          # urn:li:person:{id}
facebook_page_access_token: str = ""
facebook_page_id: str = ""
```

### Step 1.2 — Create `services/social/__init__.py`

Empty file.

### Step 1.3 — Write failing tests for social services

Create `apps/python/tests/test_social.py`:

```python
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
```

### Step 1.4 — Run tests to verify they fail

```bash
cd apps/python
python -m pytest tests/test_social.py -v
```

Expected: `ModuleNotFoundError: No module named 'services.social.x'`

---

## Task 2 — Implement social services

### Step 2.1 — Create `services/social/x.py`

```python
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
        body = {"text": text}
        headers = {
            "Authorization": _oauth_header("POST", _X_API_URL, {}),
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(_X_API_URL, headers=headers, json=body)
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
```

### Step 2.2 — Create `services/social/linkedin.py`

```python
"""LinkedIn UGC Posts API — text post to personal profile or page."""
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
```

### Step 2.3 — Create `services/social/meta.py`

```python
"""Meta Graph API — Facebook page post.

Instagram requires a media container upload (image/video) before posting,
which depends on having an image URL. That is deferred to Phase 7 (media pipeline).
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
```

### Step 2.4 — Run tests to verify they pass

```bash
cd apps/python
python -m pytest tests/test_social.py -v
```

Expected: 7 tests pass.

### Step 2.5 — Commit

```bash
git add apps/python/config.py \
        apps/python/services/social/__init__.py \
        apps/python/services/social/x.py \
        apps/python/services/social/linkedin.py \
        apps/python/services/social/meta.py \
        apps/python/tests/test_social.py
git commit -m "feat(python): social posting services — X OAuth1a, LinkedIn, Facebook"
```

---

## Task 3 — `services/publisher.py` + `routers/publish.py` (TDD)

### Step 3.1 — Write failing tests

Create `apps/python/tests/test_publisher.py`:

```python
# apps/python/tests/test_publisher.py
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


async def test_publish_pack_calls_social_services_for_each_draft():
    """publish_pack fetches approved drafts and posts each to its platform."""
    pack_id = uuid.uuid4()

    # Two approved drafts: x and linkedin
    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value={"id": pack_id, "status": "approved"})
    mock_conn.fetch = AsyncMock(return_value=[
        {"id": uuid.uuid4(), "platform": "x", "final_text": None,
         "draft_text": "Tweet text", "draft_data": '{"type":"single","tweets":["Tweet text"]}',
         "approved": True},
        {"id": uuid.uuid4(), "platform": "linkedin", "final_text": "LinkedIn text",
         "draft_text": "Draft", "draft_data": '{"content":"LinkedIn text"}', "approved": True},
    ])
    mock_conn.execute = AsyncMock()

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.publisher.get_conn", return_value=mock_ctx), \
         patch("services.publisher.post_tweet", return_value="tweet_123"), \
         patch("services.publisher.post_thread", return_value="thread_123"), \
         patch("services.publisher.post_to_linkedin", return_value="urn:li:share:789"), \
         patch("services.publisher.post_to_facebook", return_value=None):

        from services.publisher import publish_pack
        result = await publish_pack(pack_id)

    assert result["published"] >= 1
    assert result["pack_id"] == str(pack_id)


async def test_publish_pack_returns_error_when_pack_not_found():
    """If pack_id doesn't exist, returns error dict without crashing."""
    pack_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetchrow = AsyncMock(return_value=None)
    mock_conn.fetch = AsyncMock(return_value=[])

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.publisher.get_conn", return_value=mock_ctx):
        from services.publisher import publish_pack
        result = await publish_pack(pack_id)

    assert result.get("error") is not None
```

### Step 3.2 — Run to verify failure

```bash
python -m pytest tests/test_publisher.py -v
```

Expected: `ImportError: cannot import name 'publish_pack'`

### Step 3.3 — Implement `services/publisher.py`

```python
"""Publish an approved content pack to all social platforms.

For each approved draft in the pack:
  - x        → post_tweet (single) or post_thread (thread)
  - linkedin  → post_to_linkedin
  - facebook  → post_to_facebook
  - blog      → marked published_at = NOW() (served via Next.js)
  - instagram → deferred (requires media pipeline)
  - hivecast  → deferred (HeyGen integration, Phase 6+)

Updates content_drafts.platform_post_id and published_at.
Updates content_packs.status = 'published', published_at = NOW().
"""
import json
import logging
from uuid import UUID

from database import get_conn
from services.social.x import post_tweet, post_thread
from services.social.linkedin import post_to_linkedin
from services.social.meta import post_to_facebook

log = logging.getLogger(__name__)


async def publish_pack(pack_id: UUID) -> dict:
    """Publish all approved drafts for a content pack.

    Returns:
        {"pack_id": str, "published": int, "skipped": int, "errors": list}
    """
    async with get_conn() as conn:
        pack = await conn.fetchrow(
            "SELECT id, status FROM content_packs WHERE id = $1",
            pack_id,
        )
        if not pack:
            return {"error": f"Pack {pack_id} not found"}

        drafts = await conn.fetch(
            """
            SELECT id, platform, final_text, draft_text, draft_data, approved
            FROM content_drafts
            WHERE pack_id = $1 AND approved = TRUE
            ORDER BY platform
            """,
            pack_id,
        )

    published = 0
    skipped = 0
    errors = []

    for draft in drafts:
        platform = draft["platform"]
        text = draft["final_text"] or draft["draft_text"] or ""
        platform_post_id = None

        try:
            if platform == "x":
                data = json.loads(draft["draft_data"] or "{}")
                tweets = data.get("tweets", [text])
                if len(tweets) == 1:
                    platform_post_id = await post_tweet(tweets[0])
                else:
                    platform_post_id = await post_thread(tweets)

            elif platform == "linkedin":
                platform_post_id = await post_to_linkedin(text)

            elif platform == "facebook":
                platform_post_id = await post_to_facebook(text)

            elif platform == "blog":
                # Blog is served by Next.js — just mark published
                platform_post_id = f"blog:{pack_id}"

            else:
                # instagram / hivecast — deferred
                skipped += 1
                continue

        except Exception as exc:
            log.warning("Publish failed for %s draft of pack %s: %s", platform, pack_id, exc)
            errors.append({"platform": platform, "error": str(exc)})
            continue

        # Update draft record
        async with get_conn() as conn:
            await conn.execute(
                """
                UPDATE content_drafts
                SET platform_post_id = $1, published_at = NOW()
                WHERE id = $2
                """,
                platform_post_id,
                draft["id"],
            )
        published += 1

    # Mark pack as published
    async with get_conn() as conn:
        await conn.execute(
            """
            UPDATE content_packs
            SET status = 'published', published_at = NOW()
            WHERE id = $1
            """,
            pack_id,
        )

    log.info("Pack %s published: %d platforms, %d skipped, %d errors",
             pack_id, published, skipped, len(errors))

    return {
        "pack_id": str(pack_id),
        "published": published,
        "skipped": skipped,
        "errors": errors,
    }
```

### Step 3.4 — Create `routers/publish.py`

```python
"""POST /publish — publish an approved content pack to all social platforms."""
import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.publisher import publish_pack

log = logging.getLogger(__name__)
router = APIRouter()


class PublishRequest(BaseModel):
    pack_id: UUID


@router.post("/publish")
async def trigger_publish(req: PublishRequest) -> dict:
    """Publish all approved drafts in a content pack to their platforms."""
    result = await publish_pack(req.pack_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
```

### Step 3.5 — Run tests

```bash
python -m pytest tests/test_publisher.py -v
```

Expected: 2 tests pass.

### Step 3.6 — Register router in `main.py`

```python
# Change:
from routers import ingest, score, honeypot, draft
# To:
from routers import ingest, score, honeypot, draft, publish

# Add:
app.include_router(publish.router)
```

### Step 3.7 — Run full test suite

```bash
python -m pytest tests/ -v
```

Expected: all 69 tests pass (60 existing + 7 social + 2 publisher).

### Step 3.8 — Commit

```bash
git add apps/python/services/publisher.py \
        apps/python/routers/publish.py \
        apps/python/main.py \
        apps/python/tests/test_publisher.py
git commit -m "feat(python): publisher + POST /publish — orchestrate social posting on approval"
```

---

## Task 4 — Next.js public blog pages

### Step 4.1 — Create `apps/nextjs/app/blog/page.tsx`

```tsx
// apps/nextjs/app/blog/page.tsx
import { getDb } from '@/lib/db';
import Link from 'next/link';

interface BlogItem {
  id: string;
  pack_type: string;
  published_at: string;
  confidence_level: string;
  title: string;
  meta_description: string;
}

async function getPublishedPosts(): Promise<BlogItem[]> {
  const sql = getDb();
  const rows = await sql<BlogItem[]>`
    SELECT
      cp.id,
      cp.pack_type,
      cp.published_at,
      cp.confidence_level,
      cd.draft_data->>'title'            AS title,
      cd.draft_data->>'meta_description' AS meta_description
    FROM content_packs cp
    JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
    WHERE cp.status = 'published'
      AND cp.published_at IS NOT NULL
    ORDER BY cp.published_at DESC
    LIMIT 20
  `;
  return rows;
}

const CONFIDENCE_BADGE: Record<string, string> = {
  confirmed: '🔴 CONFIRMED',
  developing: '🟡 DEVELOPING',
  pinch_of_salt: '🧂 PINCH OF SALT',
};

export default async function BlogPage() {
  const posts = await getPublishedPosts();

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '40px 20px' }}>
      <div style={{ marginBottom: '40px' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: '28px', fontWeight: 700 }}>NewsHive Intelligence</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '15px' }}>
          Technology intelligence covering AI, VR/AR, Vibe Coding, and SEO.
        </p>
      </div>

      {posts.length === 0 ? (
        <p style={{ color: '#666' }}>No posts published yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {posts.map(post => (
            <article key={post.id}>
              <div style={{ marginBottom: '6px' }}>
                <span style={{ fontSize: '12px', color: '#888' }}>
                  {CONFIDENCE_BADGE[post.confidence_level] || post.confidence_level}
                  {' · '}
                  {new Date(post.published_at).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'long', year: 'numeric'
                  })}
                </span>
              </div>
              <h2 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 600 }}>
                <Link href={`/blog/${post.id}`} style={{ color: '#e5e5e5', textDecoration: 'none' }}>
                  {post.title || 'Untitled'}
                </Link>
              </h2>
              {post.meta_description && (
                <p style={{ margin: 0, color: '#888', fontSize: '14px', lineHeight: 1.6 }}>
                  {post.meta_description}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Step 4.2 — Create `apps/nextjs/app/blog/[id]/page.tsx`

```tsx
// apps/nextjs/app/blog/[id]/page.tsx
import { getDb } from '@/lib/db';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';

interface BlogPost {
  id: string;
  pack_type: string;
  published_at: string;
  confidence_level: string;
  domain_tags: string[] | null;
  title: string;
  content: string;
  meta_description: string;
}

async function getPost(id: string): Promise<BlogPost | null> {
  const sql = getDb();
  const rows = await sql<BlogPost[]>`
    SELECT
      cp.id,
      cp.pack_type,
      cp.published_at,
      cp.confidence_level,
      cl.domain_tags,
      cd.draft_data->>'title'            AS title,
      cd.draft_data->>'content'          AS content,
      cd.draft_data->>'meta_description' AS meta_description
    FROM content_packs cp
    JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
    LEFT JOIN clusters cl ON cl.id = cp.cluster_id
    WHERE cp.id = ${id}
      AND cp.status = 'published'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const post = await getPost(params.id);
  if (!post) return { title: 'Not Found' };
  return {
    title: `${post.title} — NewsHive`,
    description: post.meta_description,
  };
}

const CONFIDENCE_BADGE: Record<string, string> = {
  confirmed: '🔴 CONFIRMED',
  developing: '🟡 DEVELOPING',
  pinch_of_salt: '🧂 PINCH OF SALT',
};

export default async function BlogPostPage({ params }: { params: { id: string } }) {
  const post = await getPost(params.id);
  if (!post) notFound();

  return (
    <div style={{ maxWidth: '720px', margin: '0 auto', padding: '40px 20px' }}>
      <Link href="/blog" style={{ fontSize: '13px', color: '#666', display: 'inline-block', marginBottom: '24px' }}>
        ← All posts
      </Link>

      <header style={{ marginBottom: '32px' }}>
        <div style={{ marginBottom: '10px', fontSize: '12px', color: '#888' }}>
          {CONFIDENCE_BADGE[post.confidence_level] || post.confidence_level}
          {' · '}
          {new Date(post.published_at).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'long', year: 'numeric'
          })}
          {post.domain_tags && post.domain_tags.length > 0 && (
            <> · {post.domain_tags.join(', ')}</>
          )}
        </div>
        <h1 style={{ margin: '0 0 12px', fontSize: '28px', fontWeight: 700, lineHeight: 1.2 }}>
          {post.title}
        </h1>
        {post.meta_description && (
          <p style={{ margin: 0, fontSize: '16px', color: '#999', lineHeight: 1.6 }}>
            {post.meta_description}
          </p>
        )}
      </header>

      <div style={{ lineHeight: 1.8, fontSize: '16px', color: '#ccc' }}>
        {(post.content || '').split('\n').map((para, i) => (
          para.trim() ? (
            <p key={i} style={{ margin: '0 0 20px' }}>{para}</p>
          ) : null
        ))}
      </div>

      <footer style={{ marginTop: '48px', paddingTop: '24px', borderTop: '1px solid #2a2a2a', fontSize: '13px', color: '#555' }}>
        Intelligence by <a href="/" style={{ color: '#F5A623' }}>NewsHive</a> (newshive.geekybee.net).
        Please credit when republishing. CC BY 4.0.
      </footer>
    </div>
  );
}
```

### Step 4.3 — Commit blog pages

```bash
git add apps/nextjs/app/blog/page.tsx "apps/nextjs/app/blog/[id]/page.tsx"
git commit -m "feat(nextjs): public blog pages — listing + individual post with confidence badge"
```

---

## Task 5 — RSS feeds

### Step 5.1 — Create `apps/nextjs/app/feeds/[type]/route.ts`

RSS feed types supported:
- `all` — all published packs
- `alerts` — alert_breaking + alert_significant only
- `analysis` — standard packs only

```typescript
// apps/nextjs/app/feeds/[type]/route.ts
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/db';

const FEED_CONFIGS: Record<string, { title: string; description: string; where: string }> = {
  all: {
    title: 'NewsHive — All Intelligence',
    description: 'Technology intelligence: AI, VR/AR, Vibe Coding, SEO.',
    where: `cp.status = 'published'`,
  },
  alerts: {
    title: 'NewsHive — Alerts',
    description: 'Confirmed and developing alerts from NewsHive.',
    where: `cp.status = 'published' AND cp.pack_type IN ('alert_breaking','alert_significant')`,
  },
  analysis: {
    title: 'NewsHive — Analysis',
    description: 'In-depth technology analysis from NewsHive.',
    where: `cp.status = 'published' AND cp.pack_type = 'standard'`,
  },
};

function esc(s: string | null): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildRss(config: typeof FEED_CONFIGS[string], items: Array<{
  id: string;
  title: string;
  meta_description: string;
  content: string;
  published_at: string;
  confidence_level: string;
  domain_tags: string[] | null;
}>): string {
  const baseUrl = 'https://newshive.geekybee.net';
  const itemsXml = items.map(item => {
    const link = `${baseUrl}/blog/${item.id}`;
    const pubDate = new Date(item.published_at).toUTCString();
    return `
    <item>
      <title>${esc(item.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${esc(item.meta_description)}</description>
      <content:encoded><![CDATA[${item.content || ''}]]></content:encoded>
      <nh:confidence>${esc(item.confidence_level)}</nh:confidence>
      <nh:domains>${esc((item.domain_tags || []).join(','))}</nh:domains>
      <nh:attribution>Intelligence by NewsHive (newshive.geekybee.net). CC BY 4.0.</nh:attribution>
    </item>`;
  }).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:content="http://purl.org/rss/1.0/modules/content/"
     xmlns:nh="https://newshive.geekybee.net/ns/1.0">
  <channel>
    <title>${esc(config.title)}</title>
    <link>${baseUrl}</link>
    <description>${esc(config.description)}</description>
    <language>en-gb</language>
    <ttl>300</ttl>
    ${itemsXml}
  </channel>
</rss>`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { type: string } }
) {
  const feedConfig = FEED_CONFIGS[params.type];
  if (!feedConfig) {
    return new Response('Feed not found', { status: 404 });
  }

  const sql = getDb();

  // Dynamic query based on feed type
  let rows;
  if (params.type === 'all') {
    rows = await sql`
      SELECT
        cp.id,
        cp.published_at,
        cp.confidence_level,
        cl.domain_tags,
        cd.draft_data->>'title'            AS title,
        cd.draft_data->>'meta_description' AS meta_description,
        cd.final_text                      AS content
      FROM content_packs cp
      JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
      LEFT JOIN clusters cl ON cl.id = cp.cluster_id
      WHERE cp.status = 'published'
      ORDER BY cp.published_at DESC
      LIMIT 50
    `;
  } else if (params.type === 'alerts') {
    rows = await sql`
      SELECT
        cp.id,
        cp.published_at,
        cp.confidence_level,
        cl.domain_tags,
        cd.draft_data->>'title'            AS title,
        cd.draft_data->>'meta_description' AS meta_description,
        cd.final_text                      AS content
      FROM content_packs cp
      JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
      LEFT JOIN clusters cl ON cl.id = cp.cluster_id
      WHERE cp.status = 'published'
        AND cp.pack_type IN ('alert_breaking', 'alert_significant')
      ORDER BY cp.published_at DESC
      LIMIT 50
    `;
  } else {
    rows = await sql`
      SELECT
        cp.id,
        cp.published_at,
        cp.confidence_level,
        cl.domain_tags,
        cd.draft_data->>'title'            AS title,
        cd.draft_data->>'meta_description' AS meta_description,
        cd.final_text                      AS content
      FROM content_packs cp
      JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
      LEFT JOIN clusters cl ON cl.id = cp.cluster_id
      WHERE cp.status = 'published'
        AND cp.pack_type = 'standard'
      ORDER BY cp.published_at DESC
      LIMIT 50
    `;
  }

  const xml = buildRss(feedConfig, rows as any);

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 's-maxage=300, stale-while-revalidate=60',
    },
  });
}
```

### Step 5.2 — Commit feeds

```bash
mkdir -p "apps/nextjs/app/feeds/[type]"
git add "apps/nextjs/app/feeds/[type]/route.ts"
git commit -m "feat(nextjs): RSS feeds at /feeds/[type] — all, alerts, analysis"
```

---

## Task 6 — HiveDeck Publish button + API route

### Step 6.1 — Create publish API route

Create `apps/nextjs/app/dashboard/api/packs/[id]/publish/route.ts`:

```typescript
// apps/nextjs/app/dashboard/api/packs/[id]/publish/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { triggerDraft } from '@/lib/python-client';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const res = await fetch(`${PYTHON_URL}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pack_id: params.id }),
    });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }
    return NextResponse.json(await res.json());
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Publish failed' },
      { status: 500 }
    );
  }
}
```

### Step 6.2 — Update pack approval page to add Publish button

Update `apps/nextjs/app/dashboard/packs/[id]/page.tsx` — add Publish button state and handler:

In the component, after the `approvedCount` state, add:

```typescript
const [publishing, setPublishing] = useState(false);
const [publishResult, setPublishResult] = useState<string | null>(null);

async function handlePublish() {
  setPublishing(true);
  setPublishResult(null);
  try {
    const res = await fetch(`/dashboard/api/packs/${id}/publish`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      setPublishResult(`Error: ${data.error}`);
    } else {
      setPublishResult(`Published to ${data.published} platform${data.published !== 1 ? 's' : ''}${data.errors?.length ? ` (${data.errors.length} errors)` : ''}`);
    }
  } catch (e) {
    setPublishResult('Network error');
  } finally {
    setPublishing(false);
  }
}
```

And in the JSX, after the draft list, add the Publish button section:

```tsx
{allApproved && pack.status !== 'published' && (
  <div style={{ marginTop: '24px', padding: '16px', background: '#1a1a1a', border: '1px solid #22c55e', borderRadius: '6px' }}>
    <p style={{ margin: '0 0 12px', fontSize: '14px', color: '#ccc' }}>
      All drafts approved. Ready to publish to social platforms.
    </p>
    <button
      onClick={handlePublish}
      disabled={publishing}
      style={{
        padding: '10px 20px',
        background: publishing ? '#1a3a2a' : '#22c55e',
        color: '#0f0f0f',
        border: 'none',
        borderRadius: '4px',
        fontSize: '14px',
        fontWeight: 600,
        cursor: publishing ? 'not-allowed' : 'pointer',
      }}
    >
      {publishing ? 'Publishing…' : 'Publish Now'}
    </button>
    {publishResult && (
      <p style={{ margin: '12px 0 0', fontSize: '13px', color: '#888' }}>{publishResult}</p>
    )}
  </div>
)}
{pack.status === 'published' && (
  <div style={{ marginTop: '24px', padding: '16px', background: '#0a1f0a', border: '1px solid #22c55e', borderRadius: '6px' }}>
    <p style={{ margin: 0, fontSize: '14px', color: '#22c55e' }}>
      ✓ Published · <a href={`/blog/${pack.id}`} target="_blank" style={{ color: '#22c55e' }}>View blog post →</a>
    </p>
  </div>
)}
```

### Step 6.3 — Commit

```bash
git add "apps/nextjs/app/dashboard/api/packs/[id]/publish/route.ts" \
        "apps/nextjs/app/dashboard/packs/[id]/page.tsx"
git commit -m "feat(nextjs): Publish button in HiveDeck + publish API route"
```

---

## Final Step — Push

```bash
git push origin master
```

---

## Implementation Order Summary

| Task | Files | Tests |
|------|-------|-------|
| 1 | `config.py`, `services/social/__init__.py`, `x.py`, `linkedin.py`, `meta.py` | 7 TDD |
| 2 | `services/publisher.py`, `routers/publish.py`, `main.py` | 2 TDD |
| 3 | `app/blog/page.tsx`, `app/blog/[id]/page.tsx` | — |
| 4 | `app/feeds/[type]/route.ts` | — |
| 5 | `app/dashboard/api/packs/[id]/publish/route.ts`, update pack approval page | — |

## Environment Variables Added

| Variable | Service | Description |
|----------|---------|-------------|
| `X_API_KEY` | Python | X Developer App key |
| `X_API_SECRET` | Python | X Developer App secret |
| `X_ACCESS_TOKEN` | Python | X OAuth 1.0a user access token |
| `X_ACCESS_SECRET` | Python | X OAuth 1.0a user access secret |
| `LINKEDIN_ACCESS_TOKEN` | Python | LinkedIn OAuth 2.0 access token |
| `LINKEDIN_PERSON_ID` | Python | LinkedIn `urn:li:person:{id}` |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Python | Meta Graph API page token |
| `FACEBOOK_PAGE_ID` | Python | Facebook page numeric ID |
