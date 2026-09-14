import { classifyScorePackStatus, isDisruptedStatusLabel } from '../gameStatus.ts';
import { isCurrentLiveScoreSeason, isLiveScoreEligibleGame } from '../liveScores/browserPolling.ts';
import type { AppGame } from '../schedule.ts';
import type { ScorePack } from '../scores.ts';
import { projectGameScoreboardState } from './gameScoreboardState.ts';

/** Covers two server provider-refresh opportunities on the unchanged three-minute cron. */
export const LIVE_SCORE_OBSERVATION_MAX_AGE_MS = 7 * 60 * 1000;

export type LiveScoreObservation = {
  /** Resolution time of the exact provider-refresh attempt covering this poll. */
  observedAt: string;
  /** Games that attached a score row during the same exact-partition read. */
  attachedGameKeys: string[];
};

export type GameDayConfidence =
  | { kind: 'tracking'; label: 'Tracking scores' }
  | { kind: 'waiting'; label: 'Waiting for scores' }
  | { kind: 'preparing'; label: 'Preparing for kickoff' };

export type GameDayContext = {
  season: number;
  now: number;
};

function kickoffMs(game: AppGame): number | null {
  if (!game.date) return null;
  const parsed = Date.parse(game.date);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Whether an owned-team row may truthfully say it is awaiting a score. This is
 * the shared complete scoreboard projection plus Members' active-season gate.
 * A partial final remains awaiting while its complete score can still attach;
 * unconfirmed, placeholder, and disrupted games fail closed in the projector.
 *
 * Disrupted-label vocabulary is a FORWARD-LOOKING guard, not observed behaviour: read the
 * measurement note above `DISRUPTED_RE` in `src/lib/gameStatus.ts` before reasoning from this
 * comment (Item 661).
 */
export function isAwaitingScoreGame(params: {
  game: AppGame;
  score?: ScorePack;
  context: GameDayContext;
}): boolean {
  const { game, score, context } = params;
  const now = new Date(context.now);
  if (!isCurrentLiveScoreSeason(context.season, now)) return false;
  return projectGameScoreboardState({ game, score, nowMs: context.now }) === 'awaiting';
}

function isRecentObservation(observation: LiveScoreObservation | null, now: number): boolean {
  if (!observation) return false;
  const observedAt = Date.parse(observation.observedAt);
  if (!Number.isFinite(observedAt)) return false;
  const age = now - observedAt;
  return age >= 0 && age <= LIVE_SCORE_OBSERVATION_MAX_AGE_MS;
}

/**
 * Select the strongest truthful member-facing game-day claim. The selector is
 * pure: time and the exact provider-observation evidence are explicit inputs.
 */
export function selectGameDayConfidence(params: {
  games: AppGame[];
  scoresByKey: Record<string, ScorePack>;
  season: number;
  observation: LiveScoreObservation | null;
  now: number;
}): GameDayConfidence | null {
  const { games, scoresByKey, season, observation, now } = params;
  const nowDate = new Date(now);
  if (!isCurrentLiveScoreSeason(season, nowDate)) return null;

  const eligibleGames = games.filter((game) =>
    isLiveScoreEligibleGame(game, scoresByKey[game.key], nowDate)
  );
  if (eligibleGames.length === 0) return null;

  if (isRecentObservation(observation, now)) {
    const attachedKeys = new Set(observation?.attachedGameKeys ?? []);
    const hasObservedLiveGame = eligibleGames.some(
      (game) =>
        attachedKeys.has(game.key) &&
        classifyScorePackStatus(scoresByKey[game.key]) === 'inprogress'
    );
    if (hasObservedLiveGame) return { kind: 'tracking', label: 'Tracking scores' };
  }

  // A live-looking row without current exact-scope evidence cannot support a
  // claim. It also blocks a weaker "Preparing" claim for a later kickoff.
  if (
    eligibleGames.some((game) => classifyScorePackStatus(scoresByKey[game.key]) === 'inprogress')
  ) {
    return null;
  }

  if (
    eligibleGames.some((game) =>
      isAwaitingScoreGame({ game, score: scoresByKey[game.key], context: { season, now } })
    )
  ) {
    return { kind: 'waiting', label: 'Waiting for scores' };
  }

  const hasUpcomingKickoff = eligibleGames.some((game) => {
    const startsAt = kickoffMs(game);
    return (
      startsAt !== null &&
      startsAt > now &&
      !isDisruptedStatusLabel(game.rawStatus) &&
      classifyScorePackStatus(scoresByKey[game.key]) !== 'disrupted'
    );
  });
  return hasUpcomingKickoff ? { kind: 'preparing', label: 'Preparing for kickoff' } : null;
}
