// apps/nextjs/app/dashboard/api/trajectories/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const res = await fetch(`${PYTHON_URL}/trajectories/${params.id}`);
    if (!res.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ error: 'Failed to load trajectory' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { action, ...payload } = body;
    const endpoint = action === 'resolve'
      ? `${PYTHON_URL}/trajectories/${params.id}/resolve`
      : `${PYTHON_URL}/trajectories/${params.id}/confidence`;
    const res = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
}
