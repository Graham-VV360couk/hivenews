// apps/nextjs/app/dashboard/packs/page.tsx
import { getDb } from '@/lib/db';
import { PackCard } from '@/components/PackCard';

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

async function getPacks(): Promise<Pack[]> {
  const sql = getDb();
  const rows = await sql<Pack[]>`
    SELECT
      cp.id,
      cp.pack_type,
      cp.status,
      cp.triggered_at,
      cp.confidence_level,
      cp.trigger_reason,
      cp.readiness_score,
      COUNT(cd.id)                                          AS draft_count,
      COUNT(cd.id) FILTER (WHERE cd.approved)              AS approved_count
    FROM content_packs cp
    LEFT JOIN content_drafts cd ON cd.pack_id = cp.id
    GROUP BY cp.id
    ORDER BY cp.triggered_at DESC
    LIMIT 20
  `;
  return rows;
}

export default async function PacksPage() {
  const packs = await getPacks();

  const pending = packs.filter(p => p.status === 'pending_approval');
  const rest = packs.filter(p => p.status !== 'pending_approval');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 600 }}>Content Packs</h1>
        <span style={{ fontSize: '13px', color: '#555' }}>{packs.length} total</span>
      </div>

      {pending.length > 0 && (
        <>
          <h2 style={{ margin: '0 0 12px', fontSize: '13px', color: '#F5A623', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Pending approval ({pending.length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '32px' }}>
            {pending.map(pack => <PackCard key={pack.id} pack={pack} />)}
          </div>
        </>
      )}

      {rest.length > 0 && (
        <>
          <h2 style={{ margin: '0 0 12px', fontSize: '13px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Recent
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {rest.map(pack => <PackCard key={pack.id} pack={pack} />)}
          </div>
        </>
      )}

      {packs.length === 0 && (
        <p style={{ color: '#555', fontSize: '14px' }}>No content packs yet. They appear here when clusters reach readiness threshold or alerts are detected.</p>
      )}
    </div>
  );
}
