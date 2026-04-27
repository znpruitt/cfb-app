import type { StandingsHistory } from '../standingsHistory';
import { selectResolvedStandingsWeeks } from './historyResolution';

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

  const hasUnresolvedWeeks = resolvedWeeks.length < standingsHistory.weeks.length;
  if (!hasUnresolvedWeeks) return 'final';

  if (latestResolvedWeek >= POSTSEASON_START_WEEK) return 'postseason';

  return 'in-season';
}
