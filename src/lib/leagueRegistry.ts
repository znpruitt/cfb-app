import { cache } from 'react';

import { getAppState, withAppStateKeyTransaction } from './server/appStateStore.ts';
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

/**
 * Serialize every registry read-modify-write on the ONE registry key
 * (PLATFORM-086F2B, Codex review). The registry is a whole-array record, so two
 * concurrent mutators reading the same snapshot would drop one another's update
 * on the final write (e.g. independent per-year rollovers, or a rollover racing
 * a preseason action). `withAppStateKeyTransaction` holds the per-key advisory
 * lock across the read → mutate → write cycle on both store backends.
 */
async function mutateRegistry<T>(
  fn: (leagues: League[]) => { next?: League[]; result: T }
): Promise<T> {
  return withAppStateKeyTransaction(REGISTRY_SCOPE, REGISTRY_KEY, async (txn) => {
    const record = await txn.read<League[]>();
    const leagues = Array.isArray(record?.value) ? record.value : [];
    const { next, result } = fn(leagues);
    if (next) await txn.write(next);
    return result;
  });
}

export async function addLeague(league: League): Promise<League[]> {
  return mutateRegistry((leagues) => {
    if (leagues.some((l) => l.slug === league.slug)) {
      throw new Error(`League with slug '${league.slug}' already exists`);
    }
    const updated = [...leagues, league];
    return { next: updated, result: updated };
  });
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
  return mutateRegistry((leagues) => {
    const idx = leagues.findIndex((l) => l.slug === slug);
    if (idx === -1) return { result: null };
    const updated = leagues.map((l, i) => (i === idx ? { ...l, ...updates } : l));
    return { next: updated, result: updated[idx]! };
  });
}

/**
 * The last authoritative season year of a record — the year its lifecycle
 * status carries when one exists (season/preseason), else the stored top-level
 * projection. Entering offseason writes THIS year into `league.year`, so a
 * previously desynchronized top-level year (possible on legacy records) is
 * healed rather than carried forward into the next `beginPreseason` increment.
 */
function lastAuthoritativeYear(league: League): number {
  return league.status && league.status.state !== 'offseason' ? league.status.year : league.year;
}

/**
 * The single lifecycle mutation authority (PLATFORM-086F2B). Performs ONE
 * serialized registry write per call:
 *
 *   - `season` / `preseason` → sets `status` AND synchronizes the top-level
 *     `league.year` to `status.year` in the same written record;
 *   - `offseason` → sets `status` and writes the last authoritative season
 *     year (the outgoing `status.year` when present) into `league.year` — the
 *     archived-season compatibility projection.
 *
 * Because both fields land in one transactional write, a failed registry write
 * can never leave `status.year` and `league.year` partially synchronized.
 */
export async function updateLeagueStatus(
  slug: string,
  status: LeagueStatus
): Promise<League | null> {
  return mutateRegistry((leagues) => {
    const idx = leagues.findIndex((l) => l.slug === slug);
    if (idx === -1) return { result: null };
    const current = leagues[idx]!;
    const next: League =
      status.state === 'offseason'
        ? { ...current, status, year: lastAuthoritativeYear(current) }
        : { ...current, status, year: status.year };
    const updated = leagues.map((l, i) => (i === idx ? next : l));
    return { next: updated, result: next };
  });
}

export type SeasonRolloverTransition =
  | { outcome: 'transitioned'; league: League }
  | { outcome: 'not-in-target-season'; league: League | null };

/**
 * The GUARDED season→offseason rollover transition (PLATFORM-086F2B, Codex
 * review): inside the serialized registry transaction, the league must STILL be
 * in `season` for the exact requested year — a rollover request that captured
 * its target group before lengthy archive work can never clobber a league that
 * another actor has since rolled over and advanced to preseason. A refusal is a
 * typed outcome (the caller reports it as a status-stage failure), never a
 * silent overwrite.
 */
export async function completeSeasonRollover(
  slug: string,
  year: number
): Promise<SeasonRolloverTransition> {
  return mutateRegistry<SeasonRolloverTransition>((leagues) => {
    const idx = leagues.findIndex((l) => l.slug === slug);
    if (idx === -1) return { result: { outcome: 'not-in-target-season', league: null } };
    const current = leagues[idx]!;
    if (current.status?.state !== 'season' || current.status.year !== year) {
      return { result: { outcome: 'not-in-target-season', league: current } };
    }
    const next: League = { ...current, status: { state: 'offseason' }, year };
    const updated = leagues.map((l, i) => (i === idx ? next : l));
    return { next: updated, result: { outcome: 'transitioned', league: next } };
  });
}

/**
 * Remove the password credentials from a league, reverting it to public. Uses
 * explicit rest-destructuring so the persisted record no longer carries the
 * `passwordHash` / `passwordSalt` keys at all (rather than setting them to
 * `undefined`, which leaves the keys present in memory even though JSON
 * serialization would drop them).
 */
export async function clearLeaguePassword(slug: string): Promise<League | null> {
  return mutateRegistry((leagues) => {
    const idx = leagues.findIndex((l) => l.slug === slug);
    if (idx === -1) return { result: null };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, passwordSalt, ...rest } = leagues[idx]!;
    const cleared = rest as League;
    const updated = leagues.map((l, i) => (i === idx ? cleared : l));
    return { next: updated, result: cleared };
  });
}

export async function removeLeague(slug: string): Promise<{ removed: boolean; leagues: League[] }> {
  return mutateRegistry<{ removed: boolean; leagues: League[] }>((leagues) => {
    const idx = leagues.findIndex((l) => l.slug === slug);
    if (idx === -1) return { result: { removed: false, leagues } };
    const updated = leagues.filter((l) => l.slug !== slug);
    return { next: updated, result: { removed: true, leagues: updated } };
  });
}
