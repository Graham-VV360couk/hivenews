// apps/nextjs/app/stories/[id]/page.tsx
import Link from 'next/link';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

interface Signal {
  id: string;
  title: string;
  url: string | null;
  importance_composite: string | null;
  confidence_level: string;
  published_at: string | null;
  source_name: string | null;
  source_url: string | null;
}

interface StoryEvent {
  event_type: string;
  confidence_level: string;
  summary: string;
  created_at: string;
}

interface Cluster {
  id: string;
  name: string;
  domain_tags: string[];
  signal_count: number;
  narrative: string | null;
  narrative_updated_at: string | null;
  first_signal_at: string | null;
  last_signal_at: string | null;
}

async function getStory(id: string) {
  try {
    const res = await fetch(`${PYTHON_URL}/stories/${id}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function confidenceBadge(signals: Signal[]): { label: string; color: string; bg: string } {
  const scores = signals.map(s => Number(s.importance_composite)).filter(Boolean);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
  if (avg >= 7.5) return { label: 'CONFIRMED', color: '#22c55e', bg: 'rgba(34,197,94,0.08)' };
  if (avg >= 4.5) return { label: 'DEVELOPING', color: '#F5A623', bg: 'rgba(245,166,35,0.08)' };
  return { label: 'PINCH OF SALT', color: '#666', bg: 'rgba(100,100,100,0.08)' };
}

function fmt(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtShort(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default async function StoryPage({ params }: { params: { id: string } }) {
  const data = await getStory(params.id);

  if (!data || !data.cluster) {
    return (
      <div style={{ minHeight: '100vh', background: '#07080c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#555' }}>
          <p>Story not found.</p>
          <Link href="/" style={{ color: '#F5A623', textDecoration: 'none' }}>← Back to NewsHive</Link>
        </div>
      </div>
    );
  }

  const { cluster, signals, events } = data as { cluster: Cluster; signals: Signal[]; events: StoryEvent[] };
  const badge = confidenceBadge(signals);

  // Dedupe sources
  const sources = signals
    .filter(s => s.source_name)
    .reduce((acc: { name: string; url: string | null; count: number }[], s) => {
      const existing = acc.find(x => x.name === s.source_name);
      if (existing) { existing.count++; }
      else { acc.push({ name: s.source_name!, url: s.source_url, count: 1 }); }
      return acc;
    }, [])
    .sort((a, b) => b.count - a.count);

  return (
    <div style={{ minHeight: '100vh', background: '#07080c', color: '#e5e5e5' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;0,700;1,400&family=Space+Mono:wght@400;700&family=Lora:ital,wght@0,400;1,400&display=swap');
        body { margin: 0; }
        .signal-row:hover { background: rgba(255,255,255,0.02) !important; }
        a { color: inherit; }
      `}</style>

      {/* Top bar */}
      <div style={{ borderBottom: '1px solid #12141f', padding: '0 40px', height: '56px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(7,8,12,0.95)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 100 }}>
        <a href="https://newshive.geekybee.net/" style={{ textDecoration: 'none' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/NewsHive_Logo.png" alt="NewsHive" style={{ height: '28px', width: 'auto' }} />
        </a>
        <Link href="/dashboard" style={{ fontSize: '12px', color: '#444', textDecoration: 'none', fontFamily: 'Space Mono, monospace', letterSpacing: '0.05em' }}>
          ANALYST PORTAL →
        </Link>
      </div>

      <div style={{ maxWidth: '780px', margin: '0 auto', padding: '64px 40px' }}>

        {/* Domain tags */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {(cluster.domain_tags || []).map(tag => (
            <span key={tag} style={{ fontFamily: 'Space Mono, monospace', fontSize: '10px', letterSpacing: '0.12em', color: '#F5A623', textTransform: 'uppercase', padding: '3px 8px', border: '1px solid rgba(245,166,35,0.2)', borderRadius: '2px' }}>
              {tag}
            </span>
          ))}
          {/* Confidence badge */}
          <span style={{ fontFamily: 'Space Mono, monospace', fontSize: '10px', letterSpacing: '0.12em', color: badge.color, textTransform: 'uppercase', padding: '3px 8px', border: `1px solid ${badge.color}40`, borderRadius: '2px', background: badge.bg }}>
            {badge.label}
          </span>
        </div>

        {/* Headline */}
        <h1 style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', fontSize: '48px', fontWeight: 700, lineHeight: 1.15, margin: '0 0 24px', color: '#f0f1f8', letterSpacing: '-0.5px' }}>
          {cluster.name || 'Untitled Story'}
        </h1>

        {/* Meta */}
        <div style={{ display: 'flex', gap: '24px', marginBottom: '48px', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'Space Mono, monospace', fontSize: '11px', color: '#444', letterSpacing: '0.05em' }}>
            {cluster.signal_count} SIGNAL{cluster.signal_count !== 1 ? 'S' : ''}
          </span>
          <span style={{ fontFamily: 'Space Mono, monospace', fontSize: '11px', color: '#444', letterSpacing: '0.05em' }}>
            FIRST DETECTED {fmt(cluster.first_signal_at)}
          </span>
          {cluster.narrative_updated_at && (
            <span style={{ fontFamily: 'Space Mono, monospace', fontSize: '11px', color: '#444', letterSpacing: '0.05em' }}>
              UPDATED {fmt(cluster.narrative_updated_at)}
            </span>
          )}
        </div>

        {/* The NewsHive View */}
        {cluster.narrative ? (
          <div style={{ marginBottom: '64px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <span style={{ fontFamily: 'Space Mono, monospace', fontSize: '10px', letterSpacing: '0.15em', color: '#F5A623', textTransform: 'uppercase' }}>The NewsHive View</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(245,166,35,0.15)' }} />
            </div>
            {cluster.narrative.split('\n\n').filter(Boolean).map((para, i) => (
              <p key={i} style={{ fontFamily: 'Lora, Georgia, serif', fontSize: '18px', lineHeight: 1.8, color: '#c8cad8', margin: '0 0 24px' }}>
                {para}
              </p>
            ))}
          </div>
        ) : (
          <div style={{ marginBottom: '64px', padding: '32px', border: '1px solid #1a1d27', borderRadius: '4px', color: '#444', fontFamily: 'Space Mono, monospace', fontSize: '12px' }}>
            Narrative synthesis pending — {cluster.signal_count} signal{cluster.signal_count !== 1 ? 's' : ''} collected.
          </div>
        )}

        {/* Story timeline */}
        {signals.length > 0 && (
          <div style={{ marginBottom: '64px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
              <span style={{ fontFamily: 'Space Mono, monospace', fontSize: '10px', letterSpacing: '0.15em', color: '#555', textTransform: 'uppercase' }}>How the story developed</span>
              <div style={{ flex: 1, height: '1px', background: '#1a1d27' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
              {signals.map((signal, i) => (
                <div
                  key={signal.id}
                  className="signal-row"
                  style={{ display: 'flex', gap: '20px', padding: '14px 0', borderBottom: i < signals.length - 1 ? '1px solid #10111a' : 'none', alignItems: 'flex-start' }}
                >
                  <div style={{ fontFamily: 'Space Mono, monospace', fontSize: '11px', color: '#333', flexShrink: 0, width: '60px', paddingTop: '2px' }}>
                    {fmtShort(signal.published_at)}
                  </div>
                  <div style={{ flex: 1 }}>
                    {signal.url ? (
                      <a href={signal.url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: 'Lora, Georgia, serif', fontSize: '15px', color: '#888', lineHeight: 1.5, textDecoration: 'none' }}>
                        {signal.title}
                      </a>
                    ) : (
                      <span style={{ fontFamily: 'Lora, Georgia, serif', fontSize: '15px', color: '#888', lineHeight: 1.5 }}>{signal.title}</span>
                    )}
                    {signal.source_name && (
                      <div style={{ fontFamily: 'Space Mono, monospace', fontSize: '10px', color: '#333', marginTop: '4px' }}>
                        {signal.source_name}
                      </div>
                    )}
                  </div>
                  {signal.importance_composite && (
                    <div style={{ fontFamily: 'Space Mono, monospace', fontSize: '12px', fontWeight: 700, color: Number(signal.importance_composite) >= 7 ? '#22c55e' : Number(signal.importance_composite) >= 4.5 ? '#F5A623' : '#444', flexShrink: 0 }}>
                      {Number(signal.importance_composite).toFixed(1)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sources */}
        {sources.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
              <span style={{ fontFamily: 'Space Mono, monospace', fontSize: '10px', letterSpacing: '0.15em', color: '#555', textTransform: 'uppercase' }}>Sources</span>
              <div style={{ flex: 1, height: '1px', background: '#1a1d27' }} />
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {sources.map(source => (
                <span key={source.name} style={{ fontFamily: 'Space Mono, monospace', fontSize: '11px', color: '#444', padding: '4px 10px', border: '1px solid #1a1d27', borderRadius: '2px' }}>
                  {source.name}
                  {source.count > 1 && <span style={{ color: '#333', marginLeft: '4px' }}>×{source.count}</span>}
                </span>
              ))}
            </div>
            <p style={{ fontFamily: 'Space Mono, monospace', fontSize: '10px', color: '#2a2a2a', marginTop: '16px' }}>
              NewsHive monitors these sources continuously. All signal titles above link to the original reporting.
            </p>
          </div>
        )}

      </div>
    </div>
  );
}
