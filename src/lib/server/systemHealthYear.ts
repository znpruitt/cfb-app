/**
 * PLATFORM-086F2G / PLATFORM-086F2H1T5 — resolve the OPERATIONAL season year for
 * System Health.
 *
 * System Health is a current-status surface, not a historical year browser: the
 * scheduler, automation, quota, and storage FACTS are current/global, and only
 * the provider-domain inputs are season-scoped. The operational year is
 * therefore resolved SERVER-SIDE from authoritative league-registry lifecycle
 * state and is NEVER selected by the caller (no `?year=` seam).
 *
 * Note the year is not confined to the provider-data panel: the issues and
 * freshness derived from those year-scoped inputs feed `overallState`,
 * `issueCounts`, and the headline Overall tile. A wrong year can both fabricate
 * faults for the year it names AND hide genuine provider-refresh failures for
 * the year it displaced (activity is eligible only when its scope year matches).
 * That is why selecting the year correctly matters beyond one panel.
 *
 * PLATFORM-086F2H1T5 — PRODUCTION leagues alone select the year. The demo league
 * is manual-only for every automation job (F2H1T2 transition, F2H1T3 weekly
 * schedule, F2H1T4 rankings; rollover already excluded it), so a year only the
 * demo occupies is serviced by nothing and would report permanently missing or
 * stale provider data.
 *
 * Rule (deterministic), over PRODUCTION leagues only:
 *   1. Among production leagues whose lifecycle state is `preseason` or
 *      `season`, take the highest `status.year` (the lifecycle authority — never
 *      `league.year` for an active/preseason league).
 *   2. Otherwise the highest stored production `league.year`.
 *   3. Otherwise the calendar season-for-today.
 * The result is clamped to [2000, current UTC year + 1].
 *
 * The exclusion is UNCONDITIONAL — deliberately unlike the F2H1T3/F2H1T4 shape,
 * which gates on an active lifecycle state. Those jobs gate because an
 * `offseason` demo was never an automatic TARGET, so flagging it would falsify
 * their zero-target reason. Here both branches read the registry, and the second
 * reads the top-level `league.year`, which `applyLifecycleStatus` keeps
 * synchronized to the demo's lifecycle and RETAINS when the demo moves to
 * `offseason`. An active-only exclusion would therefore leave a demo parked in
 * offseason still selecting the year. Offseason and status-less demo records
 * must be excluded too.
 *
 * The predicate is slug-only: it never reads a demo `year`, so an unvalidated
 * legacy value cannot influence resolution before the demo is rejected. A record
 * whose `slug` is not the demo slug is treated as production, which fails toward
 * production rather than letting a corrupt record gain demo-like influence.
 *
 * SCOPE NOTE: this removes demo INFLUENCE. It does not promise the resolved year
 * is one automation maintains — an all-offseason registry resolves to the last
 * authoritative production projection, and a registry with no production league
 * resolves to the calendar season. Either may still need manual provider-data
 * preparation. Year VALIDITY (`Number.isInteger` admits structurally unusable
 * values that the clamp can then launder into a plausible year) is F2H1R's, not
 * this slice's.
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
