import type { StandingsHistory } from '../standingsHistory';

export type ResolvedStandingsWeeks = {
  resolvedWeeks: number[];
  latestResolvedWeek: number | null;
  previousResolvedWeek: number | null;
};

function isResolvedWeek(standingsHistory: StandingsHistory, week: number): boolean {
  const snapshot = standingsHistory.byWeek[week];
  if (!snapshot) return false;
  if (snapshot.coverage.state !== 'complete') return false;
  return snapshot.standings.length > 0;
}

export function selectResolvedStandingsWeeks(
  standingsHistory: StandingsHistory
): ResolvedStandingsWeeks {
  const resolvedWeeks = standingsHistory.weeks.filter((week) =>
    isResolvedWeek(standingsHistory, week)
  );
  const latestResolvedWeek =
    resolvedWeeks.length > 0 ? resolvedWeeks[resolvedWeeks.length - 1]! : null;
  const previousResolvedWeek =
    resolvedWeeks.length > 1 ? resolvedWeeks[resolvedWeeks.length - 2]! : null;

  return {
    resolvedWeeks,
    latestResolvedWeek,
    previousResolvedWeek,
  };
}
