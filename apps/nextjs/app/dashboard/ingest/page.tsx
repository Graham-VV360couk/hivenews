'use client';
// apps/nextjs/app/dashboard/ingest/page.tsx

import { useEffect, useRef, useState, useCallback } from 'react';

const DOMAINS = ['ai', 'vr', 'seo', 'vibe_coding', 'cross'];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LogEvent {
  type: string;
  msg: string;
  name?: string;
  ingested?: number;
  skipped?: number;
  errors?: number;
  entry_count?: number;
  feed_title?: string;
  total_ingested?: number;
  total_skipped?: number;
  total_errors?: number;
  sources?: number;
}

interface Result {
  ingested?: number;
  skipped_duplicates?: number;
  errors?: number;
  sources_polled?: number;
  requested?: number;
  fetch_errors?: number;
  source?: string;
  query?: string;
  days_back?: number;
  error?: string;
}

interface HealthStatus {
  status: 'ok' | 'degraded';
  checks: {
    database: string;   // e.g. "ok (5 sources)" or "error: ..."
    redis: string;
    openai_embedding: string;
  };
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function DomainPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
      {DOMAINS.map(d => {
        const active = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            onClick={() => onChange(active ? value.filter(x => x !== d) : [...value, d])}
            style={{
              padding: '4px 10px', fontSize: '12px', borderRadius: '3px',
              border: '1px solid #333', cursor: 'pointer',
              background: active ? '#F5A623' : '#111',
              color: active ? '#0f0f0f' : '#666',
            }}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}

function ResultBadge({ result }: { result: Result }) {
  if (result.error) {
    return <div style={{ color: '#ef4444', fontSize: '13px', marginTop: '10px' }}>Error: {result.error}</div>;
  }
  return (
    <div style={{
      marginTop: '12px', padding: '14px 16px',
      background: '#0f1a0f', border: '1px solid #1a3a1a', borderRadius: '4px',
      display: 'flex', gap: '24px', flexWrap: 'wrap',
    }}>
      {result.ingested !== undefined && <Stat label="Ingested" value={result.ingested} color="#22c55e" />}
      {result.skipped_duplicates !== undefined && <Stat label="Duplicates skipped" value={result.skipped_duplicates} color="#555" />}
      {result.errors !== undefined && <Stat label="Errors" value={result.errors} color={result.errors > 0 ? '#ef4444' : '#555'} />}
      {result.sources_polled !== undefined && <Stat label="Sources polled" value={result.sources_polled} color="#F5A623" />}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{ fontSize: '22px', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '11px', color: '#555', marginTop: '2px' }}>{label}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log console for RSS streaming
// ---------------------------------------------------------------------------

function logColor(evt: LogEvent): string {
  switch (evt.type) {
    case 'feed_error':   return '#ef4444';
    case 'feed_connected': return '#22c55e';
    case 'feed_done':
      if ((evt.errors ?? 0) > 0 && (evt.ingested ?? 0) === 0) return '#ef4444';
      if ((evt.ingested ?? 0) > 0) return '#F5A623';
      return '#555';
    case 'complete':     return '#22c55e';
    case 'start':        return '#F5A623';
    case 'feed_start':   return '#888';
    default:             return '#aaa';
  }
}

function LogPrefix(evt: LogEvent): string {
  switch (evt.type) {
    case 'start':        return '●';
    case 'feed_start':   return '›';
    case 'feed_connected': return '✓';
    case 'feed_error':   return '✗';
    case 'feed_done':    return '→';
    case 'complete':     return '■';
    default:             return ' ';
  }
}

function LogConsole({ logs, running }: { logs: LogEvent[]; running: boolean }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  if (logs.length === 0 && !running) return null;

  return (
    <div style={{
      marginTop: '14px',
      background: '#080a0d',
      border: '1px solid #1a1d27',
      borderRadius: '4px',
      padding: '14px 16px',
      fontFamily: "'Consolas', 'Monaco', 'Courier New', monospace",
      fontSize: '12px',
      lineHeight: 1.7,
      maxHeight: '400px',
      overflowY: 'auto',
    }}>
      {logs.length === 0 && running && (
        <span style={{ color: '#444' }}>Connecting…</span>
      )}
      {logs.map((evt, i) => (
        <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
          <span style={{ color: logColor(evt), flexShrink: 0, userSelect: 'none' }}>
            {LogPrefix(evt)}
          </span>
          <span style={{ color: logColor(evt) }}>{evt.msg}</span>
        </div>
      ))}
      {running && logs.length > 0 && (
        <div style={{ color: '#333', marginTop: '4px' }}>
          <span style={{ animation: 'none' }}>█</span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health panel
// ---------------------------------------------------------------------------

function HealthPanel() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [seedRunning, setSeedRunning] = useState(false);
  const [seedResult, setSeedResult] = useState<{ inserted?: number; skipped?: number; error?: string } | null>(null);
  const [namingRunning, setNamingRunning] = useState(false);
  const [namingResult, setNamingResult] = useState<{ named?: number; total_processed?: number; message?: string; error?: string } | null>(null);
  const [synthesiseRunning, setSynthesiseRunning] = useState(false);
  const [synthesiseResult, setSynthesiseResult] = useState<{ synthesised?: number; total_processed?: number; error?: string } | null>(null);

  const checkHealth = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/dashboard/api/ingest');
      if (!res.ok) { setHealth(null); return; }
      setHealth(await res.json());
    } catch {
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { checkHealth(); }, [checkHealth]);

  async function handleSeed() {
    setSeedRunning(true);
    setSeedResult(null);
    const res = await fetch('/dashboard/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seed' }),
    });
    setSeedResult(await res.json());
    setSeedRunning(false);
    checkHealth();
  }

  async function handleNameClusters() {
    setNamingRunning(true);
    setNamingResult(null);
    const res = await fetch('/dashboard/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'name-clusters' }),
    });
    setNamingResult(await res.json());
    setNamingRunning(false);
  }

  async function handleSynthesiseNarratives() {
    setSynthesiseRunning(true);
    setSynthesiseResult(null);
    const res = await fetch('/dashboard/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'synthesise-narratives' }),
    });
    setSynthesiseResult(await res.json());
    setSynthesiseRunning(false);
  }

  const dot = (val: string) => {
    const ok = val.startsWith('ok');
    return (
      <span style={{
        display: 'inline-block', width: '7px', height: '7px',
        borderRadius: '50%', background: ok ? '#22c55e' : '#ef4444',
        marginRight: '6px', flexShrink: 0,
      }} />
    );
  };

  // Extract source count from "ok (N sources)" string
  const dbCheck = health?.checks?.database ?? '';
  const sourceCountMatch = dbCheck.match(/\((\d+) sources?\)/);
  const sourceCount = sourceCountMatch ? parseInt(sourceCountMatch[1]) : 0;

  return (
    <div style={{
      marginBottom: '24px', padding: '16px 20px',
      background: '#111', border: '1px solid #1e1e1e', borderRadius: '6px',
      display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap',
    }}>
      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', flex: 1 }}>
        {loading ? (
          <span style={{ fontSize: '12px', color: '#444' }}>Checking services…</span>
        ) : health ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', fontSize: '12px' }}>
              {dot(health.checks.database)}
              <span style={{ color: '#555' }}>
                Database · {sourceCount} source{sourceCount !== 1 ? 's' : ''}
                {!health.checks.database.startsWith('ok') && (
                  <span style={{ color: '#ef4444' }}> ({health.checks.database})</span>
                )}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', fontSize: '12px' }}>
              {dot(health.checks.redis)}
              <span style={{ color: '#555' }}>
                Redis{!health.checks.redis.startsWith('ok') && (
                  <span style={{ color: '#ef4444' }}> ({health.checks.redis})</span>
                )}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', fontSize: '12px' }}>
              {dot(health.checks.openai_embedding)}
              <span style={{ color: '#555' }}>
                OpenAI Embeddings{!health.checks.openai_embedding.startsWith('ok') && (
                  <span style={{ color: '#ef4444' }}> ({health.checks.openai_embedding})</span>
                )}
              </span>
            </div>
          </>
        ) : (
          <span style={{ fontSize: '12px', color: '#ef4444' }}>Python service unreachable</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
        {sourceCount === 0 && !loading && health && (
          <span style={{ fontSize: '11px', color: '#F5A623' }}>No sources — seed defaults to start</span>
        )}
        <button
          onClick={handleSeed}
          disabled={seedRunning}
          style={{
            padding: '6px 14px', fontSize: '12px', borderRadius: '3px',
            background: 'none', border: '1px solid #333',
            color: seedRunning ? '#444' : '#888',
            cursor: seedRunning ? 'not-allowed' : 'pointer',
          }}
        >
          {seedRunning ? 'Seeding…' : 'Seed Default Sources'}
        </button>
        <button
          onClick={handleNameClusters}
          disabled={namingRunning}
          style={{
            padding: '6px 14px', fontSize: '12px', borderRadius: '3px',
            background: 'none', border: '1px solid #333',
            color: namingRunning ? '#444' : '#888',
            cursor: namingRunning ? 'not-allowed' : 'pointer',
          }}
        >
          {namingRunning ? 'Naming…' : 'Name Clusters'}
        </button>
        <button
          onClick={handleSynthesiseNarratives}
          disabled={synthesiseRunning}
          style={{
            padding: '6px 14px', fontSize: '12px', borderRadius: '3px',
            background: 'none', border: '1px solid #333',
            color: synthesiseRunning ? '#444' : '#888',
            cursor: synthesiseRunning ? 'not-allowed' : 'pointer',
          }}
        >
          {synthesiseRunning ? 'Synthesising…' : 'Synthesise Stories'}
        </button>
        <button
          onClick={checkHealth}
          disabled={loading}
          style={{
            padding: '6px 10px', fontSize: '11px', borderRadius: '3px',
            background: 'none', border: '1px solid #222',
            color: '#444', cursor: 'pointer',
          }}
        >
          ↻
        </button>
      </div>

      {namingResult && (
        <div style={{ width: '100%', fontSize: '12px', marginTop: '4px' }}>
          {namingResult.error ? (
            <span style={{ color: '#ef4444' }}>Error: {namingResult.error}</span>
          ) : namingResult.message ? (
            <span style={{ color: '#555' }}>{namingResult.message}</span>
          ) : (
            <span style={{ color: '#22c55e' }}>
              Named {namingResult.named} cluster{namingResult.named !== 1 ? 's' : ''}
              {(namingResult.total_processed ?? 0) > 0 && ` (processed ${namingResult.total_processed})`}
            </span>
          )}
        </div>
      )}

      {synthesiseResult && (
        <div style={{ width: '100%', fontSize: '12px', marginTop: '4px' }}>
          {synthesiseResult.error ? (
            <span style={{ color: '#ef4444' }}>Error: {synthesiseResult.error}</span>
          ) : (
            <span style={{ color: '#22c55e' }}>
              Synthesised {synthesiseResult.synthesised} stor{synthesiseResult.synthesised !== 1 ? 'ies' : 'y'}
              {(synthesiseResult.total_processed ?? 0) > 0 && ` (processed ${synthesiseResult.total_processed})`}
            </span>
          )}
        </div>
      )}

      {seedResult && (
        <div style={{ width: '100%', fontSize: '12px', marginTop: '4px' }}>
          {seedResult.error ? (
            <span style={{ color: '#ef4444' }}>Error: {seedResult.error}</span>
          ) : (
            <span style={{ color: '#22c55e' }}>
              Seeded {seedResult.inserted} source{seedResult.inserted !== 1 ? 's' : ''}
              {(seedResult.skipped ?? 0) > 0 && ` · ${seedResult.skipped} already existed`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RSS poll section — uses streaming SSE
// ---------------------------------------------------------------------------

function RssPollSection() {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [summary, setSummary] = useState<LogEvent | null>(null);

  async function handlePoll() {
    setRunning(true);
    setLogs([]);
    setSummary(null);

    try {
      const res = await fetch('/dashboard/api/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'poll-stream' }),
      });

      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok || !contentType.includes('text/event-stream')) {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try { msg = JSON.parse(text)?.error ?? msg; } catch { /* */ }
        setLogs([{ type: 'feed_error', msg: `Failed to start poll: ${msg}` }]);
        return;
      }

      if (!res.body) throw new Error('No stream');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt: LogEvent = JSON.parse(line.slice(6));
            setLogs(prev => [...prev, evt]);
            if (evt.type === 'complete') setSummary(evt);
          } catch {
            // ignore malformed line
          }
        }
      }
    } catch (err) {
      setLogs(prev => [...prev, { type: 'feed_error', msg: `Connection error: ${err}` }]);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Section title="RSS — Poll All Active Feeds">
      <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#555' }}>
        Fetches the current feed for every active RSS source. Most feeds carry 2–8 weeks of items.
        Each item is deduplicated, embedded, clustered, and scored automatically.
      </p>
      <button
        onClick={handlePoll}
        disabled={running}
        style={{
          padding: '9px 18px',
          background: '#1a1a1a',
          border: `1px solid ${running ? '#2a2a2a' : '#333'}`,
          color: running ? '#444' : '#ccc',
          borderRadius: '4px', fontSize: '13px',
          cursor: running ? 'not-allowed' : 'pointer',
        }}
      >
        {running ? 'Polling feeds…' : 'Poll RSS Feeds Now'}
      </button>

      <LogConsole logs={logs} running={running} />

      {/* Summary stats after completion */}
      {summary && !running && (
        <div style={{
          marginTop: '10px', padding: '14px 16px',
          background: '#0f1a0f', border: '1px solid #1a3a1a', borderRadius: '4px',
          display: 'flex', gap: '24px', flexWrap: 'wrap',
        }}>
          <Stat label="Ingested" value={summary.total_ingested ?? 0} color="#22c55e" />
          <Stat label="Duplicates skipped" value={summary.total_skipped ?? 0} color="#555" />
          <Stat label="Errors" value={summary.total_errors ?? 0} color={(summary.total_errors ?? 0) > 0 ? '#ef4444' : '#555'} />
          <Stat label="Feeds polled" value={summary.sources ?? 0} color="#F5A623" />
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IngestPage() {
  // HN live (official Firebase API)
  const [hnLiveFeed, setHnLiveFeed] = useState('top');
  const [hnLiveMax, setHnLiveMax] = useState('200');
  const [hnLiveDomains, setHnLiveDomains] = useState<string[]>(['ai']);
  const [hnLiveRunning, setHnLiveRunning] = useState(false);
  const [hnLiveResult, setHnLiveResult] = useState<Result | null>(null);

  // HN backfill
  const [hnQuery, setHnQuery] = useState('');
  const [hnDays, setHnDays] = useState('365');
  const [hnMax, setHnMax] = useState('500');
  const [hnDomains, setHnDomains] = useState<string[]>(['ai']);
  const [hnTags, setHnTags] = useState('story');
  const [hnRunning, setHnRunning] = useState(false);
  const [hnResult, setHnResult] = useState<Result | null>(null);

  // Reddit backfill
  const [redditSub, setRedditSub] = useState('');
  const [redditQuery, setRedditQuery] = useState('');
  const [redditDays, setRedditDays] = useState('90');
  const [redditMax, setRedditMax] = useState('300');
  const [redditMinScore, setRedditMinScore] = useState('25');
  const [redditLinksOnly, setRedditLinksOnly] = useState(true);
  const [redditDomains, setRedditDomains] = useState<string[]>([]);
  const [redditRunning, setRedditRunning] = useState(false);
  const [redditResult, setRedditResult] = useState<Result & { filtered_noise?: number } | null>(null);

  async function handleHNLive(e: React.FormEvent) {
    e.preventDefault();
    setHnLiveRunning(true);
    setHnLiveResult(null);
    const res = await fetch('/dashboard/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'hn-live',
        feed: hnLiveFeed,
        max_items: parseInt(hnLiveMax) || 200,
        domain_tags: hnLiveDomains,
      }),
    });
    setHnLiveResult(await res.json());
    setHnLiveRunning(false);
  }

  async function handleHN(e: React.FormEvent) {
    e.preventDefault();
    setHnRunning(true);
    setHnResult(null);
    const res = await fetch('/dashboard/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'hn', query: hnQuery, tags: hnTags,
        domain_tags: hnDomains,
        days_back: parseInt(hnDays) || 365,
        max_items: parseInt(hnMax) || 500,
      }),
    });
    setHnResult(await res.json());
    setHnRunning(false);
  }

  async function handleReddit(e: React.FormEvent) {
    e.preventDefault();
    setRedditRunning(true);
    setRedditResult(null);
    const res = await fetch('/dashboard/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'reddit',
        subreddit: redditSub,
        search_query: redditQuery,
        domain_tags: redditDomains,
        days_back: parseInt(redditDays) || 90,
        max_items: parseInt(redditMax) || 300,
        min_score: parseInt(redditMinScore) || 25,
        links_only: redditLinksOnly,
      }),
    });
    setRedditResult(await res.json());
    setRedditRunning(false);
  }

  return (
    <div>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ margin: '0 0 6px', fontSize: '22px', fontWeight: 600 }}>Ingest</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
          Pull news signals into the platform. All items pass through deduplication, embedding, clustering, and scoring.
        </p>
      </div>

      <HealthPanel />
      <RssPollSection />

      {/* HN Live — official Firebase API */}
      <Section title="Hacker News — Live Poll (Official API)">
        <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#555' }}>
          Uses the official Firebase REST API at <code style={{ color: '#888', fontSize: '12px' }}>hacker-news.firebaseio.com</code> — fully public, no login required.
          Fetches current top/new/best story IDs then resolves each item. Use this for regular live polling.
        </p>
        <form onSubmit={handleHNLive}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={labelStyle}>Feed</label>
              <select value={hnLiveFeed} onChange={e => setHnLiveFeed(e.target.value)} style={inputStyle}>
                <option value="top">Top Stories (front page)</option>
                <option value="new">New Stories (latest)</option>
                <option value="best">Best Stories (high quality)</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Max items (up to 500)</label>
              <input type="number" min="1" max="500" value={hnLiveMax}
                onChange={e => setHnLiveMax(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Assign domains</label>
            <DomainPicker value={hnLiveDomains} onChange={setHnLiveDomains} />
          </div>
          <button type="submit" disabled={hnLiveRunning} style={{
            padding: '9px 18px',
            background: hnLiveRunning ? '#1a1a1a' : '#1a1a1a',
            border: `1px solid ${hnLiveRunning ? '#222' : '#333'}`,
            color: hnLiveRunning ? '#444' : '#ccc',
            borderRadius: '4px', fontSize: '13px',
            cursor: hnLiveRunning ? 'not-allowed' : 'pointer',
          }}>
            {hnLiveRunning ? 'Fetching from HN…' : 'Poll HN Now'}
          </button>
          {hnLiveRunning && (
            <p style={{ marginTop: '10px', fontSize: '12px', color: '#555' }}>
              Fetching story list then resolving items in parallel batches…
            </p>
          )}
          {hnLiveResult && (
            hnLiveResult.error ? (
              <div style={{ color: '#ef4444', fontSize: '13px', marginTop: '10px' }}>Error: {hnLiveResult.error}</div>
            ) : (
              <div style={{
                marginTop: '12px', padding: '14px 16px',
                background: '#0f1a0f', border: '1px solid #1a3a1a', borderRadius: '4px',
                display: 'flex', gap: '24px', flexWrap: 'wrap',
              }}>
                {hnLiveResult.requested !== undefined && <Stat label="Requested" value={hnLiveResult.requested} color="#F5A623" />}
                {hnLiveResult.ingested !== undefined && <Stat label="Ingested" value={hnLiveResult.ingested} color="#22c55e" />}
                {hnLiveResult.skipped_duplicates !== undefined && <Stat label="Duplicates skipped" value={hnLiveResult.skipped_duplicates} color="#555" />}
                {(hnLiveResult.errors !== undefined || hnLiveResult.fetch_errors !== undefined) && (
                  <Stat label="Errors" value={(hnLiveResult.errors ?? 0) + (hnLiveResult.fetch_errors ?? 0)}
                    color={((hnLiveResult.errors ?? 0) + (hnLiveResult.fetch_errors ?? 0)) > 0 ? '#ef4444' : '#555'} />
                )}
              </div>
            )
          )}
        </form>
      </Section>

      {/* HN Backfill */}
      <Section title="Hacker News — Historical Backfill (Algolia)">
        <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#555' }}>
          Uses the Algolia HN Search API — free, no auth required. Supports full history going back years.
          Leave query blank to pull all top stories; add keywords to focus on a topic.
        </p>
        <form onSubmit={handleHN}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={labelStyle}>Search query (optional)</label>
              <input value={hnQuery} onChange={e => setHnQuery(e.target.value)}
                placeholder="e.g. AI agents, LLM, vibe coding" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Post type</label>
              <select value={hnTags} onChange={e => setHnTags(e.target.value)} style={inputStyle}>
                <option value="story">Story (link posts)</option>
                <option value="ask_hn">Ask HN</option>
                <option value="show_hn">Show HN</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Days back</label>
              <input type="number" min="1" max="1825" value={hnDays}
                onChange={e => setHnDays(e.target.value)} style={inputStyle} />
              <div style={{ fontSize: '11px', color: '#444', marginTop: '4px' }}>Max 1825 (5 years)</div>
            </div>
            <div>
              <label style={labelStyle}>Max items</label>
              <input type="number" min="1" max="5000" value={hnMax}
                onChange={e => setHnMax(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Assign domains</label>
            <DomainPicker value={hnDomains} onChange={setHnDomains} />
          </div>
          <button type="submit" disabled={hnRunning} style={{
            padding: '9px 18px',
            background: hnRunning ? '#1a1a1a' : '#F5A623',
            color: hnRunning ? '#555' : '#0f0f0f',
            border: 'none', borderRadius: '4px', fontSize: '13px',
            fontWeight: 600, cursor: hnRunning ? 'not-allowed' : 'pointer',
          }}>
            {hnRunning ? 'Backfilling HN…' : 'Start HN Backfill'}
          </button>
          {hnRunning && (
            <p style={{ marginTop: '10px', fontSize: '12px', color: '#555' }}>
              Processing — large backfills take several minutes while signals are embedded and scored…
            </p>
          )}
          {hnResult && <ResultBadge result={hnResult} />}
        </form>
      </Section>

      {/* Reddit */}
      <Section title="Reddit — News Extraction">
        <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#555' }}>
          Pulls news articles from a subreddit with quality filters to cut out memes, image posts, and low-quality content.
          For best results, target news-focused subreddits and use a keyword query to narrow the results.
        </p>

        {/* Suggested subreddits */}
        <div style={{ marginBottom: '16px', padding: '12px 14px', background: '#111', border: '1px solid #222', borderRadius: '4px' }}>
          <div style={{ fontSize: '11px', color: '#555', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Suggested subreddits by domain</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {[
              { domain: 'AI', subs: 'AINews · MachineLearning · artificial · singularity · LocalLLaMA' },
              { domain: 'VR / AR', subs: 'virtualreality · oculus · augmentedreality · SteamVR' },
              { domain: 'SEO', subs: 'SEO · bigseo · juststart · webmarketing' },
              { domain: 'Vibe Coding', subs: 'vibecoding · programming · webdev · LocalLLaMA' },
              { domain: 'Cross', subs: 'technology · Futurology · technews · worldnews' },
            ].map(({ domain, subs }) => (
              <div key={domain} style={{ display: 'flex', gap: '10px', fontSize: '12px' }}>
                <span style={{ color: '#F5A623', flexShrink: 0, width: '80px' }}>{domain}</span>
                <span style={{ color: '#444' }}>{subs}</span>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={handleReddit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={labelStyle}>Subreddit (without r/)</label>
              <input required value={redditSub} onChange={e => setRedditSub(e.target.value)}
                placeholder="e.g. AINews" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Keyword filter (optional — recommended)</label>
              <input value={redditQuery} onChange={e => setRedditQuery(e.target.value)}
                placeholder="e.g. funding, research, launch" style={inputStyle} />
              <div style={{ fontSize: '11px', color: '#444', marginTop: '3px' }}>
                Searches within the subreddit — much better signal/noise than pulling everything
              </div>
            </div>
            <div>
              <label style={labelStyle}>Min upvotes (noise filter)</label>
              <input type="number" min="0" max="10000" value={redditMinScore}
                onChange={e => setRedditMinScore(e.target.value)} style={inputStyle} />
              <div style={{ fontSize: '11px', color: '#444', marginTop: '3px' }}>
                25+ recommended · 50+ for busy subs · 0 = no filter
              </div>
            </div>
            <div>
              <label style={labelStyle}>Days back</label>
              <input type="number" min="1" max="365" value={redditDays}
                onChange={e => setRedditDays(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Max items</label>
              <input type="number" min="1" max="1000" value={redditMax}
                onChange={e => setRedditMax(e.target.value)} style={inputStyle} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#666', cursor: 'pointer', marginTop: '18px' }}>
                <input type="checkbox" checked={redditLinksOnly} onChange={e => setRedditLinksOnly(e.target.checked)} />
                Links only — skip text/self posts and image hosts
              </label>
            </div>
          </div>
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>Assign domains</label>
            <DomainPicker value={redditDomains} onChange={setRedditDomains} />
          </div>
          <button type="submit" disabled={redditRunning} style={{
            padding: '9px 18px',
            background: redditRunning ? '#1a1a1a' : '#F5A623',
            color: redditRunning ? '#555' : '#0f0f0f',
            border: 'none', borderRadius: '4px', fontSize: '13px',
            fontWeight: 600, cursor: redditRunning ? 'not-allowed' : 'pointer',
          }}>
            {redditRunning ? 'Fetching Reddit…' : 'Fetch Reddit News'}
          </button>
          {redditRunning && (
            <p style={{ marginTop: '10px', fontSize: '12px', color: '#555' }}>
              Applying filters — Reddit rate limits apply (~1 req/sec)…
            </p>
          )}
          {redditResult && (
            <div style={{
              marginTop: '12px', padding: '14px 16px',
              background: '#0f1a0f', border: '1px solid #1a3a1a', borderRadius: '4px',
              display: 'flex', gap: '24px', flexWrap: 'wrap',
            }}>
              <Stat label="Ingested" value={redditResult.ingested ?? 0} color="#22c55e" />
              <Stat label="Duplicates skipped" value={redditResult.skipped_duplicates ?? 0} color="#555" />
              <Stat label="Filtered (noise)" value={redditResult.filtered_noise ?? 0} color="#888" />
              <Stat label="Errors" value={redditResult.errors ?? 0} color={(redditResult.errors ?? 0) > 0 ? '#ef4444' : '#555'} />
            </div>
          )}
        </form>
      </Section>

      {/* Notes */}
      <div style={{ padding: '16px', background: '#111', border: '1px solid #1e1e1e', borderRadius: '4px' }}>
        <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#555', fontWeight: 600 }}>History coverage by source type</p>
        <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: '12px', color: '#444', lineHeight: 1.9 }}>
          <li><strong style={{ color: '#555' }}>RSS feeds</strong> — whatever the feed currently contains (typically 2–8 weeks)</li>
          <li><strong style={{ color: '#555' }}>Hacker News</strong> — full archive going back years via Algolia API (free, no key needed)</li>
          <li><strong style={{ color: '#555' }}>Reddit</strong> — top/search posts filtered by score, links-only, domain blocklist (imgur, v.redd.it etc.)</li>
          <li><strong style={{ color: '#555' }}>X / LinkedIn / Instagram</strong> — require API credentials (add via Sources page when ready)</li>
        </ul>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '32px', background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: '6px', padding: '24px' }}>
      <h2 style={{ margin: '0 0 16px', fontSize: '14px', fontWeight: 600, color: '#e5e5e5' }}>{title}</h2>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px',
  background: '#111', border: '1px solid #333',
  color: '#e5e5e5', borderRadius: '4px', fontSize: '13px',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: '11px', color: '#555',
  marginBottom: '5px', letterSpacing: '0.05em', textTransform: 'uppercase',
};
