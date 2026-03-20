export const dynamic = 'force-dynamic';
// apps/nextjs/app/api/v1/packs/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { validateApiKey, apiKeyFromRequest } from '../_auth';

export async function GET(request: NextRequest) {
  const key = apiKeyFromRequest(request);
  if (!await validateApiKey(key)) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

  const sql = getDb();
  const rows = await sql`
    SELECT
      cp.id,
      cp.pack_type,
      cp.confidence_level,
      cp.published_at,
      cl.domain_tags,
      cd.draft_data->>'title'            AS title,
      cd.draft_data->>'meta_description' AS meta_description
    FROM content_packs cp
    JOIN content_drafts cd ON cd.pack_id = cp.id AND cd.platform = 'blog'
    LEFT JOIN clusters cl ON cl.id = cp.cluster_id
    WHERE cp.status = 'published'
      AND cp.published_at IS NOT NULL
    ORDER BY cp.published_at DESC
    LIMIT ${limit}
  `;

  return NextResponse.json({
    data: rows,
    count: rows.length,
    attribution: 'NewsHive (newshive.geekybee.net). CC BY 4.0.',
  });
}
