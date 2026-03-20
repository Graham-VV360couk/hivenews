export const dynamic = 'force-dynamic';
// apps/nextjs/app/dashboard/api/sources/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const sql = getDb();
    const rows = await sql`
      SELECT
        s.id,
        s.name,
        s.handle,
        s.url,
        s.platform,
        s.domain_tags,
        s.tier,
        s.is_active,
        s.last_ingested,
        sr.total_signals,
        sr.accuracy_rate,
        sr.lead_time_avg_days
      FROM sources s
      LEFT JOIN source_reputation sr ON sr.source_id = s.id
      ORDER BY s.tier ASC, s.name
      LIMIT 200
    `;
    return NextResponse.json(rows);
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, handle, url, platform, domain_tags, tier } = body;

    if (!name || !platform) {
      return NextResponse.json({ error: 'name and platform are required' }, { status: 400 });
    }

    const sql = getDb();
    const tags = Array.isArray(domain_tags) ? domain_tags : [];
    const tierNum = parseInt(tier) || 3;

    const rows = await sql`
      INSERT INTO sources (name, handle, url, platform, domain_tags, tier)
      VALUES (${name}, ${handle || null}, ${url || null}, ${platform}, ${tags}, ${tierNum})
      RETURNING id, name, handle, url, platform, domain_tags, tier, is_active, last_ingested, created_at
    `;
    return NextResponse.json(rows[0], { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
