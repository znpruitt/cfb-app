import { gameStateFromScore } from '../gameUi.ts';
import type { AppGame } from '../schedule.ts';
import type { ScorePack } from '../scores.ts';
import { isAwaitingScoreGame, type GameDayContext } from './gameDayConfidence.ts';
import { projectGameScoreboardState, type GameScoreboardState } from './gameScoreboardState.ts';

/** Complete state authority for a Matchups scoreboard row. */
export function projectMatchupsRowState(
  game: AppGame,
  score: ScorePack | undefined,
  nowMs: number
): GameScoreboardState {
  return projectGameScoreboardState(score, game.startTimeTBD === true ? null : game.date, nowMs);
}

/**
 * Complete state authority for a Members owner row.
 *
 * Members retains its established score-label finality and bounded awaiting
 * predicate: an attached final label remains final with incomplete scores,
 * while awaiting depends on the selected season and live-score window.
 */
export function projectMembersRowState(
  game: AppGame,
  score: ScorePack | undefined,
  context?: GameDayContext
): GameScoreboardState {
  const scoreState = gameStateFromScore(score);
  if (scoreState === 'final') return 'final';
  if (scoreState === 'inprogress') return 'live';
  if (context && isAwaitingScoreGame({ game, score, context })) return 'awaiting';
  return 'scheduled';
}
