'use client';
// apps/nextjs/app/dashboard/ingest/page.tsx

import { useEffect, useRef, useState } from 'react';

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
  source?: string;
  query?: string;
  days_back?: number;
  error?: string;
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
  const [redditDays, setRedditDays] = useState('90');
  const [redditMax, setRedditMax] = useState('300');
  const [redditDomains, setRedditDomains] = useState<string[]>([]);
  const [redditRunning, setRedditRunning] = useState(false);
  const [redditResult, setRedditResult] = useState<Result | null>(null);

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
        action: 'reddit', subreddit: redditSub,
        domain_tags: redditDomains,
        days_back: parseInt(redditDays) || 90,
        max_items: parseInt(redditMax) || 300,
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
          {hnLiveResult && <ResultBadge result={hnLiveResult} />}
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

      {/* Reddit Backfill */}
      <Section title="Reddit — Historical Backfill">
        <p style={{ margin: '0 0 14px', fontSize: '13px', color: '#555' }}>
          Pulls top posts from a subreddit via the public Reddit API.
          Reddit enforces ~1 req/sec so large backfills take a few minutes.
        </p>
        <form onSubmit={handleReddit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <div>
              <label style={labelStyle}>Subreddit (without r/)</label>
              <input required value={redditSub} onChange={e => setRedditSub(e.target.value)}
                placeholder="e.g. MachineLearning" style={inputStyle} />
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
            {redditRunning ? 'Backfilling Reddit…' : 'Start Reddit Backfill'}
          </button>
          {redditRunning && (
            <p style={{ marginTop: '10px', fontSize: '12px', color: '#555' }}>
              Processing — Reddit rate limits apply (~1 req/sec)…
            </p>
          )}
          {redditResult && <ResultBadge result={redditResult} />}
        </form>
      </Section>

      {/* Notes */}
      <div style={{ padding: '16px', background: '#111', border: '1px solid #1e1e1e', borderRadius: '4px' }}>
        <p style={{ margin: '0 0 8px', fontSize: '12px', color: '#555', fontWeight: 600 }}>History coverage by source type</p>
        <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: '12px', color: '#444', lineHeight: 1.9 }}>
          <li><strong style={{ color: '#555' }}>RSS feeds</strong> — whatever the feed currently contains (typically 2–8 weeks)</li>
          <li><strong style={{ color: '#555' }}>Hacker News</strong> — full archive going back years via Algolia API (free, no key needed)</li>
          <li><strong style={{ color: '#555' }}>Reddit</strong> — top posts for the period via public API (up to ~1000 posts per run)</li>
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
