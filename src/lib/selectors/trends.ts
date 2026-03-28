import type { StandingsHistory } from '../standingsHistory';

export type GamesBackSeriesPoint = {
  week: number;
  value: number;
};

export type GamesBackSeries = {
  ownerId: string;
  ownerName: string;
  points: GamesBackSeriesPoint[];
};

function deriveOwnerOrderFromLatestStandings(standingsHistory: StandingsHistory): string[] {
  const latestWeek = standingsHistory.weeks[standingsHistory.weeks.length - 1];
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
 * - Point ordering: follows `standingsHistory.weeks` order exactly.
 * - Values: taken directly from `standingsHistory.byOwner[].gamesBack` (no recomputation).
 */
export function selectGamesBackTrend(args: {
  standingsHistory: StandingsHistory;
}): GamesBackSeries[] {
  const { standingsHistory } = args;
  const weeks = standingsHistory.weeks;
  const owners = deriveOwnerOrderFromLatestStandings(standingsHistory);

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
