export const dynamic = 'force-dynamic';
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
        setActionMsg(`Report generated for ${data.month} ${data.year}.`);
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

      <h2 style={{ margin: '0 0 12px', fontSize: '13px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        This Month&#39;s Stats
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
        Run &ldquo;Compute Stats&rdquo; to refresh this month&#39;s numbers, then &ldquo;Generate Report&rdquo; to synthesise
        the full HiveReport via Claude. The report appears in Content Packs for review and approval.
      </p>
    </div>
  );
}
