// apps/nextjs/app/dashboard/api/submissions/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

// GET — decrypt and return submission content
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT
        hs.id,
        hs.content_encrypted,
        hs.submitted_at,
        hs.confidence_level,
        hs.entered_queue,
        hs.instant_corroboration,
        hs.corroboration_window,
        hs.outcome,
        st.token,
        st.initial_verdict,
        st.current_tier,
        st.accuracy_rate,
        st.confirmed_correct,
        st.confirmed_wrong,
        st.submission_count
      FROM honeypot_submissions hs
      JOIN source_tokens st ON st.id = hs.token_id
      WHERE hs.id = ${params.id}
      LIMIT 1
    `;
    if (!rows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(rows[0]);
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST — record outcome
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const res = await fetch(`${PYTHON_URL}/honeypot/outcome`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submission_id: params.id, ...body }),
    });
    if (!res.ok) return NextResponse.json({ error: 'Outcome failed' }, { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
