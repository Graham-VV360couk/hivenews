'use client';
// apps/nextjs/app/dashboard/sources/page.tsx

import { useEffect, useState, useCallback } from 'react';

interface Source {
  id: string;
  name: string;
  handle: string | null;
  url: string | null;
  platform: string;
  domain_tags: string[];
  tier: number;
  is_active: boolean;
  last_ingested: string | null;
  total_signals: number | null;
  accuracy_rate: number | null;
  lead_time_avg_days: number | null;
}

const PLATFORMS = [
  { value: 'rss', label: 'RSS Feed' },
  { value: 'x', label: 'X / Twitter' },
  { value: 'reddit', label: 'Reddit' },
  { value: 'github', label: 'GitHub' },
  { value: 'hackernews', label: 'Hacker News' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'newsletter', label: 'Newsletter' },
  { value: 'other', label: 'Other' },
];

const DOMAINS = ['ai', 'vr', 'seo', 'vibe_coding', 'cross'];

const TIER_LABELS: Record<number, string> = { 1: 'Major', 2: 'Established', 3: 'Minor' };
const TIER_COLORS: Record<number, string> = { 1: '#22c55e', 2: '#F5A623', 3: '#666' };

const EMPTY_FORM = { name: '', handle: '', url: '', platform: 'rss', domain_tags: '', tier: '3' };

export default function SourcesPage() {
  const [sources, setSources] = useState<Source[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [filterPlatform, setFilterPlatform] = useState('all');
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/dashboard/api/sources');
    if (res.ok) setSources(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const tags = form.domain_tags.split(',').map(t => t.trim()).filter(Boolean);
    const body = { ...form, domain_tags: tags };

    if (editId) {
      await fetch(`/dashboard/api/sources/${editId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setEditId(null);
    } else {
      await fetch('/dashboard/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }
    setSaving(false);
    setForm(EMPTY_FORM);
    setShowAdd(false);
    await load();
  }

  function startEdit(s: Source) {
    setForm({
      name: s.name,
      handle: s.handle || '',
      url: s.url || '',
      platform: s.platform,
      domain_tags: (s.domain_tags || []).join(', '),
      tier: String(s.tier),
    });
    setEditId(s.id);
    setShowAdd(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function toggleActive(id: string) {
    setToggling(id);
    await fetch(`/dashboard/api/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle' }),
    });
    setToggling(null);
    await load();
  }

  const filtered = sources.filter(s => {
    if (!showInactive && !s.is_active) return false;
    if (filterPlatform !== 'all' && s.platform !== filterPlatform) return false;
    return true;
  });

  const activePlatforms = [...new Set(sources.map(s => s.platform))];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: '22px', fontWeight: 600 }}>Sources</h1>
          <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
            {sources.filter(s => s.is_active).length} active · {sources.length} total
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(!showAdd); setEditId(null); setForm(EMPTY_FORM); }}
          style={{ padding: '8px 16px', background: '#F5A623', color: '#0f0f0f', border: 'none', borderRadius: '4px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
        >
          + Add Source
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleSubmit} style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '20px', marginBottom: '24px' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: 600 }}>
            {editId ? 'Edit Source' : 'Add Source'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <input
              required
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Name (e.g. TechCrunch AI)"
              style={inputStyle}
            />
            <select
              value={form.platform}
              onChange={e => setForm(f => ({ ...f, platform: e.target.value }))}
              style={inputStyle}
            >
              {PLATFORMS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <input
              value={form.url}
              onChange={e => setForm(f => ({ ...f, url: e.target.value }))}
              placeholder="URL / Feed URL"
              style={inputStyle}
            />
            <input
              value={form.handle}
              onChange={e => setForm(f => ({ ...f, handle: e.target.value }))}
              placeholder="Handle / Username (optional)"
              style={inputStyle}
            />
            <div>
              <input
                value={form.domain_tags}
                onChange={e => setForm(f => ({ ...f, domain_tags: e.target.value }))}
                placeholder={`Domains: ${DOMAINS.join(', ')}`}
                style={inputStyle}
              />
              <div style={{ marginTop: '4px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {DOMAINS.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => {
                      const current = form.domain_tags.split(',').map(t => t.trim()).filter(Boolean);
                      const next = current.includes(d) ? current.filter(t => t !== d) : [...current, d];
                      setForm(f => ({ ...f, domain_tags: next.join(', ') }));
                    }}
                    style={{
                      padding: '2px 8px',
                      fontSize: '11px',
                      borderRadius: '3px',
                      border: '1px solid #333',
                      cursor: 'pointer',
                      background: form.domain_tags.split(',').map(t => t.trim()).includes(d) ? '#F5A623' : '#111',
                      color: form.domain_tags.split(',').map(t => t.trim()).includes(d) ? '#0f0f0f' : '#666',
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <select
              value={form.tier}
              onChange={e => setForm(f => ({ ...f, tier: e.target.value }))}
              style={inputStyle}
            >
              <option value="1">Tier 1 — Major</option>
              <option value="2">Tier 2 — Established</option>
              <option value="3">Tier 3 — Minor</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
            <button
              type="submit"
              disabled={saving}
              style={{ padding: '8px 16px', background: saving ? '#555' : '#F5A623', color: '#0f0f0f', border: 'none', borderRadius: '4px', fontSize: '13px', fontWeight: 600, cursor: saving ? 'not-allowed' : 'pointer' }}
            >
              {saving ? 'Saving…' : editId ? 'Update' : 'Add Source'}
            </button>
            <button
              type="button"
              onClick={() => { setShowAdd(false); setEditId(null); setForm(EMPTY_FORM); }}
              style={{ padding: '8px 16px', background: 'none', border: '1px solid #333', color: '#888', borderRadius: '4px', fontSize: '13px', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <select
          value={filterPlatform}
          onChange={e => setFilterPlatform(e.target.value)}
          style={{ padding: '6px 10px', background: '#1a1a1a', border: '1px solid #2a2a2a', color: '#ccc', borderRadius: '4px', fontSize: '13px' }}
        >
          <option value="all">All platforms</option>
          {activePlatforms.map(p => (
            <option key={p} value={p}>{PLATFORMS.find(x => x.value === p)?.label ?? p}</option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#666', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={e => setShowInactive(e.target.checked)}
          />
          Show inactive
        </label>
        <span style={{ fontSize: '13px', color: '#555' }}>{filtered.length} shown</span>
      </div>

      {loading ? (
        <div style={{ color: '#555', padding: '40px 0' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <p style={{ color: '#555' }}>No sources found. Add the first one above.</p>
      ) : (
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                <th style={th}>Source</th>
                <th style={th}>Platform</th>
                <th style={th}>Tier</th>
                <th style={th}>Domains</th>
                <th style={{ ...th, textAlign: 'right' }}>Signals</th>
                <th style={{ ...th, textAlign: 'right' }}>Accuracy</th>
                <th style={{ ...th, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr
                  key={s.id}
                  style={{
                    borderBottom: i < filtered.length - 1 ? '1px solid #1f1f1f' : 'none',
                    opacity: s.is_active ? 1 : 0.45,
                  }}
                >
                  <td style={{ padding: '10px 16px' }}>
                    <div style={{ fontWeight: 500, color: '#e5e5e5' }}>{s.name}</div>
                    {s.url && (
                      <div style={{ fontSize: '11px', color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '200px' }}>
                        {s.url}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '10px 16px', color: '#888' }}>
                    {PLATFORMS.find(p => p.value === s.platform)?.label ?? s.platform}
                    {s.handle && <div style={{ fontSize: '11px', color: '#555' }}>{s.handle}</div>}
                  </td>
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
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    {s.accuracy_rate != null ? (
                      <span style={{ color: s.accuracy_rate >= 0.7 ? '#22c55e' : s.accuracy_rate >= 0.5 ? '#F5A623' : '#ef4444' }}>
                        {(s.accuracy_rate * 100).toFixed(0)}%
                      </span>
                    ) : <span style={{ color: '#555' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => startEdit(s)}
                        style={{ padding: '4px 10px', background: '#111', border: '1px solid #333', color: '#aaa', borderRadius: '3px', fontSize: '12px', cursor: 'pointer' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => toggleActive(s.id)}
                        disabled={toggling === s.id}
                        style={{ padding: '4px 10px', background: s.is_active ? '#111' : '#1a2a1a', border: `1px solid ${s.is_active ? '#333' : '#2a4a2a'}`, color: s.is_active ? '#888' : '#22c55e', borderRadius: '3px', fontSize: '12px', cursor: 'pointer' }}
                      >
                        {toggling === s.id ? '…' : s.is_active ? 'Pause' : 'Activate'}
                      </button>
                    </div>
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

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: '#111',
  border: '1px solid #333',
  color: '#e5e5e5',
  borderRadius: '4px',
  fontSize: '14px',
  boxSizing: 'border-box',
};

const th: React.CSSProperties = {
  padding: '10px 16px',
  textAlign: 'left',
  color: '#555',
  fontWeight: 500,
};
