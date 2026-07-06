import type { AliasMap } from './teamNames.ts';

/**
 * Effective (resolver) alias map for a year: stored global > year > SEED_ALIASES
 * — the same resolution server canonical standings use. Read-only; the client
 * uses it for schedule/liveDelta identity. A leagueSlug may still be passed for
 * call-site compatibility but no longer affects resolution (PLATFORM-067).
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
