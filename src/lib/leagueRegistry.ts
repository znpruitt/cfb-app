import { cache } from 'react';

import { getAppState, setAppState } from './server/appStateStore.ts';
import type { League, LeagueStatus } from './league.ts';

const REGISTRY_SCOPE = 'leagues';
const REGISTRY_KEY = 'registry';

/** Slug must be lowercase alphanumeric words separated by single hyphens */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export async function getLeagues(): Promise<League[]> {
  const record = await getAppState<League[]>(REGISTRY_SCOPE, REGISTRY_KEY);
  const value = record?.value;
  return Array.isArray(value) ? value : [];
}

export const getLeague = cache(async (slug: string): Promise<League | null> => {
  const leagues = await getLeagues();
  return leagues.find((l) => l.slug === slug) ?? null;
});

export async function addLeague(league: League): Promise<League[]> {
  const leagues = await getLeagues();
  if (leagues.some((l) => l.slug === league.slug)) {
    throw new Error(`League with slug '${league.slug}' already exists`);
  }
  const updated = [...leagues, league];
  await setAppState(REGISTRY_SCOPE, REGISTRY_KEY, updated);
  return updated;
}

/**
 * Generic league CONFIGURATION update (display name, founded year, password
 * material, assignment configuration). The lifecycle fields — `year` and
 * `status` — are reserved for `updateLeagueStatus`, the single lifecycle-year
 * mutation authority (PLATFORM-086F2B): `league.status` is the lifecycle
 * source of truth and the top-level `league.year` is only its synchronized
 * compatibility projection, so no generic caller may write either field. The
 * type excludes them and the runtime guard rejects untyped callers.
 */
export async function updateLeague(
  slug: string,
  updates: Partial<Omit<League, 'slug' | 'createdAt' | 'year' | 'status'>>
): Promise<League | null> {
  if ('year' in updates || 'status' in updates) {
    throw new Error(
      'updateLeague cannot mutate lifecycle fields (year/status) — use updateLeagueStatus'
    );
  }
  const leagues = await getLeagues();
  const idx = leagues.findIndex((l) => l.slug === slug);
  if (idx === -1) return null;
  const updated = leagues.map((l, i) => (i === idx ? { ...l, ...updates } : l));
  await setAppState(REGISTRY_SCOPE, REGISTRY_KEY, updated);
  return updated[idx];
}

/**
 * The single lifecycle mutation authority (PLATFORM-086F2B). Performs ONE
 * registry write per call:
 *
 *   - `season` / `preseason` → sets `status` AND synchronizes the top-level
 *     `league.year` to `status.year` in the same written record;
 *   - `offseason` → sets only `status`, retaining the last season year in
 *     `league.year` (the archived-season compatibility projection).
 *
 * Because both fields land in one `setAppState` write, a failed registry write
 * can never leave `status.year` and `league.year` partially synchronized.
 */
export async function updateLeagueStatus(
  slug: string,
  status: LeagueStatus
): Promise<League | null> {
  const leagues = await getLeagues();
  const idx = leagues.findIndex((l) => l.slug === slug);
  if (idx === -1) return null;
  const current = leagues[idx]!;
  const next: League =
    status.state === 'offseason'
      ? { ...current, status }
      : { ...current, status, year: status.year };
  const updated = leagues.map((l, i) => (i === idx ? next : l));
  await setAppState(REGISTRY_SCOPE, REGISTRY_KEY, updated);
  return next;
}

/**
 * Remove the password credentials from a league, reverting it to public. Uses
 * explicit rest-destructuring so the persisted record no longer carries the
 * `passwordHash` / `passwordSalt` keys at all (rather than setting them to
 * `undefined`, which leaves the keys present in memory even though JSON
 * serialization would drop them).
 */
export async function clearLeaguePassword(slug: string): Promise<League | null> {
  const leagues = await getLeagues();
  const idx = leagues.findIndex((l) => l.slug === slug);
  if (idx === -1) return null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, passwordSalt, ...rest } = leagues[idx]!;
  const cleared = rest as League;
  const updated = leagues.map((l, i) => (i === idx ? cleared : l));
  await setAppState(REGISTRY_SCOPE, REGISTRY_KEY, updated);
  return cleared;
}

export async function removeLeague(slug: string): Promise<{ removed: boolean; leagues: League[] }> {
  const leagues = await getLeagues();
  const idx = leagues.findIndex((l) => l.slug === slug);
  if (idx === -1) return { removed: false, leagues };
  const updated = leagues.filter((l) => l.slug !== slug);
  await setAppState(REGISTRY_SCOPE, REGISTRY_KEY, updated);
  return { removed: true, leagues: updated };
}
