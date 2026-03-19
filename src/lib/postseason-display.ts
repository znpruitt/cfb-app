import type { AppGame } from './schedule.ts';

export function isWeekContextGame(game: Pick<AppGame, 'stage' | 'postseasonRole'>): boolean {
  return game.stage === 'regular' || game.stage === 'conference_championship';
}

export function isTruePostseasonGame(game: Pick<AppGame, 'stage' | 'postseasonRole'>): boolean {
  if (isWeekContextGame(game)) {
    return false;
  }

  if (game.postseasonRole === 'conference_championship') {
    return false;
  }

  return true;
}
