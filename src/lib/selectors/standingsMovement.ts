import type { OwnerStandingsRow } from '../standings';
import type { StandingsHistory } from '../standingsHistory';
import { selectResolvedStandingsWeeks } from './historyResolution';

export type StandingMovement = {
  owner: string;
  currentRank: number;
  previousRank: number | null;
  rankDelta: number | null;
};

export function deriveStandingsMovementByOwner(args: {
  rows: OwnerStandingsRow[];
  standingsHistory: StandingsHistory | null | undefined;
}): Record<string, StandingMovement> {
  const { rows, standingsHistory } = args;
  const movementByOwner: Record<string, StandingMovement> = {};

  let previousRankByOwner = new Map<string, number>();
  if (standingsHistory) {
    const { previousResolvedWeek } = selectResolvedStandingsWeeks(standingsHistory);
    const previousSnapshot =
      previousResolvedWeek != null ? standingsHistory.byWeek[previousResolvedWeek] : null;
    previousRankByOwner = new Map(
      (previousSnapshot?.standings ?? []).map((standing, index) => [standing.owner, index + 1])
    );
  }

  rows.forEach((row, index) => {
    const currentRank = index + 1;
    const previousRank = previousRankByOwner.get(row.owner) ?? null;
    const rankDelta = previousRank == null ? null : previousRank - currentRank;
    movementByOwner[row.owner] = {
      owner: row.owner,
      currentRank,
      previousRank,
      rankDelta,
    };
  });

  return movementByOwner;
}
