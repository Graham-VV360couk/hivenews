// apps/nextjs/app/api/v1/_auth.ts
import { getDb } from '@/lib/db';

export async function validateApiKey(key: string | null): Promise<boolean> {
  if (!key) return false;
  try {
    const sql = getDb();
    const rows = await sql`
      UPDATE api_subscribers
      SET last_used_at = NOW()
      WHERE api_key = ${key} AND is_active = TRUE
      RETURNING id
    `;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export function apiKeyFromRequest(request: Request): string | null {
  return request.headers.get('X-API-Key') ||
         new URL(request.url).searchParams.get('api_key');
}
