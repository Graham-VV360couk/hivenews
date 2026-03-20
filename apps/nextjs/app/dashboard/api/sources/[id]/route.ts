export const dynamic = 'force-dynamic';
// apps/nextjs/app/dashboard/api/sources/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json();
    const sql = getDb();

    if (body.action === 'toggle') {
      await sql`
        UPDATE sources SET is_active = NOT is_active WHERE id = ${params.id}
      `;
    } else {
      const { name, handle, url, platform, domain_tags, tier } = body;
      const tags = Array.isArray(domain_tags) ? domain_tags : [];
      await sql`
        UPDATE sources
        SET
          name = ${name},
          handle = ${handle || null},
          url = ${url || null},
          platform = ${platform},
          domain_tags = ${tags},
          tier = ${parseInt(tier) || 3}
        WHERE id = ${params.id}
      `;
    }

    const rows = await sql`
      SELECT id, name, handle, url, platform, domain_tags, tier, is_active, last_ingested
      FROM sources WHERE id = ${params.id}
    `;
    return NextResponse.json(rows[0] ?? { error: 'Not found' });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const sql = getDb();
    await sql`DELETE FROM sources WHERE id = ${params.id}`;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
