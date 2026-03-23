import { requireAdminAuthHeaders } from './adminAuth.ts';

export async function loadServerOwnersCsv(year: number): Promise<string | null> {
  const res = await fetch(`/api/owners?year=${year}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`owners GET ${res.status}`);
  const data = (await res.json()) as { year: number; csvText?: string | null };
  return typeof data.csvText === 'string' && data.csvText.trim() ? data.csvText : null;
}

export async function saveServerOwnersCsv(
  year: number,
  csvText: string | null
): Promise<string | null> {
  const res = await fetch(`/api/owners?year=${year}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...requireAdminAuthHeaders(),
    },
    body: JSON.stringify({ csvText }),
  });
  if (!res.ok) throw new Error(`owners PUT ${res.status}`);
  const data = (await res.json()) as { year: number; csvText?: string | null };
  return typeof data.csvText === 'string' && data.csvText.trim() ? data.csvText : null;
}
