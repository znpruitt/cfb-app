import type { AppGame } from './schedule';

export function isTruePostseasonGame(game: Pick<AppGame, 'stage' | 'postseasonRole'>): boolean {
  if (game.stage === 'regular' || game.stage === 'conference_championship') {
    return false;
  }

  if (game.postseasonRole === 'conference_championship') {
    return false;
  }

  return true;
}
