export const dynamic = 'force-dynamic';
// apps/nextjs/app/dashboard/api/packs/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const sql = getDb();
  const { id } = params;

  const [packRows, drafts] = await Promise.all([
    sql`
      SELECT id, pack_type, status, triggered_at, confidence_level,
             trigger_reason, readiness_score, approved_at, cluster_id
      FROM content_packs
      WHERE id = ${id}
    `,
    sql`
      SELECT id, platform, draft_text, draft_data, approved, final_text
      FROM content_drafts
      WHERE pack_id = ${id}
      ORDER BY ARRAY_POSITION(ARRAY['blog','linkedin','instagram','facebook','x','hivecast'], platform)
    `,
  ]);

  if (packRows.length === 0) {
    return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
  }

  return NextResponse.json({ pack: packRows[0], drafts });
}
