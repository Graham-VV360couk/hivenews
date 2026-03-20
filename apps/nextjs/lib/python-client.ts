// apps/nextjs/lib/python-client.ts

const BASE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

export async function pythonPost<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Python service error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function triggerDraft(params: {
  cluster_id?: string;
  alert_candidate_id?: string;
  force?: boolean;
}): Promise<{ pack_id: string | null; created: boolean; reason: string }> {
  return pythonPost('/draft', params);
}
