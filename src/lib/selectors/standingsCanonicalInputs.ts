import type { CanonicalStandings } from './leagueStandings';
import type { OwnerStandingsRow, StandingsCoverage } from '../standings';
import type { StandingsHistory } from '../standingsHistory';

/**
 * Conservative coverage returned when a canonical snapshot is supplied but its
 * required `coverage` is missing/null at runtime. We do NOT silently fall back
 * to client coverage in that case — a malformed canonical snapshot must not be
 * papered over with schedule-derived coverage.
 *
 * Standings-local by design: kept separate from the Overview equivalent so the
 * two surfaces stay decoupled (per PLATFORM-049 scope).
 */
export const STANDINGS_COVERAGE_UNAVAILABLE: StandingsCoverage = {
  state: 'error',
  message: 'Standings coverage is unavailable.',
};

/**
 * Resolves which standings rows/history/coverage the Standings surface renders.
 *
 * Canonical is preferred: when a canonical snapshot is supplied, its `rows`
 * (even when empty), its `standingsHistory` (even when null), and its `coverage`
 * are used — never the client-derived equivalents. When canonical is supplied
 * but `coverage` is missing/null at runtime, `STANDINGS_COVERAGE_UNAVAILABLE`
 * is returned (defensive; the type keeps `coverage` required). The client-derived
 * `rows`/`standingsHistory`/`coverage` are used only when NO canonical snapshot is
 * supplied (`undefined`/`null`, e.g. routes not yet loading canonical).
 *
 * Coverage affects only the top warning paragraph/error styling; it never
 * influences row selection, sorting, movement/history, or liveDelta badges.
 */
export function resolveStandingsCanonicalInputs(params: {
  canonicalStandings?: CanonicalStandings | null;
  rows: OwnerStandingsRow[];
  standingsHistory?: StandingsHistory | null;
  coverage: StandingsCoverage;
}): { rows: OwnerStandingsRow[]; history: StandingsHistory | null; coverage: StandingsCoverage } {
  const { canonicalStandings, rows, standingsHistory = null, coverage } = params;
  return {
    rows: canonicalStandings?.rows ?? rows,
    history: canonicalStandings ? canonicalStandings.standingsHistory : (standingsHistory ?? null),
    coverage: canonicalStandings
      ? (canonicalStandings.coverage ?? STANDINGS_COVERAGE_UNAVAILABLE)
      : coverage,
  };
}
