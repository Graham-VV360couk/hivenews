export const dynamic = 'force-dynamic';
// apps/nextjs/app/dashboard/api/monthly/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function GET() {
  try {
    const sql = getDb();
    const today = new Date();
    const rows = await sql`
      SELECT period_year, period_month, signals_ingested, alerts_fired,
             alerts_confirmed, pinch_of_salt_issued, content_packs_published,
             draft_generated_at, operator_reviewed, published_at
      FROM monthly_snapshots
      WHERE period_year = ${today.getFullYear()} AND period_month = ${today.getMonth() + 1}
      LIMIT 1
    `;
    return NextResponse.json(rows[0] ?? null);
  } catch {
    return NextResponse.json(null);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json();
    const endpoint = action === 'generate' ? '/monthly/generate' : '/monthly/snapshot';
    const res = await fetch(`${PYTHON_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json({ error: JSON.stringify(data) }, { status: res.status });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 }
    );
  }
}
