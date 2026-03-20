// apps/nextjs/components/PackCard.tsx
import Link from 'next/link';

interface Pack {
  id: string;
  pack_type: string;
  status: string;
  triggered_at: string;
  confidence_level: string;
  trigger_reason: string;
  readiness_score: number | null;
  draft_count: number;
  approved_count: number;
}

const STATUS_COLORS: Record<string, string> = {
  pending_approval: '#F5A623',
  approved: '#22c55e',
  published: '#3b82f6',
  rejected: '#ef4444',
};

const TYPE_LABELS: Record<string, string> = {
  standard: 'Standard',
  alert_breaking: 'Breaking Alert',
  alert_significant: 'Significant Alert',
  pinch_of_salt: 'Pinch of Salt',
};

export function PackCard({ pack }: { pack: Pack }) {
  const statusColor = STATUS_COLORS[pack.status] || '#666';
  const typeLabel = TYPE_LABELS[pack.pack_type] || pack.pack_type;
  const triggeredAt = new Date(pack.triggered_at).toLocaleString();
  const allApproved = pack.draft_count > 0 && pack.approved_count === pack.draft_count;

  return (
    <div style={{
      background: '#1a1a1a',
      border: '1px solid #2a2a2a',
      borderRadius: '6px',
      padding: '16px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#e5e5e5' }}>{typeLabel}</span>
          <span style={{ fontSize: '11px', color: statusColor, background: `${statusColor}20`, padding: '2px 8px', borderRadius: '999px' }}>
            {pack.status.replace('_', ' ')}
          </span>
          <span style={{ fontSize: '11px', color: '#555' }}>{pack.confidence_level}</span>
        </div>
        <div style={{ fontSize: '12px', color: '#555' }}>
          {triggeredAt} · {pack.trigger_reason} · {pack.draft_count} drafts ({pack.approved_count} approved)
          {pack.readiness_score != null && ` · readiness ${pack.readiness_score.toFixed(1)}`}
        </div>
      </div>

      <Link
        href={`/dashboard/packs/${pack.id}`}
        style={{
          padding: '7px 14px',
          background: allApproved ? '#1a3a2a' : '#2a1f0a',
          border: `1px solid ${allApproved ? '#22c55e' : '#F5A623'}`,
          color: allApproved ? '#22c55e' : '#F5A623',
          borderRadius: '4px',
          fontSize: '13px',
          fontWeight: 500,
          textDecoration: 'none',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {allApproved ? 'View' : 'Review'}
      </Link>
    </div>
  );
}
