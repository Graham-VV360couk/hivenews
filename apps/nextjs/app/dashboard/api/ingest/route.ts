export const dynamic = 'force-dynamic';
// apps/nextjs/app/dashboard/api/ingest/route.ts
import { NextRequest, NextResponse } from 'next/server';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function GET() {
  try {
    const res = await fetch(`${PYTHON_URL}/feed/health`);
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Python service unreachable' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, ...params } = body;

    // Streaming RSS poll — proxy SSE directly
    if (action === 'poll-stream') {
      const res = await fetch(`${PYTHON_URL}/feed/poll-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok || !res.body) {
        // Return the error as an SSE event so the client can display it
        const errorBody = res.body ? await res.text() : 'Stream failed';
        const errMsg = JSON.stringify({ type: 'feed_error', msg: `Server error ${res.status}: ${errorBody}` });
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`data: ${errMsg}\n\n`));
            controller.close();
          },
        });
        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
          },
        });
      }
      return new Response(res.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // Seed default sources
    if (action === 'seed') {
      const res = await fetch(`${PYTHON_URL}/feed/seed-sources`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) return NextResponse.json(data, { status: res.status });
      return NextResponse.json(data);
    }

    const endpoints: Record<string, string> = {
      poll:      '/feed/poll',
      'hn-live': '/feed/hn-live',
      hn:        '/feed/backfill/hn',
      reddit:    '/feed/backfill/reddit',
    };

    const path = endpoints[action];
    if (!path) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

    const res = await fetch(`${PYTHON_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
