export const dynamic = 'force-dynamic';
// apps/nextjs/app/dashboard/api/trajectories/route.ts
import { NextRequest, NextResponse } from 'next/server';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function GET() {
  try {
    const res = await fetch(`${PYTHON_URL}/trajectories`);
    if (!res.ok) return NextResponse.json([], { status: res.status });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json([], { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const res = await fetch(`${PYTHON_URL}/trajectories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Failed to create trajectory' }, { status: 500 });
  }
}
