import type { StandingsHistory } from '../standingsHistory';
import { selectResolvedStandingsWeeks } from './historyResolution';

export type SeasonContext = 'in-season' | 'postseason' | 'final';

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
