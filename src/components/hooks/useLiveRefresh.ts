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
import { isLiveIssue } from '../../lib/cfbScheduleAppHelpers';
import type { AliasMap } from '../../lib/teamNames';
import type { AppGame } from '../../lib/schedule';
import type { OddsUsageSnapshot } from '../../lib/apiUsage';
import type { DiagEntry } from '../../lib/diagnostics';

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
  setDiag: Dispatch<SetStateAction<DiagEntry[]>>;
  setOddsByKey: Dispatch<SetStateAction<Record<string, CombinedOdds>>>;
  setScoresByKey: Dispatch<SetStateAction<Record<string, ScorePack>>>;
  setOddsCacheState: Dispatch<SetStateAction<'hit' | 'miss' | 'unknown'>>;
  setOddsUsage: Dispatch<SetStateAction<OddsUsageSnapshot | null>>;
  setLastOddsRefreshAt: Dispatch<SetStateAction<string>>;
  setLastScoresRefreshAt: Dispatch<SetStateAction<string>>;
  loadingLive: boolean;
  setLoadingLive: Dispatch<SetStateAction<boolean>>;
  isDebug: boolean;
};

export function nextBootstrapGuardState(params: {
  current: boolean;
  scheduleLoaded: boolean;
  didBootstrapThisPass?: boolean;
}): boolean {
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
    setDiag,
    setOddsByKey,
    setScoresByKey,
    setOddsCacheState,
    setOddsUsage,
    setLastOddsRefreshAt,
    setLastScoresRefreshAt,
    loadingLive,
    setLoadingLive,
    isDebug,
  } = params;

  const liveRefreshInFlightRef = useRef<boolean>(false);
  const lastManualLiveRefreshMsRef = useRef<number>(0);
  const lastAutoScoresRefreshMsRef = useRef<number>(0);
  const hasAutoBootstrappedLiveRef = useRef<boolean>(false);
  const hasAttemptedLazyPostseasonHydrationRef = useRef<boolean>(false);

  useEffect(() => {
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
        manual,
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
      setDiag([]);

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
              const cacheState = oddsPayload.meta?.cache ?? 'unknown';

              setOddsCacheState(cacheState);
              setOddsUsage(oddsPayload.meta?.usage ?? null);
              setOddsByKey(buildOddsLookup(canonicalItems));
              setLastOddsRefreshAt(new Date().toLocaleString());
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
          const scoreScopeForRequest = options?.scoreScopeGamesOverride ?? scoreScopeGames;

          const {
            scoresByKey: nextScores,
            issues: scoreIssues,
            diag: scoreDiag,
            debugSnapshot,
          } = await fetchScoresByGame({
            games,
            fallbackScopeGames: scoreScopeForRequest,
            aliasMap,
            season: selectedSeason,
            teams,
            debugTrace: isDebug,
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
          if (scoreDiag.length) setDiag((p) => [...p, ...scoreDiag]);
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
      refreshPlan.odds.fetchOnStartup,
      scoreScopeGames,
      selectedSeason,
      selectedTab,
      selectedWeek,
      setDiag,
      setIssues,
      setLastOddsRefreshAt,
      setLastScoresRefreshAt,
      setOddsByKey,
      setOddsCacheState,
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
