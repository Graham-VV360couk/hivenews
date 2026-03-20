// apps/nextjs/components/StatsBar.tsx

interface Stat {
  label: string;
  value: number | string;
  highlight?: boolean;
}

export function StatsBar({ stats }: { stats: Stat[] }) {
  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '32px' }}>
      {stats.map(stat => (
        <div
          key={stat.label}
          style={{
            background: '#1a1a1a',
            border: `1px solid ${stat.highlight ? '#F5A623' : '#2a2a2a'}`,
            borderRadius: '6px',
            padding: '16px 20px',
            minWidth: '140px',
          }}
        >
          <div style={{ fontSize: '24px', fontWeight: 700, color: stat.highlight ? '#F5A623' : '#e5e5e5' }}>
            {stat.value}
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
            {stat.label}
          </div>
        </div>
      ))}
    </div>
  );
}
