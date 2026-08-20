import type { StandingsHistory } from '../standingsHistory';

export type ResolvedStandingsWeeks = {
  resolvedWeeks: number[];
  latestResolvedWeek: number | null;
  previousResolvedWeek: number | null;
};

/**
 * PLATFORM-105 — has the week been played?
 *
 * `played === false` is decisive. `undefined` means the snapshot predates the
 * field, which only durable season archives do, and an archive is a completed
 * season; see the note on `StandingsHistoryWeekSnapshot.played`.
 */
export function isPlayedWeek(standingsHistory: StandingsHistory, week: number): boolean {
  return standingsHistory.byWeek[week]?.played !== false;
}

/**
 * Every week that has been played, in order. SEPARATE from the resolved weeks
 * below: a week can be played and still have incomplete coverage, and those are
 * different facts. Fusing them is what let an unplayed week close a season.
 */
export function selectPlayedWeeks(standingsHistory: StandingsHistory): number[] {
  return standingsHistory.weeks.filter((week) => isPlayedWeek(standingsHistory, week));
}

function isResolvedWeek(standingsHistory: StandingsHistory, week: number): boolean {
  const snapshot = standingsHistory.byWeek[week];
  if (!snapshot) return false;
  // A week that has not happened has nothing to resolve. Its coverage reads
  // `complete` — no game it calls final is missing a score, because it has no
  // final games — which is precisely how every unplayed week counted as
  // resolved and a season in progress reported itself over from week one.
  if (!isPlayedWeek(standingsHistory, week)) return false;
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
