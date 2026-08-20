import type { StandingsHistory } from '../standingsHistory';
import { selectPlayedWeeks, selectResolvedStandingsWeeks } from './historyResolution';

export type SeasonContext = 'in-season' | 'postseason' | 'final';

// FBS regular season is 15 weeks; conference championships and first-round
// playoff games begin in week 16. This constant is stable for standard schedules.
// If non-standard schedules (< 15 regular-season weeks) become a concern, derive
// this from schedule game stages instead of using a fixed value.
const POSTSEASON_START_WEEK = 16;

export function selectSeasonContext(args: {
  standingsHistory: StandingsHistory | null;
}): SeasonContext {
  const { standingsHistory } = args;
  if (!standingsHistory || standingsHistory.weeks.length === 0) return 'in-season';

  const { resolvedWeeks, latestResolvedWeek } = selectResolvedStandingsWeeks(standingsHistory);
  if (resolvedWeeks.length === 0 || latestResolvedWeek == null) return 'in-season';

  // PLATFORM-105 — "the season is over" asks whether any football REMAINS, and
  // that is a question about weeks being PLAYED. It used to ask whether any week
  // was unresolved, which fuses it with coverage: a finished season with one
  // week whose scores never attached read as in-season, and — the direction that
  // actually bit, on every league from the first Saturday — a season with
  // thirteen weeks still to play read as `final`, because an unplayed week has
  // no missing scores.
  const playedWeeks = selectPlayedWeeks(standingsHistory);
  const seasonOver = playedWeeks.length === standingsHistory.weeks.length;
  if (seasonOver) return 'final';

  if (latestResolvedWeek >= POSTSEASON_START_WEEK) return 'postseason';

  return 'in-season';
}
