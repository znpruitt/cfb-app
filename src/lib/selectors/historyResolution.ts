import type { StandingsHistory } from '../standingsHistory';

export type ResolvedStandingsWeeks = {
  resolvedWeeks: number[];
  latestResolvedWeek: number | null;
  previousResolvedWeek: number | null;
};

/**
 * PLATFORM-105 — has the week been played?
 *
 * `played === false` is decisive. `undefined` means the snapshot carries no
 * progress flag, which is the case for durable season archives — they are
 * completed seasons by definition and `buildSeasonArchive` strips the field
 * rather than freezing a live signal into storage.
 *
 * An earlier version of this comment said absent "means the snapshot predates
 * the field", which `/code-review` pointed out would stop being true the moment
 * the next archive was written. Archives now carry no flag by construction, so
 * the reasoning matches the code instead of racing it.
 */
export function isPlayedWeek(standingsHistory: StandingsHistory, week: number): boolean {
  const snapshot = standingsHistory.byWeek[week];
  // A week with no snapshot is not played, matching `isResolvedWeek` two
  // functions down. The first round returned TRUE here, so a history whose
  // `weeks` and `byWeek` diverge — a truncated or hand-built record — counted
  // the missing week toward the season being over.
  if (!snapshot) return false;
  return snapshot.played !== false;
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

/**
 * The history restricted to its RESOLVED weeks, optionally to the last `n` of
 * them.
 *
 * Every trend surface draws from resolved weeks, but not every one of them said
 * so. `MiniTrendsGrid` takes its x-axis domain from `standingsHistory.weeks`, so
 * a caller that hands it the raw history gets a labelled gridline for each week
 * the selectors will then decline to populate — a `W14`/`W15` column with no
 * line behind it, which is the archive half of POLISH-013.
 *
 * Resolved rather than merely played: a played week whose coverage is incomplete
 * is dropped by the trend selectors, so slicing on `played` alone still leaves a
 * labelled column with no series behind it.
 *
 * Moved here from `OverviewPanel` in POLISH-013. It was a derivation living in a
 * client component (AGENTS.md core rule 9), which is also why the archive call
 * site could not reach it.
 */
export function sliceStandingsHistoryToResolvedWeeks(
  history: StandingsHistory,
  options?: { last?: number }
): StandingsHistory {
  const resolved = selectResolvedStandingsWeeks(history).resolvedWeeks;
  const last = options?.last;
  // `slice(-0)` is `slice(0)` — the WHOLE array — so an explicit request for zero
  // recent weeks used to return every resolved week. Review caught it; no caller
  // passes 0 today, but this is a shared helper with a public wrapper.
  const weeks = typeof last === 'number' ? (last > 0 ? resolved.slice(-last) : []) : resolved;
  const weekSet = new Set(weeks);
  return {
    weeks,
    byWeek: Object.fromEntries(
      Object.entries(history.byWeek).filter(([week]) => weekSet.has(Number(week)))
    ),
    byOwner: Object.fromEntries(
      Object.entries(history.byOwner).map(([owner, points]) => [
        owner,
        points.filter((point) => weekSet.has(point.week)),
      ])
    ),
  };
}

/**
 * The history with its TRAILING unresolved weeks removed, and nothing else.
 *
 * POLISH-013 remediation. Slicing an archive to only its resolved weeks fixed the
 * reported defect — trailing `W14`/`W15` gridlines with no line behind them — and
 * introduced a quieter one: `MiniTrendsGrid` spaces gridlines by array INDEX, not
 * by week number, so dropping an unresolved week in the MIDDLE renders its
 * neighbours adjacent. An archived season whose week 7 never reached complete
 * coverage would show W6 and W8 side by side, and a two-week swing would read as
 * a one-week swing.
 *
 * The reported defect is entirely about the TAIL, so only the tail is trimmed.
 * Interior gaps stay where they are, at their true x positions, with no series
 * drawn across them.
 */
export function trimTrailingUnresolvedWeeks(history: StandingsHistory): StandingsHistory {
  const { latestResolvedWeek } = selectResolvedStandingsWeeks(history);
  if (latestResolvedWeek === null) return { weeks: [], byWeek: {}, byOwner: {} };

  const weeks = history.weeks.filter((week) => week <= latestResolvedWeek);
  const weekSet = new Set(weeks);
  return {
    weeks,
    byWeek: Object.fromEntries(
      Object.entries(history.byWeek).filter(([week]) => weekSet.has(Number(week)))
    ),
    byOwner: Object.fromEntries(
      Object.entries(history.byOwner).map(([owner, points]) => [
        owner,
        points.filter((point) => weekSet.has(point.week)),
      ])
    ),
  };
}
