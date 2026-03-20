export const dynamic = 'force-dynamic';
// apps/nextjs/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { createSession } from '@/lib/auth';

export async function POST(request: NextRequest): Promise<Response> {
  const { password } = await request.json();

  if (!password || typeof password !== 'string') {
    return NextResponse.json({ error: 'Password required' }, { status: 400 });
  }

  const hash = process.env.DASHBOARD_PASSWORD_HASH;
  if (!hash) {
    console.error('DASHBOARD_PASSWORD_HASH is not set');
    return NextResponse.json({ error: 'Auth not configured' }, { status: 500 });
  }

  const valid = await bcrypt.compare(password, hash);
  if (!valid) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const okResponse = NextResponse.json({ ok: true });
  return createSession(okResponse);
}
