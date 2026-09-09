import { hasUsableFinalScore } from '../gameStatus';
import { gameStateFromScore } from '../gameUi';
import type { ScorePack } from '../scores';

export type GameScoreboardState = 'scheduled' | 'live' | 'awaiting' | 'final';

/**
 * Project only the state a scoreboard row can truthfully render. Ownership,
 * section placement, omission, abandonment, and polling eligibility are separate
 * decisions owned by their existing selectors.
 */
export function projectGameScoreboardState(
  score: ScorePack | undefined,
  kickoff: string | null | undefined,
  nowMs: number
): GameScoreboardState {
  const scoreState = gameStateFromScore(score);
  const kickoffMs = kickoff ? Date.parse(kickoff) : Number.NaN;

  if (hasUsableFinalScore(score)) return 'final';
  if (scoreState === 'inprogress') return 'live';
  if (!Number.isFinite(kickoffMs) || !Number.isFinite(nowMs) || kickoffMs > nowMs) {
    return 'scheduled';
  }
  if (Number.isFinite(kickoffMs) && Number.isFinite(nowMs) && kickoffMs <= nowMs) {
    return 'awaiting';
  }

  throw new Error('Unreachable game scoreboard state projection');
}
