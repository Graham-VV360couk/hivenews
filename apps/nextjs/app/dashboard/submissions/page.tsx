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
