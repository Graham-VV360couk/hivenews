// apps/nextjs/app/api/v1/signals/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { validateApiKey, apiKeyFromRequest } from '../_auth';

export async function GET(request: NextRequest) {
  const key = apiKeyFromRequest(request);
  if (!await validateApiKey(key)) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const domain = searchParams.get('domain');
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

  const sql = getDb();

  const rows = domain
    ? await sql`
        SELECT id, title, url, published_at, ingested_at,
               domain_tags, confidence_level, importance_composite,
               corroboration_count
        FROM signals
        WHERE domain_tags @> ARRAY[${domain}]::text[]
          AND processed = TRUE
        ORDER BY ingested_at DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT id, title, url, published_at, ingested_at,
               domain_tags, confidence_level, importance_composite,
               corroboration_count
        FROM signals
        WHERE processed = TRUE
        ORDER BY ingested_at DESC
        LIMIT ${limit}
      `;

  return NextResponse.json({
    data: rows,
    count: rows.length,
    attribution: 'NewsHive (newshive.geekybee.net). CC BY 4.0.',
  });
}
