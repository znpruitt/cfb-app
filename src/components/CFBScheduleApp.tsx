'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AliasEditorPanel from './AliasEditorPanel';
import IssuesPanel from './IssuesPanel';
import UploadPanel from './UploadPanel';
import GameWeekPanel from './GameWeekPanel';
import PostseasonPanel from './PostseasonPanel';
import WeekControls from './WeekControls';
import AdminUsagePanel from './AdminUsagePanel';
import ScoreAttachmentDebugPanel from './ScoreAttachmentDebugPanel';
import type { AliasStaging, DiagEntry } from '../lib/diagnostics';
import { parseOwnersCsv, type OwnerRow } from '../lib/parseOwnersCsv';
import { buildOddsByGame, type CombinedOdds, type OddsEvent } from '../lib/odds';
import { isTruePostseasonGame } from '../lib/postseason-display';
import { fetchScoresByGame, type ScorePack } from '../lib/scores';
import {
  getRefreshPlan,
  LIVE_MANUAL_COOLDOWN_MS,
  SCORES_AUTO_REFRESH_MS,
} from '../lib/refreshPolicy';
import { SEED_ALIASES, type AliasMap } from '../lib/teamNames';
import { normalizeAliasLookup } from '../lib/teamNormalization';
import { saveServerAliases } from '../lib/aliasesApi';
import { bootstrapAliasesAndCaches } from '../lib/bootstrap';
import { stageAliasFromMiss } from '../lib/aliasStaging';
import { pillClass } from '../lib/gameUi';
import {
  buildScheduleFromApi,
  fetchSeasonSchedule,
  type AppGame,
  type ScheduleFetchMeta,
} from '../lib/schedule';
import { fetchTeamsCatalog } from '../lib/teamsCatalog';
import { fetchConferencesCatalog } from '../lib/conferencesCatalog';
import { LEGACY_STORAGE_KEYS, seasonStorageKeys } from '../lib/storageKeys';
import { fetchLatestOddsUsageSnapshot, type OddsUsageSnapshot } from '../lib/apiUsage';
import { getOddsQuotaGuardState } from '../lib/api/oddsUsage';
import { chooseDefaultWeek, filterGamesForWeek } from '../lib/weekSelection';
import { deriveWeekDateMetadataByWeek, getPresentationTimeZone } from '../lib/weekPresentation';
import { deriveCanonicalActiveViewGames, deriveRegularWeekTabs } from '../lib/activeView';
import {
  EMPTY_SCORE_HYDRATION_STATE,
  getBootstrapScoreHydrationGames,
  getCanonicalPostseasonGames,
  getHydrationSeasonTypes,
  getLazyScoreHydrationGames,
  markScoreHydrationLoaded,
  type ScoreHydrationState,
} from '../lib/scoreHydration';
import {
  dedupeIssues,
  isLiveIssue,
  isScheduleIssue,
  isTransientScheduleIssue,
  summarizeGames,
} from '../lib/cfbScheduleAppHelpers';

const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === '1';
const DEFAULT_SEASON = Number(process.env.NEXT_PUBLIC_SEASON ?? new Date().getFullYear());

export default function CFBScheduleApp(): React.ReactElement {
  const hasBootstrappedRef = useRef<boolean>(false);

  const [selectedSeason] = useState<number>(DEFAULT_SEASON);
  const storageKeys = useMemo(() => seasonStorageKeys(selectedSeason), [selectedSeason]);

  const [games, setGames] = useState<AppGame[]>([]);
  const [byes, setByes] = useState<Record<number, string[]>>({});
  const [conferences, setConferences] = useState<string[]>(['ALL']);
  const [roster, setRoster] = useState<OwnerRow[]>([]);
  const [selectedConference, setSelectedConference] = useState<string>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('');
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [selectedTab, setSelectedTab] = useState<number | 'postseason' | null>(null);

  const [oddsByKey, setOddsByKey] = useState<Record<string, CombinedOdds>>({});
  const [scoresByKey, setScoresByKey] = useState<Record<string, ScorePack>>({});
  const [loadingLive, setLoadingLive] = useState<boolean>(false);
  const [loadingSchedule, setLoadingSchedule] = useState<boolean>(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [lastScoresRefreshAt, setLastScoresRefreshAt] = useState<string>('');
  const [lastOddsRefreshAt, setLastOddsRefreshAt] = useState<string>('');
  const [lastScheduleRefreshAt, setLastScheduleRefreshAt] = useState<string>('');
  const [scheduleMeta, setScheduleMeta] = useState<ScheduleFetchMeta>({});
  const [oddsCacheState, setOddsCacheState] = useState<'hit' | 'miss' | 'unknown'>('unknown');
  const [oddsUsage, setOddsUsage] = useState<OddsUsageSnapshot | null>(null);

  const [aliasMap, setAliasMap] = useState<AliasMap>({});
  const [editOpen, setEditOpen] = useState<boolean>(false);
  const [editDraft, setEditDraft] = useState<Array<{ key: string; value: string }>>([]);

  const [diag, setDiag] = useState<DiagEntry[]>([]);
  const [manualPostseasonOverrides, setManualPostseasonOverrides] = useState<
    Record<string, Partial<AppGame>>
  >({});
  const [aliasStaging, setAliasStaging] = useState<AliasStaging>({ upserts: {}, deletes: [] });
  const [aliasToast, setAliasToast] = useState<string | null>(null);

  const [ownersLoadedFromCache, setOwnersLoadedFromCache] = useState<boolean>(false);
  const [hasCachedOwners, setHasCachedOwners] = useState<boolean>(false);
  const [scheduleLoaded, setScheduleLoaded] = useState<boolean>(false);
  const [scoreHydrationState, setScoreHydrationState] = useState<ScoreHydrationState>(
    EMPTY_SCORE_HYDRATION_STATE
  );

  const liveRefreshInFlightRef = useRef<boolean>(false);
  const scheduleRefreshInFlightRef = useRef<boolean>(false);
  const lastManualLiveRefreshMsRef = useRef<number>(0);
  const lastAutoScoresRefreshMsRef = useRef<number>(0);
  const hasAutoBootstrappedLiveRef = useRef<boolean>(false);
  const hasAttemptedLazyPostseasonHydrationRef = useRef<boolean>(false);

  const applySavedAliasMap = useCallback(
    (saved: AliasMap) => {
      setAliasMap(saved);
      window.localStorage.setItem(storageKeys.aliasMap, JSON.stringify(saved));
    },
    [storageKeys.aliasMap]
  );

  const persistAliasChanges = useCallback(
    async (upserts: AliasMap, deletes: string[] = []): Promise<AliasMap> => {
      const saved = await saveServerAliases(upserts, deletes, selectedSeason);
      applySavedAliasMap(saved);
      return saved;
    },
    [applySavedAliasMap, selectedSeason]
  );

  const tryParseOwnersCSV = useCallback((text: string) => {
    setRoster(parseOwnersCsv(text));
  }, []);

  const clearScheduleDerivedState = useCallback(() => {
    setGames([]);
    setByes({});
    setConferences(['ALL']);
    setSelectedWeek(null);
    setSelectedTab(null);
    setSelectedConference('ALL');
    setTeamFilter('');
    setOddsByKey({});
    setScoresByKey({});
    setIssues([]);
    setDiag([]);
    setLastScoresRefreshAt('');
    setLastOddsRefreshAt('');
    setLastScheduleRefreshAt('');
    setScheduleMeta({});
    setOddsCacheState('unknown');
    setOddsUsage(null);
    setScheduleLoaded(false);
    setScoreHydrationState(EMPTY_SCORE_HYDRATION_STATE);
    hasAutoBootstrappedLiveRef.current = false;
    hasAttemptedLazyPostseasonHydrationRef.current = false;
  }, []);

  const clearOwnersDerivedState = useCallback(() => {
    setRoster([]);
  }, []);

  // API-first schedule loader. CFBD now defines the game universe for normal operation.
  const loadScheduleFromApi = useCallback(
    async (
      overrideAliasMap?: AliasMap,
      overrideManualOverrides?: Record<string, Partial<AppGame>>,
      options?: { bypassCache?: boolean }
    ): Promise<boolean> => {
      if (scheduleRefreshInFlightRef.current) return false;
      scheduleRefreshInFlightRef.current = true;
      setLoadingSchedule(true);

      try {
        setDiag([]);
        const [schedulePayload, teams, conferenceRecords] = await Promise.all([
          fetchSeasonSchedule(selectedSeason, { bypassCache: options?.bypassCache }),
          fetchTeamsCatalog(),
          fetchConferencesCatalog({ bypassCache: options?.bypassCache }),
        ]);
        const scheduleItems = schedulePayload.items;
        setScheduleMeta(schedulePayload.meta ?? {});
        setLastScheduleRefreshAt(new Date().toLocaleString());
        if (IS_DEBUG) {
          const seasonWeeks = Array.from(
            new Set(scheduleItems.map((item) => item.week).filter((w) => Number.isFinite(w)))
          ).sort((a, b) => a - b);
          const regularCount = scheduleItems.filter(
            (item) => item.seasonType !== 'postseason'
          ).length;
          const postseasonCount = scheduleItems.filter(
            (item) => item.seasonType === 'postseason'
          ).length;

          console.log('raw API response', {
            count: scheduleItems.length,
            weeks: seasonWeeks,
            regular: regularCount,
            postseason: postseasonCount,
            sample: scheduleItems.slice(0, 10).map((item) => ({
              id: item.id,
              week: item.week,
              home: item.homeTeam,
              away: item.awayTeam,
              seasonType: item.seasonType ?? 'unknown',
            })),
          });
        }
        const built = buildScheduleFromApi({
          scheduleItems,
          teams,
          aliasMap: overrideAliasMap ?? aliasMap,
          season: selectedSeason,
          manualOverrides: overrideManualOverrides ?? manualPostseasonOverrides,
          conferenceRecords,
        });

        const nextScheduleIssues = built.issues.filter((issue) => !isTransientScheduleIssue(issue));
        if (IS_DEBUG && built.hydrationDiagnostics.length) {
          const actionableDiagnostics = built.hydrationDiagnostics.filter(
            (d) => d.action !== 'template-preserved'
          );
          if (actionableDiagnostics.length) {
            nextScheduleIssues.push(
              ...actionableDiagnostics
                .slice(0, 8)
                .map((d) => `hydrate:${d.action}:${d.eventId}:${d.reason}`)
            );
          }
        }

        setIssues((prev) =>
          dedupeIssues([...prev.filter((issue) => !isScheduleIssue(issue)), ...nextScheduleIssues])
        );

        if (!built.games.length) {
          clearScheduleDerivedState();
          return false;
        }

        setGames(built.games);
        const regularWeeks = deriveRegularWeekTabs(built.games);
        setByes(built.byes);
        setConferences(built.conferences);
        setScheduleLoaded(true);
        if (selectedWeek == null && regularWeeks.length) {
          const nextDefaultWeek = chooseDefaultWeek({ games: built.games, regularWeeks });
          setSelectedWeek(nextDefaultWeek);
          setSelectedTab(nextDefaultWeek);
        }
        return true;
      } catch (error) {
        const scheduleFailure = `CFBD schedule load failed: ${(error as Error).message}`;
        setIssues((prev) =>
          dedupeIssues([...prev.filter((issue) => !isScheduleIssue(issue)), scheduleFailure])
        );
        return false;
      } finally {
        scheduleRefreshInFlightRef.current = false;
        setLoadingSchedule(false);
      }
    },
    [aliasMap, clearScheduleDerivedState, manualPostseasonOverrides, selectedSeason, selectedWeek]
  );

  const clearCachedOwners = useCallback(() => {
    window.localStorage.removeItem(storageKeys.ownersCsv);
    window.localStorage.removeItem(LEGACY_STORAGE_KEYS.ownersCsv);
    setHasCachedOwners(false);
    setOwnersLoadedFromCache(false);
    clearOwnersDerivedState();
  }, [clearOwnersDerivedState, storageKeys.ownersCsv]);

  const showAliasToast = useCallback((message: string, timeoutMs: number = 1200) => {
    setAliasToast(message);
    setTimeout(() => setAliasToast(null), timeoutMs);
  }, []);

  useEffect(() => {
    if (hasBootstrappedRef.current) return;
    hasBootstrappedRef.current = true;

    (async () => {
      const {
        aliasMap: bootAliasMap,
        aliasLoadIssue,
        ownersCsvText,
      } = await bootstrapAliasesAndCaches({ season: selectedSeason, seedAliases: SEED_ALIASES });

      setAliasMap(bootAliasMap);
      if (aliasLoadIssue) setIssues((p) => [...p, aliasLoadIssue]);

      setHasCachedOwners(Boolean(ownersCsvText));

      let loadedOverrides: Record<string, Partial<AppGame>> = {};
      try {
        let rawOverrides = window.localStorage.getItem(storageKeys.postseasonOverrides);
        if (!rawOverrides) {
          rawOverrides = window.localStorage.getItem(LEGACY_STORAGE_KEYS.postseasonOverrides);
          if (rawOverrides) {
            window.localStorage.setItem(storageKeys.postseasonOverrides, rawOverrides);
          }
        }
        if (rawOverrides)
          loadedOverrides = JSON.parse(rawOverrides) as Record<string, Partial<AppGame>>;
      } catch {
        loadedOverrides = {};
      }
      setManualPostseasonOverrides(loadedOverrides);

      await loadScheduleFromApi(bootAliasMap, loadedOverrides);

      if (ownersCsvText) {
        setOwnersLoadedFromCache(true);
        tryParseOwnersCSV(ownersCsvText);
      }
    })();
  }, [loadScheduleFromApi, selectedSeason, storageKeys.postseasonOverrides, tryParseOwnersCSV]);

  const onOwnersFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      window.localStorage.setItem(storageKeys.ownersCsv, text);
      setHasCachedOwners(true);
      setOwnersLoadedFromCache(false);
      tryParseOwnersCSV(text);
    },
    [storageKeys.ownersCsv, tryParseOwnersCSV]
  );

  useEffect(() => {
    if (selectedTab == null && selectedWeek != null) {
      setSelectedTab(selectedWeek);
    }
  }, [selectedTab, selectedWeek]);

  const weeks = useMemo(() => deriveRegularWeekTabs(games), [games]);
  const presentationTimeZone = useMemo(() => getPresentationTimeZone(), []);
  const weekDateMetadataByWeek = useMemo(
    () => deriveWeekDateMetadataByWeek(games, presentationTimeZone),
    [games, presentationTimeZone]
  );

  const rosterByTeam = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roster) m.set(r.team, r.owner);
    return m;
  }, [roster]);

  const filteredWeekGames = useMemo(() => {
    if (selectedWeek == null) return [] as AppGame[];
    const tf = teamFilter.toLowerCase();
    const next = filterGamesForWeek(games, selectedWeek).filter((g) => {
      const confOk =
        selectedConference === 'ALL' ||
        g.homeConf === selectedConference ||
        g.awayConf === selectedConference;
      const teamOk =
        !tf || g.csvHome.toLowerCase().includes(tf) || g.csvAway.toLowerCase().includes(tf);
      return confOk && teamOk;
    });

    if (IS_DEBUG) {
      summarizeGames(`displayGames: week ${selectedWeek}`, next);
    }

    return next;
  }, [games, selectedConference, selectedWeek, teamFilter]);

  const postseasonGames = useMemo(() => {
    const tf = teamFilter.toLowerCase();
    return games.filter(isTruePostseasonGame).filter((g) => {
      const confOk =
        selectedConference === 'ALL' ||
        g.homeConf === selectedConference ||
        g.awayConf === selectedConference;
      const teamOk =
        !tf ||
        g.csvHome.toLowerCase().includes(tf) ||
        g.csvAway.toLowerCase().includes(tf) ||
        (g.label ?? '').toLowerCase().includes(tf);
      return confOk && teamOk;
    });
  }, [games, selectedConference, teamFilter]);

  const canonicalPostseasonGames = useMemo(() => getCanonicalPostseasonGames(games), [games]);

  const hasPostseasonGames = canonicalPostseasonGames.length > 0;

  const visibleGames = useMemo(() => {
    if (selectedTab === 'postseason') return postseasonGames;
    return filteredWeekGames;
  }, [filteredWeekGames, postseasonGames, selectedTab]);

  const hasActiveViewFilters = selectedConference !== 'ALL' || teamFilter.trim().length > 0;

  const scoreScopeGames = useMemo(() => {
    if (visibleGames.length > 0 || hasActiveViewFilters) {
      return visibleGames;
    }

    return deriveCanonicalActiveViewGames({
      games,
      selectedTab,
      selectedWeek,
    });
  }, [games, hasActiveViewFilters, selectedTab, selectedWeek, visibleGames]);

  const refreshPlan = useMemo(
    () =>
      getRefreshPlan({
        season: selectedSeason,
        visibleGames,
        scoresByKey,
      }),
    [scoresByKey, selectedSeason, visibleGames]
  );

  const refreshLiveData = useCallback(
    async (options?: {
      manual?: boolean;
      includeOdds?: boolean;
      scoreScopeGamesOverride?: AppGame[];
    }): Promise<void> => {
      const manual = options?.manual ?? false;
      if (liveRefreshInFlightRef.current) return;

      const nowMs = Date.now();
      if (manual && nowMs - lastManualLiveRefreshMsRef.current < LIVE_MANUAL_COOLDOWN_MS) {
        return;
      }

      setIssues((prev) => prev.filter((issue) => !isLiveIssue(issue)));
      setDiag([]);
      if (!games.length) {
        setIssues((p) => [...p, 'No games loaded. CFBD schedule load may have failed.']);
        return;
      }

      liveRefreshInFlightRef.current = true;
      setLoadingLive(true);
      if (manual) {
        lastManualLiveRefreshMsRef.current = nowMs;
      }

      try {
        const teams = await fetchTeamsCatalog().catch(() => []);
        const shouldFetchOdds = options?.includeOdds ?? refreshPlan.odds.fetchOnStartup;

        if (shouldFetchOdds) {
          const quota = getOddsQuotaGuardState(oddsUsage?.remaining);
          if (!manual && quota.disableAutoRefresh) {
            setIssues((p) => [
              ...p,
              `Odds auto-refresh skipped: low remaining quota (${oddsUsage?.remaining ?? 'unknown'}).`,
            ]);
          } else {
            if (manual && quota.manualWarningOnly) {
              setIssues((p) => [
                ...p,
                `Odds refresh warning: remaining quota critically low (${oddsUsage?.remaining ?? 'unknown'}).`,
              ]);
            }
            try {
              const oddsRes = await fetch(`/api/odds`, { cache: 'no-store' });
              if (oddsRes.ok) {
                const oddsPayload = (await oddsRes.json()) as
                  | OddsEvent[]
                  | {
                      items?: OddsEvent[];
                      meta?: {
                        cache?: 'hit' | 'miss';
                        usage?: OddsUsageSnapshot | null;
                      };
                    };
                const oddsEvents = Array.isArray(oddsPayload)
                  ? oddsPayload
                  : (oddsPayload.items ?? []);
                const cacheState = Array.isArray(oddsPayload)
                  ? 'unknown'
                  : (oddsPayload.meta?.cache ?? 'unknown');
                setOddsCacheState(cacheState);
                setOddsUsage(Array.isArray(oddsPayload) ? null : (oddsPayload.meta?.usage ?? null));
                const next = buildOddsByGame({ games, oddsEvents, aliasMap, teams });
                setOddsByKey(next);
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
            debugTrace: IS_DEBUG,
          });

          if (IS_DEBUG) {
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
      oddsUsage,
      refreshPlan.odds.fetchOnStartup,
      scoreScopeGames,
      selectedSeason,
      selectedTab,
      selectedWeek,
      visibleGames,
      weeks,
    ]
  );

  useEffect(() => {
    void fetchLatestOddsUsageSnapshot()
      .then((snapshot) => {
        setOddsUsage(snapshot);
      })
      .catch(() => {
        // non-fatal diagnostics fetch
      });
  }, []);

  useEffect(() => {
    if (!scheduleLoaded || hasAutoBootstrappedLiveRef.current) return;

    const bootstrapScoreGames = getBootstrapScoreHydrationGames({
      games,
      selectedTab,
    });

    if (bootstrapScoreGames.length === 0) return;

    hasAutoBootstrappedLiveRef.current = true;
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

  const stageAliasWithToast = useCallback(
    (providerName: string, csvName: string) => {
      setAliasStaging((prev) => stageAliasFromMiss(providerName, csvName, prev));
      showAliasToast(`Staged alias: "${providerName}" → "${csvName}"`);
    },
    [showAliasToast]
  );

  const commitStagedAliases = useCallback(async () => {
    if (!Object.keys(aliasStaging.upserts).length && !aliasStaging.deletes.length) return;
    try {
      await persistAliasChanges(aliasStaging.upserts, aliasStaging.deletes);
      setAliasStaging({ upserts: {}, deletes: [] });
      showAliasToast('Aliases saved. Rebuilding…', 1800);

      await loadScheduleFromApi();
    } catch (err) {
      setIssues((p) => [...p, `Alias save failed: ${(err as Error).message}`]);
      showAliasToast('Alias save failed.', 1800);
    }
  }, [aliasStaging, persistAliasChanges, showAliasToast, loadScheduleFromApi]);

  const openEditor = useCallback(() => {
    setEditDraft(
      Object.entries(aliasMap)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, value]) => ({ key, value }))
    );
    setEditOpen(true);
  }, [aliasMap]);

  const updateDraftKey = useCallback((idx: number, v: string) => {
    setEditDraft((prev) => prev.map((row, i) => (i === idx ? { ...row, key: v } : row)));
  }, []);

  const updateDraftValue = useCallback((idx: number, v: string) => {
    setEditDraft((prev) => prev.map((row, i) => (i === idx ? { ...row, value: v } : row)));
  }, []);

  const addDraftRow = useCallback(() => {
    setEditDraft((prev) => [...prev, { key: '', value: '' }]);
  }, []);

  const removeDraftRow = useCallback((idx: number) => {
    setEditDraft((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const saveDraft = useCallback(async () => {
    const cleaned: AliasMap = {};
    for (const row of editDraft) {
      const k = normalizeAliasLookup(row.key);
      const v = row.value.trim();
      if (!k || !v) continue;
      cleaned[k] = v;
    }

    const deletes: string[] = [];
    for (const k of Object.keys(aliasMap)) {
      if (!(k in cleaned)) deletes.push(k);
    }

    try {
      await persistAliasChanges(cleaned, deletes);
      setEditOpen(false);
      await loadScheduleFromApi();
    } catch (err) {
      setIssues((p) => [...p, `Alias save failed: ${(err as Error).message}`]);
    }
  }, [editDraft, aliasMap, persistAliasChanges, loadScheduleFromApi]);

  const savePostseasonOverride = useCallback(
    (eventId: string, patch: Partial<AppGame>) => {
      const applyOverride = (base: AppGame, override: Partial<AppGame>): AppGame => ({
        ...base,
        ...override,
        participants: {
          home: override.participants?.home ?? base.participants.home,
          away: override.participants?.away ?? base.participants.away,
        },
        sources: { ...base.sources, ...(override.sources ?? {}) },
      });

      let nextOverrides: Record<string, Partial<AppGame>> | null = null;
      setManualPostseasonOverrides((prev) => {
        const next = { ...prev, [eventId]: { ...(prev[eventId] ?? {}), ...patch } };
        window.localStorage.setItem(storageKeys.postseasonOverrides, JSON.stringify(next));
        nextOverrides = next;

        const override = next[eventId];
        if (override) {
          setGames((prevGames) =>
            prevGames.map((g) => (g.eventId === eventId ? applyOverride(g, override) : g))
          );
        }

        return next;
      });

      if (nextOverrides) {
        void loadScheduleFromApi(undefined, nextOverrides);
      }
    },
    [loadScheduleFromApi, storageKeys.postseasonOverrides]
  );
  return (
    <div className="p-6 space-y-6 text-gray-900 bg-white dark:text-zinc-100 dark:bg-zinc-950">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">CFB Office Pool</h1>
          <p className="text-sm text-gray-600 dark:text-zinc-400">
            API-first schedule (CFBD), owners CSV support, and persistent aliases for manual repair.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <button
            className={`px-3 py-2 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 ${
              loadingLive ? 'opacity-60' : ''
            }`}
            onClick={() => void refreshLiveData({ manual: true })}
            disabled={loadingLive || games.length === 0}
            title={
              games.length === 0
                ? 'Schedule load failed'
                : 'Refresh scores and context-relevant odds'
            }
          >
            {loadingLive ? 'Refreshing…' : 'Refresh data'}
          </button>
          <button
            className="px-3 py-2 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            onClick={openEditor}
            title="Edit alias map (persists on server)"
          >
            Edit Aliases
          </button>
          <button
            className="px-3 py-2 rounded border border-gray-200 bg-gray-50 text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            onClick={() => void loadScheduleFromApi(undefined, undefined, { bypassCache: true })}
            disabled={loadingSchedule}
            title="Force a schedule rebuild from CFBD"
          >
            {loadingSchedule ? 'Rebuilding…' : 'Rebuild schedule'}
          </button>
          <span className="text-xs text-gray-600 dark:text-zinc-400">
            Schedule: {lastScheduleRefreshAt || 'not loaded'} ({scheduleMeta.cache ?? 'unknown'}{' '}
            cache)
          </span>
          <span className="text-xs text-gray-600 dark:text-zinc-400">
            Scores: {lastScoresRefreshAt || 'not refreshed'}
          </span>
          <span className="text-xs text-gray-600 dark:text-zinc-400">
            Odds: {lastOddsRefreshAt || 'manual / policy-gated'} ({oddsCacheState} cache)
          </span>
        </div>
      </header>

      <p className="text-xs text-gray-600 dark:text-zinc-400">
        Conservative refresh policy: schedule rebuilds are manual, scores may auto-refresh on focus
        for active views, and odds remain policy-gated to protect monthly API quotas.
      </p>

      <AdminUsagePanel />
      <ScoreAttachmentDebugPanel season={selectedSeason} onStageAlias={stageAliasWithToast} />

      <IssuesPanel
        issues={issues}
        diag={diag}
        aliasStaging={aliasStaging}
        aliasToast={aliasToast}
        pillClass={pillClass}
        onCommitStagedAliases={() => void commitStagedAliases()}
        onStageAlias={stageAliasWithToast}
      />

      <AliasEditorPanel
        open={editOpen}
        season={selectedSeason}
        draft={editDraft}
        onClose={() => setEditOpen(false)}
        onAddRow={addDraftRow}
        onSave={() => void saveDraft()}
        onUpdateKey={updateDraftKey}
        onUpdateValue={updateDraftValue}
        onRemoveRow={removeDraftRow}
      />

      <UploadPanel
        gamesCount={games.length}
        weeksCount={weeks.length}
        conferencesCount={conferences.length > 0 ? conferences.length - 1 : 0}
        ownersCount={roster.length}
        ownersLoadedFromCache={ownersLoadedFromCache}
        hasCachedOwners={hasCachedOwners}
        scheduleLoaded={scheduleLoaded}
        onOwnersFile={onOwnersFile}
        onClearCachedOwners={clearCachedOwners}
      />

      {(weeks.length > 0 || hasPostseasonGames) && (
        <>
          <WeekControls
            weeks={weeks}
            selectedTab={selectedTab}
            weekDateLabels={
              new Map(weeks.map((week) => [week, weekDateMetadataByWeek.get(week)?.label ?? '']))
            }
            hasPostseason={hasPostseasonGames}
            selectedConference={selectedConference}
            conferences={conferences}
            teamFilter={teamFilter}
            onSelectWeek={(week) => {
              setSelectedWeek(week);
              setSelectedTab(week);
            }}
            onSelectPostseason={() => setSelectedTab('postseason')}
            onSelectedConferenceChange={setSelectedConference}
            onTeamFilterChange={setTeamFilter}
          />

          {selectedTab !== 'postseason' && selectedWeek != null && (
            <section className="space-y-3">
              <div className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
                <span className="font-semibold">Week {selectedWeek}</span>
                {weekDateMetadataByWeek.get(selectedWeek)?.label ? (
                  <> · {weekDateMetadataByWeek.get(selectedWeek)?.label}</>
                ) : null}{' '}
                · {filteredWeekGames.length} matchup{filteredWeekGames.length === 1 ? '' : 's'}{' '}
                shown
              </div>
              <GameWeekPanel
                games={filteredWeekGames}
                byes={byes[selectedWeek] ?? []}
                oddsByKey={oddsByKey}
                scoresByKey={scoresByKey}
                rosterByTeam={rosterByTeam}
                isDebug={IS_DEBUG}
                onSavePostseasonOverride={savePostseasonOverride}
                displayTimeZone={presentationTimeZone}
              />
            </section>
          )}

          {selectedTab === 'postseason' && hasPostseasonGames && (
            <PostseasonPanel
              games={postseasonGames}
              oddsByKey={oddsByKey}
              scoresByKey={scoresByKey}
              rosterByTeam={rosterByTeam}
              isDebug={IS_DEBUG}
              onSavePostseasonOverride={savePostseasonOverride}
            />
          )}
        </>
      )}
    </div>
  );
}
