import type { StandingsHistory } from '../standingsHistory';
import { selectResolvedStandingsWeeks } from './historyResolution';

export type OwnerMomentum = {
  ownerId: string;
  deltaWins: number;
  deltaGamesBack: number;
  deltaWinPct: number;
};

function roundTo3(value: number): number {
  return Number(value.toFixed(3));
}

export function selectOwnerMomentum(args: {
  standingsHistory: StandingsHistory;
  windowSize?: number;
}): OwnerMomentum[] {
  const { standingsHistory, windowSize = 3 } = args;
  const safeWindow = Math.max(1, Math.floor(windowSize));
  const { resolvedWeeks } = selectResolvedStandingsWeeks(standingsHistory);

  if (resolvedWeeks.length === 0) return [];

  const latestWeek = resolvedWeeks[resolvedWeeks.length - 1] ?? null;
  if (latestWeek == null) return [];

  const priorIndex = Math.max(0, resolvedWeeks.length - 1 - safeWindow);
  const baselineWeek = resolvedWeeks[priorIndex] ?? latestWeek;

  const owners = Object.keys(standingsHistory.byOwner).sort((a, b) => a.localeCompare(b));

  return owners
    .flatMap((ownerId) => {
      const series = standingsHistory.byOwner[ownerId] ?? [];
      const latest = series.find((point) => point.week === latestWeek);
      const baseline = series.find((point) => point.week === baselineWeek);
      if (!latest || !baseline) return [];

      return [
        {
          ownerId,
          deltaWins: latest.wins - baseline.wins,
          deltaGamesBack: roundTo3(latest.gamesBack - baseline.gamesBack),
          deltaWinPct: roundTo3(latest.winPct - baseline.winPct),
        },
      ];
    })
    .sort((left, right) => {
      if (left.deltaWins !== right.deltaWins) return right.deltaWins - left.deltaWins;
      if (left.deltaGamesBack !== right.deltaGamesBack)
        return left.deltaGamesBack - right.deltaGamesBack;
      if (left.deltaWinPct !== right.deltaWinPct) return right.deltaWinPct - left.deltaWinPct;
      return left.ownerId.localeCompare(right.ownerId);
    });
}
