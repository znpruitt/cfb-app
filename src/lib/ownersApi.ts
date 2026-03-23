import { requireAdminAuthHeaders } from './adminAuth.ts';

export type ServerOwnersCsvState = {
  csvText: string | null;
  hasStoredValue: boolean;
};

export async function loadServerOwnersCsv(year: number): Promise<ServerOwnersCsvState> {
  const res = await fetch(`/api/owners?year=${year}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`owners GET ${res.status}`);
  const data = (await res.json()) as {
    year: number;
    csvText?: string | null;
    hasStoredValue?: boolean;
  };
  return {
    csvText: typeof data.csvText === 'string' && data.csvText.trim() ? data.csvText : null,
    hasStoredValue: data.hasStoredValue === true,
  };
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
