import type { AppGame } from './schedule';
import type { ScorePack } from './scores';

export const SCORES_AUTO_REFRESH_MS = 15 * 60 * 1000;
export const LIVE_MANUAL_COOLDOWN_MS = 30 * 1000;

export type RefreshContext = {
  season: number;
  visibleGames: AppGame[];
  scoresByKey: Record<string, ScorePack>;
  now?: Date;
};

export type RefreshPlan = {
  scores: {
    fetchOnStartup: boolean;
    allowAutoOnFocus: boolean;
    autoIntervalMs: number;
    manualOnly: boolean;
  };
  odds: {
    fetchOnStartup: boolean;
    allowManualRefresh: boolean;
    manualOnly: boolean;
  };
};

function isFinalStatus(status: string | undefined): boolean {
  const normalized = (status ?? '').toLowerCase();
  return normalized.includes('final') || normalized.includes('post');
}

function hasGamesLikelyInWindow(visibleGames: AppGame[], now: Date): boolean {
  const nowMs = now.getTime();
  const lookbackMs = 12 * 60 * 60 * 1000;
  const lookaheadMs = 3 * 24 * 60 * 60 * 1000;

  return visibleGames.some((game) => {
    if (!game.date) return false;
    const kickoffMs = new Date(game.date).getTime();
    if (!Number.isFinite(kickoffMs)) return false;
    return kickoffMs >= nowMs - lookbackMs && kickoffMs <= nowMs + lookaheadMs;
  });
}

export function getRefreshPlan(context: RefreshContext): RefreshPlan {
  const { season, visibleGames, scoresByKey, now = new Date() } = context;

  if (visibleGames.length === 0) {
    return {
      scores: {
        fetchOnStartup: false,
        allowAutoOnFocus: false,
        autoIntervalMs: SCORES_AUTO_REFRESH_MS,
        manualOnly: true,
      },
      odds: { fetchOnStartup: false, allowManualRefresh: true, manualOnly: true },
    };
  }

  const currentYear = now.getFullYear();
  const inSeasonWindow = season >= currentYear - 1 && season <= currentYear + 1;
  const hasUnsettledVisibleGame = visibleGames.some((game) => {
    const score = scoresByKey[game.key];
    if (!score) return true;
    return !isFinalStatus(score.status);
  });

  const hasRelevantWindow = hasGamesLikelyInWindow(visibleGames, now);

  const scoresShouldAuto = inSeasonWindow && hasUnsettledVisibleGame && hasRelevantWindow;
  const oddsShouldLoad = inSeasonWindow && hasUnsettledVisibleGame && hasRelevantWindow;

  return {
    scores: {
      fetchOnStartup: true,
      allowAutoOnFocus: scoresShouldAuto,
      autoIntervalMs: SCORES_AUTO_REFRESH_MS,
      manualOnly: !scoresShouldAuto,
    },
    odds: {
      fetchOnStartup: oddsShouldLoad,
      allowManualRefresh: true,
      manualOnly: true,
    },
  };
}
