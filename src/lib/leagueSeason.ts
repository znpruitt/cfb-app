import type { LeagueStatus } from './league.ts';

/**
 * Resolves the season year a league's client surfaces should use for
 * season-sensitive operations (schedule, scores, aliases, rankings, insights,
 * and season-scoped storage/cache keys).
 *
 * Precedence:
 *   1. `leagueStatus.year` when the status carries one (preseason / season) —
 *      the authoritative active-season signal.
 *   2. `leagueYear` — the league's stored active-season year.
 *   3. `defaultSeason` — global fallback, used only when no league-specific
 *      year is available (e.g. offseason with no stored league year).
 *
 * The key guarantee: active-season and offseason leagues must not silently fall
 * back to the global default when league-specific year information exists. This
 * helper is intentionally small and local — it is NOT a canonical standings
 * resolver.
 */
export function resolveLeagueSeason(params: {
  leagueStatus?: LeagueStatus;
  leagueYear?: number;
  defaultSeason: number;
}): number {
  const { leagueStatus, leagueYear, defaultSeason } = params;

  if (leagueStatus && 'year' in leagueStatus && Number.isFinite(leagueStatus.year)) {
    return leagueStatus.year;
  }

  if (typeof leagueYear === 'number' && Number.isFinite(leagueYear)) {
    return leagueYear;
  }

  return defaultSeason;
}
