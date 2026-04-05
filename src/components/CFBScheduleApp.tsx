'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

import AdminDebugSurface from './AdminDebugSurface';
import FeedbackForm from './FeedbackForm';
import GameWeekPanel from './GameWeekPanel';
import MatchupMatrixView from './MatchupMatrixView';
import MatchupsWeekPanel from './MatchupsWeekPanel';
import WeekViewTabs, { type WeekViewMode } from './WeekViewTabs';
import PostseasonPanel from './PostseasonPanel';
import RankingsPageContent from './RankingsPageContent';
import StandingsPanel from './StandingsPanel';
import OverviewPanel from './OverviewPanel';
import OwnerPanel from './OwnerPanel';
import WeekControls from './WeekControls';
import type { StandingsSubview } from './StandingsPanel';
import type { AliasStaging, DiagEntry } from '../lib/diagnostics';
import { parseOwnersCsv, type OwnerRow } from '../lib/parseOwnersCsv';
import { type CombinedOdds } from '../lib/odds';
import { isTruePostseasonGame } from '../lib/postseason-display';
import { type ScorePack } from '../lib/scores';
import { getRefreshPlan } from '../lib/refreshPolicy';
import { type AliasMap } from '../lib/teamNames';
import { normalizeAliasLookup } from '../lib/teamNormalization';
import { saveServerAliases } from '../lib/aliasesApi';
import { stageAliasFromMiss } from '../lib/aliasStaging';
import { countRenderedMatchupCards, deriveWeekMatchupSections } from '../lib/matchups';
import { deriveStandings, deriveStandingsCoverage } from '../lib/standings';
import { deriveStandingsHistory } from '../lib/standingsHistory';
import { deriveAutonomousOverviewScope, deriveOverviewSnapshot } from '../lib/overview';
import type { HighlightDrilldownTarget } from '../lib/highlightDrilldown';
import { deriveOwnerViewSnapshot } from '../lib/ownerView';
import { deriveOddsAvailabilitySummary } from '../lib/selectors/matchups';
import { selectSeasonContext } from '../lib/selectors/seasonContext';
import { deriveActiveSurfaceCopy } from '../lib/presentationCopy';
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
import { saveServerOwnersCsv } from '../lib/ownersApi';
import { saveServerPostseasonOverrides } from '../lib/postseasonOverridesApi';
import { filterGamesForWeek } from '../lib/weekSelection';
import { deriveWeekDateMetadataByWeek, getPresentationTimeZone } from '../lib/weekPresentation';
import {
  deriveCanonicalActiveViewGames,
  derivePrimarySurfaceKind,
  deriveRegularWeekTabs,
  shouldRenderPrimaryViewSection,
} from '../lib/activeView';
import {
  EMPTY_SCORE_HYDRATION_STATE,
  getCanonicalPostseasonGames,
  type ScoreHydrationState,
} from '../lib/scoreHydration';
import {
  deriveScheduleLoadApplicationResult,
  dedupeIssues,
  isScheduleIssue,
  summarizeGames,
} from '../lib/cfbScheduleAppHelpers';
import {
  buildRankingsLookup,
  fetchSeasonRankings,
  getDefaultRankingsSeason,
  selectRankingsWeek,
  type RankingsResponse,
} from '../lib/rankings';
import { createRankingsRequestGuard } from '../lib/rankingsRequestGuard';
import { useScheduleBootstrap } from './hooks/useScheduleBootstrap';
import { useLiveRefresh } from './hooks/useLiveRefresh';
import type { DraftPhase } from '../lib/draft';

const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === '1';
const EXPLICIT_SEASON = Number.parseInt(process.env.NEXT_PUBLIC_SEASON ?? '', 10);
const DEFAULT_SEASON = getDefaultRankingsSeason(
  Number.isFinite(EXPLICIT_SEASON) ? EXPLICIT_SEASON : null
);

type CFBScheduleAppProps = {
  surface?: 'league' | 'admin';
  leagueSlug?: string;
  leagueDisplayName?: string;
  leagueYear?: number;
  isAdmin?: boolean;
  initialGames?: AppGame[];
  initialIssues?: string[];
  initialRoster?: OwnerRow[];
  initialWeekViewMode?: WeekViewMode;
  initialStandingsSubview?: StandingsSubview;
};

export function deriveWeeklyMatchupsDrilldownState(params: {
  selectedTab: number | 'postseason' | null;
  selectedWeek: number | null;
  regularWeeks: number[];
}): { nextTab: number | 'postseason' | null; nextWeek: number | null } {
  const { selectedTab, selectedWeek } = params;
  void params.regularWeeks;
  return { nextTab: selectedTab, nextWeek: selectedWeek };
}

type HighlightNavigationState = {
  nextTab: number | 'postseason' | null;
  nextWeek: number | null;
  nextViewMode: WeekViewMode;
  focusedGameId: string | null;
  focusedOwner: string | null;
  focusedOwnerPair: [string, string] | null;
};

type DrilldownFocusState = Pick<
  HighlightNavigationState,
  'focusedGameId' | 'focusedOwner' | 'focusedOwnerPair'
>;

export function clearDrilldownFocusState(): DrilldownFocusState {
  return {
    focusedGameId: null,
    focusedOwner: null,
    focusedOwnerPair: null,
  };
}

export function resolveHighlightDrilldownNavigation(params: {
  target: HighlightDrilldownTarget;
  selectedWeek: number | null;
  regularWeeks: number[];
}): HighlightNavigationState {
  const { target, selectedWeek, regularWeeks } = params;
  const targetWeek =
    target.seasonTab === 'week' && target.week != null
      ? target.week
      : target.seasonTab === 'week'
        ? (selectedWeek ?? regularWeeks[0] ?? null)
        : null;

  let nextTab: number | 'postseason' | null =
    target.seasonTab === 'postseason' ? 'postseason' : targetWeek;
  let nextWeek = targetWeek;

  if (target.destination === 'matchups') {
    const weeklyDrilldown = deriveWeeklyMatchupsDrilldownState({
      selectedTab: nextTab,
      selectedWeek: nextWeek,
      regularWeeks,
    });
    nextTab = weeklyDrilldown.nextTab;
    nextWeek = weeklyDrilldown.nextWeek;
  }

  if (target.destination === 'schedule') {
    return {
      nextTab,
      nextWeek,
      nextViewMode: 'schedule',
      focusedGameId: target.gameId,
      focusedOwner: null,
      focusedOwnerPair: null,
    };
  }

  if (target.destination === 'standings') {
    return {
      nextTab,
      nextWeek,
      nextViewMode: 'standings',
      focusedGameId: null,
      focusedOwner: target.owner,
      focusedOwnerPair: null,
    };
  }

  if (target.destination === 'matchups') {
    return {
      nextTab,
      nextWeek,
      nextViewMode: 'matchups',
      focusedGameId: null,
      focusedOwner: target.kind === 'owner' ? target.owner : null,
      focusedOwnerPair: target.kind === 'owner_pair' ? target.owners : null,
    };
  }

  return {
    nextTab,
    nextWeek,
    nextViewMode: 'matrix',
    focusedGameId: null,
    focusedOwner: null,
    focusedOwnerPair: target.kind === 'owner_pair' ? target.owners : null,
  };
}

export default function CFBScheduleApp({
  surface = 'league',
  leagueSlug,
  leagueDisplayName,
  leagueYear,
  isAdmin = false,
  initialGames = [],
  initialIssues = [],
  initialRoster = [],
  initialWeekViewMode = 'overview',
  initialStandingsSubview = 'table',
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
  const [focusedGameId, setFocusedGameId] = useState<string | null>(null);
  const [focusedOwner, setFocusedOwner] = useState<string | null>(null);
  const [focusedOwnerPair, setFocusedOwnerPair] = useState<[string, string] | null>(null);

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

  const [draftPhase, setDraftPhase] = useState<DraftPhase | null>(null);
  const [draftBannerDismissed, setDraftBannerDismissed] = useState<boolean>(false);

  const scheduleRefreshInFlightRef = useRef<boolean>(false);
  const rankingsRequestGuardRef = useRef(createRankingsRequestGuard());

  const applySavedAliasMap = useCallback(
    (saved: AliasMap) => {
      setAliasMap(saved);
      window.localStorage.setItem(storageKeys.aliasMap, JSON.stringify(saved));
    },
    [storageKeys.aliasMap]
  );

  const persistAliasChanges = useCallback(
    async (upserts: AliasMap, deletes: string[] = []): Promise<AliasMap> => {
      const saved = await saveServerAliases(upserts, deletes, selectedSeason, leagueSlug);
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
    setFocusedGameId(null);
    setFocusedOwner(null);
    setFocusedOwnerPair(null);
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
  }, []);

  const clearOwnersDerivedState = useCallback(() => {
    setRoster([]);
  }, []);

  const loadRankings = useCallback(
    async (options?: { bypassCache?: boolean }) => {
      const requestId = rankingsRequestGuardRef.current.nextRequestId();
      try {
        const nextRankings = await fetchSeasonRankings(selectedSeason, {
          bypassCache: options?.bypassCache,
        });
        if (!rankingsRequestGuardRef.current.isCurrent(requestId)) return;
        setRankings(nextRankings);
      } catch (error) {
        if (!rankingsRequestGuardRef.current.isCurrent(requestId)) return;
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

  // Canonical-data invariant: CFBD-backed schedule load defines the game universe.
  // All odds/scores attachment and downstream selectors operate against this schedule.
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

        const application = deriveScheduleLoadApplicationResult({
          built,
          selectedWeek,
          selectedTab,
          isDebug: IS_DEBUG,
        });

        setIssues((prev) =>
          dedupeIssues([
            ...prev.filter((issue) => !isScheduleIssue(issue)),
            ...application.nextScheduleIssues,
          ])
        );

        if (!application.hasGames) {
          clearScheduleDerivedState();
          return false;
        }

        setGames(built.games);
        setByes(built.byes);
        setConferences(built.conferences);
        setScheduleLoaded(true);
        if (options?.bypassCache) {
          await loadRankings({ bypassCache: true });
        }
        const postLoadSelection = application.postLoadSelection;
        if (postLoadSelection.shouldApplyDefaultSelection) {
          setSelectedWeek(postLoadSelection.nextSelectedWeek);
          setSelectedTab(postLoadSelection.nextSelectedTab);
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
      selectedTab,
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

  const dismissDraftBanner = useCallback(() => {
    const draftYear = leagueYear ?? selectedSeason;
    if (leagueSlug && typeof window !== 'undefined') {
      window.localStorage.setItem(
        `cfb-draft-banner-dismissed:${leagueSlug}:${draftYear}`,
        '1'
      );
    }
    setDraftBannerDismissed(true);
  }, [leagueSlug, leagueYear, selectedSeason]);

  useScheduleBootstrap({
    hasBootstrappedRef,
    selectedSeason,
    leagueSlug,
    setAliasMap,
    setIssues,
    setHasCachedOwners,
    setManualPostseasonOverrides,
    loadScheduleFromApi,
    setOwnersLoadedFromCache,
    tryParseOwnersCSV,
  });

  const onOwnersFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        await saveServerOwnersCsv(selectedSeason, text, leagueSlug);
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
    (async () => {
      await loadRankings();
    })();

    return () => {
      rankingsRequestGuardRef.current.cancelOutstanding();
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

  const matchupSections = useMemo(
    () => deriveWeekMatchupSections(filteredWeekGames, rosterByTeam),
    [filteredWeekGames, rosterByTeam]
  );
  const postseasonMatchupSections = useMemo(
    () => deriveWeekMatchupSections(postseasonGames, rosterByTeam),
    [postseasonGames, rosterByTeam]
  );
  const renderedMatchupCardCount = useMemo(
    () => countRenderedMatchupCards(matchupSections),
    [matchupSections]
  );

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
  const standingsHistory = useMemo(
    () =>
      deriveStandingsHistory({
        games,
        rosterByTeam,
        scoresByKey,
        coverageOptions: {
          isLoadingScores: loadingLive,
          hasScoreLoadError,
        },
      }),
    [games, hasScoreLoadError, loadingLive, rosterByTeam, scoresByKey]
  );
  const seasonContext = useMemo(
    () => selectSeasonContext({ standingsHistory }),
    [standingsHistory]
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
    primarySurfaceKind === 'matrix' ||
    primarySurfaceKind === 'standings' ||
    primarySurfaceKind === 'owner' ||
    primarySurfaceKind === 'rankings';
  const shouldShowWeekControls =
    primarySurfaceKind === 'schedule' ||
    primarySurfaceKind === 'matchups' ||
    primarySurfaceKind === 'postseason';
  const activeSurfaceCopy = deriveActiveSurfaceCopy(weekViewMode);

  const openWeeklyMatchupsView = useCallback(() => {
    const nextDrilldownState = deriveWeeklyMatchupsDrilldownState({
      selectedTab,
      selectedWeek,
      regularWeeks: weeks,
    });
    if (nextDrilldownState.nextWeek !== selectedWeek) {
      setSelectedWeek(nextDrilldownState.nextWeek);
    }
    if (nextDrilldownState.nextTab !== selectedTab) {
      setSelectedTab(nextDrilldownState.nextTab);
    }
    const clearedFocus = clearDrilldownFocusState();
    setFocusedGameId(clearedFocus.focusedGameId);
    setFocusedOwner(clearedFocus.focusedOwner);
    setFocusedOwnerPair(clearedFocus.focusedOwnerPair);
    setWeekViewMode('matchups');
  }, [selectedTab, selectedWeek, weeks]);

  const onOpenHighlightTarget = useCallback(
    (target: HighlightDrilldownTarget) => {
      const nextState = resolveHighlightDrilldownNavigation({
        target,
        selectedWeek,
        regularWeeks: weeks,
      });
      if (nextState.nextWeek !== selectedWeek) {
        setSelectedWeek(nextState.nextWeek);
      }
      if (nextState.nextTab !== selectedTab) {
        setSelectedTab(nextState.nextTab);
      }
      setFocusedGameId(nextState.focusedGameId);
      setFocusedOwner(nextState.focusedOwner);
      setFocusedOwnerPair(nextState.focusedOwnerPair);
      setWeekViewMode(nextState.nextViewMode);
    },
    [selectedTab, selectedWeek, weeks]
  );

  const matrixSnapshot = useMemo(
    () =>
      deriveOverviewSnapshot({
        standingsRows: standingsSnapshot.rows,
        standingsCoverage,
        weekGames: selectedTab === 'postseason' ? postseasonGames : filteredWeekGames,
        allGames: games,
        rosterByTeam,
        scoresByKey,
        selectedWeekLabel: activeWeekLabel,
      }),
    [
      activeWeekLabel,
      filteredWeekGames,
      games,
      postseasonGames,
      rosterByTeam,
      scoresByKey,
      selectedTab,
      standingsCoverage,
      standingsSnapshot.rows,
    ]
  );

  const scoreScopeGames = useMemo(() => {
    // Scope invariant: live score fetch scope remains schedule-derived even when a
    // filtered view produces zero visible rows, preventing accidental empty fetches.
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

  const { refreshLiveData } = useLiveRefresh({
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
    isDebug: IS_DEBUG,
  });

  useEffect(() => {
    void fetchLatestOddsUsageSnapshot()
      .then((snapshot) => {
        setOddsUsage(snapshot);
      })
      .catch(() => {
        // non-fatal diagnostics fetch
      });
  }, []);

  // Load draft phase for contextual banner (non-blocking, best-effort).
  useEffect(() => {
    if (!leagueSlug) return;
    const draftYear = leagueYear ?? selectedSeason;
    const dismissKey = `cfb-draft-banner-dismissed:${leagueSlug}:${draftYear}`;
    if (typeof window !== 'undefined' && window.localStorage.getItem(dismissKey) === '1') {
      setDraftBannerDismissed(true);
    }
    fetch(`/api/draft/${encodeURIComponent(leagueSlug)}/${draftYear}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ draft?: { phase?: string } }>) : null))
      .then((data) => {
        const phase = data?.draft?.phase;
        if (typeof phase === 'string') setDraftPhase(phase as DraftPhase);
      })
      .catch(() => {}); // non-fatal
  }, [leagueSlug, leagueYear, selectedSeason]);

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
        void saveServerPostseasonOverrides(selectedSeason, nextOverrides, leagueSlug).catch(
          (err) => {
            setIssues((p) => [...p, `Postseason override save failed: ${(err as Error).message}`]);
          }
        );
        void loadScheduleFromApi(undefined, nextOverrides);
      }
    },
    [loadScheduleFromApi, selectedSeason, storageKeys.postseasonOverrides]
  );

  const isAdminSurface = surface === 'admin';
  const canRenderLeagueSurface = weeks.length > 0 || hasPostseasonGames;
  const canRenderPrimarySurface =
    canRenderLeagueSurface || weekViewMode === 'owner' || weekViewMode === 'rankings';
  const fatalBootstrapIssues = issues.filter(isScheduleIssue);
  const hasFatalLeagueBootstrapFailure =
    !isAdminSurface && !canRenderLeagueSurface && fatalBootstrapIssues.length > 0;
  const leagueHref = leagueSlug ? `/league/${leagueSlug}` : '/';
  const visibleScoresCount = useMemo(
    () => visibleGames.filter((game) => Boolean(scoresByKey[game.key])).length,
    [scoresByKey, visibleGames]
  );
  const visibleOddsCount = useMemo(
    () => visibleGames.filter((game) => Boolean(oddsByKey[game.key])).length,
    [oddsByKey, visibleGames]
  );
  const oddsAvailabilitySummary = useMemo(
    () =>
      deriveOddsAvailabilitySummary({
        gamesCount: visibleGames.length,
        oddsAvailableCount: visibleOddsCount,
      }),
    [visibleGames.length, visibleOddsCount]
  );
  const userFacingLiveIssues = useMemo(
    () =>
      issues.filter(
        (issue) =>
          issue.startsWith('Odds ') ||
          issue.startsWith('Scores ') ||
          issue.startsWith('Odds fetch failed:') ||
          issue.startsWith('Scores fetch failed:')
      ),
    [issues]
  );

  return (
    <div className="space-y-5 bg-white p-4 text-gray-900 sm:p-6 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex flex-col gap-3">
        {isAdminSurface ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-gray-300 bg-gray-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-widest text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              Admin / Debug
            </span>
          </div>
        ) : null}
        {/* Row 1: league name + gear icon */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium">
              {leagueDisplayName ??
                (leagueSlug
                  ? leagueSlug
                      .split('-')
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(' ')
                  : 'League')}
            </h1>
            <p className="mt-0.5 text-sm text-zinc-400">
              {selectedSeason} season
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isAdmin && leagueSlug ? (
              <Link
                href={`/admin/${leagueSlug}`}
                title="League settings"
                className="flex-shrink-0 text-zinc-500 hover:text-zinc-200 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                </svg>
              </Link>
            ) : null}
            {isAdminSurface ? (
              <Link
                href={leagueHref}
                className="inline-flex items-center rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-900 transition hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                Back to league view
              </Link>
            ) : null}
          </div>
        </div>
        {/* Row 2: nav tabs (non-admin surface only) */}
        {!isAdminSurface ? (
          <div className="space-y-2">
            <WeekViewTabs value={weekViewMode} onChange={setWeekViewMode} leagueSlug={leagueSlug} />
            {/* Matchups sub-nav */}
            {(weekViewMode === 'matchups' ||
              weekViewMode === 'schedule' ||
              weekViewMode === 'matrix') ? (
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    { key: 'matchups', label: 'Matchups' },
                    { key: 'schedule', label: 'Schedule' },
                    { key: 'matrix', label: 'Matrix' },
                  ] as const
                ).map((sub) => (
                  <button
                    key={sub.key}
                    type="button"
                    onClick={() => setWeekViewMode(sub.key)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      weekViewMode === sub.key
                        ? 'bg-gray-200 text-gray-900 dark:bg-zinc-700 dark:text-zinc-100'
                        : 'text-gray-500 hover:text-gray-800 dark:text-zinc-500 dark:hover:text-zinc-300'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            ) : null}
            {/* Standings sub-nav */}
            {(weekViewMode === 'standings' || weekViewMode === 'rankings') ? (
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    { key: 'standings', label: 'Standings' },
                    { key: 'rankings', label: 'Rankings' },
                  ] as const
                ).map((sub) => (
                  <button
                    key={sub.key}
                    type="button"
                    onClick={() => setWeekViewMode(sub.key)}
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                      weekViewMode === sub.key
                        ? 'bg-gray-200 text-gray-900 dark:bg-zinc-700 dark:text-zinc-100'
                        : 'text-gray-500 hover:text-gray-800 dark:text-zinc-500 dark:hover:text-zinc-300'
                    }`}
                  >
                    {sub.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {/* Draft banner — contextual, non-admin league surface only */}
      {!isAdminSurface && leagueSlug && draftPhase && draftPhase !== 'setup' &&
        !(draftPhase === 'complete' && draftBannerDismissed) ? (
        <div
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-sm ${
            draftPhase === 'live' || draftPhase === 'paused'
              ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100'
              : 'border-gray-200 bg-gray-50 text-gray-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'
          }`}
        >
          <span className={`font-medium ${draftPhase === 'live' || draftPhase === 'paused' ? 'text-amber-800 dark:text-amber-200' : ''}`}>
            {draftPhase === 'live' || draftPhase === 'paused'
              ? 'Draft in progress'
              : draftPhase === 'complete'
                ? 'Draft complete'
                : 'Draft scheduled'}
          </span>
          <div className="flex items-center gap-2">
            {(draftPhase === 'settings' || draftPhase === 'preview') && (
              <Link
                href={`/league/${leagueSlug}/draft/board`}
                className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-medium text-gray-900 transition hover:bg-gray-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
              >
                Draft Board
              </Link>
            )}
            {(draftPhase === 'live' || draftPhase === 'paused') && (
              <Link
                href={`/league/${leagueSlug}/draft/board`}
                className="rounded border border-amber-400 bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900 transition hover:bg-amber-200 dark:border-amber-700 dark:bg-amber-900/50 dark:text-amber-100 dark:hover:bg-amber-900"
              >
                Join Draft
              </Link>
            )}
            {draftPhase === 'complete' && (
              <>
                <Link
                  href={`/league/${leagueSlug}/draft/summary`}
                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  View Summary
                </Link>
                <button
                  type="button"
                  onClick={dismissDraftBanner}
                  aria-label="Dismiss draft banner"
                  className="ml-1 text-gray-400 hover:text-gray-600 transition-colors dark:text-zinc-500 dark:hover:text-zinc-300"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="h-4 w-4"
                    aria-hidden="true"
                  >
                    <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                  </svg>
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {hasFatalLeagueBootstrapFailure ? (
        <section className="space-y-4 rounded-2xl border border-red-200 bg-red-50/80 p-4 shadow-sm dark:border-red-900/50 dark:bg-red-950/30">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-widest text-red-700 dark:text-red-300">
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
              href="/admin/data"
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-900 transition hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              Open Data Management
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
          {!isAdminSurface ? (
            <section className="space-y-1">
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {loadingSchedule && !scheduleLoaded ? (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-medium text-sky-700 dark:border-sky-900 dark:bg-sky-950/25 dark:text-sky-200">
                    Loading schedule…
                  </span>
                ) : null}
                {loadingLive ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-200">
                    Refreshing scores and odds…
                  </span>
                ) : null}
                {!loadingLive &&
                visibleGames.length > 0 &&
                visibleScoresCount < visibleGames.length ? (
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-medium text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                    Scores available for {visibleScoresCount}/{visibleGames.length} games.
                  </span>
                ) : null}
                {!loadingLive && oddsAvailabilitySummary ? (
                  <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 font-medium text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                    {oddsAvailabilitySummary}
                  </span>
                ) : null}
              </div>
              {userFacingLiveIssues.length > 0 ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Some live data could not be updated. Showing the latest available results.
                </p>
              ) : null}
            </section>
          ) : null}

          <section className="space-y-4 rounded-xl border border-gray-300 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">

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

          {shouldShowWeekControls ? (
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
                  games={games}
                  scoresByKey={scoresByKey}
                  rosterByTeam={rosterByTeam}
                  standingsLeaders={overviewSnapshot.standingsLeaders}
                  standingsHistory={standingsHistory}
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
                  onViewStandings={() => setWeekViewMode('standings')}
                  onViewSchedule={() => {
                    setFocusedGameId(null);
                    setWeekViewMode('schedule');
                  }}
                  onViewMatchups={openWeeklyMatchupsView}
                  onOpenHighlightTarget={onOpenHighlightTarget}
                  leagueSlug={leagueSlug}
                />
              ) : primarySurfaceKind === 'standings' ? (
                <StandingsPanel
                  rows={standingsSnapshot.rows}
                  season={selectedSeason}
                  coverage={standingsCoverage}
                  focusedOwner={focusedOwner}
                  standingsHistory={standingsHistory}
                  seasonContext={seasonContext}
                  trendIssues={issues}
                  onOwnerSelect={(owner) => {
                    setSelectedOwner(owner);
                    setWeekViewMode('owner');
                  }}
                  initialSubview={initialStandingsSubview}
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
                  focusedGameId={focusedGameId}
                />
              ) : primarySurfaceKind === 'rankings' ? (
                <RankingsPageContent
                  latestWeek={rankings?.latestWeek ?? null}
                  loading={rankings === null}
                  error={
                    issues
                      .find((issue) => issue.startsWith('CFBD rankings load failed:'))
                      ?.replace('CFBD rankings load failed: ', '') ?? null
                  }
                  season={selectedSeason}
                />
              ) : weekViewMode === 'matchups' ? (
                <MatchupsWeekPanel
                  games={selectedTab === 'postseason' ? postseasonGames : filteredWeekGames}
                  oddsByKey={oddsByKey}
                  scoresByKey={scoresByKey}
                  rosterByTeam={rosterByTeam}
                  displayTimeZone={presentationTimeZone}
                  sections={
                    selectedTab === 'postseason' ? postseasonMatchupSections : matchupSections
                  }
                  rankingsByTeamId={rankingsByTeamId}
                  focusedOwner={focusedOwner}
                  focusedOwnerPair={focusedOwnerPair}
                />
              ) : weekViewMode === 'matrix' ? (
                <MatchupMatrixView
                  matrix={matrixSnapshot.matchupMatrix}
                  focusedOwnerPair={focusedOwnerPair}
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
                  focusedGameId={focusedGameId}
                />
              )}
            </section>
          )}
        </>
      )}
      {!isAdminSurface ? <FeedbackForm /> : null}
    </div>
  );
}
