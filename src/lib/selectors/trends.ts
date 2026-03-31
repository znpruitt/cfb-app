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

  return owners.map((owner) => {
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
    };
  });
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

  return owners.map((owner) => {
    const points = weeks.flatMap((week) => {
      const weekStandings = standingsHistory.byWeek[week]?.standings ?? [];
      const rankIndex = weekStandings.findIndex((row) => row.owner === owner);
      if (rankIndex === -1) return [];
      return [{ week, value: rankIndex + 1 }];
    });
    return { ownerId: owner, ownerName: owner, points };
  });
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
