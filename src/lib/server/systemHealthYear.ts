/**
 * PLATFORM-086F2G / PLATFORM-086F2H1T5 — resolve the OPERATIONAL season year for
 * System Health.
 *
 * System Health is a current-status surface, not a historical year browser. The
 * year is resolved SERVER-SIDE from authoritative league-registry lifecycle
 * state and is NEVER selected by the caller (no `?year=` seam).
 *
 * Rule (deterministic), over PRODUCTION leagues only:
 *   1. Among production leagues in `preseason` or `season`, the highest
 *      `status.year` (the lifecycle authority — never `league.year` for an
 *      active league).
 *   2. Otherwise the highest stored production `league.year`.
 *   3. Otherwise the calendar season-for-today.
 * Clamped to [2000, current UTC year + 1].
 *
 * PLATFORM-086F2H1T5 — the demo league does not select the year. It is
 * manual-only for every lifecycle and provider automation job, so no job
 * maintains the SCHEDULE, RANKINGS, or LIFECYCLE of a year only it occupies.
 * (Narrower than "serviced by nothing": the live-scores, game-stats, and odds
 * jobs key off the calendar season and the canonical schedule, not the registry.)
 *
 * ONE THING TO GET RIGHT IF YOU EDIT THIS: the exclusion is UNCONDITIONAL.
 * Do NOT add the `isActive &&` gate the F2H1T3/F2H1T4 selectors use — here it is
 * a defect, and it is mutation-pinned as one. Those jobs gate because an
 * `offseason` demo was never an automatic TARGET. Here the stored-year branch
 * reads the top-level `league.year`, which `applyLifecycleStatus` keeps
 * synchronized to the demo's lifecycle and RETAINS on the move to `offseason`,
 * so an active-only exclusion leaves a demo parked in offseason still selecting
 * the year. Offseason and status-less demo records must be excluded too.
 *
 * The predicate is slug-only and never reads a demo `year`, so an unvalidated
 * legacy value cannot influence resolution before the demo is rejected; a record
 * whose slug is not the demo slug is treated as production, failing toward
 * production rather than letting corruption acquire demo-like influence.
 *
 * SCOPE: this removes demo INFLUENCE. It does not promise the resolved year is
 * one automation maintains — both fallbacks can land on a year needing manual
 * provider-data preparation. Year VALIDITY is F2H1R's, not this slice's.
 *
 * The binding rule lives in AGENTS.md (Lifecycle Authority invariant 2); the
 * operator-facing description is `docs/operations/diagnostics.md`.
 */

import { TEST_LEAGUE_SLUG, type League } from '../league.ts';
import { seasonYearForToday } from '../scores/normalizers.ts';

const MIN_YEAR = 2000;

function clamp(year: number, maxYear: number): number {
  if (year < MIN_YEAR) return MIN_YEAR;
  if (year > maxYear) return maxYear;
  return year;
}

/**
 * The three-step rule, applied to an ALREADY-FILTERED production population.
 * Private and taking only the filtered list, so the unfiltered registry is not
 * in lexical scope here — a one-branch exclusion becomes a structural edit
 * rather than a one-token slip the type system could not catch.
 */
function resolveFromProductionLeagues(leagues: League[], nowMs: number): number {
  const maxYear = new Date(nowMs).getUTCFullYear() + 1;

  const active = leagues
    .filter((l) => l.status?.state === 'preseason' || l.status?.state === 'season')
    // The `: l.year` arm is UNREACHABLE — the filter above already guarantees an
    // active state. It is retained as the type-narrowing device that lets this
    // read `status.year` at all (`filter` does not narrow the element type), and
    // is byte-identical to the pre-T5 expression so this move is provably
    // behavior-preserving. `league.year` never feeds the active branch.
    .map((l) => (l.status && l.status.state !== 'offseason' ? l.status.year : l.year))
    .filter((y) => Number.isInteger(y));
  if (active.length > 0) return clamp(Math.max(...active), maxYear);

  const anyYears = leagues.map((l) => l.year).filter((y) => Number.isInteger(y));
  if (anyYears.length > 0) return clamp(Math.max(...anyYears), maxYear);

  return clamp(seasonYearForToday(new Date(nowMs)), maxYear);
}

export function resolveOperationalSeasonYear(params: { leagues: League[]; nowMs: number }): number {
  const productionLeagues = params.leagues.filter((league) => league.slug !== TEST_LEAGUE_SLUG);
  return resolveFromProductionLeagues(productionLeagues, params.nowMs);
}
