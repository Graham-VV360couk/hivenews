export const dynamic = 'force-dynamic';
// apps/nextjs/app/dashboard/api/packs/[id]/approve/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const sql = getDb();
  const { id } = params;
  const { platform, final_text } = await request.json();

  if (!platform) {
    return NextResponse.json({ error: 'platform required' }, { status: 400 });
  }

  // Approve the draft
  await sql`
    UPDATE content_drafts
    SET approved = TRUE,
        final_text = ${final_text ?? null},
        approved_at = NOW()
    WHERE pack_id = ${id}
    AND platform = ${platform}
  `;

  // Check if all drafts are now approved
  const remaining = await sql<[{ count: string }]>`
    SELECT COUNT(*) FROM content_drafts
    WHERE pack_id = ${id} AND approved = FALSE
  `;

  const pendingCount = Number(remaining[0].count);
  if (pendingCount === 0) {
    await sql`
      UPDATE content_packs
      SET status = 'approved',
          approved_at = NOW()
      WHERE id = ${id}
    `;
  }

  return NextResponse.json({ ok: true, all_approved: pendingCount === 0 });
}
