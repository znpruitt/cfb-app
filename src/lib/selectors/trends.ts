import type { StandingsHistory } from '../standingsHistory';
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
