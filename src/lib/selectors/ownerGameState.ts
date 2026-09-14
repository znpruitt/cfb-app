import type { AppGame } from '../schedule';
import type { ScorePack } from '../scores';
import { isAwaitingScoreGame, type GameDayContext } from './gameDayConfidence';
import { projectGameScoreboardState, type GameScoreboardState } from './gameScoreboardState';

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
  return projectGameScoreboardState({ game, score, nowMs });
}

/** Complete state authority used by every Members owned-team row and slate consumer. */
export function projectMembersGameState(params: {
  game: AppGame;
  score?: ScorePack;
  context: GameDayContext;
}): GameScoreboardState {
  const { game, score, context } = params;
  const projected = projectGameScoreboardState({ game, score, nowMs: context.now });

  switch (projected) {
    case 'scheduled':
    case 'live':
    case 'unavailable':
    case 'final':
      return projected;
    case 'awaiting':
      // Members additionally limits game-day claims to the active score season.
      return isAwaitingScoreGame({ game, score, context }) ? 'awaiting' : 'scheduled';
  }
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

function isPendingMembersRowState(state: GameScoreboardState): boolean {
  switch (state) {
    case 'scheduled':
    case 'awaiting':
      return true;
    case 'live':
    case 'unavailable':
    case 'final':
      return false;
  }
}

/**
 * Select the one game a Members owned-team row describes. Live evidence wins;
 * otherwise the first pending game wins, followed by the latest terminal row.
 * `unavailable` is terminal for sequencing even though it is not a scored
 * final: an old reporting gap must not pin the roster row ahead of a later
 * upcoming game. Every status check flows through `projectMembersGameState`.
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

  const pending = projected.find(({ state }) => isPendingMembersRowState(state));
  if (pending) return pending;
  return projected.at(-1) ?? null;
}
