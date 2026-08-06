import { isStructurallyValidSeasonYear, TEST_LEAGUE_SLUG, type League } from './league.ts';

/**
 * PLATFORM-086F2B — the ONE season-rollover target-selection policy, shared by
 * the automatic cron (`/api/cron/season-rollover`) and the manual admin route
 * (`/api/admin/rollover`) so the two can never diverge on which leagues a
 * rollover may touch.
 */

// The demo league is excluded from global rollover. `TEST_LEAGUE_SLUG` lives in
// `league.ts` (PLATFORM-086F2H1T1); it is deliberately NOT re-exported here —
// no module ever imported it from this one.

export type RolloverYearGroup = {
  year: number;
  leagues: League[];
};

/**
 * PLATFORM-086F2H1R4 — the run-scoped surface this policy publishes refusals
 * into AS IT COUNTS THEM, rather than returning them after the loop.
 *
 * AGENTS.md requires the refusal count to survive a mid-loop throw, and the
 * grouping loop is exactly a loop that can throw: the registry array is typed
 * `League[]` but nothing validates each element, so a non-object member throws
 * on property access. A count returned only on the normal path is discarded
 * whenever a later record throws, and the caller then reports zero refusals on
 * a run that found them.
 *
 * The return value stays `RolloverYearGroup[]`: two callers with different
 * contracts consume it, and a sink keeps the count out of a shape they would
 * otherwise both have to thread. Counted per LEAGUE RECORD, not per distinct
 * unusable value — there is no usable year to deduplicate records by.
 */
export type RolloverRefusalSink = {
  invalidLifecycleTargets: number;
};

/**
 * Group the supplied league records into per-year rollover targets. No I/O;
 * callers pass the registry snapshot they already read, and the only effect is
 * publishing refusals into the caller's sink as they are counted.
 *
 * Policy, in this exact order:
 *   - the `test` league is excluded;
 *   - only leagues whose `status.state === 'season'` are targets (offseason,
 *     preseason, and legacy missing-status records are never rolled);
 *   - a surviving PRODUCTION candidate's `status.year` is validated
 *     structurally (PLATFORM-086F2H1R4) and refused if unusable;
 *   - grouping is exclusively by `status.year` — never the top-level
 *     `league.year`, never the first registered league, never the calendar;
 *   - groups are returned in deterministic ascending year order.
 *
 * The demo-then-validity ORDER is load-bearing, as it was in T3/T4: an active
 * demo record carrying an unusable year must stay a demo exclusion, never an
 * invalid production target.
 *
 * Rollover is the slice where this validation matters most, because it is the
 * only one of the four that WRITES durable data derived from the year:
 * `saveSeasonArchive` keys on `String(archive.year)`, so an unusable year would
 * mint a permanent, TTL-less archive under a key like `2026.5` or `undefined`.
 * The other three jobs' worst case was a billed provider call and a false
 * report — both observable and recoverable. This one is not.
 */
export function groupRolloverTargets(
  leagues: League[],
  // REQUIRED: a defaulted or optional sink would let a caller silently record
  // zero refusals with no compiler signal.
  refusals: RolloverRefusalSink
): RolloverYearGroup[] {
  const byYear = new Map<number, League[]>();
  for (const league of leagues) {
    if (league.slug === TEST_LEAGUE_SLUG) continue;
    const status = league.status;
    if (!status || status.state !== 'season') continue;
    if (!isStructurallyValidSeasonYear(status.year)) {
      // Published on the caller's state IMMEDIATELY, not accumulated locally: a
      // later record that throws must not discard a refusal already observed.
      refusals.invalidLifecycleTargets += 1;
      continue;
    }
    const group = byYear.get(status.year) ?? [];
    group.push(league);
    byYear.set(status.year, group);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => a - b)
    .map(([year, group]) => ({ year, leagues: group }));
}
