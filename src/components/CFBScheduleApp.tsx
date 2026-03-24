'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import AdminDebugSurface from './AdminDebugSurface';
import GameWeekPanel from './GameWeekPanel';
import MatchupsWeekPanel from './MatchupsWeekPanel';
import WeekViewTabs, { type WeekViewMode } from './WeekViewTabs';
import PostseasonPanel from './PostseasonPanel';
import StandingsPanel from './StandingsPanel';
import OverviewPanel from './OverviewPanel';
import OwnerPanel from './OwnerPanel';
import WeekControls from './WeekControls';
import type { AliasStaging, DiagEntry } from '../lib/diagnostics';
import { parseOwnersCsv, type OwnerRow } from '../lib/parseOwnersCsv';
import { buildOddsLookup, type CanonicalOddsItem, type CombinedOdds } from '../lib/odds';
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
import { countRenderedMatchupCards, deriveWeekMatchupSections } from '../lib/matchups';
import { deriveStandings, deriveStandingsCoverage } from '../lib/standings';
import { deriveAutonomousOverviewScope, deriveOverviewSnapshot } from '../lib/overview';
import { deriveOwnerViewSnapshot } from '../lib/ownerView';
import {
  buildScheduleFromApi,
  fetchSeasonSchedule,
  type AppGame,
  type ScheduleFetchMeta,
} from '../lib/schedule';
import { fetchTeamsCatalog } from '../lib/teamsCatalog';
import type { TeamCatalogItem } from '../lib/teamIdentity';
import { fetchConferencesCatalog } from '../lib/conferencesCatalog';
import { LEGACY_STORAGE_KEYS, seasonStorageKeys } from '../lib/storageKeys';
import { fetchLatestOddsUsageSnapshot, type OddsUsageSnapshot } from '../lib/apiUsage';
import { requireAdminAuthHeaders } from '../lib/adminAuth';
import { saveServerOwnersCsv } from '../lib/ownersApi';
import { saveServerPostseasonOverrides } from '../lib/postseasonOverridesApi';
import { getOddsQuotaGuardState } from '../lib/api/oddsUsage';
import { chooseDefaultWeek, filterGamesForWeek } from '../lib/weekSelection';
import { deriveWeekDateMetadataByWeek, getPresentationTimeZone } from '../lib/weekPresentation';
import {
  deriveCanonicalActiveViewGames,
  derivePrimarySurfaceKind,
  deriveRegularWeekTabs,
  shouldRenderPrimaryViewSection,
} from '../lib/activeView';
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
import { getAdminAlertCount } from '../lib/adminDiagnostics';
import {
  buildRankingsLookup,
  fetchSeasonRankings,
  getDefaultRankingsSeason,
  selectRankingsWeek,
  type RankingsResponse,
} from '../lib/rankings';

const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === '1';
const EXPLICIT_SEASON = Number.parseInt(process.env.NEXT_PUBLIC_SEASON ?? '', 10);
const DEFAULT_SEASON = getDefaultRankingsSeason(
  Number.isFinite(EXPLICIT_SEASON) ? EXPLICIT_SEASON : null
);

type CFBScheduleAppProps = {
  surface?: 'league' | 'admin';
  initialGames?: AppGame[];
  initialIssues?: string[];
  initialRoster?: OwnerRow[];
  initialWeekViewMode?: WeekViewMode;
};

export default function CFBScheduleApp({
  surface = 'league',
  initialGames = [],
  initialIssues = [],
  initialRoster = [],
  initialWeekViewMode = 'overview',
}: CFBScheduleAppProps = {}): React.ReactElement {
  const hasBootstrappedRef = useRef<boolean>(false);

  const [selectedSeason] = useState<number>(DEFAULT_SEASON);
  const storageKeys = useMemo(() => seasonStorageKeys(selectedSeason), [selectedSeason]);

  const [games, setGames] = useState<AppGame[]>(initialGames);
  const [byes, setByes] = useState<Record<number, string[]>>({});
  const [conferences, setConferences] = useState<string[]>(['ALL']);
  const [teamCatalog, setTeamCatalog] = useState<TeamCatalogItem[]>([]);
  const [roster, setRoster] = useState<OwnerRow[]>(initialRoster);
  const [selectedConference, setSelectedConference] = useState<string>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('');
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);
  const [selectedTab, setSelectedTab] = useState<number | 'postseason' | null>(null);
  const [weekViewMode, setWeekViewMode] = useState<WeekViewMode>(initialWeekViewMode);
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);

  const [oddsByKey, setOddsByKey] = useState<Record<string, CombinedOdds>>({});
  const [scoresByKey, setScoresByKey] = useState<Record<string, ScorePack>>({});
  const [loadingLive, setLoadingLive] = useState<boolean>(false);
  const [loadingSchedule, setLoadingSchedule] = useState<boolean>(false);
  const [issues, setIssues] = useState<string[]>(initialIssues);
  const [lastScoresRefreshAt, setLastScoresRefreshAt] = useState<string>('');
  const [lastOddsRefreshAt, setLastOddsRefreshAt] = useState<string>('');
  const [lastScheduleRefreshAt, setLastScheduleRefreshAt] = useState<string>('');
  const [scheduleMeta, setScheduleMeta] = useState<ScheduleFetchMeta>({});
  const [oddsCacheState, setOddsCacheState] = useState<'hit' | 'miss' | 'unknown'>('unknown');
  const [oddsUsage, setOddsUsage] = useState<OddsUsageSnapshot | null>(null);
  const [rankings, setRankings] = useState<RankingsResponse | null>(null);

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
    setTeamCatalog([]);
    setSelectedWeek(null);
    setSelectedTab(null);
    setSelectedConference('ALL');
    setTeamFilter('');
    setWeekViewMode('overview');
    setSelectedOwner(null);
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
    setRankings(null);
    setScheduleLoaded(false);
    setScoreHydrationState(EMPTY_SCORE_HYDRATION_STATE);
    hasAutoBootstrappedLiveRef.current = false;
    hasAttemptedLazyPostseasonHydrationRef.current = false;
  }, []);

  const clearOwnersDerivedState = useCallback(() => {
    setRoster([]);
  }, []);

  const loadRankings = useCallback(
    async (options?: { bypassCache?: boolean }) => {
      try {
        const nextRankings = await fetchSeasonRankings(selectedSeason, {
          bypassCache: options?.bypassCache,
        });
        setRankings(nextRankings);
      } catch (error) {
        setIssues((prev) =>
          dedupeIssues([
            ...prev.filter((issue) => !issue.startsWith('CFBD rankings load failed:')),
            `CFBD rankings load failed: ${(error as Error).message}`,
          ])
        );
      }
    },
    [selectedSeason]
  );

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
        setTeamCatalog(teams);
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
        if (options?.bypassCache) {
          await loadRankings({ bypassCache: true });
        }
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
    [
      aliasMap,
      clearScheduleDerivedState,
      loadRankings,
      manualPostseasonOverrides,
      selectedSeason,
      selectedWeek,
    ]
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
        ownersLoadIssue,
        postseasonOverrides: loadedOverrides,
        postseasonOverridesLoadIssue,
      } = await bootstrapAliasesAndCaches({ season: selectedSeason, seedAliases: SEED_ALIASES });

      setAliasMap(bootAliasMap);
      if (aliasLoadIssue) setIssues((p) => [...p, aliasLoadIssue]);
      if (ownersLoadIssue) setIssues((p) => [...p, ownersLoadIssue]);
      if (postseasonOverridesLoadIssue) setIssues((p) => [...p, postseasonOverridesLoadIssue]);

      setHasCachedOwners(Boolean(ownersCsvText));
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
      try {
        await saveServerOwnersCsv(selectedSeason, text);
        window.localStorage.setItem(storageKeys.ownersCsv, text);
        setHasCachedOwners(true);
        setOwnersLoadedFromCache(false);
        tryParseOwnersCSV(text);
      } catch (err) {
        setIssues((prev) => [...prev, `Owners save failed: ${(err as Error).message}`]);
      }
    },
    [selectedSeason, storageKeys.ownersCsv, tryParseOwnersCSV]
  );

  useEffect(() => {
    if (selectedTab == null && selectedWeek != null) {
      setSelectedTab(selectedWeek);
    }
  }, [selectedTab, selectedWeek]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (cancelled) return;
      await loadRankings();
    })();

    return () => {
      cancelled = true;
    };
  }, [loadRankings]);

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

  const teamCatalogById = useMemo(() => {
    const next = new Map<string, TeamCatalogItem>();
    for (const team of teamCatalog) {
      const id = team.id?.trim();
      if (id) next.set(id, team);
    }
    return next;
  }, [teamCatalog]);

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

  const matchupSections = useMemo(
    () => deriveWeekMatchupSections(filteredWeekGames, rosterByTeam),
    [filteredWeekGames, rosterByTeam]
  );
  const renderedMatchupCardCount = useMemo(
    () => countRenderedMatchupCards(matchupSections),
    [matchupSections]
  );

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

  const standingsSnapshot = useMemo(
    () => deriveStandings(games, rosterByTeam, scoresByKey),
    [games, rosterByTeam, scoresByKey]
  );

  const hasScoreLoadError = useMemo(
    () =>
      issues.some(
        (issue) => issue.startsWith('Scores ') || issue.startsWith('Scores fetch failed:')
      ),
    [issues]
  );

  const standingsCoverage = useMemo(
    () =>
      deriveStandingsCoverage(games, rosterByTeam, scoresByKey, {
        isLoadingScores: loadingLive,
        hasScoreLoadError,
      }),
    [games, hasScoreLoadError, loadingLive, rosterByTeam, scoresByKey]
  );
  const activeWeekForDisplay = selectedWeek ?? 0;
  const activeWeekLabel =
    selectedTab === 'postseason'
      ? 'the postseason'
      : selectedWeek != null
        ? `Week ${activeWeekForDisplay}${weekDateMetadataByWeek.get(activeWeekForDisplay)?.label ? ` (${weekDateMetadataByWeek.get(activeWeekForDisplay)?.label})` : ''}`
        : 'the currently selected week';

  const ownerViewSnapshot = useMemo(
    () =>
      deriveOwnerViewSnapshot({
        selectedOwner,
        standingsRows: standingsSnapshot.rows,
        allGames: games,
        weekGames: selectedTab === 'postseason' ? postseasonGames : filteredWeekGames,
        rosterByTeam,
        scoresByKey,
      }),
    [
      filteredWeekGames,
      games,
      postseasonGames,
      rosterByTeam,
      scoresByKey,
      selectedOwner,
      selectedTab,
      standingsSnapshot.rows,
    ]
  );

  useEffect(() => {
    if (ownerViewSnapshot.selectedOwner !== selectedOwner) {
      setSelectedOwner(ownerViewSnapshot.selectedOwner);
    }
  }, [ownerViewSnapshot.selectedOwner, selectedOwner]);

  const overviewScope = useMemo(
    () =>
      deriveAutonomousOverviewScope({
        games,
        rosterByTeam,
        scoresByKey,
      }),
    [games, rosterByTeam, scoresByKey]
  );

  const overviewSnapshot = useMemo(
    () =>
      deriveOverviewSnapshot({
        standingsRows: standingsSnapshot.rows,
        standingsCoverage,
        weekGames: overviewScope.games,
        allGames: games,
        rosterByTeam,
        scoresByKey,
        selectedWeekLabel: overviewScope.label ?? activeWeekLabel,
      }),
    [
      activeWeekLabel,
      games,
      overviewScope.games,
      overviewScope.label,
      rosterByTeam,
      scoresByKey,
      standingsCoverage,
      standingsSnapshot.rows,
    ]
  );

  const selectedRankingsWeek = useMemo(
    () =>
      selectRankingsWeek({
        rankings,
        selectedWeek,
        selectedTab,
      }),
    [rankings, selectedTab, selectedWeek]
  );

  const rankingsByTeamId = useMemo(
    () => buildRankingsLookup(selectedRankingsWeek),
    [selectedRankingsWeek]
  );

  const visibleGames = useMemo(() => {
    if (selectedTab === 'postseason') return postseasonGames;
    return filteredWeekGames;
  }, [filteredWeekGames, postseasonGames, selectedTab]);

  useEffect(() => {
    if (!IS_DEBUG) return;

    const sampleLookupEntries = Array.from(rankingsByTeamId.entries())
      .slice(0, 5)
      .map(([teamId, ranking]) => ({ teamId, ...ranking }));
    const tracedGame = visibleGames.find((game) => {
      const homeTeamId =
        game.participants.home.kind === 'team' ? game.participants.home.teamId : null;
      const awayTeamId =
        game.participants.away.kind === 'team' ? game.participants.away.teamId : null;
      return Boolean(
        (homeTeamId && rankingsByTeamId.has(homeTeamId)) ||
          (awayTeamId && rankingsByTeamId.has(awayTeamId))
      );
    });

    console.log('rankings selected-week lookup', {
      selectedSeason,
      selectedWeek,
      selectedTab,
      rankingsWeekChosen: selectedRankingsWeek
        ? {
            season: selectedRankingsWeek.season,
            week: selectedRankingsWeek.week,
            seasonType: selectedRankingsWeek.seasonType,
            primarySource: selectedRankingsWeek.primarySource,
          }
        : null,
      lookupSize: rankingsByTeamId.size,
      sampleLookupEntries,
    });

    if (tracedGame) {
      const homeTeamId =
        tracedGame.participants.home.kind === 'team' ? tracedGame.participants.home.teamId : null;
      const awayTeamId =
        tracedGame.participants.away.kind === 'team' ? tracedGame.participants.away.teamId : null;
      const homeRanking = homeTeamId ? (rankingsByTeamId.get(homeTeamId) ?? null) : null;
      const awayRanking = awayTeamId ? (rankingsByTeamId.get(awayTeamId) ?? null) : null;

      console.log('rankings traced game', {
        gameKey: tracedGame.key,
        week: tracedGame.week,
        homeTeamName: tracedGame.csvHome,
        awayTeamName: tracedGame.csvAway,
        homeCanonicalTeamId: homeTeamId,
        awayCanonicalTeamId: awayTeamId,
        homeLookupHit: Boolean(homeRanking),
        awayLookupHit: Boolean(awayRanking),
        homeRanking,
        awayRanking,
        rankedTeamNameProps: {
          home: { teamName: tracedGame.csvHome, ranking: homeRanking },
          away: { teamName: tracedGame.csvAway, ranking: awayRanking },
        },
      });
    }
  }, [
    rankingsByTeamId,
    selectedRankingsWeek,
    selectedSeason,
    selectedTab,
    selectedWeek,
    visibleGames,
  ]);

  const hasActiveViewFilters = selectedConference !== 'ALL' || teamFilter.trim().length > 0;
  const shouldRenderPrimaryView = shouldRenderPrimaryViewSection({
    selectedTab,
    selectedWeek,
    viewMode: weekViewMode,
  });
  const primarySurfaceKind = derivePrimarySurfaceKind({
    selectedTab,
    viewMode: weekViewMode,
  });
  const isSeasonScopedView =
    primarySurfaceKind === 'overview' ||
    primarySurfaceKind === 'standings' ||
    primarySurfaceKind === 'owner';
  const activeSurfaceCopy =
    weekViewMode === 'overview'
      ? {
          eyebrow: 'League overview',
          title: 'Overview',
          description:
            'Start with the current league picture, then drill into weekly schedule and matchup detail as needed.',
        }
      : weekViewMode === 'standings'
        ? {
            eyebrow: 'Season view',
            title: 'Standings',
            description:
              'Season-long surname results and coverage status stay front-and-center here.',
          }
        : weekViewMode === 'owner'
          ? {
              eyebrow: 'Team view',
              title: 'Teams',
              description:
                'Focus on one surname’s roster, live games, and active-week slate in one place.',
            }
          : weekViewMode === 'matchups'
            ? {
                eyebrow: 'Week view',
                title: 'Matchups',
                description: 'Surname-based weekly cards and team context for the selected tab.',
              }
            : {
                eyebrow: 'Week view',
                title: 'Schedule',
                description:
                  'Full game list and live details for the selected week or postseason slate.',
              };

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
        void saveServerPostseasonOverrides(selectedSeason, nextOverrides).catch((err) => {
          setIssues((p) => [...p, `Postseason override save failed: ${(err as Error).message}`]);
        });
        void loadScheduleFromApi(undefined, nextOverrides);
      }
    },
    [loadScheduleFromApi, selectedSeason, storageKeys.postseasonOverrides]
  );

  const isAdminSurface = surface === 'admin';
  const canRenderLeagueSurface = weeks.length > 0 || hasPostseasonGames;
  const canRenderPrimarySurface = canRenderLeagueSurface || weekViewMode === 'owner';
  const fatalBootstrapIssues = issues.filter(isScheduleIssue);
  const hasFatalLeagueBootstrapFailure =
    !isAdminSurface && !canRenderLeagueSurface && fatalBootstrapIssues.length > 0;
  const adminAlertCount = getAdminAlertCount({ issues, diag, aliasStaging });
  const adminHref = '/admin';
  const leagueHref = '/';
  const rankingsHref = '/rankings';

  return (
    <div className="space-y-6 bg-white p-4 text-gray-900 sm:p-6 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex flex-col gap-4 lg:gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200">
              League Overview
            </span>
            {isAdminSurface ? (
              <span className="rounded-full border border-gray-300 bg-gray-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                Admin / Debug
              </span>
            ) : null}
          </div>
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">CFB League Dashboard</h1>
            <p className="max-w-3xl text-sm text-gray-600 dark:text-zinc-400">
              Overview, schedule, matchups, and standings stay front-and-center on the main
              dashboard, while commissioner tooling lives on a dedicated admin area.
            </p>
          </div>
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-start xl:w-auto xl:max-w-md xl:justify-end">
          {!isAdminSurface && adminAlertCount > 0 ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              {adminAlertCount} admin item{adminAlertCount === 1 ? '' : 's'} need attention
            </span>
          ) : null}
          {!isAdminSurface ? (
            <Link
              href={rankingsHref}
              className="inline-flex w-full items-center justify-center rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition hover:bg-gray-50 sm:w-auto dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              Rankings
            </Link>
          ) : null}
          <Link
            href={isAdminSurface ? leagueHref : adminHref}
            className="inline-flex w-full items-center justify-center rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition hover:bg-gray-50 sm:w-auto dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            {isAdminSurface ? 'Back to league view' : 'Admin / Debug'}
          </Link>
        </div>
      </header>

      {!isAdminSurface && adminAlertCount > 0 ? (
        <p className="text-xs text-gray-600 dark:text-zinc-400">
          Diagnostics, alias repairs, refresh controls, and surnames CSV maintenance live on the
          admin area to keep the default league experience focused.
        </p>
      ) : null}

      {hasFatalLeagueBootstrapFailure ? (
        <section className="space-y-4 rounded-2xl border border-red-200 bg-red-50/80 p-4 shadow-sm dark:border-red-900/50 dark:bg-red-950/30">
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-red-700 dark:text-red-300">
              League view unavailable
            </p>
            <h2 className="text-xl font-semibold text-red-950 dark:text-red-100">
              We couldn’t load the schedule needed to render the league view
            </h2>
            <p className="max-w-3xl text-sm text-red-800 dark:text-red-200">
              Try rebuilding the schedule from CFBD below. If the issue persists, open the admin
              area for deeper diagnostics and repair tools.
            </p>
          </div>

          <ul className="space-y-2 text-sm text-red-900 dark:text-red-100">
            {fatalBootstrapIssues.map((issue) => (
              <li
                key={issue}
                className="rounded border border-red-200 bg-white/80 px-3 py-2 dark:border-red-900/60 dark:bg-zinc-950/60"
              >
                {issue}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-900 transition hover:bg-red-100 disabled:opacity-60 dark:border-red-800 dark:bg-zinc-950 dark:text-red-100 dark:hover:bg-red-950/40"
              onClick={() => void loadScheduleFromApi(undefined, undefined, { bypassCache: true })}
              disabled={loadingSchedule}
            >
              {loadingSchedule ? 'Rebuilding…' : 'Rebuild schedule'}
            </button>
            <Link
              href={adminHref}
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              Open Admin / Debug
            </Link>
          </div>
        </section>
      ) : null}

      {isAdminSurface ? (
        <AdminDebugSurface
          aliasStaging={aliasStaging}
          aliasToast={aliasToast}
          conferences={conferences}
          diag={diag}
          editDraft={editDraft}
          editOpen={editOpen}
          games={games}
          hasCachedOwners={hasCachedOwners}
          issues={issues}
          lastOddsRefreshAt={lastOddsRefreshAt}
          lastScheduleRefreshAt={lastScheduleRefreshAt}
          lastScoresRefreshAt={lastScoresRefreshAt}
          loadingLive={loadingLive}
          loadingSchedule={loadingSchedule}
          oddsCacheState={oddsCacheState}
          ownersLoadedFromCache={ownersLoadedFromCache}
          roster={roster}
          scheduleLoaded={scheduleLoaded}
          scheduleMeta={scheduleMeta}
          season={selectedSeason}
          weeks={weeks}
          onAddDraftRow={addDraftRow}
          onClearCachedOwners={clearCachedOwners}
          onCloseAliasEditor={() => setEditOpen(false)}
          onCommitStagedAliases={() => void commitStagedAliases()}
          onOpenAliasEditor={openEditor}
          onOwnersFile={onOwnersFile}
          onRefreshData={() =>
            void refreshLiveData({
              manual: true,
              scoreScopeGamesOverride: games,
            })
          }
          onRebuildSchedule={() =>
            void loadScheduleFromApi(undefined, undefined, { bypassCache: true })
          }
          onRemoveDraftRow={removeDraftRow}
          onSaveAliases={() => void saveDraft()}
          onStageAlias={stageAliasWithToast}
          onUpdateDraftKey={updateDraftKey}
          onUpdateDraftValue={updateDraftValue}
        />
      ) : null}

      {canRenderPrimarySurface && (
        <>
          <section className="space-y-4 rounded-xl border border-gray-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
            <div className="flex flex-col gap-4 lg:gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="max-w-3xl space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-zinc-400">
                  {activeSurfaceCopy.eyebrow}
                </p>
                <h2 className="text-2xl font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
                  {activeSurfaceCopy.title}
                </h2>
                <p className="text-sm text-gray-600 dark:text-zinc-300">
                  {activeSurfaceCopy.description}
                </p>
              </div>
              <div className="w-full space-y-2 xl:max-w-2xl">
                <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                  View
                </div>
                <WeekViewTabs value={weekViewMode} onChange={setWeekViewMode} />
              </div>
            </div>

            {!isSeasonScopedView ? (
              <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm leading-6 text-gray-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                {selectedTab === 'postseason' ? (
                  <>
                    <span className="font-semibold">Postseason</span> · {postseasonGames.length}{' '}
                    game
                    {postseasonGames.length === 1 ? '' : 's'} shown
                  </>
                ) : (
                  <>
                    <span className="font-semibold">Week {activeWeekForDisplay}</span>
                    {weekDateMetadataByWeek.get(activeWeekForDisplay)?.label ? (
                      <> · {weekDateMetadataByWeek.get(activeWeekForDisplay)?.label}</>
                    ) : null}{' '}
                    {weekViewMode === 'matchups' ? (
                      <>
                        · {renderedMatchupCardCount} matchup card
                        {renderedMatchupCardCount === 1 ? '' : 's'} shown
                        {matchupSections.otherGames.length > 0 ? (
                          <>
                            {' '}
                            · {matchupSections.otherGames.length} other game
                            {matchupSections.otherGames.length === 1 ? '' : 's'} summarized below
                          </>
                        ) : null}
                      </>
                    ) : (
                      <>
                        · {filteredWeekGames.length} matchup
                        {filteredWeekGames.length === 1 ? '' : 's'} shown
                      </>
                    )}
                  </>
                )}
              </div>
            ) : null}
          </section>

          {primarySurfaceKind !== 'overview' ? (
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
              isSeasonViewActive={isSeasonScopedView}
              activeViewLabel={activeSurfaceCopy.title}
            />
          ) : null}

          {shouldRenderPrimaryView && (
            <section className="space-y-3">
              {primarySurfaceKind === 'overview' ? (
                <OverviewPanel
                  standingsLeaders={overviewSnapshot.standingsLeaders}
                  standingsCoverage={standingsCoverage}
                  matchupMatrix={overviewSnapshot.matchupMatrix}
                  liveItems={overviewSnapshot.liveItems}
                  keyMatchups={overviewSnapshot.keyMatchups}
                  context={overviewSnapshot.context}
                  displayTimeZone={presentationTimeZone}
                  onOwnerSelect={(owner) => {
                    setSelectedOwner(owner);
                    setWeekViewMode('owner');
                  }}
                />
              ) : primarySurfaceKind === 'standings' ? (
                <StandingsPanel
                  rows={standingsSnapshot.rows}
                  season={selectedSeason}
                  coverage={standingsCoverage}
                  onOwnerSelect={(owner) => {
                    setSelectedOwner(owner);
                    setWeekViewMode('owner');
                  }}
                />
              ) : primarySurfaceKind === 'owner' ? (
                <OwnerPanel
                  snapshot={ownerViewSnapshot}
                  selectedWeekLabel={activeWeekLabel}
                  displayTimeZone={presentationTimeZone}
                  onOwnerChange={setSelectedOwner}
                  rankingsByTeamId={rankingsByTeamId}
                />
              ) : primarySurfaceKind === 'postseason' ? (
                <PostseasonPanel
                  games={postseasonGames}
                  oddsByKey={oddsByKey}
                  scoresByKey={scoresByKey}
                  rosterByTeam={rosterByTeam}
                  isDebug={IS_DEBUG}
                  teamCatalogById={teamCatalogById}
                  onSavePostseasonOverride={savePostseasonOverride}
                />
              ) : weekViewMode === 'matchups' ? (
                <MatchupsWeekPanel
                  games={filteredWeekGames}
                  oddsByKey={oddsByKey}
                  scoresByKey={scoresByKey}
                  rosterByTeam={rosterByTeam}
                  displayTimeZone={presentationTimeZone}
                  sections={matchupSections}
                  rankingsByTeamId={rankingsByTeamId}
                />
              ) : (
                <GameWeekPanel
                  games={filteredWeekGames}
                  byes={byes[activeWeekForDisplay] ?? []}
                  oddsByKey={oddsByKey}
                  scoresByKey={scoresByKey}
                  rosterByTeam={rosterByTeam}
                  isDebug={IS_DEBUG}
                  teamCatalogById={teamCatalogById}
                  onSavePostseasonOverride={savePostseasonOverride}
                  displayTimeZone={presentationTimeZone}
                  rankingsByTeamId={rankingsByTeamId}
                />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
