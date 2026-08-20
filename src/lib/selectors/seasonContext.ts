import type { StandingsHistory } from '../standingsHistory';
import { selectPlayedWeeks } from './historyResolution';

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

  // PLATFORM-105 — BOTH finality and phase come from PLAYED weeks. The first
  // round moved only the finality test and left the early guard and the
  // postseason branch on `latestResolvedWeek`, so a played week 16 with partial
  // score coverage still read `in-season`, and a finished season with a coverage
  // gap in every week did too — the exact defect item 52 originally described,
  // surviving inside its own fix.
  //
  // Resolved weeks are for usable standings SNAPSHOTS. Progress is a different
  // question and no longer borrows that answer.
  const playedWeeks = selectPlayedWeeks(standingsHistory);
  if (playedWeeks.length === 0) return 'in-season';

  if (playedWeeks.length === standingsHistory.weeks.length) return 'final';

  const latestPlayedWeek = playedWeeks[playedWeeks.length - 1]!;
  if (latestPlayedWeek >= POSTSEASON_START_WEEK) return 'postseason';

  return 'in-season';
}
