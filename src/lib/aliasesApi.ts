import { requireAdminAuthHeaders } from './adminAuth.ts';
import type { AliasMap } from './teamNames.ts';

export async function loadServerAliases(year: number, leagueSlug?: string): Promise<AliasMap> {
  const leagueParam = leagueSlug ? `&league=${encodeURIComponent(leagueSlug)}` : '';
  const res = await fetch(`/api/aliases?year=${year}${leagueParam}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`aliases GET ${res.status}`);
  const data = (await res.json()) as { year: number; map: AliasMap };
  return data.map ?? {};
}

/**
 * Effective (resolver) alias map for a league/year: stored global > league+year
 * > year > SEED_ALIASES — the same resolution server canonical standings use.
 * Read-only; use for client schedule/liveDelta identity, NOT for the alias
 * editor (which manages stored league aliases via loadServerAliases).
 */
export async function loadEffectiveAliases(year: number, leagueSlug?: string): Promise<AliasMap> {
  const leagueParam = leagueSlug ? `&league=${encodeURIComponent(leagueSlug)}` : '';
  const res = await fetch(`/api/aliases?scope=effective&year=${year}${leagueParam}`, {
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`effective aliases GET ${res.status}`);
  const data = (await res.json()) as { map: AliasMap };
  return data.map ?? {};
}

export async function saveServerAliases(
  upserts: AliasMap,
  deletes: string[] = [],
  year: number,
  leagueSlug?: string
): Promise<AliasMap> {
  const leagueParam = leagueSlug ? `&league=${encodeURIComponent(leagueSlug)}` : '';
  const res = await fetch(`/api/aliases?year=${year}${leagueParam}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...requireAdminAuthHeaders() },
    body: JSON.stringify({ upserts, deletes }),
  });
  if (!res.ok) throw new Error(`aliases PUT ${res.status}`);
  const data = (await res.json()) as { year: number; map: AliasMap };
  return data.map ?? {};
}
