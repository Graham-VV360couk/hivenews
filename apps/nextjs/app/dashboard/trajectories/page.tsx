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

  async function loadTrajectories() {
    fetch('/dashboard/api/trajectories')
      .then(r => r.json())
      .then(data => { setTrajectories(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { loadTrajectories(); }, []);

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
        await loadTrajectories();
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
