export const dynamic = 'force-dynamic';
// apps/nextjs/app/dashboard/trajectories/[id]/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
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

  const [showUpdate, setShowUpdate] = useState(false);
  const [updateForm, setUpdateForm] = useState({ new_score: '', direction: 'stable', reason: '' });
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');

  const [showResolve, setShowResolve] = useState(false);
  const [resolveForm, setResolveForm] = useState({ status: 'confirmed', outcome_notes: '' });
  const [resolving, setResolving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/dashboard/api/trajectories/${id}`);
      if (!res.ok) throw new Error('Not found');
      setTraj(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

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
