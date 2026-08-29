import { sideIdentityCandidates } from './gameOwnership.ts';
import type { CombinedOdds } from './odds.ts';
import type { AppGame } from './schedule.ts';
import { hasEquivalentTeamName } from './teamIdentity.ts';

export type OddsUpsetSide = 'away' | 'home';

export type OddsUpsetEvaluation = {
  favoriteSide: OddsUpsetSide | null;
  underdogSide: OddsUpsetSide | null;
  winnerSide: OddsUpsetSide | null;
  spreadMagnitude: number | null;
  spreadThreshold: number;
  meetsSpreadThreshold: boolean;
  isUpset: boolean;
  source: string | null;
  bookmakerKey: string | null;
  lineSourceStatus: CombinedOdds['lineSourceStatus'] | null;
};

export const DEFAULT_ODDS_UPSET_SPREAD_THRESHOLD = 6;

function spreadMagnitude(odds?: CombinedOdds): number | null {
  if (!odds) return null;
  if (typeof odds.spread === 'number') return Math.abs(odds.spread);
  if (typeof odds.homeSpread === 'number') return Math.abs(odds.homeSpread);
  if (typeof odds.awaySpread === 'number') return Math.abs(odds.awaySpread);
  return null;
}

function favoriteSideFromOdds(game: AppGame, odds?: CombinedOdds): OddsUpsetSide | null {
  if (!odds) return null;

  if (typeof odds.homeSpread === 'number' && typeof odds.awaySpread === 'number') {
    if (odds.homeSpread < odds.awaySpread) return 'home';
    if (odds.awaySpread < odds.homeSpread) return 'away';
    return null;
  }

  if (odds.favorite) {
    if (hasEquivalentTeamName(odds.favorite, sideIdentityCandidates(game, 'home'))) return 'home';
    if (hasEquivalentTeamName(odds.favorite, sideIdentityCandidates(game, 'away'))) return 'away';
  }

  return null;
}

/**
 * Shared odds-upset policy for badges and recap facts. The threshold applies to
 * the pregame spread magnitude; result margin is deliberately irrelevant.
 */
export function evaluateOddsUpset(args: {
  game: AppGame;
  odds: CombinedOdds | undefined;
  winnerSide?: OddsUpsetSide | null;
  spreadThreshold?: number;
}): OddsUpsetEvaluation {
  const {
    game,
    odds,
    winnerSide = null,
    spreadThreshold = DEFAULT_ODDS_UPSET_SPREAD_THRESHOLD,
  } = args;
  const favoriteSide = favoriteSideFromOdds(game, odds);
  const magnitude = spreadMagnitude(odds);
  const meetsSpreadThreshold = magnitude != null && magnitude >= spreadThreshold;
  const underdogSide = favoriteSide === null ? null : favoriteSide === 'away' ? 'home' : 'away';

  return {
    favoriteSide,
    underdogSide,
    winnerSide,
    spreadMagnitude: magnitude,
    spreadThreshold,
    meetsSpreadThreshold,
    isUpset:
      favoriteSide != null &&
      winnerSide != null &&
      favoriteSide !== winnerSide &&
      meetsSpreadThreshold,
    source: odds?.source ?? null,
    bookmakerKey: odds?.bookmakerKey ?? null,
    lineSourceStatus: odds?.lineSourceStatus ?? null,
  };
}
