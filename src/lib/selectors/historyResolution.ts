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
 * The history with its unresolved EDGE weeks removed at BOTH ends, and the
 * interior left alone.
 *
 * `MiniTrendsGrid` takes its x-axis domain from `standingsHistory.weeks` and
 * labels a gridline for each one, but the trend selectors populate only RESOLVED
 * weeks. Any unresolved week at either edge is therefore a labelled column with
 * no line behind it — the defect POLISH-013 exists to close.
 *
 * Both ends, and the interior preserved, because each half was got wrong once:
 *
 *  - Slicing to ONLY the resolved weeks (the original) removed both edges but
 *    also closed interior gaps. The grid spaces gridlines by array INDEX, not by
 *    week number, so an archive missing week 7 rendered W6 and W8 adjacent and a
 *    two-week swing read as a one-week swing.
 *  - Trimming only the TAIL (the first remediation) preserved the interior and
 *    handed the leading edge straight back: weeks 1–2 of an archive that first
 *    resolved at week 3 were labelled with nothing drawn under them. Confirming
 *    review caught it, and it was verified by rendering.
 *
 * NOTE what an interior gap actually looks like: `buildPath` joins consecutive
 * points with `L`, so the line is DRAWN ACROSS the gap rather than broken at it —
 * weeks `[1,2,3]` resolving only 1 and 3 render one segment through the W2
 * gridline. An earlier version of this comment claimed the opposite. Preserving
 * the gap keeps the x-axis honest about elapsed time; it does not punch a hole in
 * the series, and breaking the subpath there would be a separate change.
 */
export function trimUnresolvedEdgeWeeks(history: StandingsHistory): StandingsHistory {
  const { resolvedWeeks } = selectResolvedStandingsWeeks(history);
  const firstResolvedWeek = resolvedWeeks[0];
  const latestResolvedWeek = resolvedWeeks[resolvedWeeks.length - 1];
  if (firstResolvedWeek === undefined || latestResolvedWeek === undefined) {
    return { weeks: [], byWeek: {}, byOwner: {} };
  }

  const weeks = history.weeks.filter(
    (week) => week >= firstResolvedWeek && week <= latestResolvedWeek
  );
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
