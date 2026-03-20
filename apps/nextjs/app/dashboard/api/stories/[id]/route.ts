export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const res = await fetch(`${PYTHON_URL}/stories/${params.id}/synthesise`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
