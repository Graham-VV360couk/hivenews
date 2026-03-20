# Phase 6 — Intelligence Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the trajectories system (named theories about domain direction), monthly HiveReport synthesis, and HiveDeck pages for trajectories, monthly reports, and source reputation.

**Architecture:** Python adds `services/trajectory.py` and `services/monthly_report.py` with corresponding routers. Next.js adds `/dashboard/trajectories`, `/dashboard/monthly`, and `/dashboard/sources` pages. Monthly reports feed into the existing content pack pipeline (`pack_type = 'monthly_report'`). The sidebar nav gains three new links.

**Tech Stack:** Python asyncpg, Anthropic Claude claude-opus-4-6, Next.js App Router Server Components

---

## File Map

```
apps/python/
├── services/
│   ├── trajectory.py         Trajectory CRUD + confidence versioning
│   └── monthly_report.py     Monthly stats computation + Claude synthesis
├── routers/
│   ├── trajectory.py         GET/POST/PATCH /trajectories endpoints
│   └── monthly.py            POST /monthly/snapshot, /monthly/generate
├── tests/
│   ├── test_trajectory.py    TDD for trajectory service
│   └── test_monthly_report.py TDD for monthly report service
└── main.py                   (updated: add trajectory + monthly routers)

apps/nextjs/
├── app/dashboard/
│   ├── layout.tsx            (updated: add Trajectories, Sources, Monthly nav links)
│   ├── trajectories/
│   │   ├── page.tsx          Trajectories list — active theories with confidence
│   │   └── [id]/page.tsx     Trajectory detail — confidence history, signals, actions
│   ├── sources/
│   │   └── page.tsx          Sources list with tier + reputation stats
│   └── monthly/
│       └── page.tsx          Monthly snapshot stats + Generate Report button
└── app/dashboard/api/
    ├── trajectories/
    │   ├── route.ts           GET list, POST create
    │   └── [id]/route.ts      GET detail, PATCH update confidence / resolve
    └── monthly/
        └── route.ts           POST (action: snapshot | generate)
```

---

## Task 1 — `services/trajectory.py` + tests + router (TDD)

### Step 1.1 — Write failing tests

Create `apps/python/tests/test_trajectory.py`:

```python
# apps/python/tests/test_trajectory.py
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


async def test_create_trajectory_returns_uuid():
    """create_trajectory inserts a row and returns its UUID."""
    new_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetchval = AsyncMock(return_value=new_id)
    mock_conn.execute = AsyncMock()

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.trajectory.get_conn", return_value=mock_ctx):
        from services.trajectory import create_trajectory
        result = await create_trajectory(
            name="AI agents displace SaaS",
            domain_tags=["ai"],
            description="LLM agents will erode traditional SaaS subscriptions within 18 months.",
        )

    assert result == new_id


async def test_get_active_trajectories_returns_list():
    """get_active_trajectories returns a list of active trajectory dicts."""
    traj_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetch = AsyncMock(return_value=[{
        "id": traj_id,
        "name": "AI agents displace SaaS",
        "domain_tags": ["ai"],
        "confidence_score": 6.5,
        "confidence_direction": "rising",
        "status": "active",
        "description": "LLM agents will erode...",
    }])

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.trajectory.get_conn", return_value=mock_ctx):
        from services.trajectory import get_active_trajectories
        result = await get_active_trajectories()

    assert len(result) == 1
    assert result[0]["name"] == "AI agents displace SaaS"


async def test_update_trajectory_confidence_returns_true_when_found():
    """update_trajectory_confidence updates score and returns True when row exists."""
    traj_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetchval = AsyncMock(side_effect=[
        3,          # current version_number
        None,       # INSERT trajectory_version (fetchval returns None for inserts)
    ])
    mock_conn.execute = AsyncMock()

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.trajectory.get_conn", return_value=mock_ctx):
        from services.trajectory import update_trajectory_confidence
        result = await update_trajectory_confidence(
            trajectory_id=traj_id,
            new_score=7.5,
            direction="rising",
            reason="Three new corroborating signals this week.",
        )

    assert result is True


async def test_update_trajectory_confidence_returns_false_when_not_found():
    """Returns False if trajectory_id doesn't exist."""
    traj_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.fetchval = AsyncMock(return_value=None)  # no version found

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.trajectory.get_conn", return_value=mock_ctx):
        from services.trajectory import update_trajectory_confidence
        result = await update_trajectory_confidence(
            trajectory_id=traj_id,
            new_score=7.5,
            direction="rising",
            reason="Test",
        )

    assert result is False


async def test_attach_signal_to_trajectory():
    """attach_signal appends signal_id to supporting or contradicting array."""
    traj_id = uuid.uuid4()
    sig_id = uuid.uuid4()

    mock_conn = AsyncMock()
    mock_conn.execute = AsyncMock()

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.trajectory.get_conn", return_value=mock_ctx):
        from services.trajectory import attach_signal
        result = await attach_signal(traj_id, sig_id, supporting=True)

    assert result is True
    mock_conn.execute.assert_awaited_once()
```

### Step 1.2 — Run tests to verify they fail

```bash
cd apps/python
python -m pytest tests/test_trajectory.py -v
```

Expected: `ImportError: cannot import name 'create_trajectory'`

### Step 1.3 — Implement `services/trajectory.py`

Create `apps/python/services/trajectory.py`:

```python
"""Trajectory management — named theories about where domains are heading.

A trajectory is a named, falsifiable prediction about the direction of a technology
domain. Confidence scores (0-10) are updated as supporting or contradicting signals
arrive. Every confidence update creates a trajectory_version for the audit trail.
"""
import logging
from uuid import UUID

from database import get_conn

log = logging.getLogger(__name__)


async def create_trajectory(
    name: str,
    domain_tags: list[str],
    description: str,
    initial_score: float = 5.0,
) -> UUID | None:
    """Insert a new trajectory and its first version. Returns the new UUID."""
    try:
        async with get_conn() as conn:
            traj_id = await conn.fetchval(
                """
                INSERT INTO trajectories
                  (name, domain_tags, description, confidence_score,
                   confidence_direction, status, first_published_at, last_updated_at)
                VALUES ($1, $2, $3, $4, 'stable', 'active', NOW(), NOW())
                RETURNING id
                """,
                name, domain_tags, description, initial_score,
            )
            # Record initial version
            await conn.execute(
                """
                INSERT INTO trajectory_versions
                  (trajectory_id, version_number, confidence_score,
                   description, reason_for_change)
                VALUES ($1, 1, $2, $3, 'Initial creation')
                """,
                traj_id, initial_score, description,
            )
        log.info("Created trajectory %s: %s", traj_id, name)
        return traj_id
    except Exception as exc:
        log.error("Failed to create trajectory: %s", exc)
        return None


async def get_active_trajectories() -> list[dict]:
    """Return all active trajectories ordered by confidence score descending."""
    try:
        async with get_conn() as conn:
            rows = await conn.fetch(
                """
                SELECT id, name, domain_tags, confidence_score,
                       confidence_direction, status, description,
                       first_published_at, last_updated_at
                FROM trajectories
                WHERE status = 'active'
                ORDER BY confidence_score DESC, last_updated_at DESC
                """,
            )
        return [dict(r) for r in rows]
    except Exception as exc:
        log.error("Failed to fetch active trajectories: %s", exc)
        return []


async def get_trajectory(trajectory_id: UUID) -> dict | None:
    """Return a single trajectory with its version history."""
    try:
        async with get_conn() as conn:
            row = await conn.fetchrow(
                """
                SELECT id, name, domain_tags, confidence_score, confidence_direction,
                       status, description, most_likely_path, accelerated_scenario,
                       disruption_scenario, stagnation_scenario,
                       supporting_signal_ids, contradicting_signal_ids,
                       first_published_at, last_updated_at, outcome, outcome_notes
                FROM trajectories
                WHERE id = $1
                """,
                trajectory_id,
            )
            if not row:
                return None
            versions = await conn.fetch(
                """
                SELECT version_number, confidence_score, reason_for_change, created_at
                FROM trajectory_versions
                WHERE trajectory_id = $1
                ORDER BY version_number DESC
                LIMIT 20
                """,
                trajectory_id,
            )
        result = dict(row)
        result["versions"] = [dict(v) for v in versions]
        return result
    except Exception as exc:
        log.error("Failed to fetch trajectory %s: %s", trajectory_id, exc)
        return None


async def update_trajectory_confidence(
    trajectory_id: UUID,
    new_score: float,
    direction: str,
    reason: str,
) -> bool:
    """Update confidence score and record a new version. Returns False if not found."""
    try:
        async with get_conn() as conn:
            current_version = await conn.fetchval(
                "SELECT MAX(version_number) FROM trajectory_versions WHERE trajectory_id = $1",
                trajectory_id,
            )
            if current_version is None:
                return False
            next_version = current_version + 1
            await conn.execute(
                """
                UPDATE trajectories
                SET confidence_score = $1, confidence_direction = $2, last_updated_at = NOW()
                WHERE id = $3
                """,
                new_score, direction, trajectory_id,
            )
            await conn.execute(
                """
                INSERT INTO trajectory_versions
                  (trajectory_id, version_number, confidence_score, reason_for_change)
                VALUES ($1, $2, $3, $4)
                """,
                trajectory_id, next_version, new_score, reason,
            )
        return True
    except Exception as exc:
        log.error("Failed to update trajectory confidence %s: %s", trajectory_id, exc)
        return False


async def attach_signal(
    trajectory_id: UUID,
    signal_id: UUID,
    supporting: bool,
) -> bool:
    """Append a signal to the trajectory's supporting or contradicting array."""
    try:
        column = "supporting_signal_ids" if supporting else "contradicting_signal_ids"
        async with get_conn() as conn:
            await conn.execute(
                f"""
                UPDATE trajectories
                SET {column} = array_append(COALESCE({column}, '{{}}'), $1),
                    last_updated_at = NOW()
                WHERE id = $2
                """,
                signal_id, trajectory_id,
            )
        return True
    except Exception as exc:
        log.error("Failed to attach signal to trajectory: %s", exc)
        return False


async def resolve_trajectory(
    trajectory_id: UUID,
    status: str,
    outcome_notes: str,
) -> bool:
    """Mark trajectory as confirmed/abandoned/superseded."""
    valid = {"confirmed", "abandoned", "superseded"}
    if status not in valid:
        log.warning("Invalid trajectory status: %s", status)
        return False
    try:
        async with get_conn() as conn:
            await conn.execute(
                """
                UPDATE trajectories
                SET status = $1, outcome_notes = $2, outcome_at = NOW(), last_updated_at = NOW()
                WHERE id = $3
                """,
                status, outcome_notes, trajectory_id,
            )
        return True
    except Exception as exc:
        log.error("Failed to resolve trajectory %s: %s", trajectory_id, exc)
        return False
```

### Step 1.4 — Run tests

```bash
python -m pytest tests/test_trajectory.py -v
```

Expected: 5 tests pass.

### Step 1.5 — Create `routers/trajectory.py`

```python
"""Trajectory management endpoints."""
import logging
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.trajectory import (
    create_trajectory,
    get_active_trajectories,
    get_trajectory,
    update_trajectory_confidence,
    attach_signal,
    resolve_trajectory,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/trajectories", tags=["trajectories"])


class CreateTrajectoryRequest(BaseModel):
    name: str
    domain_tags: list[str] = []
    description: str
    initial_score: float = 5.0


class UpdateConfidenceRequest(BaseModel):
    new_score: float
    direction: str  # rising / falling / stable
    reason: str


class AttachSignalRequest(BaseModel):
    signal_id: UUID
    supporting: bool = True


class ResolveRequest(BaseModel):
    status: str  # confirmed / abandoned / superseded
    outcome_notes: str


@router.get("")
async def list_trajectories() -> list[dict]:
    """List all active trajectories."""
    return await get_active_trajectories()


@router.post("")
async def create(req: CreateTrajectoryRequest) -> dict:
    """Create a new trajectory."""
    traj_id = await create_trajectory(
        req.name, req.domain_tags, req.description, req.initial_score
    )
    if not traj_id:
        raise HTTPException(status_code=500, detail="Failed to create trajectory")
    return {"trajectory_id": str(traj_id)}


@router.get("/{trajectory_id}")
async def detail(trajectory_id: UUID) -> dict:
    """Get a single trajectory with version history."""
    traj = await get_trajectory(trajectory_id)
    if not traj:
        raise HTTPException(status_code=404, detail="Trajectory not found")
    return traj


@router.patch("/{trajectory_id}/confidence")
async def update_confidence(trajectory_id: UUID, req: UpdateConfidenceRequest) -> dict:
    """Update trajectory confidence score."""
    ok = await update_trajectory_confidence(
        trajectory_id, req.new_score, req.direction, req.reason
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Trajectory not found")
    return {"updated": True}


@router.post("/{trajectory_id}/signals")
async def add_signal(trajectory_id: UUID, req: AttachSignalRequest) -> dict:
    """Attach a signal to a trajectory."""
    ok = await attach_signal(trajectory_id, req.signal_id, req.supporting)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to attach signal")
    return {"attached": True}


@router.patch("/{trajectory_id}/resolve")
async def resolve(trajectory_id: UUID, req: ResolveRequest) -> dict:
    """Resolve a trajectory (confirmed/abandoned/superseded)."""
    ok = await resolve_trajectory(trajectory_id, req.status, req.outcome_notes)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid status or trajectory not found")
    return {"resolved": True}
```

### Step 1.6 — Register router in `main.py`

```python
# Change:
from routers import ingest, score, honeypot, draft, publish
# To:
from routers import ingest, score, honeypot, draft, publish, trajectory, monthly

# Add after existing include_router calls:
app.include_router(trajectory.router)
# monthly.router added in Task 3
```

Add only trajectory for now:
```python
from routers import ingest, score, honeypot, draft, publish, trajectory
app.include_router(trajectory.router)
```

### Step 1.7 — Run full test suite

```bash
python -m pytest tests/ -v
```

Expected: 74 tests pass (69 + 5 new).

### Step 1.8 — Commit

```bash
git add apps/python/services/trajectory.py \
        apps/python/routers/trajectory.py \
        apps/python/tests/test_trajectory.py \
        apps/python/main.py
git commit -m "feat(python): trajectory service + router — named intelligence theories with confidence versioning"
```

---

## Task 2 — HiveDeck Trajectories pages

### Step 2.1 — Create dashboard API routes

Create `apps/nextjs/app/dashboard/api/trajectories/route.ts`:

```typescript
// apps/nextjs/app/dashboard/api/trajectories/route.ts
import { NextRequest, NextResponse } from 'next/server';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function GET() {
  try {
    const res = await fetch(`${PYTHON_URL}/trajectories`);
    if (!res.ok) return NextResponse.json([], { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${PYTHON_URL}/trajectories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create trajectory' }, { status: 500 });
  }
}
```

Create `apps/nextjs/app/dashboard/api/trajectories/[id]/route.ts`:

```typescript
// apps/nextjs/app/dashboard/api/trajectories/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const res = await fetch(`${PYTHON_URL}/trajectories/${params.id}`);
    if (!res.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Failed to load trajectory' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { action, ...payload } = body;
    const endpoint = action === 'resolve'
      ? `${PYTHON_URL}/trajectories/${params.id}/resolve`
      : `${PYTHON_URL}/trajectories/${params.id}/confidence`;
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
```

### Step 2.2 — Create Trajectories list page

Create `apps/nextjs/app/dashboard/trajectories/page.tsx`:

```tsx
// apps/nextjs/app/dashboard/trajectories/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Trajectory {
  id: string;
  name: string;
  domain_tags: string[];
  confidence_score: number;
  confidence_direction: string;
  status: string;
  description: string;
  last_updated_at: string;
}

const DIRECTION_ICON: Record<string, string> = {
  rising: '↑',
  falling: '↓',
  stable: '→',
};

const DIRECTION_COLOR: Record<string, string> = {
  rising: '#22c55e',
  falling: '#ef4444',
  stable: '#888',
};

export default function TrajectoriesPage() {
  const [trajectories, setTrajectories] = useState<Trajectory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', domain_tags: '', initial_score: '5' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch('/dashboard/api/trajectories')
      .then(r => r.json())
      .then(data => { setTrajectories(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/dashboard/api/trajectories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          domain_tags: form.domain_tags.split(',').map(t => t.trim()).filter(Boolean),
          initial_score: parseFloat(form.initial_score),
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setForm({ name: '', description: '', domain_tags: '', initial_score: '5' });
        const updated = await fetch('/dashboard/api/trajectories').then(r => r.json());
        setTrajectories(updated);
      }
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div style={{ color: '#555', padding: '40px 0' }}>Loading…</div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>Trajectories</h1>
        <button
          onClick={() => setShowCreate(!showCreate)}
          style={{
            padding: '8px 16px',
            background: '#F5A623',
            color: '#0f0f0f',
            border: 'none',
            borderRadius: '4px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + New Theory
        </button>
      </div>

      {showCreate && (
        <form onSubmit={handleCreate} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '20px', marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600 }}>New Trajectory</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Theory name (e.g. 'AI agents displace SaaS')"
              required
              style={{ padding: '8px 12px', background: '#111', border: '1px solid #333', color: '#e5e5e5', borderRadius: '4px', fontSize: '14px' }}
            />
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Description — what this theory claims and why it matters"
              required
              rows={3}
              style={{ padding: '8px 12px', background: '#111', border: '1px solid #333', color: '#e5e5e5', borderRadius: '4px', fontSize: '14px', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', gap: '12px' }}>
              <input
                value={form.domain_tags}
                onChange={e => setForm(f => ({ ...f, domain_tags: e.target.value }))}
                placeholder="Domains (ai, vr, seo, vibe_coding)"
                style={{ flex: 1, padding: '8px 12px', background: '#111', border: '1px solid #333', color: '#e5e5e5', borderRadius: '4px', fontSize: '14px' }}
              />
              <input
                type="number"
                min="0"
                max="10"
                step="0.5"
                value={form.initial_score}
                onChange={e => setForm(f => ({ ...f, initial_score: e.target.value }))}
                style={{ width: '80px', padding: '8px 12px', background: '#111', border: '1px solid #333', color: '#e5e5e5', borderRadius: '4px', fontSize: '14px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="submit" disabled={creating} style={{ padding: '8px 16px', background: creating ? '#555' : '#F5A623', color: '#0f0f0f', border: 'none', borderRadius: '4px', fontSize: '13px', fontWeight: 600, cursor: creating ? 'not-allowed' : 'pointer' }}>
                {creating ? 'Creating…' : 'Create'}
              </button>
              <button type="button" onClick={() => setShowCreate(false)} style={{ padding: '8px 16px', background: 'none', border: '1px solid #333', color: '#888', borderRadius: '4px', fontSize: '13px', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      {trajectories.length === 0 ? (
        <p style={{ color: '#555' }}>No active trajectories. Create the first named theory.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {trajectories.map(t => (
            <Link
              key={t.id}
              href={`/dashboard/trajectories/${t.id}`}
              style={{ display: 'block', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '16px 20px', textDecoration: 'none', color: 'inherit' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: '#e5e5e5', marginBottom: '4px' }}>{t.name}</div>
                  <div style={{ fontSize: '13px', color: '#666', marginBottom: '6px' }}>{t.description}</div>
                  <div style={{ fontSize: '12px', color: '#555' }}>
                    {(t.domain_tags || []).join(', ')}
                    {t.last_updated_at && ` · Updated ${new Date(t.last_updated_at).toLocaleDateString('en-GB')}`}
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '16px' }}>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: '#F5A623', lineHeight: 1 }}>
                    {t.confidence_score?.toFixed(1) ?? '—'}
                  </div>
                  <div style={{ fontSize: '13px', color: DIRECTION_COLOR[t.confidence_direction] || '#888', marginTop: '2px' }}>
                    {DIRECTION_ICON[t.confidence_direction] || '—'} {t.confidence_direction}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Step 2.3 — Create Trajectory detail page

Create `apps/nextjs/app/dashboard/trajectories/[id]/page.tsx`:

```tsx
// apps/nextjs/app/dashboard/trajectories/[id]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface TrajectoryVersion {
  version_number: number;
  confidence_score: number;
  reason_for_change: string;
  created_at: string;
}

interface Trajectory {
  id: string;
  name: string;
  domain_tags: string[];
  confidence_score: number;
  confidence_direction: string;
  status: string;
  description: string;
  most_likely_path: string | null;
  outcome_notes: string | null;
  versions: TrajectoryVersion[];
}

const DIRECTION_COLOR: Record<string, string> = {
  rising: '#22c55e',
  falling: '#ef4444',
  stable: '#888',
};

export default function TrajectoryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [traj, setTraj] = useState<Trajectory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Update confidence form
  const [showUpdate, setShowUpdate] = useState(false);
  const [updateForm, setUpdateForm] = useState({ new_score: '', direction: 'stable', reason: '' });
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');

  // Resolve form
  const [showResolve, setShowResolve] = useState(false);
  const [resolveForm, setResolveForm] = useState({ status: 'confirmed', outcome_notes: '' });
  const [resolving, setResolving] = useState(false);

  async function load() {
    try {
      const res = await fetch(`/dashboard/api/trajectories/${id}`);
      if (!res.ok) throw new Error('Not found');
      setTraj(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault();
    setUpdating(true);
    setUpdateMsg('');
    try {
      const res = await fetch(`/dashboard/api/trajectories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confidence',
          new_score: parseFloat(updateForm.new_score),
          direction: updateForm.direction,
          reason: updateForm.reason,
        }),
      });
      if (res.ok) {
        setUpdateMsg('Updated');
        setShowUpdate(false);
        await load();
      } else {
        setUpdateMsg('Update failed');
      }
    } finally {
      setUpdating(false);
    }
  }

  async function handleResolve(e: React.FormEvent) {
    e.preventDefault();
    setResolving(true);
    try {
      const res = await fetch(`/dashboard/api/trajectories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resolve', ...resolveForm }),
      });
      if (res.ok) {
        setShowResolve(false);
        await load();
      }
    } finally {
      setResolving(false);
    }
  }

  if (loading) return <div style={{ color: '#555', padding: '40px 0' }}>Loading…</div>;
  if (error || !traj) return <div style={{ color: '#ef4444', padding: '40px 0' }}>{error || 'Not found'}</div>;

  const isActive = traj.status === 'active';

  return (
    <div>
      <Link href="/dashboard/trajectories" style={{ fontSize: '13px', color: '#555', display: 'inline-block', marginBottom: '16px' }}>
        ← Trajectories
      </Link>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 600 }}>{traj.name}</h1>
          <div style={{ fontSize: '13px', color: '#666', marginBottom: '6px' }}>
            {(traj.domain_tags || []).join(', ')} · Status: {traj.status}
          </div>
          <p style={{ margin: 0, fontSize: '14px', color: '#aaa', maxWidth: '600px' }}>{traj.description}</p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '24px' }}>
          <div style={{ fontSize: '36px', fontWeight: 700, color: '#F5A623', lineHeight: 1 }}>
            {traj.confidence_score?.toFixed(1) ?? '—'}
          </div>
          <div style={{ fontSize: '13px', color: DIRECTION_COLOR[traj.confidence_direction] || '#888', marginTop: '4px' }}>
            {traj.confidence_direction}
          </div>
          <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>confidence /10</div>
        </div>
      </div>

      {/* Action buttons */}
      {isActive && (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          <button onClick={() => setShowUpdate(!showUpdate)} style={{ padding: '8px 14px', background: '#1a1a1a', border: '1px solid #333', color: '#ccc', borderRadius: '4px', fontSize: '13px', cursor: 'pointer' }}>
            Update Confidence
          </button>
          <button onClick={() => setShowResolve(!showResolve)} style={{ padding: '8px 14px', background: '#1a1a1a', border: '1px solid #333', color: '#888', borderRadius: '4px', fontSize: '13px', cursor: 'pointer' }}>
            Resolve
          </button>
        </div>
      )}

      {/* Update form */}
      {showUpdate && (
        <form onSubmit={handleUpdate} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '16px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <input
              type="number" min="0" max="10" step="0.5" required
              value={updateForm.new_score}
              onChange={e => setUpdateForm(f => ({ ...f, new_score: e.target.value }))}
              placeholder="Score (0-10)"
              style={{ width: '120px', padding: '7px 10px', background: '#111', border: '1px solid #333', color: '#e5e5e5', borderRadius: '4px', fontSize: '13px' }}
            />
            <select
              value={updateForm.direction}
              onChange={e => setUpdateForm(f => ({ ...f, direction: e.target.value }))}
              style={{ padding: '7px 10px', background: '#111', border: '1px solid #333', color: '#e5e5e5', borderRadius: '4px', fontSize: '13px' }}
            >
              <option value="rising">Rising</option>
              <option value="stable">Stable</option>
              <option value="falling">Falling</option>
            </select>
            <input
              required
              value={updateForm.reason}
              onChange={e => setUpdateForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="Reason for change"
              style={{ flex: 1, minWidth: '200px', padding: '7px 10px', background: '#111', border: '1px solid #333', color: '#e5e5e5', borderRadius: '4px', fontSize: '13px' }}
            />
            <button type="submit" disabled={updating} style={{ padding: '7px 14px', background: '#F5A623', color: '#0f0f0f', border: 'none', borderRadius: '4px', fontSize: '13px', fontWeight: 600, cursor: updating ? 'not-allowed' : 'pointer' }}>
              {updating ? '…' : 'Update'}
            </button>
          </div>
          {updateMsg && <div style={{ marginTop: '8px', fontSize: '12px', color: '#888' }}>{updateMsg}</div>}
        </form>
      )}

      {/* Resolve form */}
      {showResolve && (
        <form onSubmit={handleResolve} style={{ background: '#1a1a1a', border: '1px solid #ef444460', borderRadius: '6px', padding: '16px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <select
              value={resolveForm.status}
              onChange={e => setResolveForm(f => ({ ...f, status: e.target.value }))}
              style={{ padding: '7px 10px', background: '#111', border: '1px solid #333', color: '#e5e5e5', borderRadius: '4px', fontSize: '13px' }}
            >
              <option value="confirmed">Confirmed</option>
              <option value="abandoned">Abandoned</option>
              <option value="superseded">Superseded</option>
            </select>
            <input
              required
              value={resolveForm.outcome_notes}
              onChange={e => setResolveForm(f => ({ ...f, outcome_notes: e.target.value }))}
              placeholder="Outcome notes"
              style={{ flex: 1, minWidth: '200px', padding: '7px 10px', background: '#111', border: '1px solid #333', color: '#e5e5e5', borderRadius: '4px', fontSize: '13px' }}
            />
            <button type="submit" disabled={resolving} style={{ padding: '7px 14px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '13px', fontWeight: 600, cursor: resolving ? 'not-allowed' : 'pointer' }}>
              {resolving ? '…' : 'Resolve'}
            </button>
          </div>
        </form>
      )}

      {/* Version history */}
      <h2 style={{ margin: '0 0 12px', fontSize: '13px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Confidence History
      </h2>
      <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', overflow: 'hidden' }}>
        {(traj.versions || []).length === 0 ? (
          <p style={{ padding: '16px', color: '#555', margin: 0 }}>No history yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                <th style={{ padding: '8px 16px', textAlign: 'left', color: '#555', fontWeight: 500 }}>v</th>
                <th style={{ padding: '8px 16px', textAlign: 'left', color: '#555', fontWeight: 500 }}>Score</th>
                <th style={{ padding: '8px 16px', textAlign: 'left', color: '#555', fontWeight: 500 }}>Reason</th>
                <th style={{ padding: '8px 16px', textAlign: 'right', color: '#555', fontWeight: 500 }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {traj.versions.map((v, i) => (
                <tr key={v.version_number} style={{ borderBottom: i < traj.versions.length - 1 ? '1px solid #1f1f1f' : 'none' }}>
                  <td style={{ padding: '8px 16px', color: '#555' }}>{v.version_number}</td>
                  <td style={{ padding: '8px 16px', color: '#F5A623', fontWeight: 600 }}>{v.confidence_score?.toFixed(1)}</td>
                  <td style={{ padding: '8px 16px', color: '#aaa' }}>{v.reason_for_change}</td>
                  <td style={{ padding: '8px 16px', color: '#555', textAlign: 'right' }}>
                    {new Date(v.created_at).toLocaleDateString('en-GB')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
```

### Step 2.4 — Commit

```bash
git add "apps/nextjs/app/dashboard/api/trajectories/route.ts" \
        "apps/nextjs/app/dashboard/api/trajectories/[id]/route.ts" \
        "apps/nextjs/app/dashboard/trajectories/page.tsx" \
        "apps/nextjs/app/dashboard/trajectories/[id]/page.tsx"
git commit -m "feat(nextjs): HiveDeck Trajectories pages — list, detail, confidence update, resolve"
```

---

## Task 3 — `services/monthly_report.py` + tests + router (TDD)

The monthly report generates a content pack of `pack_type = 'monthly_report'` that flows through the existing HiveDeck approval workflow. `compute_monthly_stats` builds the stats and upserts `monthly_snapshots`. `generate_monthly_report` synthesises the 7-section report via Claude and creates a content pack.

### Step 3.1 — Write failing tests

Create `apps/python/tests/test_monthly_report.py`:

```python
# apps/python/tests/test_monthly_report.py
import uuid
from unittest.mock import AsyncMock, MagicMock, patch


async def test_compute_monthly_stats_returns_dict():
    """compute_monthly_stats fetches counts from DB and returns a stats dict."""
    snap_id = uuid.uuid4()

    mock_conn = AsyncMock()
    # fetchrow returns a snapshot row (or None if first time)
    mock_conn.fetchrow = AsyncMock(return_value=None)
    # fetch* returning single-row aggregates
    mock_conn.fetchval = AsyncMock(side_effect=[
        42,   # signals_ingested
        5,    # alerts_fired
        3,    # alerts_confirmed
        2,    # pinch_of_salt_issued
        1,    # content_packs_published
    ])
    mock_conn.execute = AsyncMock()

    mock_ctx = MagicMock()
    mock_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
    mock_ctx.__aexit__ = AsyncMock(return_value=None)

    with patch("services.monthly_report.get_conn", return_value=mock_ctx):
        from services.monthly_report import compute_monthly_stats
        result = await compute_monthly_stats(2026, 3)

    assert result["year"] == 2026
    assert result["month"] == 3
    assert "signals_ingested" in result


async def test_generate_monthly_report_creates_content_pack():
    """generate_monthly_report calls Claude and returns a pack_id."""
    pack_id = uuid.uuid4()

    mock_stats = {
        "year": 2026, "month": 3,
        "signals_ingested": 42, "alerts_fired": 5,
        "alerts_confirmed": 3, "pinch_of_salt_issued": 2,
        "content_packs_published": 8,
    }

    mock_claude_response = MagicMock()
    mock_claude_response.content = [MagicMock(text='{"section1": "The Month in Numbers text", "section2": "AI domain text", "section3": "Scorecard", "section4": "Trajectory updates", "section5": "Signal of month", "section6": "Watching items", "section7": "Pinch of salt watch"}')]

    mock_pack_id = pack_id

    with patch("services.monthly_report.compute_monthly_stats", return_value=mock_stats), \
         patch("services.monthly_report.anthropic.AsyncAnthropic") as mock_anthropic_cls, \
         patch("services.monthly_report.create_content_pack", return_value=mock_pack_id), \
         patch("services.monthly_report.store_drafts", return_value=True):
        mock_client = AsyncMock()
        mock_client.messages.create = AsyncMock(return_value=mock_claude_response)
        mock_anthropic_cls.return_value = mock_client

        from services.monthly_report import generate_monthly_report
        result = await generate_monthly_report(2026, 3)

    assert result is not None
    assert "pack_id" in result
```

### Step 3.2 — Run tests to verify they fail

```bash
python -m pytest tests/test_monthly_report.py -v
```

Expected: `ImportError: cannot import name 'compute_monthly_stats'`

### Step 3.3 — Implement `services/monthly_report.py`

```python
"""Monthly HiveReport synthesis.

Two-step process:
  1. compute_monthly_stats  — gather and store DB stats into monthly_snapshots
  2. generate_monthly_report — call Claude with all context, create content_pack

The generated report flows into the normal HiveDeck approval queue as
pack_type = 'monthly_report'. The operator reviews 7 sections, approves,
then publishes via the existing publish pipeline.
"""
import json
import logging
from datetime import date
from uuid import UUID

import anthropic

from config import settings
from database import get_conn
from services.content_pack import create_content_pack, store_drafts

log = logging.getLogger(__name__)

_MONTH_NAMES = [
    "", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


async def compute_monthly_stats(year: int, month: int) -> dict:
    """Gather monthly stats from DB and upsert into monthly_snapshots.

    Returns a dict with all counts and metrics for the given month.
    """
    try:
        async with get_conn() as conn:
            # Date range for the month
            start = f"{year}-{month:02d}-01"
            if month == 12:
                end = f"{year + 1}-01-01"
            else:
                end = f"{year}-{month + 1:02d}-01"

            signals_ingested = await conn.fetchval(
                "SELECT COUNT(*) FROM signals WHERE ingested_at >= $1 AND ingested_at < $2",
                start, end,
            ) or 0

            alerts_fired = await conn.fetchval(
                "SELECT COUNT(*) FROM alert_candidates WHERE created_at >= $1 AND created_at < $2",
                start, end,
            ) or 0

            alerts_confirmed = await conn.fetchval(
                "SELECT COUNT(*) FROM alert_candidates WHERE created_at >= $1 AND created_at < $2 AND outcome_accurate = TRUE",
                start, end,
            ) or 0

            pinch_of_salt_issued = await conn.fetchval(
                "SELECT COUNT(*) FROM pinch_of_salt_watch WHERE created_at >= $1 AND created_at < $2",
                start, end,
            ) or 0

            content_packs_published = await conn.fetchval(
                "SELECT COUNT(*) FROM content_packs WHERE published_at >= $1 AND published_at < $2",
                start, end,
            ) or 0

            # Upsert snapshot row
            await conn.execute(
                """
                INSERT INTO monthly_snapshots
                  (period_year, period_month, signals_ingested, alerts_fired,
                   alerts_confirmed, pinch_of_salt_issued, content_packs_published)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (period_year, period_month) DO UPDATE SET
                  signals_ingested = EXCLUDED.signals_ingested,
                  alerts_fired = EXCLUDED.alerts_fired,
                  alerts_confirmed = EXCLUDED.alerts_confirmed,
                  pinch_of_salt_issued = EXCLUDED.pinch_of_salt_issued,
                  content_packs_published = EXCLUDED.content_packs_published
                """,
                year, month, int(signals_ingested), int(alerts_fired),
                int(alerts_confirmed), int(pinch_of_salt_issued),
                int(content_packs_published),
            )

        stats = {
            "year": year,
            "month": month,
            "month_name": _MONTH_NAMES[month],
            "signals_ingested": int(signals_ingested),
            "alerts_fired": int(alerts_fired),
            "alerts_confirmed": int(alerts_confirmed),
            "pinch_of_salt_issued": int(pinch_of_salt_issued),
            "content_packs_published": int(content_packs_published),
        }
        log.info("Monthly stats computed for %s/%s: %s", year, month, stats)
        return stats

    except Exception as exc:
        log.error("Failed to compute monthly stats: %s", exc)
        return {"year": year, "month": month, "error": str(exc)}


async def generate_monthly_report(year: int, month: int) -> dict | None:
    """Synthesise the monthly HiveReport via Claude and create a content pack.

    Returns {"pack_id": str} on success, None on failure.
    """
    # Step 1: get stats
    stats = await compute_monthly_stats(year, month)
    if "error" in stats:
        return None

    # Step 2: gather trajectories summary
    try:
        async with get_conn() as conn:
            trajectories = await conn.fetch(
                """
                SELECT name, confidence_score, confidence_direction, status, description
                FROM trajectories
                WHERE status = 'active'
                ORDER BY confidence_score DESC
                LIMIT 10
                """
            )
            trajectory_summaries = "\n".join(
                f"- {t['name']} (confidence: {t['confidence_score']}/10, {t['confidence_direction']}): {t['description']}"
                for t in trajectories
            )

            # Recent published packs for context
            recent_packs = await conn.fetch(
                """
                SELECT cp.pack_type, cp.confidence_level,
                       cd.draft_data->>'title' AS title
                FROM content_packs cp
                JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
                WHERE cp.published_at >= $1
                  AND cp.status = 'published'
                ORDER BY cp.published_at DESC
                LIMIT 20
                """,
                f"{year}-{month:02d}-01",
            )
            pack_summaries = "\n".join(
                f"- [{p['pack_type']} / {p['confidence_level']}] {p['title']}"
                for p in recent_packs
            )
    except Exception as exc:
        log.error("Failed to gather report context: %s", exc)
        trajectory_summaries = "No trajectory data available."
        pack_summaries = "No published packs data available."

    month_name = _MONTH_NAMES[month]

    prompt = f"""You are generating the monthly HiveReport for NewsHive — our flagship intelligence briefing.

This report covers {month_name} {year}.

MONTHLY STATISTICS:
- Signals ingested: {stats['signals_ingested']}
- HiveAlerts fired: {stats['alerts_fired']} ({stats['alerts_confirmed']} confirmed)
- Pinch of Salt signals issued: {stats['pinch_of_salt_issued']}
- Content packs published: {stats['content_packs_published']}

ACTIVE TRAJECTORIES:
{trajectory_summaries or 'None yet.'}

CONTENT PUBLISHED THIS MONTH:
{pack_summaries or 'None yet.'}

NEWSHAI VOICE GUIDE:
Write as a thoughtful, experienced observer. Strong opinions arrived at visibly. Never hollow amplifiers. Rhythm matters — long sentences that build, short ones that land. The honest scorecard (section 3) must include every call made — correct, wrong, and partial. Do not omit misses.

Generate the full HiveReport for {month_name} {year} following the seven-section structure. Length: 2000-3000 words total.

Return as JSON with these exact keys:
{{
  "title": "The {month_name} {year} HiveReport",
  "meta_description": "...",
  "section1_numbers": "The Month in Numbers — narrative summary of the stats above",
  "section2_domains": "Domain by Domain — AI, VR/AR, Vibe Coding, SEO activity narrative",
  "section3_scorecard": "The Calls We Made — honest assessment of all predictions (use ✅ ❌ ⚠️ ⏳)",
  "section4_trajectories": "Trajectory Updates — status of each named active theory",
  "section5_signal": "Signal of the Month — the single most significant development, full treatment",
  "section6_watching": "What We're Watching — 3-5 specific falsifiable items for next month",
  "section7_pos": "Pinch of Salt Watch — status of outstanding unverified signals",
  "linkedin_extract": "400-word LinkedIn extract from Signal of the Month section",
  "x_thread": ["Tweet 1: top takeaway", "Tweet 2", "Tweet 3", "Tweet 4", "Tweet 5: link"],
  "facebook_summary": "200-word conversational Facebook summary + link",
  "hivecast_script": "90-second spoken HiveCast script for the monthly highlight"
}}"""

    # Step 3: Call Claude
    try:
        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
        response = await client.messages.create(
            model="claude-opus-4-6",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()

        # Extract JSON
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        report_data = json.loads(raw)

    except Exception as exc:
        log.error("Claude synthesis failed for monthly report: %s", exc)
        return None

    # Step 4: Create content pack + store drafts
    # Build drafts dict in the format store_drafts expects
    drafts = {
        "blog": {
            "title": report_data.get("title", f"{month_name} {year} HiveReport"),
            "content": "\n\n".join([
                report_data.get("section1_numbers", ""),
                report_data.get("section2_domains", ""),
                report_data.get("section3_scorecard", ""),
                report_data.get("section4_trajectories", ""),
                report_data.get("section5_signal", ""),
                report_data.get("section6_watching", ""),
                report_data.get("section7_pos", ""),
            ]),
            "meta_description": report_data.get("meta_description", ""),
        },
        "linkedin": {
            "content": report_data.get("linkedin_extract", ""),
        },
        "x": {
            "type": "thread",
            "tweets": report_data.get("x_thread", []),
        },
        "facebook": {
            "content": report_data.get("facebook_summary", ""),
        },
        "hivecast": {
            "script": report_data.get("hivecast_script", ""),
        },
        "instagram": {
            "content": report_data.get("linkedin_extract", "")[:400],
            "hashtags": ["NewsHive", "HiveReport", "TechIntelligence"],
        },
        "suggested_visuals": f"NewsHive Monthly HiveReport — {month_name} {year}",
    }

    # Fetch a representative cluster_id for the pack (or None)
    try:
        async with get_conn() as conn:
            cluster_id = await conn.fetchval(
                "SELECT id FROM clusters WHERE is_active = TRUE ORDER BY readiness_score DESC LIMIT 1"
            )
    except Exception:
        cluster_id = None

    try:
        async with get_conn() as conn:
            signals = await conn.fetch(
                "SELECT id FROM signals WHERE ingested_at >= $1 ORDER BY importance_composite DESC LIMIT 10",
                f"{year}-{month:02d}-01",
            )
        signal_ids = [r["id"] for r in signals]
    except Exception:
        signal_ids = []

    pack_id = await create_content_pack(
        cluster_id=cluster_id,
        alert_candidate_id=None,
        pack_type="monthly_report",
        trigger_reason="schedule",
        readiness_score=100.0,
        signal_ids=signal_ids,
    )

    if pack_id is None:
        log.error("Failed to create content pack for monthly report")
        return None

    ok = await store_drafts(pack_id, drafts)
    if not ok:
        log.error("Failed to store drafts for monthly report pack %s", pack_id)
        return None

    # Update monthly_snapshots with draft_generated_at
    try:
        async with get_conn() as conn:
            await conn.execute(
                """
                UPDATE monthly_snapshots
                SET draft_generated_at = NOW()
                WHERE period_year = $1 AND period_month = $2
                """,
                year, month,
            )
    except Exception as exc:
        log.warning("Failed to update monthly_snapshots draft_generated_at: %s", exc)

    log.info("Monthly report generated for %s/%s — pack %s", year, month, pack_id)
    return {"pack_id": str(pack_id), "month": month_name, "year": year}
```

### Step 3.4 — Run tests

```bash
python -m pytest tests/test_monthly_report.py -v
```

Expected: 2 tests pass.

### Step 3.5 — Create `routers/monthly.py`

```python
"""Monthly HiveReport endpoints."""
import logging
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.monthly_report import compute_monthly_stats, generate_monthly_report

log = logging.getLogger(__name__)
router = APIRouter(prefix="/monthly", tags=["monthly"])


class MonthRequest(BaseModel):
    year: int | None = None
    month: int | None = None


@router.post("/snapshot")
async def trigger_snapshot(req: MonthRequest = MonthRequest()) -> dict:
    """Compute and store monthly stats for the given month (defaults to current)."""
    today = date.today()
    year = req.year or today.year
    month = req.month or today.month
    stats = await compute_monthly_stats(year, month)
    if "error" in stats:
        raise HTTPException(status_code=500, detail=stats["error"])
    return stats


@router.post("/generate")
async def trigger_generate(req: MonthRequest = MonthRequest()) -> dict:
    """Run Claude synthesis and create a monthly report content pack."""
    today = date.today()
    year = req.year or today.year
    month = req.month or today.month
    result = await generate_monthly_report(year, month)
    if result is None:
        raise HTTPException(status_code=500, detail="Monthly report generation failed")
    return result
```

### Step 3.6 — Register both new routers in `main.py`

```python
# Change:
from routers import ingest, score, honeypot, draft, publish, trajectory
# To:
from routers import ingest, score, honeypot, draft, publish, trajectory, monthly

# Add:
app.include_router(monthly.router)
```

### Step 3.7 — Run full test suite

```bash
python -m pytest tests/ -v
```

Expected: 76 tests pass (74 + 2 new).

### Step 3.8 — Commit

```bash
git add apps/python/services/monthly_report.py \
        apps/python/routers/monthly.py \
        apps/python/tests/test_monthly_report.py \
        apps/python/main.py
git commit -m "feat(python): monthly HiveReport synthesis — stats snapshot + Claude 7-section generation"
```

---

## Task 4 — HiveDeck Monthly page

### Step 4.1 — Create monthly API route

Create `apps/nextjs/app/dashboard/api/monthly/route.ts`:

```typescript
// apps/nextjs/app/dashboard/api/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

// GET — current month snapshot (from DB directly)
export async function GET() {
  try {
    const sql = getDb();
    const today = new Date();
    const rows = await sql`
      SELECT period_year, period_month, signals_ingested, alerts_fired,
             alerts_confirmed, pinch_of_salt_issued, content_packs_published,
             draft_generated_at, operator_reviewed, published_at
      FROM monthly_snapshots
      WHERE period_year = ${today.getFullYear()} AND period_month = ${today.getMonth() + 1}
      LIMIT 1
    `;
    return NextResponse.json(rows[0] ?? null);
  } catch {
    return NextResponse.json(null);
  }
}

// POST — action: 'snapshot' or 'generate'
export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();
    const endpoint = action === 'generate' ? '/monthly/generate' : '/monthly/snapshot';
    const res = await fetch(`${PYTHON_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: JSON.stringify(data) }, { status: res.status });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 }
    );
  }
}
```

### Step 4.2 — Create Monthly page

Create `apps/nextjs/app/dashboard/monthly/page.tsx`:

```tsx
// apps/nextjs/app/dashboard/monthly/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface MonthlySnapshot {
  period_year: number;
  period_month: number;
  signals_ingested: number;
  alerts_fired: number;
  alerts_confirmed: number;
  pinch_of_salt_issued: number;
  content_packs_published: number;
  draft_generated_at: string | null;
  operator_reviewed: boolean;
  published_at: string | null;
}

const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function MonthlyPage() {
  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  const [snapshot, setSnapshot] = useState<MonthlySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'snapshot' | 'generate' | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [packId, setPackId] = useState<string | null>(null);

  async function load() {
    const res = await fetch('/dashboard/api/monthly');
    setSnapshot(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAction(act: 'snapshot' | 'generate') {
    setAction(act);
    setActionMsg(null);
    setPackId(null);
    try {
      const res = await fetch('/dashboard/api/monthly', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: act }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionMsg(`Error: ${data.error}`);
      } else if (act === 'generate' && data.pack_id) {
        setPackId(data.pack_id);
        setActionMsg(`Report generated — pack ready for review.`);
      } else {
        setActionMsg(`Stats computed for ${MONTH_NAMES[data.month]} ${data.year}.`);
      }
      await load();
    } catch {
      setActionMsg('Network error');
    } finally {
      setAction(null);
    }
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 6px', fontSize: '22px', fontWeight: 600 }}>Monthly HiveReport</h1>
      <p style={{ margin: '0 0 28px', color: '#666', fontSize: '14px' }}>
        {MONTH_NAMES[currentMonth]} {currentYear}
      </p>

      {/* Snapshot stats */}
      <h2 style={{ margin: '0 0 12px', fontSize: '13px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        This Month's Stats
      </h2>
      {loading ? (
        <p style={{ color: '#555' }}>Loading…</p>
      ) : snapshot ? (
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '20px', marginBottom: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '16px', marginBottom: '16px' }}>
            {[
              { label: 'Signals ingested', value: snapshot.signals_ingested },
              { label: 'Alerts fired', value: snapshot.alerts_fired },
              { label: 'Alerts confirmed', value: snapshot.alerts_confirmed },
              { label: 'Pinch of Salt', value: snapshot.pinch_of_salt_issued },
              { label: 'Packs published', value: snapshot.content_packs_published },
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: '24px', fontWeight: 700, color: '#F5A623' }}>{s.value ?? '—'}</div>
                <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: '12px', color: '#555' }}>
            {snapshot.draft_generated_at
              ? `Draft generated ${new Date(snapshot.draft_generated_at).toLocaleString()}`
              : 'No draft generated yet'}
            {snapshot.published_at && ` · Published ${new Date(snapshot.published_at).toLocaleDateString('en-GB')}`}
          </div>
        </div>
      ) : (
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '20px', marginBottom: '24px' }}>
          <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>No snapshot computed yet for this month.</p>
        </div>
      )}

      {/* Actions */}
      <h2 style={{ margin: '0 0 12px', fontSize: '13px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Actions
      </h2>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <button
          onClick={() => handleAction('snapshot')}
          disabled={action !== null}
          style={{ padding: '10px 18px', background: '#1a1a1a', border: '1px solid #333', color: '#ccc', borderRadius: '4px', fontSize: '14px', cursor: action !== null ? 'not-allowed' : 'pointer' }}
        >
          {action === 'snapshot' ? 'Computing…' : 'Compute Stats'}
        </button>
        <button
          onClick={() => handleAction('generate')}
          disabled={action !== null}
          style={{ padding: '10px 18px', background: action !== null ? '#1a3a1a' : '#22c55e', color: '#0f0f0f', border: 'none', borderRadius: '4px', fontSize: '14px', fontWeight: 600, cursor: action !== null ? 'not-allowed' : 'pointer' }}
        >
          {action === 'generate' ? 'Generating…' : 'Generate Report'}
        </button>
      </div>

      {actionMsg && (
        <div style={{ marginBottom: '16px', fontSize: '14px', color: '#aaa' }}>
          {actionMsg}
          {packId && (
            <> · <Link href={`/dashboard/packs/${packId}`} style={{ color: '#F5A623' }}>Review pack →</Link></>
          )}
        </div>
      )}

      <p style={{ fontSize: '13px', color: '#555', marginTop: '12px', maxWidth: '480px' }}>
        Run "Compute Stats" to refresh this month's numbers, then "Generate Report" to synthesise the full HiveReport via Claude.
        The report will appear in the Content Packs queue for your review and approval.
      </p>
    </div>
  );
}
```

### Step 4.3 — Commit

```bash
git add "apps/nextjs/app/dashboard/api/monthly/route.ts" \
        "apps/nextjs/app/dashboard/monthly/page.tsx"
git commit -m "feat(nextjs): HiveDeck Monthly page — stats view + Report generate trigger"
```

---

## Task 5 — HiveDeck Sources page

### Step 5.1 — Create Sources page

Create `apps/nextjs/app/dashboard/sources/page.tsx`:

```tsx
// apps/nextjs/app/dashboard/sources/page.tsx
import { getDb } from '@/lib/db';

interface Source {
  id: string;
  name: string;
  platform: string;
  tier: number;
  domain_tags: string[];
  is_active: boolean;
  last_ingested: string | null;
  total_signals: number | null;
  accuracy_rate: number | null;
  lead_time_avg_days: number | null;
}

const TIER_LABELS: Record<number, string> = {
  1: 'Major',
  2: 'Established',
  3: 'Minor',
};

const TIER_COLORS: Record<number, string> = {
  1: '#22c55e',
  2: '#F5A623',
  3: '#666',
};

async function getSources(): Promise<Source[]> {
  const sql = getDb();
  const rows = await sql<Source[]>`
    SELECT
      s.id,
      s.name,
      s.platform,
      s.tier,
      s.domain_tags,
      s.is_active,
      s.last_ingested,
      sr.total_signals,
      sr.accuracy_rate,
      sr.lead_time_avg_days
    FROM sources s
    LEFT JOIN source_reputation sr ON sr.source_id = s.id
    ORDER BY s.tier ASC, sr.total_signals DESC NULLS LAST, s.name
    LIMIT 100
  `;
  return rows;
}

export default async function SourcesPage() {
  const sources = await getSources();

  const byStat = (sources: Source[], key: keyof Source) =>
    sources.filter(s => s[key] != null).length;

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: '22px', fontWeight: 600 }}>Sources</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
          {sources.filter(s => s.is_active).length} active · {sources.length} total
        </p>
      </div>

      {sources.length === 0 ? (
        <p style={{ color: '#555' }}>No sources registered yet.</p>
      ) : (
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#555', fontWeight: 500 }}>Source</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#555', fontWeight: 500 }}>Platform</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#555', fontWeight: 500 }}>Tier</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#555', fontWeight: 500 }}>Domains</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: '#555', fontWeight: 500 }}>Signals</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: '#555', fontWeight: 500 }}>Accuracy</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: '#555', fontWeight: 500 }}>Lead (days)</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: '#555', fontWeight: 500 }}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s, i) => (
                <tr
                  key={s.id}
                  style={{
                    borderBottom: i < sources.length - 1 ? '1px solid #1f1f1f' : 'none',
                    opacity: s.is_active ? 1 : 0.4,
                  }}
                >
                  <td style={{ padding: '10px 16px', color: '#e5e5e5', maxWidth: '200px' }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                  </td>
                  <td style={{ padding: '10px 16px', color: '#888' }}>{s.platform}</td>
                  <td style={{ padding: '10px 16px' }}>
                    <span style={{ color: TIER_COLORS[s.tier] || '#666', fontSize: '12px', fontWeight: 600 }}>
                      T{s.tier} {TIER_LABELS[s.tier] || ''}
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px', color: '#555', fontSize: '12px' }}>
                    {(s.domain_tags || []).join(', ') || '—'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#888' }}>
                    {s.total_signals ?? '—'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: s.accuracy_rate != null ? (s.accuracy_rate >= 0.7 ? '#22c55e' : s.accuracy_rate >= 0.5 ? '#F5A623' : '#ef4444') : '#555' }}>
                    {s.accuracy_rate != null ? `${(s.accuracy_rate * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#888' }}>
                    {s.lead_time_avg_days != null ? s.lead_time_avg_days.toFixed(1) : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#555', fontSize: '12px' }}>
                    {s.last_ingested ? new Date(s.last_ingested).toLocaleDateString('en-GB') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

### Step 5.2 — Commit

```bash
git add "apps/nextjs/app/dashboard/sources/page.tsx"
git commit -m "feat(nextjs): HiveDeck Sources page — source reputation table with accuracy + lead time"
```

---

## Task 6 — Update sidebar nav + final commit

### Step 6.1 — Update `apps/nextjs/app/dashboard/layout.tsx`

Change:

```typescript
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/packs', label: 'Content Packs' },
];
```

To:

```typescript
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/packs', label: 'Content Packs' },
  { href: '/dashboard/trajectories', label: 'Trajectories' },
  { href: '/dashboard/sources', label: 'Sources' },
  { href: '/dashboard/monthly', label: 'Monthly Report' },
];
```

### Step 6.2 — Commit

```bash
git add apps/nextjs/app/dashboard/layout.tsx
git commit -m "feat(nextjs): add Trajectories, Sources, Monthly Report to HiveDeck sidebar"
```

### Step 6.3 — Push

```bash
git push origin master
```

---

## Implementation Order Summary

| Task | Files | Tests |
|------|-------|-------|
| 1 | `services/trajectory.py`, `routers/trajectory.py`, `main.py` | 5 TDD |
| 2 | `api/trajectories/route.ts`, `api/trajectories/[id]/route.ts`, `trajectories/page.tsx`, `trajectories/[id]/page.tsx` | — |
| 3 | `services/monthly_report.py`, `routers/monthly.py`, `main.py` | 2 TDD |
| 4 | `api/monthly/route.ts`, `monthly/page.tsx` | — |
| 5 | `sources/page.tsx` | — |
| 6 | `layout.tsx` (nav update) | — |

**Test count after Phase 6:** 76 (69 existing + 5 trajectory + 2 monthly)
