export const dynamic = 'force-dynamic';
// apps/nextjs/app/dashboard/api/connections/route.ts
import { NextResponse } from 'next/server';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function GET() {
  try {
    const res = await fetch(`${PYTHON_URL}/connections`);
    if (!res.ok) return NextResponse.json({}, { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({}, { status: 500 });
  }
}
