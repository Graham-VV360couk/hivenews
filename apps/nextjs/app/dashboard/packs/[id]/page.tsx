// apps/nextjs/app/dashboard/packs/[id]/page.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { DraftViewer } from '@/components/DraftViewer';
import Link from 'next/link';

interface Pack {
  id: string;
  pack_type: string;
  status: string;
  triggered_at: string;
  confidence_level: string;
  trigger_reason: string;
  readiness_score: number | null;
}

interface Draft {
  id: string;
  platform: string;
  draft_text: string;
  draft_data: string;
  approved: boolean;
  final_text: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  standard: 'Standard Pack',
  alert_breaking: 'Breaking Alert',
  alert_significant: 'Significant Alert',
  pinch_of_salt: 'Pinch of Salt',
};

export default function PackApprovalPage() {
  const { id } = useParams<{ id: string }>();
  const [pack, setPack] = useState<Pack | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [approvedCount, setApprovedCount] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/dashboard/api/packs/${id}`);
      if (!res.ok) throw new Error('Pack not found');
      const data = await res.json();
      setPack(data.pack);
      setDrafts(data.drafts);
      setApprovedCount(data.drafts.filter((d: Draft) => d.approved).length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function handleDraftApproved() {
    setApprovedCount(c => c + 1);
  }

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
    } catch {
      setPublishResult('Network error');
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return <div style={{ color: '#555', padding: '40px 0' }}>Loading…</div>;
  }
  if (error || !pack) {
    return <div style={{ color: '#ef4444', padding: '40px 0' }}>{error || 'Pack not found'}</div>;
  }

  const allApproved = approvedCount === drafts.length && drafts.length > 0;
  const typeLabel = TYPE_LABELS[pack.pack_type] || pack.pack_type;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <Link href="/dashboard/packs" style={{ fontSize: '13px', color: '#555', display: 'inline-block', marginBottom: '12px' }}>
          ← Back to packs
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>{typeLabel}</h1>
          <span style={{
            fontSize: '11px',
            padding: '3px 10px',
            borderRadius: '999px',
            background: allApproved ? '#22c55e20' : '#F5A62320',
            color: allApproved ? '#22c55e' : '#F5A623',
          }}>
            {allApproved ? 'All approved' : `${approvedCount}/${drafts.length} approved`}
          </span>
        </div>
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#555' }}>
          {pack.confidence_level} · {pack.trigger_reason} · {new Date(pack.triggered_at).toLocaleString()}
          {pack.readiness_score != null && ` · readiness ${pack.readiness_score.toFixed(1)}`}
        </div>
      </div>

      {/* Drafts */}
      {drafts.length === 0 ? (
        <p style={{ color: '#555' }}>No drafts found for this pack.</p>
      ) : (
        drafts.map(draft => (
          <DraftViewer
            key={draft.id}
            draft={draft}
            packId={pack.id}
            onApproved={handleDraftApproved}
          />
        ))
      )}

      {/* Publish section */}
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
    </div>
  );
}
