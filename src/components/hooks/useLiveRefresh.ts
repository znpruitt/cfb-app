import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

import {
  getBootstrapScoreHydrationGames,
  getHydrationSeasonTypes,
  getLazyScoreHydrationGames,
  markScoreHydrationLoaded,
  type ScoreHydrationState,
} from '../../lib/scoreHydration';
import { decideRefresh } from '../../lib/refreshDecision';
import {
  LIVE_MANUAL_COOLDOWN_MS,
  SCORES_AUTO_REFRESH_MS,
  type RefreshPlan,
} from '../../lib/refreshPolicy';
import { getOddsQuotaGuardState } from '../../lib/api/oddsUsage';
import { fetchTeamsCatalog } from '../../lib/teamsCatalog';
import { requireAdminAuthHeaders } from '../../lib/adminAuth';
import { buildOddsLookup, type CanonicalOddsItem, type CombinedOdds } from '../../lib/odds';
import { fetchScoresByGame, type ScorePack } from '../../lib/scores';
import { classifyScorePackStatus } from '../../lib/gameStatus';
import { isLiveIssue } from '../../lib/cfbScheduleAppHelpers';
import type { AliasMap } from '../../lib/teamNames';
import type { AppGame } from '../../lib/schedule';
import type { OddsUsageSnapshot } from '../../lib/apiUsage';

type UseLiveRefreshParams = {
  selectedSeason: number;
  selectedTab: number | 'postseason' | null;
  selectedWeek: number | null;
  weeks: number[];
  scheduleLoaded: boolean;
  games: AppGame[];
  visibleGames: AppGame[];
  scoreScopeGames: AppGame[];
  aliasMap: AliasMap;
  oddsUsage: OddsUsageSnapshot | null;
  refreshPlan: RefreshPlan;
  scoreHydrationState: ScoreHydrationState;
  setScoreHydrationState: Dispatch<SetStateAction<ScoreHydrationState>>;
  setIssues: Dispatch<SetStateAction<string[]>>;
  setOddsByKey: Dispatch<SetStateAction<Record<string, CombinedOdds>>>;
  setScoresByKey: Dispatch<SetStateAction<Record<string, ScorePack>>>;
  setOddsUsage: Dispatch<SetStateAction<OddsUsageSnapshot | null>>;
  setLastScoresRefreshAt: Dispatch<SetStateAction<string>>;
  loadingLive: boolean;
  setLoadingLive: Dispatch<SetStateAction<boolean>>;
  isDebug: boolean;
  /**
   * Called once when a live poll observes a real non-final → final game
   * transition (PLATFORM-080). Consumers wire this to `router.refresh()` so the
   * server `canonicalStandings` snapshot recomputes and records/ranks update.
   */
  onGamesFinalized?: () => void;
};

/**
 * Transition-aware finalization detector (PLATFORM-080). Given a poll's fetched
 * scores, the keys of the games actually watched this poll (the score request
 * scope), and the caller-held memory of previously-observed and already-final
 * game keys, returns true iff at least one game made a REAL non-final → final
 * transition this poll — i.e. a game watched in an earlier poll is now final. It
 * deliberately does NOT fire for:
 *   - a game observed for the first time that is already final (initial payload,
 *     or a game entering the score scope already final) — that is not a
 *     transition and canonical already reflects it (or navigation will),
 *   - a game that was already counted as final on a previous poll (no repeat).
 *
 * `observedKeys` is seeded from the watched SCOPE, not the score payload, so a
 * scheduled game that carried no attached score row on earlier polls (cold/stale
 * public cache, or a failed attach) still counts as observed — otherwise its
 * later finalization would be misread as a first-seen final and suppress the
 * refresh, leaving standings stale (the very bug this fixes). The
 * `observedKeys` / `finalKeys` sets are mutated in place to carry memory forward.
 * Callers use the result to trigger exactly one RSC refresh so server
 * `canonicalStandings` recomputes; no client standings derivation is involved.
 */
export function detectScoreFinalizations(params: {
  nextScores: Record<string, ScorePack>;
  scopeGameKeys: Iterable<string>;
  observedKeys: Set<string>;
  finalKeys: Set<string>;
}): boolean {
  const { nextScores, scopeGameKeys, observedKeys, finalKeys } = params;
  let transitioned = false;

  for (const [key, score] of Object.entries(nextScores)) {
    if (classifyScorePackStatus(score) !== 'final') continue;
    if (finalKeys.has(key)) continue; // already counted final — no repeat refresh
    // First time this key is final. A refresh is warranted only if we had
    // already watched the game on an earlier poll (necessarily as non-final).
    if (observedKeys.has(key)) transitioned = true;
    finalKeys.add(key);
  }

  // Record every game watched this poll (whether or not it had a score row) so a
  // later finalization counts as an observed transition. Seeded AFTER the check
  // so a game first seen already-final on this poll does not self-trigger.
  for (const key of scopeGameKeys) observedKeys.add(key);

  return transitioned;
}

export function nextBootstrapGuardState(params: {
  current: boolean;
  scheduleLoaded: boolean;
  didBootstrapThisPass?: boolean;
}): boolean {
  // Lifecycle invariant: bootstrap guard is scoped to a loaded schedule lifecycle.
  // When schedule unloads (rebuild/reset), bootstrap must re-arm for the next load.
  const { current, scheduleLoaded, didBootstrapThisPass = false } = params;
  if (!scheduleLoaded) return false;
  if (didBootstrapThisPass) return true;
  return current;
}

export function useLiveRefresh(params: UseLiveRefreshParams): {
  refreshLiveData: (options?: {
    manual?: boolean;
    includeOdds?: boolean;
    scoreScopeGamesOverride?: AppGame[];
  }) => Promise<void>;
} {
  const {
    selectedSeason,
    selectedTab,
    selectedWeek,
    weeks,
    scheduleLoaded,
    games,
    visibleGames,
    scoreScopeGames,
    aliasMap,
    oddsUsage,
    refreshPlan,
    scoreHydrationState,
    setScoreHydrationState,
    setIssues,
    setOddsByKey,
    setScoresByKey,
    setOddsUsage,
    setLastScoresRefreshAt,
    loadingLive,
    setLoadingLive,
    isDebug,
    onGamesFinalized,
  } = params;

  const liveRefreshInFlightRef = useRef<boolean>(false);
  const lastManualLiveRefreshMsRef = useRef<number>(0);
  const lastAutoScoresRefreshMsRef = useRef<number>(0);
  const hasAutoBootstrappedLiveRef = useRef<boolean>(false);
  const hasAttemptedLazyPostseasonHydrationRef = useRef<boolean>(false);
  // PLATFORM-080: memory of game keys observed across polls and those already
  // counted final, so we fire an RSC refresh only on a real non-final → final
  // transition (see detectScoreFinalizations).
  const observedScoreKeysRef = useRef<Set<string>>(new Set());
  const finalizedScoreKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Keep the bootstrap gate tied to scheduleLoaded transitions only.
    hasAutoBootstrappedLiveRef.current = nextBootstrapGuardState({
      current: hasAutoBootstrappedLiveRef.current,
      scheduleLoaded,
    });
  }, [scheduleLoaded]);

  const refreshLiveData = useCallback(
    async (options?: {
      manual?: boolean;
      includeOdds?: boolean;
      scoreScopeGamesOverride?: AppGame[];
    }): Promise<void> => {
      const manual = options?.manual ?? false;
      if (liveRefreshInFlightRef.current) return;

      const nowMs = Date.now();
      const shouldFetchOdds = options?.includeOdds ?? refreshPlan.odds.fetchOnStartup;
      const quota = getOddsQuotaGuardState(oddsUsage?.remaining);
      const refreshDecision = decideRefresh({
        hasGames: games.length > 0,
        manualCooldownActive:
          manual && nowMs - lastManualLiveRefreshMsRef.current < LIVE_MANUAL_COOLDOWN_MS,
        includeOddsRequested: shouldFetchOdds,
        oddsAutoDisabledByQuota: !manual && quota.disableAutoRefresh,
      });
      if (refreshDecision.kind === 'skip') {
        if (refreshDecision.reason === 'no-games') {
          setIssues((p) => [...p, 'No games loaded. CFBD schedule load may have failed.']);
        }
        return;
      }

      setIssues((prev) => prev.filter((issue) => !isLiveIssue(issue)));

      liveRefreshInFlightRef.current = true;
      setLoadingLive(true);
      if (manual) {
        lastManualLiveRefreshMsRef.current = nowMs;
      }

      try {
        const teams = await fetchTeamsCatalog().catch(() => []);

        if (refreshDecision.reason === 'odds-disabled-by-quota') {
          setIssues((p) => [
            ...p,
            `Odds auto-refresh skipped: low remaining quota (${oddsUsage?.remaining ?? 'unknown'}).`,
          ]);
        }

        if (refreshDecision.kind === 'scores_and_odds') {
          if (manual && quota.manualWarningOnly) {
            setIssues((p) => [
              ...p,
              `Odds refresh warning: remaining quota critically low (${oddsUsage?.remaining ?? 'unknown'}).`,
            ]);
          }
          try {
            const oddsRes = await fetch(
              `/api/odds?year=${selectedSeason}${manual ? '&refresh=1' : ''}`,
              {
                cache: 'no-store',
                headers: manual ? requireAdminAuthHeaders() : undefined,
              }
            );
            if (oddsRes.ok) {
              const oddsPayload = (await oddsRes.json()) as {
                items?: CanonicalOddsItem[];
                meta?: {
                  cache?: 'hit' | 'miss';
                  usage?: OddsUsageSnapshot | null;
                };
              };

              const canonicalItems = oddsPayload.items ?? [];

              setOddsUsage(oddsPayload.meta?.usage ?? null);
              setOddsByKey(buildOddsLookup(canonicalItems));
            } else {
              const t = await oddsRes.text().catch(() => '');
              setIssues((p) => [
                ...p,
                oddsRes.status === 402 || oddsRes.status === 429
                  ? `Odds quota error ${oddsRes.status}: ${t}`
                  : `Odds error ${oddsRes.status}: ${t}`,
              ]);
            }
          } catch (err) {
            setIssues((p) => [...p, `Odds fetch failed: ${(err as Error).message}`]);
          }
        }

        try {
          // Attachment invariant: scores are always requested against schedule-derived game scope.
          const scoreScopeForRequest = options?.scoreScopeGamesOverride ?? scoreScopeGames;

          const {
            scoresByKey: nextScores,
            issues: scoreIssues,
            debugSnapshot,
          } = await fetchScoresByGame({
            games,
            fallbackScopeGames: scoreScopeForRequest,
            aliasMap,
            season: selectedSeason,
            teams,
            debugTrace: isDebug,
            // Manual refresh authorizes the scores upstream refresh (mirrors the
            // odds path) so it can update scores; the public/auto path stays
            // cache-only (PLATFORM-075). The manual trigger is retained refresh
            // infrastructure — no live caller passes it since AdminDebugSurface
            // was removed, but the authorized-refresh capability is preserved.
            refresh: manual,
            authHeaders: manual ? requireAdminAuthHeaders() : undefined,
          });

          if (isDebug) {
            console.log('scores refresh scope', {
              selectedTab,
              selectedWeek,
              regularWeeks: weeks,
              visibleGamesCount: visibleGames.length,
              visibleGamesSample: visibleGames.slice(0, 5).map((game) => game.key),
              visibleSeasonTypes: Array.from(
                new Set(
                  visibleGames.map((game) => (game.stage === 'regular' ? 'regular' : 'postseason'))
                )
              ),
              visibleWeeks: Array.from(new Set(visibleGames.map((game) => game.week))).sort(
                (a, b) => a - b
              ),
              scoreScopeCount: scoreScopeForRequest.length,
              scoreScopeSample: scoreScopeForRequest.slice(0, 5).map((game) => game.key),
              scoreScopeSeasonTypes: Array.from(
                new Set(
                  scoreScopeForRequest.map((game) =>
                    game.stage === 'regular' ? 'regular' : 'postseason'
                  )
                )
              ),
              scoreScopeWeeks: Array.from(
                new Set(scoreScopeForRequest.map((game) => game.week))
              ).sort((a, b) => a - b),
              emptyScopeEarlyReturn: scoreScopeForRequest.length === 0,
              providerRowCount: debugSnapshot?.providerRowCount ?? null,
              attachedScoreCount: debugSnapshot?.attachedCount ?? null,
              scoreRequests: debugSnapshot?.requestUrls ?? [],
            });
          }

          if (scoreIssues.length) setIssues((p) => [...p, ...scoreIssues]);
          setScoresByKey((prev) => {
            const retained: Record<string, ScorePack> = {};
            for (const game of games) {
              const nextScore = nextScores[game.key];
              if (nextScore) {
                retained[game.key] = nextScore;
                continue;
              }
              const prevScore = prev[game.key];
              if (prevScore) {
                retained[game.key] = prevScore;
              }
            }
            return retained;
          });

          // PLATFORM-080: if this poll observed a game transition non-final →
          // final, refresh the RSC tree so server canonicalStandings recomputes
          // (the /api/scores write path already invalidated the standings tag).
          // liveDelta excludes final games, so without this the new final would
          // not reach standings until navigation. Transition-gated: never fires
          // on the initial payload's already-final games or repeat finals.
          const observedFinalization = detectScoreFinalizations({
            nextScores,
            // Seed observed from the watched scope (not the score payload) so a
            // scheduled game with no attached score row is still tracked and its
            // later finalization triggers the refresh.
            scopeGameKeys: scoreScopeForRequest.map((g) => g.key),
            observedKeys: observedScoreKeysRef.current,
            finalKeys: finalizedScoreKeysRef.current,
          });
          if (observedFinalization) onGamesFinalized?.();

          setLastScoresRefreshAt(new Date().toLocaleString());
          const loadedSeasonTypes = getHydrationSeasonTypes(scoreScopeForRequest);
          if (loadedSeasonTypes.length > 0) {
            setScoreHydrationState((prev) => markScoreHydrationLoaded(prev, loadedSeasonTypes));
          }
          if (!manual) {
            lastAutoScoresRefreshMsRef.current = Date.now();
          }
        } catch (err) {
          setIssues((p) => [...p, `Scores fetch failed: ${(err as Error).message}`]);
        }
      } finally {
        liveRefreshInFlightRef.current = false;
        setLoadingLive(false);
      }
    },
    [
      aliasMap,
      games,
      isDebug,
      oddsUsage,
      onGamesFinalized,
      refreshPlan.odds.fetchOnStartup,
      scoreScopeGames,
      selectedSeason,
      selectedTab,
      selectedWeek,
      setIssues,
      setLastScoresRefreshAt,
      setOddsByKey,
      setOddsUsage,
      setScoreHydrationState,
      setScoresByKey,
      visibleGames,
      weeks,
    ]
  );

  useEffect(() => {
    if (!scheduleLoaded || hasAutoBootstrappedLiveRef.current) return;
    const bootstrapScoreGames = getBootstrapScoreHydrationGames({
      games,
      selectedTab,
    });

    if (bootstrapScoreGames.length === 0) return;

    hasAutoBootstrappedLiveRef.current = nextBootstrapGuardState({
      current: hasAutoBootstrappedLiveRef.current,
      scheduleLoaded,
      didBootstrapThisPass: true,
    });
    void refreshLiveData({
      manual: false,
      includeOdds: refreshPlan.odds.fetchOnStartup,
      scoreScopeGamesOverride: bootstrapScoreGames,
    });
  }, [games, refreshLiveData, refreshPlan.odds.fetchOnStartup, scheduleLoaded, selectedTab]);

  useEffect(() => {
    if (!scheduleLoaded || !refreshPlan.scores.allowAutoOnFocus) return;

    const tryRefresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastAutoScoresRefreshMsRef.current < SCORES_AUTO_REFRESH_MS) return;
      void refreshLiveData({ manual: false, includeOdds: false });
    };

    const onFocus = () => {
      tryRefresh();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refreshLiveData, refreshPlan.scores.allowAutoOnFocus, scheduleLoaded]);

  useEffect(() => {
    if (selectedTab !== 'postseason') {
      hasAttemptedLazyPostseasonHydrationRef.current = false;
      return;
    }

    if (!scheduleLoaded || loadingLive) return;

    const lazyPostseasonGames = getLazyScoreHydrationGames({
      games,
      selectedTab,
      hydrationState: scoreHydrationState,
      hasAttemptedPostseasonHydration: hasAttemptedLazyPostseasonHydrationRef.current,
    });

    if (lazyPostseasonGames.length === 0) return;

    hasAttemptedLazyPostseasonHydrationRef.current = true;
    void refreshLiveData({
      manual: false,
      includeOdds: false,
      scoreScopeGamesOverride: lazyPostseasonGames,
    });
  }, [games, loadingLive, refreshLiveData, scheduleLoaded, scoreHydrationState, selectedTab]);

  return { refreshLiveData };
}
