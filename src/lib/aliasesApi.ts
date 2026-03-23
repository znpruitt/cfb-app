import { requireAdminAuthHeaders } from './adminAuth.ts';
import type { AliasMap } from './teamNames.ts';

export async function loadServerAliases(year: number): Promise<AliasMap> {
  const res = await fetch(`/api/aliases?year=${year}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`aliases GET ${res.status}`);
  const data = (await res.json()) as { year: number; map: AliasMap };
  return data.map ?? {};
}

export async function saveServerAliases(
  upserts: AliasMap,
  deletes: string[] = [],
  year: number
): Promise<AliasMap> {
  const res = await fetch(`/api/aliases?year=${year}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...requireAdminAuthHeaders() },
    body: JSON.stringify({ upserts, deletes }),
  });
  if (!res.ok) throw new Error(`aliases PUT ${res.status}`);
  const data = (await res.json()) as { year: number; map: AliasMap };
  return data.map ?? {};
}
