import { TEST_LEAGUE_SLUG, type League } from './league.ts';

/**
 * PLATFORM-086F2B — the ONE season-rollover target-selection policy, shared by
 * the automatic cron (`/api/cron/season-rollover`) and the manual admin route
 * (`/api/admin/rollover`) so the two can never diverge on which leagues a
 * rollover may touch.
 */

/**
 * Test league is excluded from global rollover — it has its own independent
 * lifecycle controls. Re-exported from `league.ts` (its canonical home) so
 * existing importers keep working.
 */
export { TEST_LEAGUE_SLUG };

export type RolloverYearGroup = {
  year: number;
  leagues: League[];
};

/**
 * Group the supplied league records into per-year rollover targets. Pure — no
 * I/O; callers pass the registry snapshot they already read.
 *
 * Policy:
 *   - the `test` league is excluded;
 *   - only leagues whose `status.state === 'season'` are targets (offseason,
 *     preseason, and legacy missing-status records are never rolled);
 *   - grouping is exclusively by `status.year` — never the top-level
 *     `league.year`, never the first registered league, never the calendar;
 *   - groups are returned in deterministic ascending year order.
 */
export function groupRolloverTargets(leagues: League[]): RolloverYearGroup[] {
  const byYear = new Map<number, League[]>();
  for (const league of leagues) {
    if (league.slug === TEST_LEAGUE_SLUG) continue;
    const status = league.status;
    if (!status || status.state !== 'season') continue;
    const group = byYear.get(status.year) ?? [];
    group.push(league);
    byYear.set(status.year, group);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, group]) => ({ year, leagues: group }));
}
