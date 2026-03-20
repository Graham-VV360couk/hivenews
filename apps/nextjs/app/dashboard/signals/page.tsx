'use client';
// apps/nextjs/app/dashboard/signals/page.tsx

import { useEffect, useState, useCallback } from 'react';

const DOMAINS = ['', 'ai', 'vr', 'seo', 'vibe_coding', 'cross'];

interface Signal {
  id: string;
  title: string;
  url: string | null;
  domain_tags: string[];
  source_type: string;
  importance_composite: string | null;
  is_alert_candidate: boolean;
  confidence_level: string;
  published_at: string | null;
  ingested_at: string;
  source_name: string | null;
}

function scoreColor(val: number | null): string {
  if (val === null) return '#444';
  if (val >= 8.0) return '#ef4444';
  if (val >= 7.0) return '#22c55e';
  if (val >= 4.5) return '#F5A623';
  return '#555';
}

function fmt(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [domain, setDomain] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 100;

  const load = useCallback(async (d: string, o: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(limit), offset: String(o) });
      if (d) params.set('domain', d);
      const res = await fetch(`/dashboard/api/signals?${params}`);
      const data = await res.json();
      setSignals(data.signals ?? []);
      setTotal(data.total ?? 0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(domain, offset); }, [load, domain, offset]);

  function handleDomain(d: string) {
    setDomain(d);
    setOffset(0);
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: '22px', fontWeight: 600 }}>Signals</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
          {total.toLocaleString()} ingested signal{total !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Domain filter */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {DOMAINS.map(d => (
          <button
            key={d || 'all'}
            onClick={() => handleDomain(d)}
            style={{
              padding: '5px 12px', fontSize: '12px', borderRadius: '3px',
              border: '1px solid #333', cursor: 'pointer',
              background: domain === d ? '#F5A623' : '#111',
              color: domain === d ? '#0f0f0f' : '#666',
            }}
          >
            {d || 'All'}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: '#555', padding: '40px 0' }}>Loading…</div>
      ) : signals.length === 0 ? (
        <div style={{ color: '#555', padding: '40px 0' }}>No signals found.</div>
      ) : (
        <>
          <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2a2a2a', background: '#111' }}>
                  <th style={th}>Title</th>
                  <th style={{ ...th, width: '80px' }}>Score</th>
                  <th style={{ ...th, width: '120px' }}>Domain</th>
                  <th style={{ ...th, width: '140px' }}>Source</th>
                  <th style={{ ...th, width: '110px' }}>Published</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s, i) => {
                  const score = s.importance_composite != null ? Number(s.importance_composite) : null;
                  return (
                    <tr
                      key={s.id}
                      style={{ borderBottom: i < signals.length - 1 ? '1px solid #1e1e1e' : 'none' }}
                    >
                      <td style={{ padding: '9px 14px', color: '#ccc', lineHeight: 1.4 }}>
                        {s.is_alert_candidate && (
                          <span style={{ marginRight: '6px', color: '#ef4444', fontSize: '10px', fontWeight: 700 }}>ALERT</span>
                        )}
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#ccc', textDecoration: 'none' }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#F5A623')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#ccc')}
                          >
                            {s.title || '(no title)'}
                          </a>
                        ) : (
                          <span>{s.title || '(no title)'}</span>
                        )}
                      </td>
                      <td style={{ padding: '9px 14px', textAlign: 'center', fontWeight: 700, color: scoreColor(score), fontFamily: 'monospace' }}>
                        {score != null ? score.toFixed(1) : '—'}
                      </td>
                      <td style={{ padding: '9px 14px', color: '#555' }}>
                        {(s.domain_tags || []).join(', ') || '—'}
                      </td>
                      <td style={{ padding: '9px 14px', color: '#555' }}>
                        {s.source_name || s.source_type || '—'}
                      </td>
                      <td style={{ padding: '9px 14px', color: '#555', whiteSpace: 'nowrap' }}>
                        {fmt(s.published_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {total > limit && (
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', alignItems: 'center' }}>
              <button
                onClick={() => setOffset(Math.max(0, offset - limit))}
                disabled={offset === 0}
                style={pageBtn(offset === 0)}
              >
                ← Prev
              </button>
              <span style={{ fontSize: '12px', color: '#555' }}>
                {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}
              </span>
              <button
                onClick={() => setOffset(offset + limit)}
                disabled={offset + limit >= total}
                style={pageBtn(offset + limit >= total)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '9px 14px',
  textAlign: 'left',
  color: '#555',
  fontWeight: 500,
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const pageBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '6px 14px', fontSize: '12px', borderRadius: '3px',
  background: 'none', border: '1px solid #333',
  color: disabled ? '#333' : '#888',
  cursor: disabled ? 'not-allowed' : 'pointer',
});
