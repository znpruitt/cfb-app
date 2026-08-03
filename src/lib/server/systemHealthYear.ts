/**
 * PLATFORM-086F2G — resolve the OPERATIONAL season year for System Health.
 *
 * System Health is a current-status surface, not a historical year browser: the
 * scheduler, automation, quota, and storage facts are current/global, and only
 * the provider-data axis is season-scoped. The operational year is therefore
 * resolved SERVER-SIDE from authoritative league-registry lifecycle state and is
 * NEVER selected by the caller (no `?year=` seam).
 *
 * Rule (deterministic):
 *   1. Among leagues whose lifecycle state is `preseason` or `season`, take the
 *      highest `status.year` (the lifecycle authority — never `league.year` for
 *      an active/preseason league).
 *   2. Otherwise the highest stored `league.year`.
 *   3. Otherwise the calendar season-for-today.
 * The result is clamped to [2000, current UTC year + 1].
 */

import type { League } from '../league.ts';
import { seasonYearForToday } from '../scores/normalizers.ts';

const MIN_YEAR = 2000;

function clamp(year: number, maxYear: number): number {
  if (year < MIN_YEAR) return MIN_YEAR;
  if (year > maxYear) return maxYear;
  return year;
}

export function resolveOperationalSeasonYear(params: { leagues: League[]; nowMs: number }): number {
  const { leagues, nowMs } = params;
  const maxYear = new Date(nowMs).getUTCFullYear() + 1;

  const active = leagues
    .filter((l) => l.status?.state === 'preseason' || l.status?.state === 'season')
    .map((l) => (l.status && l.status.state !== 'offseason' ? l.status.year : l.year))
    .filter((y) => Number.isInteger(y));
  if (active.length > 0) return clamp(Math.max(...active), maxYear);

  const anyYears = leagues.map((l) => l.year).filter((y) => Number.isInteger(y));
  if (anyYears.length > 0) return clamp(Math.max(...anyYears), maxYear);

  return clamp(seasonYearForToday(new Date(nowMs)), maxYear);
}
