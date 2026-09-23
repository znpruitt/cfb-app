/**
 * PLATFORM-757a — the ONE registry-driven selector for "which season years are
 * active", shared by every automation job that needs the answer.
 *
 * ## Why this is its own module
 *
 * This logic was written for the automatic rankings cron and lived in
 * `rankings/automaticContext.ts` as `selectRankingsTargetYears`. It is not
 * rankings policy: it is the league registry's own definition of an active
 * season year, and the standalone schedule-presentation job (#757a) needs the
 * identical answer. Importing a `rankings`-named function into a presentation
 * job would have worked and read as a mistake; copying it would have created a
 * third spelling of "which years are active", which is the shape
 * [#838](https://github.com/znpruitt/cfb-app/issues/838) came from.
 *
 * **A second spelling still exists and is NOT unified here.** The weekly
 * schedule cron carries its own inline copy of this loop
 * (`app/api/cron/schedule-refresh/route.ts`), and `rolloverTargeting.ts` a third
 * variant. Owner decision 2026-09-22: out of scope for #757a, tracked as
 * [#858](https://github.com/znpruitt/cfb-app/issues/858). This module is where
 * they converge when it is done, not a claim that they already have.
 *
 * ## What the selection IS
 *
 * Target years come ONLY from the durable league registry — `preseason` and
 * `season` lifecycle states, grouped by `status.year`, ascending; never from the
 * calendar and never from `league.year`. A year held by both states resolves to
 * `season`.
 *
 * Pure: the caller owns the registry read and its failure handling.
 */

import { isStructurallyValidSeasonYear, TEST_LEAGUE_SLUG, type League } from './league.ts';

export type ActiveSeasonLifecycle = 'preseason' | 'season';

export type ActiveSeasonTargetYear = {
  year: number;
  lifecycle: ActiveSeasonLifecycle;
};

/**
 * The closed result of target selection: the production-owned target years plus
 * the one fact the caller cannot re-derive from them — whether an otherwise
 * eligible demo target was excluded. Both are produced by the SAME loop, so a
 * caller can never observe years without the exclusion truth that shaped them.
 */
export type ActiveSeasonTargetSelection = {
  years: ActiveSeasonTargetYear[];
  /** True when an ACTIVE demo league was excluded from selection. */
  excludedDemoCandidate: boolean;
};

/**
 * PLATFORM-086F2H1R3 — the run-scoped surface the selector publishes refusals
 * into AS IT COUNTS THEM, rather than returning them after the loop.
 *
 * This is not a style choice. AGENTS.md requires the refusal count to survive a
 * mid-loop throw, and the ownership loop is exactly a loop that can throw: the
 * registry array is typed `League[]` but nothing validates each element, so a
 * non-object member throws on property access. A count returned only on the
 * normal path is discarded whenever a later record throws, and the caller then
 * reports zero refusals on a run that found them — on the response, the runtime
 * event, AND the receipt.
 *
 * Deliberately NOT also on the return value: two channels for one fact can
 * drift, and a caller that read both would double-count. The sink is the single
 * source of truth. Counted per LEAGUE RECORD, not per distinct raw year — three
 * records sharing one unusable year count three, because there is no usable
 * year to deduplicate them by in the first place.
 */
export type ActiveSeasonRefusalSink = { invalidLifecycleTargets: number };

/**
 * Select the distinct active season years from the league registry.
 *
 * ## The demo exclusion, and why it is PER LEAGUE
 *
 * PLATFORM-086F2H1T4 — the demo league is MANUAL-ONLY for automatic work, so
 * ownership resolves from PRODUCTION leagues alone.
 *
 * `TEST_LEAGUE_SLUG` is filtered PER LEAGUE, inside this loop, before the league
 * can contribute year membership or lifecycle precedence. It cannot be filtered
 * against the returned `years`: that would drop an entire year a PRODUCTION
 * league also occupies, removing its automatic work — a worse regression than
 * the one this fixes.
 *
 * The DEMO EXCLUSION FLAG is derived from `slug` and `status.state` ONLY — never
 * from `status.year`. That narrow property is what makes the ordering below
 * safe. It is NOT the broader claim that an unvalidated year cannot affect the
 * caller's zero-target reason: it plainly can, by producing the caller's
 * unusable-year reason. What survives is that a bad year cannot masquerade as,
 * or suppress, the DEMO reason.
 *
 * ## The validity refusal, and why it comes SECOND
 *
 * PLATFORM-086F2H1R3 — an active PRODUCTION candidate's `status.year` is
 * validated structurally, AFTER the demo exclusion. The order is load-bearing in
 * one direction: an active DEMO record carrying an unusable year must stay a
 * demo exclusion, so the caller keeps reporting its demo reason. Validating
 * first would count it as an invalid production target and undo F2H1T4's reason.
 *
 * `status.year` arrives here straight from durable JSON — `getLeagues()`
 * performs no per-record validation — so before this guard an unusable year
 * became a map key and owned real automated work. What that work then did with
 * it is caller-specific and documented at each call site; the guard is shared
 * because the hazard is.
 *
 * Offseason and status-less PRODUCTION records are NOT counted: they were never
 * candidates, exactly as they were never targets.
 */
export function selectActiveSeasonTargetYears(
  leagues: readonly League[],
  // REQUIRED: a defaulted or optional sink would let a caller silently record
  // zero refusals with no compiler signal.
  refusals: ActiveSeasonRefusalSink
): ActiveSeasonTargetSelection {
  const lifecycleByYear = new Map<number, ActiveSeasonLifecycle>();
  let excludedDemoCandidate = false;
  for (const league of leagues) {
    const status = league.status;
    const isActive = status?.state === 'season' || status?.state === 'preseason';

    // An `offseason` (or status-less) demo record is not an excluded CANDIDATE —
    // it was never eligible. Setting the flag on the slug alone would make every
    // empty-target run report the demo reason and leave the plain no-target
    // reason unreachable, which is exactly the falsehood this guard avoids.
    if (isActive && league.slug === TEST_LEAGUE_SLUG) {
      excludedDemoCandidate = true;
      continue;
    }

    if (isActive && !isStructurallyValidSeasonYear(status.year)) {
      // Published on the RUN STATE immediately, not accumulated locally: a later
      // record that throws must not discard a refusal already observed.
      refusals.invalidLifecycleTargets += 1;
      continue;
    }

    if (status?.state === 'season') {
      lifecycleByYear.set(status.year, 'season');
    } else if (status?.state === 'preseason' && lifecycleByYear.get(status.year) !== 'season') {
      lifecycleByYear.set(status.year, 'preseason');
    }
  }
  return {
    years: [...lifecycleByYear.entries()]
      .map(([year, lifecycle]) => ({ year, lifecycle }))
      .sort((a, b) => a.year - b.year),
    excludedDemoCandidate,
  };
}
