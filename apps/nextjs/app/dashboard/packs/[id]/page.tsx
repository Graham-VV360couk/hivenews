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
    </div>
  );
}
