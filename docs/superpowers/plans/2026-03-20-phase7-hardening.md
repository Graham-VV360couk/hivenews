# Phase 7 — Hardening + Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the platform with: the public Honeypot submission form (no analytics, Tor-compatible), HiveDeck Submissions review, HiveAPI public endpoints with API key auth, webhook notifications on pack publish, rate limiting, and Tor Docker config.

**Architecture:** Next.js gains the public `/honeypot` multi-step form and `/api/v1/` read-only endpoints. Python gains `services/webhook.py` (fire webhooks on publish), `slowapi` rate limiting on public endpoints. A `docker-compose.tor.yml` config provides the Tor hidden service.

**Tech Stack:** Next.js App Router Server + Client Components, slowapi (Python rate limiting), asyncpg, existing AES-256-GCM encryption, Docker/Tor

---

## File Map

```
apps/python/
├── services/
│   └── webhook.py            Fire webhook POSTs to api_subscribers on pack publish
├── services/publisher.py     (updated: call fire_webhooks after successful publish)
├── main.py                   (updated: attach SlowAPI limiter)
├── requirements.txt          (updated: add slowapi)
├── tests/
│   ├── test_webhook.py       TDD for webhook service
│   └── test_hiveapi.py       TDD placeholder (routes tested via integration)

apps/nextjs/
├── app/
│   ├── honeypot/
│   │   └── page.tsx          Public 4-step submission form (no analytics, Tor-safe)
│   └── api/
│       ├── honeypot/
│       │   └── route.ts      POST → Python /honeypot/submit proxy
│       └── v1/
│           ├── _auth.ts      API key validation helper (checks api_subscribers)
│           ├── signals/
│           │   └── route.ts  GET /api/v1/signals
│           ├── packs/
│           │   └── route.ts  GET /api/v1/packs
│           └── trajectories/
│               └── route.ts  GET /api/v1/trajectories
├── app/dashboard/
│   └── submissions/
│       └── page.tsx          HiveDeck Honeypot submission review queue
└── app/dashboard/api/
    └── submissions/
        ├── route.ts          GET pending submissions list
        └── [id]/
            └── route.ts      GET (decrypt) + POST (outcome)

docker/
└── docker-compose.tor.yml    Tor hidden service config
```

---

## Task 1 — `services/webhook.py` + tests + integrate into publisher (TDD)

### Step 1.1 — Write failing tests

Create `apps/python/tests/test_webhook.py`:

```python
# apps/python/tests/test_webhook.py
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


async def test_fire_webhooks_posts_to_active_subscribers():
    """fire_webhooks sends POST to each active subscriber with a webhook_url."""
    pack_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=[
        {"webhook_url": "https://example.com/hook", "api_key": "key1"},
        {"webhook_url": "https://other.com/hook", "api_key": "key2"},
    ])

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    mock_resp = MagicMock()
    mock_resp.status_code = 200

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(return_value=mock_resp)

    with patch("services.webhook.get_conn", return_value=mock_ctx), \
         patch("services.webhook.httpx.AsyncClient", return_value=mock_client):
        from services.webhook import fire_webhooks
        await fire_webhooks(pack_id, "standard", ["ai"])

    assert mock_client.post.await_count == 2


async def test_fire_webhooks_skips_when_no_subscribers():
    """fire_webhooks does nothing if no subscribers have webhook URLs."""
    pack_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=[])

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.webhook.get_conn", return_value=mock_ctx):
        from services.webhook import fire_webhooks
        # Should not raise, just silently skip
        await fire_webhooks(pack_id, "standard", [])


async def test_fire_webhooks_continues_on_individual_failure():
    """If one webhook POST fails, others still fire."""
    pack_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=[
        {"webhook_url": "https://fail.example.com/hook", "api_key": "key1"},
        {"webhook_url": "https://ok.example.com/hook", "api_key": "key2"},
    ])

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    call_count = 0

    async def mock_post(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            raise Exception("timeout")
        return MagicMock(status_code=200)

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = mock_post

    with patch("services.webhook.get_conn", return_value=mock_ctx), \
         patch("services.webhook.httpx.AsyncClient", return_value=mock_client):
        from services.webhook import fire_webhooks
        await fire_webhooks(pack_id, "standard", ["ai"])

    assert call_count == 2
```

### Step 1.2 — Run to verify failure

```bash
cd apps/python
python -m pytest tests/test_webhook.py -v
```

Expected: `ImportError: cannot import name 'fire_webhooks'`

### Step 1.3 — Implement `services/webhook.py`

```python
"""Webhook notification service.

On every successful pack publish, POST a notification to all active
api_subscribers that have a webhook_url configured.

Payload sent to each webhook:
{
  "event": "pack.published",
  "pack_id": "...",
  "pack_type": "standard|alert_breaking|...",
  "domain_tags": ["ai", "vr"],
  "published_at": "2026-03-20T08:00:00Z"
}

Failures are logged but never block the publish flow.
"""
import logging
from datetime import datetime, timezone
from uuid import UUID

import httpx

from database import get_conn

log = logging.getLogger(__name__)

_TIMEOUT = 5.0  # seconds — webhooks must not slow down publish


async def fire_webhooks(
    pack_id: UUID,
    pack_type: str,
    domain_tags: list[str],
) -> None:
    """POST pack.published notification to all active subscribers with webhook URLs.

    Never raises — failures are logged and skipped.
    """
    try:
        async with get_conn() as conn:
            subscribers = await conn.fetch(
                """
                SELECT webhook_url, api_key
                FROM api_subscribers
                WHERE is_active = TRUE
                  AND webhook_url IS NOT NULL
                  AND webhook_url != ''
                """
            )
    except Exception as exc:
        log.warning("Failed to fetch webhook subscribers: %s", exc)
        return

    if not subscribers:
        return

    payload = {
        "event": "pack.published",
        "pack_id": str(pack_id),
        "pack_type": pack_type,
        "domain_tags": domain_tags,
        "published_at": datetime.now(timezone.utc).isoformat(),
    }

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        for sub in subscribers:
            try:
                await client.post(
                    sub["webhook_url"],
                    json=payload,
                    headers={"X-NewsHive-Event": "pack.published"},
                )
            except Exception as exc:
                log.warning("Webhook delivery failed to %s: %s", sub["webhook_url"], exc)
```

### Step 1.4 — Run tests

```bash
python -m pytest tests/test_webhook.py -v
```

Expected: 3 tests pass.

### Step 1.5 — Update `services/publisher.py` to fire webhooks

At the end of `publish_pack`, after marking the pack published, add:

```python
# After the UPDATE content_packs block, before the return:
from services.webhook import fire_webhooks
# Fetch domain_tags for the pack
try:
    async with get_conn() as conn:
        pack_row = await conn.fetchrow(
            """
            SELECT cp.pack_type, cl.domain_tags
            FROM content_packs cp
            LEFT JOIN clusters cl ON cl.id = cp.cluster_id
            WHERE cp.id = $1
            """,
            pack_id,
        )
    if pack_row:
        await fire_webhooks(
            pack_id,
            pack_row["pack_type"],
            list(pack_row["domain_tags"] or []),
        )
except Exception as exc:
    log.warning("Webhook fire failed for pack %s: %s", pack_id, exc)
```

### Step 1.6 — Run full test suite

```bash
python -m pytest tests/ -q --no-header
```

Expected: 79 tests pass (76 + 3 new).

### Step 1.7 — Commit

```bash
git add apps/python/services/webhook.py \
        apps/python/services/publisher.py \
        apps/python/tests/test_webhook.py
git commit -m "feat(python): webhook notifications — fire pack.published to api_subscribers on publish"
```

---

## Task 2 — Rate limiting on Python public endpoints

### Step 2.1 — Add `slowapi` to requirements.txt

Add to `apps/python/requirements.txt`:
```
slowapi==0.1.9
```

### Step 2.2 — Update `main.py` to attach rate limiter

```python
# Add to main.py imports:
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Before lifespan:
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])

# In the FastAPI app creation:
app = FastAPI(title="NewsHive Python Service", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
```

Apply tighter limit to honeypot submit in `routers/honeypot.py`:

```python
# Add to imports in routers/honeypot.py:
from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

# Apply to submit endpoint:
@router.post("/honeypot/submit", response_model=HoneypotSubmitResponse)
@limiter.limit("5/minute")
async def submit_honeypot(request: Request, req: HoneypotSubmitRequest) -> HoneypotSubmitResponse:
    ...
```

### Step 2.3 — Install and verify import

```bash
pip install slowapi==0.1.9
python -c "from slowapi import Limiter; print('ok')"
```

### Step 2.4 — Run full test suite (rate limiter must not break existing tests)

```bash
python -m pytest tests/ -q --no-header
```

Expected: 79 tests pass.

### Step 2.5 — Commit

```bash
git add apps/python/requirements.txt apps/python/main.py apps/python/routers/honeypot.py
git commit -m "feat(python): slowapi rate limiting — 200/min global, 5/min on honeypot/submit"
```

---

## Task 3 — HiveAPI public endpoints (Next.js `/api/v1/`)

### Step 3.1 — Create API key auth helper

Create `apps/nextjs/app/api/v1/_auth.ts`:

```typescript
// apps/nextjs/app/api/v1/_auth.ts
import { getDb } from '@/lib/db';

export async function validateApiKey(key: string | null): Promise<boolean> {
  if (!key) return false;
  try {
    const sql = getDb();
    const rows = await sql`
      UPDATE api_subscribers
      SET last_used_at = NOW()
      WHERE api_key = ${key} AND is_active = TRUE
      RETURNING id
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export function apiKeyFromRequest(request: Request): string | null {
  return request.headers.get('X-API-Key') ||
         new URL(request.url).searchParams.get('api_key');
}
```

### Step 3.2 — Create signals endpoint

Create `apps/nextjs/app/api/v1/signals/route.ts`:

```typescript
// apps/nextjs/app/api/v1/signals/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { validateApiKey, apiKeyFromRequest } from '../_auth';

export async function GET(request: NextRequest) {
  const key = apiKeyFromRequest(request);
  if (!await validateApiKey(key)) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain');
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

  const sql = getDb();

  const rows = domain
    ? await sql`
        SELECT id, title, url, published_at, ingested_at,
               domain_tags, confidence_level, importance_composite,
               corroboration_count
        FROM signals
        WHERE domain_tags @> ARRAY[${domain}]::text[]
          AND processed = TRUE
        ORDER BY ingested_at DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT id, title, url, published_at, ingested_at,
               domain_tags, confidence_level, importance_composite,
               corroboration_count
        FROM signals
        WHERE processed = TRUE
        ORDER BY ingested_at DESC
        LIMIT ${limit}
      `;

  return NextResponse.json({
    data: rows,
    count: rows.length,
    attribution: 'NewsHive (newshive.geekybee.net). CC BY 4.0.',
  });
}
```

### Step 3.3 — Create packs endpoint

Create `apps/nextjs/app/api/v1/packs/route.ts`:

```typescript
// apps/nextjs/app/api/v1/packs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { validateApiKey, apiKeyFromRequest } from '../_auth';

export async function GET(request: NextRequest) {
  const key = apiKeyFromRequest(request);
  if (!await validateApiKey(key)) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

  const sql = getDb();
  const rows = await sql`
    SELECT
      cp.id,
      cp.pack_type,
      cp.confidence_level,
      cp.published_at,
      cl.domain_tags,
      cd.draft_data->>'title'            AS title,
      cd.draft_data->>'meta_description' AS meta_description
    FROM content_packs cp
    JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
    LEFT JOIN clusters cl ON cl.id = cp.cluster_id
    WHERE cp.status = 'published'
      AND cp.published_at IS NOT NULL
    ORDER BY cp.published_at DESC
    LIMIT ${limit}
  `;

  return NextResponse.json({
    data: rows,
    count: rows.length,
    attribution: 'NewsHive (newshive.geekybee.net). CC BY 4.0.',
  });
}
```

### Step 3.4 — Create trajectories endpoint

Create `apps/nextjs/app/api/v1/trajectories/route.ts`:

```typescript
// apps/nextjs/app/api/v1/trajectories/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { validateApiKey, apiKeyFromRequest } from '../_auth';

export async function GET(request: NextRequest) {
  const key = apiKeyFromRequest(request);
  if (!await validateApiKey(key)) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const sql = getDb();
  const rows = await sql`
    SELECT id, name, domain_tags, confidence_score,
           confidence_direction, status, description,
           first_published_at, last_updated_at
    FROM trajectories
    WHERE status = 'active'
    ORDER BY confidence_score DESC
  `;

  return NextResponse.json({
    data: rows,
    count: rows.length,
    attribution: 'NewsHive (newshive.geekybee.net). CC BY 4.0.',
  });
}
```

### Step 3.5 — Commit HiveAPI

```bash
git add "apps/nextjs/app/api/v1/_auth.ts" \
        "apps/nextjs/app/api/v1/signals/route.ts" \
        "apps/nextjs/app/api/v1/packs/route.ts" \
        "apps/nextjs/app/api/v1/trajectories/route.ts"
git commit -m "feat(nextjs): HiveAPI v1 — /api/v1/signals, /packs, /trajectories with API key auth"
```

---

## Task 4 — Public Honeypot submission form

No analytics, no external resources, no cookies. Token shown once in memory.

### Step 4.1 — Create Honeypot proxy API route

Create `apps/nextjs/app/api/honeypot/route.ts`:

```typescript
// apps/nextjs/app/api/honeypot/route.ts
import { NextRequest, NextResponse } from 'next/server';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${PYTHON_URL}/honeypot/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: 'Submission failed' }, { status: res.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 });
  }
}
```

### Step 4.2 — Create Honeypot page

Create `apps/nextjs/app/honeypot/page.tsx`:

```tsx
// apps/nextjs/app/honeypot/page.tsx
// NO analytics. NO external resources. NO cookies.
// Self-contained — all assets served from same origin.
'use client';

import { useState } from 'react';

const QUESTIONS = [
  {
    id: 'proximity',
    text: 'How close are you to this information?',
    options: [
      'I work directly in this area',
      'I work adjacent to this area',
      'I heard this from someone who does',
      'I observed this indirectly',
    ],
  },
  {
    id: 'source',
    text: 'How have you come to know this?',
    options: [
      'Direct professional involvement',
      'Internal communications I have seen',
      'Industry contacts I trust',
      'A pattern I have observed over time',
      'A document or data I have access to',
    ],
  },
  {
    id: 'confidence',
    text: 'How confident are you?',
    options: [
      'Certain — I was directly involved',
      'High — I witnessed it firsthand',
      'Medium — from a trusted colleague',
      'Low — a pattern I am reading',
    ],
  },
  {
    id: 'sector',
    text: 'What broad sector are you in?',
    options: [
      'Engineering or technical',
      'Business or commercial',
      'Research or academic',
      'Investment or financial',
      'Government or regulatory',
      'Media or analyst',
      'Other',
    ],
  },
];

const DOMAIN_OPTIONS = [
  { value: 'ai', label: 'Artificial Intelligence' },
  { value: 'vr', label: 'VR / AR / Spatial Computing' },
  { value: 'vibe_coding', label: 'Vibe Coding / Developer Tools' },
  { value: 'seo', label: 'SEO / Search' },
  { value: 'cross', label: 'Cross-domain / Other' },
];

type Step = 'welcome' | 'questions' | 'submission' | 'confirm';

const BASE = {
  background: '#0f0f0f',
  color: '#e5e5e5',
  fontFamily: 'Georgia, serif',
  minHeight: '100vh',
  display: 'flex',
  justifyContent: 'center',
  padding: '48px 20px',
} as const;

const CONTAINER = {
  maxWidth: '620px',
  width: '100%',
} as const;

const LABEL_STYLE = {
  display: 'block',
  marginBottom: '6px',
  fontSize: '13px',
  color: '#888',
  fontFamily: 'monospace',
  letterSpacing: '0.05em',
  textTransform: 'uppercase' as const,
};

export default function HoneypotPage() {
  const [step, setStep] = useState<Step>('welcome');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [existingToken, setExistingToken] = useState('');
  const [content, setContent] = useState('');
  const [contactMethod, setContactMethod] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');

  function toggleDomain(value: string) {
    setDomains(d => d.includes(value) ? d.filter(x => x !== value) : [...d, value]);
  }

  function allAnswered() {
    return QUESTIONS.every(q => answers[q.id]);
  }

  async function handleSubmit() {
    if (!content.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/honeypot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          questionnaire_answers: answers,
          domain_tags: domains,
          existing_token: existingToken.trim() || null,
          contact_method: contactMethod.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError('Submission failed. Please try again.');
        return;
      }
      setToken(data.token);
      setStep('confirm');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const h1Style = { margin: '0 0 8px', fontSize: '24px', fontWeight: 700, letterSpacing: '-0.02em' };
  const h2Style = { margin: '0 0 24px', fontSize: '13px', color: '#F5A623', fontFamily: 'monospace', letterSpacing: '0.1em', textTransform: 'uppercase' as const };
  const bodyStyle = { margin: '0 0 20px', fontSize: '15px', lineHeight: 1.7, color: '#aaa' };
  const btnStyle = (primary = true) => ({
    display: 'inline-block',
    padding: '12px 24px',
    background: primary ? '#F5A623' : 'none',
    color: primary ? '#0f0f0f' : '#666',
    border: primary ? 'none' : '1px solid #333',
    borderRadius: '2px',
    fontSize: '14px',
    fontWeight: primary ? 700 : 400,
    cursor: 'pointer',
    fontFamily: 'monospace',
    letterSpacing: '0.05em',
  });

  if (step === 'welcome') {
    return (
      <div style={BASE}>
        <div style={CONTAINER}>
          <div style={{ marginBottom: '48px' }}>
            <div style={{ color: '#F5A623', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '0.15em', marginBottom: '16px' }}>NEWSHIVE</div>
            <h1 style={h1Style}>The Honeypot</h1>
            <p style={h2Style}>Secure anonymous submission</p>
          </div>

          <p style={bodyStyle}>
            If you have information about developments in AI, VR/AR, spatial computing,
            vibe coding, or SEO that you believe the world should know about — we want to hear it.
          </p>

          <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '2px', padding: '24px', marginBottom: '32px' }}>
            <div style={{ fontFamily: 'monospace', fontSize: '12px', color: '#F5A623', letterSpacing: '0.1em', marginBottom: '12px' }}>HOW WE PROTECT YOU</div>
            {[
              'We do not log IP addresses.',
              'We do not store identifying information.',
              'We cannot identify you even if legally compelled.',
              'We assign you an anonymous token — not a name, not a profile.',
              'Your questionnaire answers are assessed once, then deleted.',
            ].map(line => (
              <div key={line} style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                <span style={{ color: '#F5A623', fontFamily: 'monospace', flexShrink: 0 }}>—</span>
                <span style={{ fontSize: '14px', color: '#888', lineHeight: 1.5 }}>{line}</span>
              </div>
            ))}
          </div>

          <p style={{ ...bodyStyle, fontSize: '13px', color: '#555' }}>
            This page is accessible via Tor for maximum anonymity.
            If you are using a standard browser, consider switching to Tor Browser for additional protection.
          </p>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={btnStyle()} onClick={() => setStep('questions')}>
              BEGIN SUBMISSION →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'questions') {
    return (
      <div style={BASE}>
        <div style={CONTAINER}>
          <button onClick={() => setStep('welcome')} style={{ ...btnStyle(false), marginBottom: '32px', padding: '0', border: 'none', fontSize: '13px' }}>
            ← Back
          </button>

          <h1 style={h1Style}>Context</h1>
          <p style={{ ...h2Style }}>1 of 2 — Your answers help us assess this information. They are not stored.</p>

          {QUESTIONS.map(q => (
            <div key={q.id} style={{ marginBottom: '28px' }}>
              <label style={{ ...LABEL_STYLE }}>{q.text}</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {q.options.map(opt => (
                  <label key={opt} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name={q.id}
                      value={opt}
                      checked={answers[q.id] === opt}
                      onChange={() => setAnswers(a => ({ ...a, [q.id]: opt }))}
                      style={{ marginTop: '2px', flexShrink: 0 }}
                    />
                    <span style={{ fontSize: '14px', color: answers[q.id] === opt ? '#e5e5e5' : '#888', lineHeight: 1.4 }}>{opt}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div style={{ marginBottom: '28px' }}>
            <label style={LABEL_STYLE}>Have you submitted to NewsHive before? (optional)</label>
            <input
              type="text"
              value={existingToken}
              onChange={e => setExistingToken(e.target.value)}
              placeholder="Your token (e.g. SCOUT-7734)"
              style={{ width: '100%', padding: '10px 12px', background: '#1a1a1a', border: '1px solid #333', color: '#e5e5e5', borderRadius: '2px', fontSize: '14px', boxSizing: 'border-box' as const, fontFamily: 'monospace' }}
            />
          </div>

          <button
            style={{ ...btnStyle(), opacity: allAnswered() ? 1 : 0.4, cursor: allAnswered() ? 'pointer' : 'not-allowed' }}
            onClick={() => allAnswered() && setStep('submission')}
            disabled={!allAnswered()}
          >
            CONTINUE →
          </button>
        </div>
      </div>
    );
  }

  if (step === 'submission') {
    return (
      <div style={BASE}>
        <div style={CONTAINER}>
          <button onClick={() => setStep('questions')} style={{ ...btnStyle(false), marginBottom: '32px', padding: '0', border: 'none', fontSize: '13px' }}>
            ← Back
          </button>

          <h1 style={h1Style}>Your submission</h1>
          <p style={{ ...h2Style }}>2 of 2 — Tell us what you know</p>

          <div style={{ marginBottom: '20px' }}>
            <label style={LABEL_STYLE}>What are you reporting? Include context and why you believe it to be true.</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={10}
              placeholder="What is happening or about to happen. Why you believe this. What you think it means."
              style={{ width: '100%', padding: '12px', background: '#1a1a1a', border: '1px solid #333', color: '#e5e5e5', borderRadius: '2px', fontSize: '14px', lineHeight: 1.6, boxSizing: 'border-box' as const, resize: 'vertical', fontFamily: 'Georgia, serif' }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={LABEL_STYLE}>Domain (select all that apply)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {DOMAIN_OPTIONS.map(d => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDomain(d.value)}
                  style={{
                    padding: '6px 12px',
                    background: domains.includes(d.value) ? '#F5A623' : '#1a1a1a',
                    color: domains.includes(d.value) ? '#0f0f0f' : '#888',
                    border: `1px solid ${domains.includes(d.value) ? '#F5A623' : '#333'}`,
                    borderRadius: '2px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontFamily: 'monospace',
                  }}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '28px' }}>
            <label style={LABEL_STYLE}>Secure contact method (optional)</label>
            <input
              type="text"
              value={contactMethod}
              onChange={e => setContactMethod(e.target.value)}
              placeholder="Signal number or ProtonMail address — for clarifying questions only"
              style={{ width: '100%', padding: '10px 12px', background: '#1a1a1a', border: '1px solid #333', color: '#e5e5e5', borderRadius: '2px', fontSize: '14px', boxSizing: 'border-box' as const }}
            />
          </div>

          {error && <p style={{ color: '#ef4444', fontSize: '14px', marginBottom: '16px' }}>{error}</p>}

          <button
            style={{ ...btnStyle(), opacity: content.trim() && !submitting ? 1 : 0.4, cursor: content.trim() && !submitting ? 'pointer' : 'not-allowed' }}
            onClick={handleSubmit}
            disabled={!content.trim() || submitting}
          >
            {submitting ? 'SUBMITTING…' : 'SUBMIT SECURELY →'}
          </button>
        </div>
      </div>
    );
  }

  // Confirm step — token shown once
  return (
    <div style={BASE}>
      <div style={CONTAINER}>
        <div style={{ marginBottom: '32px' }}>
          <div style={{ color: '#22c55e', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '0.15em', marginBottom: '8px' }}>SUBMISSION RECEIVED</div>
          <h1 style={h1Style}>Your anonymous token</h1>
        </div>

        <div style={{ background: '#0a1f0a', border: '1px solid #22c55e', borderRadius: '2px', padding: '32px', textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ fontFamily: 'monospace', fontSize: '32px', fontWeight: 700, color: '#22c55e', letterSpacing: '0.1em' }}>
            {token}
          </div>
        </div>

        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '2px', padding: '20px', marginBottom: '32px' }}>
          {[
            'Save this token. It is the only link between this and future submissions.',
            'We do not store this token anywhere you can retrieve it.',
            'This page will not be accessible again. We cannot recover your token.',
            'You will not be contacted unless you provided a secure contact method.',
          ].map(line => (
            <div key={line} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <span style={{ color: '#F5A623', fontFamily: 'monospace', flexShrink: 0 }}>—</span>
              <span style={{ fontSize: '14px', color: '#888', lineHeight: 1.5 }}>{line}</span>
            </div>
          ))}
        </div>

        <p style={{ fontSize: '13px', color: '#555', lineHeight: 1.7 }}>
          We will assess your submission against current intelligence.
          If it enters our system, it may appear as a Pinch of Salt signal — unverified, but flagged as worth watching.
          If corroborated by independent sources, it may be elevated.
          Thank you for trusting us with this.
        </p>
      </div>
    </div>
  );
}
```

### Step 4.3 — Commit Honeypot pages

```bash
git add "apps/nextjs/app/honeypot/page.tsx" \
        "apps/nextjs/app/api/honeypot/route.ts"
git commit -m "feat(nextjs): public Honeypot submission form — 4-step, no analytics, Tor-compatible, token shown once"
```

---

## Task 5 — HiveDeck Submissions page

### Step 5.1 — Create submissions API routes

Create `apps/nextjs/app/dashboard/api/submissions/route.ts`:

```typescript
// apps/nextjs/app/dashboard/api/submissions/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT
        hs.id,
        hs.submitted_at,
        hs.confidence_level,
        hs.entered_queue,
        hs.instant_corroboration,
        hs.corroboration_window,
        hs.outcome,
        hs.submission_sequence,
        st.token,
        st.initial_verdict,
        st.current_tier,
        st.submission_count,
        st.accuracy_rate
      FROM honeypot_submissions hs
      JOIN source_tokens st ON st.id = hs.token_id
      WHERE hs.outcome IS NULL
        AND hs.content_encrypted != '[PURGED]'
      ORDER BY hs.submitted_at DESC
      LIMIT 50
    `;
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
```

Create `apps/nextjs/app/dashboard/api/submissions/[id]/route.ts`:

```typescript
// apps/nextjs/app/dashboard/api/submissions/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

// GET — decrypt and return submission content
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT
        hs.id,
        hs.content_encrypted,
        hs.submitted_at,
        hs.confidence_level,
        hs.entered_queue,
        hs.instant_corroboration,
        hs.corroboration_window,
        hs.outcome,
        st.token,
        st.initial_verdict,
        st.current_tier,
        st.accuracy_rate,
        st.confirmed_correct,
        st.confirmed_wrong,
        st.submission_count
      FROM honeypot_submissions hs
      JOIN source_tokens st ON st.id = hs.token_id
      WHERE hs.id = ${params.id}
      LIMIT 1
    `;
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST — record outcome
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const res = await fetch(`${PYTHON_URL}/honeypot/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submission_id: params.id, ...body }),
    });
    if (!res.ok) return NextResponse.json({ error: 'Outcome failed' }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
```

### Step 5.2 — Create Submissions page

Create `apps/nextjs/app/dashboard/submissions/page.tsx`:

```tsx
// apps/nextjs/app/dashboard/submissions/page.tsx
'use client';

import { useEffect, useState } from 'react';

interface Submission {
  id: string;
  submitted_at: string;
  confidence_level: string;
  entered_queue: string;
  instant_corroboration: boolean;
  corroboration_window: string;
  outcome: string | null;
  submission_sequence: number;
  token: string;
  initial_verdict: string;
  current_tier: number;
  submission_count: number;
  accuracy_rate: number | null;
  // decrypted content (loaded on demand)
  content_encrypted?: string;
}

interface ExpandedSubmission extends Submission {
  confirmed_correct: number;
  confirmed_wrong: number;
}

const VERDICT_COLOR: Record<string, string> = {
  reliable: '#22c55e',
  indefinite: '#F5A623',
  illegitimate: '#ef4444',
};

const TIER_LABEL = ['New', 'Emerging', 'Credible', 'Reliable', 'Exemplary'];

export default function SubmissionsPage() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, ExpandedSubmission | null>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [outcomeMsg, setOutcomeMsg] = useState<Record<string, string>>({});

  async function load() {
    const res = await fetch('/dashboard/api/submissions');
    setSubmissions(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function expand(id: string) {
    if (expanded[id] !== undefined) {
      setExpanded(e => ({ ...e, [id]: null }));
      return;
    }
    setLoadingId(id);
    const res = await fetch(`/dashboard/api/submissions/${id}`);
    const data = await res.json();
    setExpanded(e => ({ ...e, [id]: data }));
    setLoadingId(null);
  }

  async function recordOutcome(id: string, outcome: string) {
    const res = await fetch(`/dashboard/api/submissions/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outcome }),
    });
    if (res.ok) {
      setOutcomeMsg(m => ({ ...m, [id]: `Marked ${outcome}` }));
      await load();
    }
  }

  if (loading) return <div style={{ color: '#555', padding: '40px 0' }}>Loading…</div>;

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: '22px', fontWeight: 600 }}>Honeypot Submissions</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
          {submissions.length} pending review
        </p>
      </div>

      {submissions.length === 0 ? (
        <p style={{ color: '#555' }}>No pending submissions.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {submissions.map(s => {
            const exp = expanded[s.id];
            const isExpanded = exp !== null && exp !== undefined;
            return (
              <div key={s.id} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', overflow: 'hidden' }}>
                {/* Summary row */}
                <div
                  onClick={() => expand(s.id)}
                  style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '4px' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '13px', color: '#e5e5e5', fontWeight: 600 }}>{s.token}</span>
                      <span style={{ fontSize: '11px', color: VERDICT_COLOR[s.initial_verdict] || '#888', fontFamily: 'monospace' }}>
                        {s.initial_verdict.toUpperCase()}
                      </span>
                      <span style={{ fontSize: '11px', color: '#555' }}>Tier {s.current_tier} — {TIER_LABEL[s.current_tier] || '?'}</span>
                      {s.instant_corroboration && (
                        <span style={{ fontSize: '11px', color: '#22c55e' }}>⚡ {s.corroboration_window} corroboration</span>
                      )}
                    </div>
                    <div style={{ fontSize: '12px', color: '#555' }}>
                      {new Date(s.submitted_at).toLocaleString()} ·
                      Submission #{s.submission_sequence} · {s.submission_count} total ·
                      Queue: {s.entered_queue}
                    </div>
                  </div>
                  <div style={{ color: '#555', fontSize: '12px', flexShrink: 0 }}>
                    {loadingId === s.id ? '…' : isExpanded ? '▲' : '▼ Review'}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && exp && (
                  <div style={{ borderTop: '1px solid #2a2a2a', padding: '16px' }}>
                    <div style={{ background: '#111', border: '1px solid #222', borderRadius: '4px', padding: '16px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '11px', color: '#555', fontFamily: 'monospace', marginBottom: '8px' }}>SUBMISSION CONTENT (decrypted in memory)</div>
                      <pre style={{ margin: 0, fontSize: '14px', color: '#ccc', lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: 'Georgia, serif' }}>
                        {exp.content_encrypted}
                      </pre>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: '#555', marginRight: '4px' }}>Record outcome:</span>
                      {['confirmed', 'wrong', 'partial', 'unresolved'].map(outcome => (
                        <button
                          key={outcome}
                          onClick={() => recordOutcome(s.id, outcome)}
                          style={{
                            padding: '6px 12px',
                            background: outcome === 'confirmed' ? '#0a1f0a' : outcome === 'wrong' ? '#1f0a0a' : '#1a1a1a',
                            border: `1px solid ${outcome === 'confirmed' ? '#22c55e' : outcome === 'wrong' ? '#ef4444' : '#333'}`,
                            color: outcome === 'confirmed' ? '#22c55e' : outcome === 'wrong' ? '#ef4444' : '#888',
                            borderRadius: '4px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            fontFamily: 'monospace',
                          }}
                        >
                          {outcome}
                        </button>
                      ))}
                      {outcomeMsg[s.id] && (
                        <span style={{ fontSize: '12px', color: '#22c55e', marginLeft: '8px' }}>{outcomeMsg[s.id]}</span>
                      )}
                    </div>

                    <div style={{ marginTop: '12px', fontSize: '12px', color: '#555' }}>
                      Track record: {exp.confirmed_correct} correct · {exp.confirmed_wrong} wrong ·{' '}
                      {exp.accuracy_rate != null ? `${(exp.accuracy_rate * 100).toFixed(0)}% accuracy` : 'no resolved calls yet'}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

### Step 5.3 — Add Submissions to sidebar nav

Update `apps/nextjs/app/dashboard/layout.tsx`:

```typescript
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/packs', label: 'Content Packs' },
  { href: '/dashboard/trajectories', label: 'Trajectories' },
  { href: '/dashboard/sources', label: 'Sources' },
  { href: '/dashboard/monthly', label: 'Monthly Report' },
  { href: '/dashboard/submissions', label: 'Submissions' },
];
```

### Step 5.4 — Commit Submissions page

```bash
git add "apps/nextjs/app/dashboard/api/submissions/route.ts" \
        "apps/nextjs/app/dashboard/api/submissions/[id]/route.ts" \
        "apps/nextjs/app/dashboard/submissions/page.tsx" \
        "apps/nextjs/app/dashboard/layout.tsx"
git commit -m "feat(nextjs): HiveDeck Submissions page — review Honeypot queue, decrypt content, record outcomes"
```

---

## Task 6 — Tor Docker config

### Step 6.1 — Create `docker/docker-compose.tor.yml`

```yaml
# docker/docker-compose.tor.yml
# Tor hidden service for The Honeypot
# Deploy as a custom Docker application in Coolify on the same network as newshive-nextjs.
#
# After deployment, retrieve .onion address:
#   docker exec [tor-container] cat /var/lib/tor/hidden_service/hostname
#
# Add this address to apps/nextjs/app/honeypot/page.tsx (Tor Browser notice).

version: '3.8'

services:
  tor:
    image: dperson/torproxy:latest
    restart: unless-stopped
    environment:
      - HIDDENSERVICE=newshive-nextjs:3000
    volumes:
      - tor-hidden-service:/var/lib/tor/hidden_service
    networks:
      - coolify   # Must be on the same internal Docker network as newshive-nextjs

volumes:
  tor-hidden-service:
    driver: local

networks:
  coolify:
    external: true
    name: coolify
```

### Step 6.2 — Commit Tor config

```bash
git add docker/docker-compose.tor.yml
git commit -m "feat(deploy): Tor hidden service Docker config for Honeypot .onion access"
```

---

## Task 7 — Final commit + push

### Step 7.1 — Run full Python test suite

```bash
cd apps/python
python -m pytest tests/ -q --no-header
```

Expected: 79 tests pass.

### Step 7.2 — Push all commits

```bash
git push origin master
```

---

## Implementation Order Summary

| Task | Files | Tests |
|------|-------|-------|
| 1 | `services/webhook.py`, `services/publisher.py` (webhook call) | 3 TDD |
| 2 | `requirements.txt`, `main.py`, `routers/honeypot.py` (rate limit) | — |
| 3 | `api/v1/_auth.ts`, `signals/route.ts`, `packs/route.ts`, `trajectories/route.ts` | — |
| 4 | `honeypot/page.tsx`, `api/honeypot/route.ts` | — |
| 5 | `dashboard/submissions/page.tsx`, API routes, `layout.tsx` | — |
| 6 | `docker/docker-compose.tor.yml` | — |
| 7 | Push | — |

**Final test count:** 79 (76 existing + 3 webhook)
