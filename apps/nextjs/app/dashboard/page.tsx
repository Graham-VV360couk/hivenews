// apps/nextjs/app/dashboard/page.tsx
import { getDb } from '@/lib/db';
import { StatsBar } from '@/components/StatsBar';
import Link from 'next/link';

interface TopCluster {
  name: string;
  domain_tags: string[];
  readiness_score: number;
}

async function getDashboardData() {
  const sql = getDb();

  const [
    pendingAlerts,
    pendingPacks,
    pendingHoneypots,
    signalsToday,
    activeClusters,
    topClusters,
  ] = await Promise.all([
    sql<[{ count: string }]>`
      SELECT COUNT(*) FROM alert_candidates
      WHERE created_at > NOW() - INTERVAL '24 hours'
      AND outcome_accurate IS NULL
    `,
    sql<[{ count: string }]>`
      SELECT COUNT(*) FROM content_packs WHERE status = 'pending_approval'
    `,
    sql<[{ count: string }]>`
      SELECT COUNT(*) FROM honeypot_submissions WHERE outcome IS NULL
    `,
    sql<[{ count: string }]>`
      SELECT COUNT(*) FROM signals WHERE ingested_at > NOW() - INTERVAL '24 hours'
    `,
    sql<[{ count: string }]>`
      SELECT COUNT(*) FROM clusters WHERE is_active = TRUE
    `,
    sql<TopCluster[]>`
      SELECT name, domain_tags, readiness_score
      FROM clusters
      WHERE is_active = TRUE
      ORDER BY readiness_score DESC
      LIMIT 5
    `,
  ]);

  return {
    pendingAlerts: Number(pendingAlerts[0].count),
    pendingPacks: Number(pendingPacks[0].count),
    pendingHoneypots: Number(pendingHoneypots[0].count),
    signalsToday: Number(signalsToday[0].count),
    activeClusters: Number(activeClusters[0].count),
    topClusters,
  };
}

export default async function DashboardHome() {
  const data = await getDashboardData();

  const attentionStats = [
    { label: 'Alerts (24h)', value: data.pendingAlerts, highlight: data.pendingAlerts > 0 },
    { label: 'Packs pending', value: data.pendingPacks, highlight: data.pendingPacks > 0 },
    { label: 'Honeypot queue', value: data.pendingHoneypots },
  ];

  const activityStats = [
    { label: 'Signals today', value: data.signalsToday },
    { label: 'Active clusters', value: data.activeClusters },
  ];

  return (
    <div>
      <h1 style={{ margin: '0 0 24px', fontSize: '22px', fontWeight: 600 }}>Overview</h1>

      <h2 style={{ margin: '0 0 12px', fontSize: '13px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Needs attention
      </h2>
      <StatsBar stats={attentionStats} />

      <h2 style={{ margin: '0 0 12px', fontSize: '13px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Today&#39;s activity
      </h2>
      <StatsBar stats={activityStats} />

      <h2 style={{ margin: '24px 0 12px', fontSize: '13px', color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Top clusters by readiness
      </h2>
      <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', overflow: 'hidden' }}>
        {data.topClusters.length === 0 ? (
          <p style={{ padding: '20px', color: '#666', margin: 0 }}>No active clusters yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #2a2a2a' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#666', fontWeight: 500 }}>Cluster</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', color: '#666', fontWeight: 500 }}>Domains</th>
                <th style={{ padding: '10px 16px', textAlign: 'right', color: '#666', fontWeight: 500 }}>Readiness</th>
              </tr>
            </thead>
            <tbody>
              {data.topClusters.map((cluster, i) => (
                <tr key={i} style={{ borderBottom: i < data.topClusters.length - 1 ? '1px solid #2a2a2a' : 'none' }}>
                  <td style={{ padding: '10px 16px', color: '#e5e5e5' }}>{cluster.name}</td>
                  <td style={{ padding: '10px 16px', color: '#888' }}>
                    {(cluster.domain_tags || []).join(', ')}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: cluster.readiness_score >= 75 ? '#F5A623' : '#666' }}>
                    {cluster.readiness_score?.toFixed(1) ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {data.pendingPacks > 0 && (
        <div style={{ marginTop: '24px' }}>
          <Link
            href="/dashboard/packs"
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              background: '#F5A623',
              color: '#0f0f0f',
              borderRadius: '4px',
              fontWeight: 600,
              fontSize: '14px',
              textDecoration: 'none',
            }}
          >
            Review {data.pendingPacks} pending pack{data.pendingPacks !== 1 ? 's' : ''} →
          </Link>
        </div>
      )}
    </div>
  );
}
