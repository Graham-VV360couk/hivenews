// apps/nextjs/lib/db.ts
import postgres from 'postgres';

// Module-level singleton — Next.js will re-use this across requests in prod
let _sql: ReturnType<typeof postgres> | null = null;

export function getDb(): ReturnType<typeof postgres> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    _sql = postgres(url, { max: 5 });
  }
  return _sql;
}
