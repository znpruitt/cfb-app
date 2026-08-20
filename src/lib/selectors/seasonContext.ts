import { hasGameBeenAbandoned, type StandingsHistory } from '../standingsHistory';
import { selectPlayedWeeks } from './historyResolution';

export type SeasonContext = 'in-season' | 'postseason' | 'final';

// FBS regular season is 15 weeks; conference championships and first-round
// playoff games begin in week 16. This constant is stable for standard schedules.
// If non-standard schedules (< 15 regular-season weeks) become a concern, derive
// this from schedule game stages instead of using a fixed value.
const POSTSEASON_START_WEEK = 16;

export function selectSeasonContext(args: {
  standingsHistory: StandingsHistory | null;
  /**
   * Evaluation time for the abandonment allowance. Defaults to now; passed
   * explicitly by tests, and by any caller replaying a past moment.
   */
  now?: Date;
}): SeasonContext {
  const { standingsHistory, now } = args;
  if (!standingsHistory || standingsHistory.weeks.length === 0) return 'in-season';

  // PLATFORM-105 — BOTH finality and phase come from PLAYED weeks. The first
  // round moved only the finality test and left the early guard and the
  // postseason branch on `latestResolvedWeek`, so a played week 16 with partial
  // score coverage still read `in-season`, and a finished season with a coverage
  // gap in every week did too — the exact defect item 52 originally described,
  // surviving inside its own fix.
  //
  // Resolved weeks are for usable standings SNAPSHOTS. Progress is a different
  // question and no longer borrows that answer.
  // SEASON-OVER IS A QUESTION ABOUT GAMES (owner ruling, 2026-08-20): the season
  // is over when every REAL game has a result. Asking it week-by-week is what let
  // an all-shell playoff week block a season that had finished, and it re-fused
  // the two questions this module exists to separate.
  //
  // The abandonment allowance is applied HERE, at request time, from the
  // time-invariant `pending` list on each snapshot — never inside the cached
  // selector, per AGENTS.md invariant 3.
  const evaluatedAt = now ?? new Date();
  const unresolved = standingsHistory.weeks.flatMap(
    (week) => standingsHistory.byWeek[week]?.pending ?? []
  );
  if (unresolved.every((game) => hasGameBeenAbandoned(game, evaluatedAt))) return 'final';

  const playedWeeks = selectPlayedWeeks(standingsHistory);
  if (playedWeeks.length === 0) return 'in-season';

  const latestPlayedWeek = playedWeeks[playedWeeks.length - 1]!;
  if (latestPlayedWeek >= POSTSEASON_START_WEEK) return 'postseason';

  return 'in-season';
}
