import type { StandingsHistory } from '../standingsHistory';
import type { AppGame } from '../schedule';
import type { ScorePack } from '../scores';
import { classifyScorePackStatus } from '../gameStatus';
import { selectResolvedStandingsWeeks } from './historyResolution';

export type GamesBackSeriesPoint = {
  week: number;
  value: number;
};

export type GamesBackSeries = {
  ownerId: string;
  ownerName: string;
  points: GamesBackSeriesPoint[];
  /**
   * The value every owner held before the season started, or null when the
   * series has no plotted weeks. See {@link SEASON_ORIGIN_GAMES_BACK}.
   *
   * Deliberately NOT a point: a point needs a `week`, and there is no week
   * number that is right for both charts. `TrendsDetailSurface` reads `week` as
   * a coordinate on a linear scale, so a fixed sentinel misplaces the origin
   * whenever the first plotted week is not 1; `MiniTrendsGrid` reads it as a key
   * into an index map, where an unknown week silently collapses onto the first
   * column. Each chart places the origin in its OWN coordinate system instead,
   * and no fake week is minted anywhere.
   */
  origin: number | null;
};

export type WinPctSeriesPoint = {
  week: number;
  value: number;
};

export type WinPctSeries = {
  ownerId: string;
  ownerName: string;
  points: WinPctSeriesPoint[];
};

export type WinBarsRow = {
  ownerId: string;
  ownerName: string;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  gamesBack: number;
};

/**
 * POLISH-014 — where every owner starts.
 *
 * Before any game is played every owner is 0-0, level with everyone else. Games
 * back is therefore 0, and win% is 0 because `deriveStandings` already defines a
 * 0-0 record that way (`standings.ts`: `winPct: decisions > 0 ? wins / decisions : 0`).
 * The origin states what the app already claims about an unplayed record; it
 * does not invent data.
 *
 * It exists so that ONE resolved week is an ordinary two-point segment rather
 * than a special case. A single point builds a moveto-only path that SVG will not
 * draw, and three attempts to special-case that — markers, a clamp, a paint
 * order — each produced the next defect (`docs/next-tasks.md` item 74).
 */
export const SEASON_ORIGIN_GAMES_BACK = 0;

/**
 * WIN% HAS NO ORIGIN, deliberately.
 *
 * A first version gave it one at 0.000 on the reasoning that `deriveStandings`
 * already defines a 0-0 record that way. True of the DATA and wrong for the
 * CHART: on a 0-1 win% axis, 0.000 is the worst possible value, not "level", so
 * every line would begin at the floor and the converged y-domain would be
 * dragged to 0, flattening the whole chart. Games back is different — 0 there
 * genuinely means level with everyone.
 *
 * Nothing consumed it (`TrendsDetailSurface` ignores `origin` entirely), so it
 * was removed rather than left as a trap. Adopting an origin for win% needs its
 * own baseline decision; the series count is unaffected either way, so the
 * POLISH-012 empty-case divergence this slice worried about cannot arise from
 * the asymmetry.
 */

/**
 * Is "no game has concluded yet" true immediately before `firstDrawnWeek`?
 *
 * The origin asserts every owner level at 0-0, so it is honest only when no
 * result exists before the first week the chart draws. This asks the STANDINGS
 * for that — `finalGames` counts concluded games — rather than inferring it from
 * a week flag. Two rounds of review went to learning that no flag answers it:
 *
 *  - The first version compared against the first RESOLVED week. Since
 *    PLATFORM-105 a week can be `played: true` with incomplete coverage, which
 *    makes it unresolved and invisible to the trend selectors — so weeks 1-2
 *    played but partial, with week 3 resolved, drew everyone level before W3
 *    after two weeks of football.
 *  - The second version asked `selectPlayedWeeks`, which is the OPPOSITE
 *    polarity of the same mistake. `played` is
 *    `realGames.length > 0 && pending.length === 0`, and `pending` deliberately
 *    retains postponed games, so ONE postponed week-1 game leaves that week
 *    `played: false` permanently while its other games have already moved the
 *    cumulative standings. Review probed it: first drawn week 2,
 *    `seasonOriginApplies` true, week 1 carrying real results.
 *
 * `finalGames` is the evidence both flags were standing in for.
 *
 * Also false for a recent-window slice — Overview charts the last five resolved
 * weeks, so from week six the window starts mid-season and earlier games count.
 */
export function seasonOriginApplies(
  fullHistory: StandingsHistory,
  firstDrawnWeek: number | undefined
): boolean {
  if (firstDrawnWeek === undefined) return false;
  return !fullHistory.weeks.some(
    (week) =>
      week < firstDrawnWeek &&
      (fullHistory.byWeek[week]?.standings ?? []).some(
        // `finalGames` is typed required but durable archives predate it, and
        // `undefined > 0` is false rather than an error — so the RECORD half has
        // to stand on its own. This mirrors the precedent already established in
        // `insights/generators/existing.ts`, which this predicate should have
        // followed the first time; `byWeek` standings are cumulative, so a
        // decision on the record answers the same question.
        (row) => row.finalGames > 0 || row.wins + row.losses + row.ties > 0
      )
  );
}

/**
 * Can this series actually be drawn as a line?
 *
 * ONE authority, because three surfaces ask: the Overview GB Race guard,
 * `SeasonArcChart`, and `MiniTrendsGrid` itself. POLISH-013 shipped the answer in
 * two of the three and the third kept rendering an empty box with axes — the
 * defect class this project has hit repeatedly by fixing a call site by name
 * instead of by class.
 *
 * A line needs two endpoints. The origin counts as one of them.
 */
export function isDrawableTrendSeries(series: {
  points: unknown[];
  origin: number | null;
}): boolean {
  return series.points.length + (series.origin === null ? 0 : 1) >= 2;
}

function deriveOwnerOrderFromLatestStandings(
  standingsHistory: StandingsHistory,
  latestWeek: number | null
): string[] {
  const latestStandings =
    latestWeek != null ? (standingsHistory.byWeek[latestWeek]?.standings ?? []) : [];
  const latestOwners = latestStandings.map((row) => row.owner);

  if (latestOwners.length === 0) {
    return Object.keys(standingsHistory.byOwner).sort((a, b) => a.localeCompare(b));
  }

  const seen = new Set(latestOwners);
  const trailingOwners = Object.keys(standingsHistory.byOwner)
    .filter((owner) => !seen.has(owner))
    .sort((a, b) => a.localeCompare(b));
  return [...latestOwners, ...trailingOwners];
}

/**
 * Builds chart-ready Games Back trend series from canonical standings history.
 *
 * Contract:
 * - Owner ordering: latest standings order; fallback is alphabetical by owner key when latest standings are unavailable.
 * - Point ordering: follows resolved-week order from `standingsHistory.weeks`.
 * - Values: taken directly from `standingsHistory.byOwner[].gamesBack` (no recomputation).
 */
export function selectGamesBackTrend(args: {
  standingsHistory: StandingsHistory;
}): GamesBackSeries[] {
  const { standingsHistory } = args;
  const { resolvedWeeks: weeks, latestResolvedWeek } =
    selectResolvedStandingsWeeks(standingsHistory);
  const owners = deriveOwnerOrderFromLatestStandings(standingsHistory, latestResolvedWeek);

  return (
    owners
      .map((owner) => {
        const ownerSeries = standingsHistory.byOwner[owner] ?? [];
        const pointByWeek = new Map(ownerSeries.map((point) => [point.week, point]));
        const points = weeks.flatMap((week) => {
          const point = pointByWeek.get(week);
          if (!point) return [];
          return [{ week, value: point.gamesBack }];
        });

        return {
          ownerId: owner,
          ownerName: owner,
          points,
          // Only when something is plotted. A series with no resolved weeks stays
          // empty and is filtered below, so the origin can never resurrect a chart
          // for a season that has not started.
          origin: points.length > 0 ? SEASON_ORIGIN_GAMES_BACK : null,
        };
      })
      // POLISH-012: MATCHES `selectWinPctTrend`. Without this, no resolved weeks
      // produced one point-less series PER OWNER here while win% produced none at
      // all — so in preseason the two metric charts disagreed about whether there
      // was anything to draw. They share a fiber, so that divergence is what made
      // the hook-count crash reachable. "No resolved weeks" must mean "no rows"
      // for both, which is also the honest answer: there is nothing to chart.
      .filter((series) => series.points.length > 0)
  );
}

/**
 * Builds chart-ready Win % trend series from canonical standings history.
 *
 * Contract:
 * - Owner ordering: latest standings order; fallback is alphabetical by owner key when latest standings are unavailable.
 * - Point ordering: follows resolved-week order from `standingsHistory.weeks`.
 * - Values: taken directly from `standingsHistory.byOwner[].winPct` (no recomputation).
 */
export function selectWinPctTrend(args: { standingsHistory: StandingsHistory }): WinPctSeries[] {
  const { standingsHistory } = args;
  const { resolvedWeeks: weeks, latestResolvedWeek } =
    selectResolvedStandingsWeeks(standingsHistory);
  const owners = deriveOwnerOrderFromLatestStandings(standingsHistory, latestResolvedWeek);

  return owners
    .map((owner) => {
      const ownerSeries = standingsHistory.byOwner[owner] ?? [];
      const pointByWeek = new Map(ownerSeries.map((point) => [point.week, point]));
      const points = weeks.flatMap((week) => {
        const point = pointByWeek.get(week);
        if (!point) return [];
        return [{ week, value: point.winPct }];
      });

      return {
        ownerId: owner,
        ownerName: owner,
        points,
      };
    })
    .filter((series) => series.points.length > 0);
}

export function selectWinBars(args: { standingsHistory: StandingsHistory }): WinBarsRow[] {
  const { standingsHistory } = args;
  const { latestResolvedWeek } = selectResolvedStandingsWeeks(standingsHistory);
  const latestStandings =
    latestResolvedWeek != null
      ? (standingsHistory.byWeek[latestResolvedWeek]?.standings ?? [])
      : [];

  if (latestStandings.length > 0) {
    return latestStandings.map((row) => ({
      ownerId: row.owner,
      ownerName: row.owner,
      wins: row.wins,
      losses: row.losses,
      ties: row.ties,
      winPct: row.winPct,
      gamesBack: row.gamesBack,
    }));
  }

  const owners = Object.keys(standingsHistory.byOwner).sort((a, b) => a.localeCompare(b));
  return owners.flatMap((owner) => {
    const point = standingsHistory.byOwner[owner]?.find(
      (entry) => entry.week === latestResolvedWeek
    );
    if (!point) return [];
    return [
      {
        ownerId: owner,
        ownerName: owner,
        wins: point.wins,
        losses: point.losses,
        ties: point.ties,
        winPct: point.winPct,
        gamesBack: point.gamesBack,
      },
    ];
  });
}

export type RankSeries = {
  ownerId: string;
  ownerName: string;
  points: { week: number; value: number }[];
};

/**
 * Builds chart-ready standings-position (rank) trend series from canonical standings history.
 *
 * Contract:
 * - Owner ordering: latest standings order.
 * - Rank value: 1-based index of owner in byWeek[week].standings for each resolved week.
 * - Owners absent from a week's standings are omitted for that week.
 */
export function selectRankTrend(args: { standingsHistory: StandingsHistory }): RankSeries[] {
  const { standingsHistory } = args;
  const { resolvedWeeks: weeks, latestResolvedWeek } =
    selectResolvedStandingsWeeks(standingsHistory);
  const owners = deriveOwnerOrderFromLatestStandings(standingsHistory, latestResolvedWeek);

  return (
    owners
      .map((owner) => {
        const points = weeks.flatMap((week) => {
          const weekStandings = standingsHistory.byWeek[week]?.standings ?? [];
          const rankIndex = weekStandings.findIndex((row) => row.owner === owner);
          if (rankIndex === -1) return [];
          return [{ week, value: rankIndex + 1 }];
        });
        return { ownerId: owner, ownerName: owner, points };
      })
      // POLISH-012: ONE convention in this file. This selector has no consumer
      // today, but leaving it with the old shape means the next component that
      // renders rank beside another metric inherits the exact divergence that
      // crashed the standings page — two selectors disagreeing about whether
      // "no resolved weeks" means "no rows".
      .filter((series) => series.points.length > 0)
  );
}

export function selectGamesBackTrendFull(args: {
  standingsHistory: StandingsHistory;
}): GamesBackSeries[] {
  return selectGamesBackTrend(args);
}

export function selectWinPctTrendFull(args: {
  standingsHistory: StandingsHistory;
}): WinPctSeries[] {
  return selectWinPctTrend(args);
}

export function selectWinBarsFull(args: { standingsHistory: StandingsHistory }): WinBarsRow[] {
  return selectWinBars(args);
}

export type WeekOutcome = 'W' | 'L' | 'T';

export type OwnerRecentOutcomes = {
  ownerId: string;
  ownerName: string;
  outcomes: { week: number; result: WeekOutcome }[];
};

export type PositionDelta = {
  week: number;
  rank: number;
  /** Signed integer: positive = moved up, negative = moved down, null = no prior resolved week. */
  delta: number | null;
};

export type OwnerPositionDeltas = {
  ownerId: string;
  ownerName: string;
  deltas: PositionDelta[];
};

/**
 * Derives week-over-week standings position change for every owner across the
 * last `maxWeeks` resolved weeks.
 *
 * Contract:
 * - Owner ordering: latest resolved standings order.
 * - delta = previousRank − currentRank (positive = moved up, negative = moved down).
 * - The previous resolved week before the display window is used to compute the first delta.
 * - Owners absent from a week's standings return delta: null for that week.
 */
export function selectPositionDeltas(args: {
  standingsHistory: StandingsHistory;
  maxWeeks?: number;
}): { weeks: number[]; owners: OwnerPositionDeltas[] } {
  const { standingsHistory, maxWeeks = 5 } = args;
  const { resolvedWeeks, latestResolvedWeek } = selectResolvedStandingsWeeks(standingsHistory);
  const owners = deriveOwnerOrderFromLatestStandings(standingsHistory, latestResolvedWeek);
  const recentWeeks = resolvedWeeks.slice(-maxWeeks);

  const ownerDeltas: OwnerPositionDeltas[] = owners.map((owner) => {
    const deltas: PositionDelta[] = recentWeeks.map((week) => {
      const weekStandings = standingsHistory.byWeek[week]?.standings ?? [];
      const rank = weekStandings.findIndex((r) => r.owner === owner) + 1;
      if (rank === 0) return { week, rank: 0, delta: null };

      // Use the resolved week immediately before this one (may be outside the display window)
      const weekIndexInAll = resolvedWeeks.indexOf(week);
      const prevResolvedWeek = weekIndexInAll > 0 ? resolvedWeeks[weekIndexInAll - 1] : null;
      if (prevResolvedWeek == null) return { week, rank, delta: null };

      const prevStandings = standingsHistory.byWeek[prevResolvedWeek]?.standings ?? [];
      const prevRank = prevStandings.findIndex((r) => r.owner === owner) + 1;
      if (prevRank === 0) return { week, rank, delta: null };

      return { week, rank, delta: prevRank - rank };
    });
    return { ownerId: owner, ownerName: owner, deltas };
  });

  return { weeks: recentWeeks, owners: ownerDeltas };
}

/**
 * Derives per-week W/L/T outcomes for every owner from actual game scores.
 * Only weeks with a final score are included; pending/live games produce no dot.
 */
export function selectRecentOutcomes(args: {
  standingsHistory: StandingsHistory;
  games: AppGame[];
  scoresByKey: Record<string, ScorePack>;
  rosterByTeam: Map<string, string>;
  maxWeeks?: number;
}): { weeks: number[]; owners: OwnerRecentOutcomes[] } {
  const { standingsHistory, games, scoresByKey, rosterByTeam, maxWeeks = 5 } = args;
  const { resolvedWeeks, latestResolvedWeek } = selectResolvedStandingsWeeks(standingsHistory);
  const owners = deriveOwnerOrderFromLatestStandings(standingsHistory, latestResolvedWeek);
  const recentWeeks = resolvedWeeks.slice(-maxWeeks);

  // Build a lookup: week → owner → 'W' | 'L' | 'T'
  const resultByWeekOwner = new Map<number, Map<string, WeekOutcome>>();
  for (const game of games) {
    const week = game.week;
    if (week == null || !recentWeeks.includes(week)) continue;
    const score = scoresByKey[game.key];
    if (classifyScorePackStatus(score) !== 'final') continue;
    const awayScore = score.away.score;
    const homeScore = score.home.score;
    if (awayScore == null || homeScore == null) continue;

    const awayOwner = rosterByTeam.get(game.csvAway);
    const homeOwner = rosterByTeam.get(game.csvHome);
    if (!resultByWeekOwner.has(week)) resultByWeekOwner.set(week, new Map());
    const weekMap = resultByWeekOwner.get(week)!;

    if (awayOwner) {
      weekMap.set(awayOwner, awayScore > homeScore ? 'W' : awayScore < homeScore ? 'L' : 'T');
    }
    if (homeOwner) {
      weekMap.set(homeOwner, homeScore > awayScore ? 'W' : homeScore < awayScore ? 'L' : 'T');
    }
  }

  const ownerOutcomes: OwnerRecentOutcomes[] = owners.map((owner) => {
    const outcomes = recentWeeks.flatMap((week): { week: number; result: WeekOutcome }[] => {
      const result = resultByWeekOwner.get(week)?.get(owner);
      return result != null ? [{ week, result }] : [];
    });
    return { ownerId: owner, ownerName: owner, outcomes };
  });

  return { weeks: recentWeeks, owners: ownerOutcomes };
}
