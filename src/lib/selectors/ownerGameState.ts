import { classifyScorePackStatus, isDisruptedStatusLabel } from '../gameStatus';
import { gameStateFromScore } from '../gameUi';
import type { AppGame } from '../schedule';
import type { ScorePack } from '../scores';
import { isAwaitingScoreGame, type GameDayContext } from './gameDayConfidence';
import {
  isScorePollingWindowExpired,
  projectGameScoreboardState,
  type GameScoreboardState,
} from './gameScoreboardState';

export type OwnerSlateSurfaceProjection =
  | { surface: 'matchups'; nowMs: number }
  | { surface: 'members'; context: GameDayContext };

/** Complete state authority used by every Matchups game row and slate consumer. */
export function projectMatchupsGameState(params: {
  game: AppGame;
  score?: ScorePack;
  nowMs: number;
}): GameScoreboardState {
  const { game, score, nowMs } = params;
  return projectGameScoreboardState(score, game.startTimeTBD === true ? null : game.date, nowMs);
}

/** Complete state authority used by every Members owned-team row and slate consumer. */
export function projectMembersGameState(params: {
  game: AppGame;
  score?: ScorePack;
  context: GameDayContext;
}): GameScoreboardState {
  const { game, score, context } = params;
  const scoreState = gameStateFromScore(score);

  // Members historically treats an attached final label as final even while one
  // numeric score is absent. Matchups requires a usable final score. Per-surface
  // row agreement is the invariant; cross-surface equality is deliberately not.
  if (scoreState === 'final') return 'final';
  if (scoreState === 'inprogress') return 'live';
  if (isAwaitingScoreGame({ game, score, context })) return 'awaiting';

  // A disrupted game is not an evidence-free result that merely aged out of the
  // polling window. Preserve Members' existing non-awaiting treatment for it.
  if (classifyScorePackStatus(score) === 'disrupted' || isDisruptedStatusLabel(game.rawStatus)) {
    return 'scheduled';
  }
  if (isScorePollingWindowExpired(game.date, context.now)) return 'unavailable';
  return 'scheduled';
}

export function projectOwnerSlateGameState(params: {
  game: AppGame;
  score?: ScorePack;
  projection: OwnerSlateSurfaceProjection;
}): GameScoreboardState {
  const { game, score, projection } = params;
  switch (projection.surface) {
    case 'matchups':
      return projectMatchupsGameState({ game, score, nowMs: projection.nowMs });
    case 'members':
      return projectMembersGameState({ game, score, context: projection.context });
  }
}

export type MembersRowGameProjection = {
  game: AppGame;
  state: GameScoreboardState;
};

function isUnfinishedMembersRowState(state: GameScoreboardState): boolean {
  switch (state) {
    case 'scheduled':
    case 'awaiting':
    case 'unavailable':
      return true;
    case 'live':
    case 'final':
      return false;
  }
}

/**
 * Select the one game a Members owned-team row describes. Live evidence wins;
 * otherwise the first unfinished game wins, followed by the latest final.
 * Every status check flows through `projectMembersGameState`.
 */
export function selectMembersRowGame(params: {
  games: AppGame[];
  scoresByKey: Record<string, ScorePack>;
  context: GameDayContext;
}): MembersRowGameProjection | null {
  const { games, scoresByKey, context } = params;
  const projected = games.map(
    (game): MembersRowGameProjection => ({
      game,
      state: projectMembersGameState({ game, score: scoresByKey[game.key], context }),
    })
  );

  const live = projected.find(({ state }) => state === 'live');
  if (live) return live;

  const unfinished = projected.find(({ state }) => isUnfinishedMembersRowState(state));
  if (unfinished) return unfinished;
  return projected.at(-1) ?? null;
}
