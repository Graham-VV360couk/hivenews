// apps/nextjs/app/dashboard/api/submissions/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT
        hs.id,
        hs.submitted_at,
        hs.confidence_level,
        hs.entered_queue,
        hs.instant_corroboration,
        hs.corroboration_window,
        hs.outcome,
        hs.submission_sequence,
        st.token,
        st.initial_verdict,
        st.current_tier,
        st.submission_count,
        st.accuracy_rate
      FROM honeypot_submissions hs
      JOIN source_tokens st ON st.id = hs.token_id
      WHERE hs.outcome IS NULL
        AND hs.content_encrypted != '[PURGED]'
      ORDER BY hs.submitted_at DESC
      LIMIT 50
    `;
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}
