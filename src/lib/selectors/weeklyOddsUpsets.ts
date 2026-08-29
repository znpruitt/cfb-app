import { evaluateOddsUpset, type OddsUpsetSide } from '../oddsUpsetPolicy.ts';
import type { CombinedOdds } from '../odds.ts';
import { NO_CLAIM_OWNER, type OwnedFinalParticipation } from '../standings.ts';

export type WeeklyOddsUpset = {
  gameKey: string;
  week: number;
  favoriteSide: OddsUpsetSide;
  favoriteTeam: string;
  favoriteOwner: string | null;
  winnerSide: OddsUpsetSide;
  winnerTeam: string;
  winnerOwner: string | null;
  winnerScore: number;
  loserScore: number;
  spreadMagnitude: number;
  source: string | null;
  bookmakerKey: string | null;
  lineSourceStatus: CombinedOdds['lineSourceStatus'];
};

function oppositeSide(side: OddsUpsetSide): OddsUpsetSide {
  return side === 'away' ? 'home' : 'away';
}

function realOwner(owner: string | null | undefined): string | null {
  return owner && owner !== NO_CLAIM_OWNER ? owner : null;
}

function ownerForSide(participation: OwnedFinalParticipation, side: OddsUpsetSide): string | null {
  return side === participation.teamSide
    ? realOwner(participation.owner)
    : realOwner(participation.opponentOwner);
}

function teamForSide(participation: OwnedFinalParticipation, side: OddsUpsetSide): string {
  return side === 'away' ? participation.game.csvAway : participation.game.csvHome;
}

/**
 * Select final odds upsets for one canonical week. Finality and ownership come
 * only from canonical owned participations; a game with two owned teams is
 * collapsed to one fact by game key.
 */
export function selectWeeklyOddsUpsets(args: {
  participations: OwnedFinalParticipation[];
  week: number;
  oddsByGameKey: Readonly<Record<string, CombinedOdds>>;
}): WeeklyOddsUpset[] {
  const byGame = new Map<string, OwnedFinalParticipation[]>();

  for (const participation of args.participations) {
    if (participation.game.canonicalWeek !== args.week) continue;
    const current = byGame.get(participation.game.key) ?? [];
    current.push(participation);
    byGame.set(participation.game.key, current);
  }

  const upsets: WeeklyOddsUpset[] = [];
  for (const [gameKey, gameParticipations] of byGame) {
    if (!gameParticipations.some((participation) => realOwner(participation.owner) != null)) {
      continue;
    }

    const participation = gameParticipations[0];
    if (!participation) continue;
    const winnerSide =
      participation.result === 'win'
        ? participation.teamSide
        : oppositeSide(participation.teamSide);
    const evaluation = evaluateOddsUpset({
      game: participation.game,
      odds: args.oddsByGameKey[gameKey],
      winnerSide,
    });
    if (
      !evaluation.isUpset ||
      evaluation.favoriteSide == null ||
      evaluation.spreadMagnitude == null ||
      evaluation.lineSourceStatus == null
    ) {
      continue;
    }

    const winnerScore =
      participation.result === 'win' ? participation.pointsFor : participation.pointsAgainst;
    const loserScore =
      participation.result === 'loss' ? participation.pointsFor : participation.pointsAgainst;

    upsets.push({
      gameKey,
      week: args.week,
      favoriteSide: evaluation.favoriteSide,
      favoriteTeam: teamForSide(participation, evaluation.favoriteSide),
      favoriteOwner: ownerForSide(participation, evaluation.favoriteSide),
      winnerSide,
      winnerTeam: teamForSide(participation, winnerSide),
      winnerOwner: ownerForSide(participation, winnerSide),
      winnerScore,
      loserScore,
      spreadMagnitude: evaluation.spreadMagnitude,
      source: evaluation.source,
      bookmakerKey: evaluation.bookmakerKey,
      lineSourceStatus: evaluation.lineSourceStatus,
    });
  }

  return upsets;
}
