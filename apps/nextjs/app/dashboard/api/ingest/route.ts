export const dynamic = 'force-dynamic';
// apps/nextjs/app/dashboard/api/ingest/route.ts
import { NextRequest, NextResponse } from 'next/server';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, ...params } = body;

    const endpoints: Record<string, string> = {
      poll:    '/feed/poll',
      hn:      '/feed/backfill/hn',
      reddit:  '/feed/backfill/reddit',
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
