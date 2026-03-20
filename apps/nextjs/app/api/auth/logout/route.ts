export const dynamic = 'force-dynamic';
// apps/nextjs/app/api/auth/logout/route.ts
import { clearSession } from '@/lib/auth';

export async function POST(): Promise<Response> {
  return clearSession();
}
