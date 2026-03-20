export const dynamic = 'force-dynamic';
// apps/nextjs/app/dashboard/api/signals/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const sql = getDb();
    const { searchParams } = new URL(req.url);
    const domain = searchParams.get('domain') || '';
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');

    const rows = await sql`
      SELECT
        s.id,
        s.title,
        s.url,
        s.domain_tags,
        s.source_type,
        s.importance_composite,
        s.is_alert_candidate,
        s.confidence_level,
        COALESCE(s.published_at, s.ingested_at) AS published_at,
        s.ingested_at,
        src.name AS source_name
      FROM signals s
      LEFT JOIN sources src ON src.id = s.source_id
      WHERE (${domain} = '' OR ${domain} = ANY(s.domain_tags))
      ORDER BY COALESCE(s.published_at, s.ingested_at) DESC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `;

    const total = await sql`
      SELECT COUNT(*)::int AS count FROM signals
      WHERE (${domain} = '' OR ${domain} = ANY(domain_tags))
    `;

    return NextResponse.json({ signals: rows, total: total[0].count });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
