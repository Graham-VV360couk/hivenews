// apps/nextjs/app/dashboard/api/packs/route.ts
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  const sql = getDb();
  const packs = await sql`
    SELECT
      cp.id,
      cp.pack_type,
      cp.status,
      cp.triggered_at,
      cp.confidence_level,
      cp.trigger_reason,
      cp.readiness_score,
      COUNT(cd.id)                                          AS draft_count,
      COUNT(cd.id) FILTER (WHERE cd.approved)              AS approved_count
    FROM content_packs cp
    LEFT JOIN content_drafts cd ON cd.pack_id = cp.id
    GROUP BY cp.id
    ORDER BY cp.triggered_at DESC
    LIMIT 20
  `;
  return NextResponse.json(packs);
}
