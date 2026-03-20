// apps/nextjs/app/api/v1/trajectories/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { validateApiKey, apiKeyFromRequest } from '../_auth';

export async function GET(request: NextRequest) {
  const key = apiKeyFromRequest(request);
  if (!await validateApiKey(key)) {
    return NextResponse.json({ error: 'Invalid or missing API key' }, { status: 401 });
  }

  const sql = getDb();
  const rows = await sql`
    SELECT id, name, domain_tags, confidence_score,
           confidence_direction, status, description,
           first_published_at, last_updated_at
    FROM trajectories
    WHERE status = 'active'
    ORDER BY confidence_score DESC
  `;

  return NextResponse.json({
    data: rows,
    count: rows.length,
    attribution: 'NewsHive (newshive.geekybee.net). CC BY 4.0.',
  });
}
