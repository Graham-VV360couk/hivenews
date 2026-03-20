export const dynamic = 'force-dynamic';
// apps/nextjs/app/dashboard/sources/page.tsx
import { getDb } from '@/lib/db';

interface Source {
  id: string;
  name: string;
  platform: string;
  tier: number;
  domain_tags: string[];
  is_active: boolean;
  last_ingested: string | null;
  total_signals: number | null;
  accuracy_rate: number | null;
  lead_time_avg_days: number | null;
}

const TIER_LABELS: Record<number, string> = {
  1: 'Major',
  2: 'Established',
  3: 'Minor',
};

const TIER_COLORS: Record<number, string> = {
  1: '#22c55e',
  2: '#F5A623',
  3: '#666',
};

async function getSources(): Promise<Source[]> {
  const sql = getDb();
  const rows = await sql<Source[]>`
    SELECT
      s.id,
      s.name,
      s.platform,
      s.tier,
      s.domain_tags,
      s.is_active,
      s.last_ingested,
      sr.total_signals,
      sr.accuracy_rate,
      sr.lead_time_avg_days
    FROM sources s
    LEFT JOIN source_reputation sr ON sr.source_id = s.id
    ORDER BY s.tier ASC, sr.total_signals DESC NULLS LAST, s.name
    LIMIT 100
  `;
  return rows;
}

export default async function SourcesPage() {
  const sources = await getSources();

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: '22px', fontWeight: 600 }}>Sources</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
          {sources.filter(s => s.is_active).length} active · {sources.length} total
        </p>
      </div>

      {sources.length === 0 ? (
        <p style={{ color: '#555' }}>No sources registered yet.</p>
      ) : (
        <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#555', fontWeight: 500 }}>Source</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#555', fontWeight: 500 }}>Platform</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#555', fontWeight: 500 }}>Tier</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#555', fontWeight: 500 }}>Domains</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: '#555', fontWeight: 500 }}>Signals</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: '#555', fontWeight: 500 }}>Accuracy</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: '#555', fontWeight: 500 }}>Lead (days)</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: '#555', fontWeight: 500 }}>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s, i) => (
                <tr
                  key={s.id}
                  style={{
                    borderBottom: i < sources.length - 1 ? '1px solid #1f1f1f' : 'none',
                    opacity: s.is_active ? 1 : 0.4,
                  }}
                >
                  <td style={{ padding: '10px 16px', color: '#e5e5e5', maxWidth: '200px' }}>
                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                  </td>
                  <td style={{ padding: '10px 16px', color: '#888' }}>{s.platform}</td>
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
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: s.accuracy_rate != null ? (s.accuracy_rate >= 0.7 ? '#22c55e' : s.accuracy_rate >= 0.5 ? '#F5A623' : '#ef4444') : '#555' }}>
                    {s.accuracy_rate != null ? `${(s.accuracy_rate * 100).toFixed(0)}%` : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#888' }}>
                    {s.lead_time_avg_days != null ? s.lead_time_avg_days.toFixed(1) : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#555', fontSize: '12px' }}>
                    {s.last_ingested ? new Date(s.last_ingested).toLocaleDateString('en-GB') : '—'}
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
