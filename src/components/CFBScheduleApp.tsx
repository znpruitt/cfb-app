'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AliasEditorPanel from './AliasEditorPanel';
import IssuesPanel from './IssuesPanel';
import UploadPanel from './UploadPanel';
import GameWeekPanel from './GameWeekPanel';
import WeekControls from './WeekControls';
import type { AliasStaging, DiagEntry } from '../lib/diagnostics';
import { parseOwnersCsv, type OwnerRow } from '../lib/parseOwnersCsv';
import { buildOddsByGame, type CombinedOdds, type OddsEvent } from '../lib/odds';
import { fetchScoresByGame, type ScorePack } from '../lib/scores';
import { SEED_ALIASES, type AliasMap } from '../lib/teamNames';
import { normalizeAliasLookup } from '../lib/teamNormalization';
import { saveServerAliases } from '../lib/aliasesApi';
import { bootstrapAliasesAndCaches } from '../lib/bootstrap';
import { stageAliasFromMiss } from '../lib/aliasStaging';
import { pillClass } from '../lib/gameUi';
import { buildScheduleFromApi, fetchSeasonSchedule, type AppGame } from '../lib/schedule';
import { fetchTeamsCatalog } from '../lib/teamsCatalog';
import { LEGACY_STORAGE_KEYS, seasonStorageKeys } from '../lib/storageKeys';

const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === '1';
const DEFAULT_SEASON = Number(process.env.NEXT_PUBLIC_SEASON ?? new Date().getFullYear());

function dedupeIssues(items: string[]): string[] {
  return Array.from(new Set(items));
}

function isScheduleIssue(issue: string): boolean {
  return (
    issue.startsWith('invalid-schedule-row:') ||
    issue.startsWith('identity-unresolved:') ||
    issue.startsWith('out-of-scope-postseason-row:') ||
    issue.startsWith('hydrate:') ||
    issue.startsWith('CFBD schedule load failed:')
  );
}

function summarizeGames(label: string, games: AppGame[]): void {
  const weeks = Array.from(
    new Set(games.map((g) => g.week).filter((w) => Number.isFinite(w)))
  ).sort((a, b) => a - b);
  const regular = games.filter((g) => g.stage === 'regular' && !g.isPlaceholder).length;
  const placeholder = games.filter((g) => g.isPlaceholder).length;
  const postseasonReal = games.filter((g) => g.stage !== 'regular' && !g.isPlaceholder).length;

  console.log(label, {
    count: games.length,
    weeks,
    regular,
    placeholder,
    postseasonReal,
    sample: games.slice(0, 10).map((g) => ({
      key: g.key,
      week: g.week,
      away: g.csvAway ?? g.canAway,
      home: g.csvHome ?? g.canHome,
      isPostseasonPlaceholder: !!g.isPlaceholder,
      postseason: g.stage !== 'regular',
    })),
  });
}

export default function CFBScheduleApp(): React.ReactElement {
  const hasBootstrappedRef = useRef<boolean>(false);

  const [selectedSeason] = useState<number>(DEFAULT_SEASON);
  const storageKeys = useMemo(() => seasonStorageKeys(selectedSeason), [selectedSeason]);

  const [games, setGames] = useState<AppGame[]>([]);
  const [weeks, setWeeks] = useState<number[]>([]);
  const [byes, setByes] = useState<Record<number, string[]>>({});
  const [conferences, setConferences] = useState<string[]>(['ALL']);
  const [roster, setRoster] = useState<OwnerRow[]>([]);
  const [selectedConference, setSelectedConference] = useState<string>('ALL');
  const [teamFilter, setTeamFilter] = useState<string>('');
  const [selectedWeek, setSelectedWeek] = useState<number | null>(null);

  const [oddsByKey, setOddsByKey] = useState<Record<string, CombinedOdds>>({});
  const [scoresByKey, setScoresByKey] = useState<Record<string, ScorePack>>({});
  const [loadingLive, setLoadingLive] = useState<boolean>(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [lastRefreshAt, setLastRefreshAt] = useState<string>('');

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
    setWeeks([]);
    setByes({});
    setConferences(['ALL']);
    setSelectedWeek(null);
    setSelectedConference('ALL');
    setTeamFilter('');
    setOddsByKey({});
    setScoresByKey({});
    setIssues([]);
    setDiag([]);
    setLastRefreshAt('');
    setScheduleLoaded(false);
  }, []);

  const clearOwnersDerivedState = useCallback(() => {
    setRoster([]);
  }, []);

  // API-first schedule loader. CFBD now defines the game universe for normal operation.
  const loadScheduleFromApi = useCallback(
    async (
      overrideAliasMap?: AliasMap,
      overrideManualOverrides?: Record<string, Partial<AppGame>>
    ): Promise<boolean> => {
      try {
        const [scheduleItems, teams] = await Promise.all([
          fetchSeasonSchedule(selectedSeason),
          fetchTeamsCatalog(),
        ]);
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
        });

        const nextScheduleIssues = [...built.issues];
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
        setWeeks(built.weeks);
        setByes(built.byes);
        setConferences(built.conferences);
        setScheduleLoaded(true);
        if (selectedWeek == null && built.games.length) setSelectedWeek(built.games[0]!.week);
        return true;
      } catch (error) {
        const scheduleFailure = `CFBD schedule load failed: ${(error as Error).message}`;
        setIssues((prev) =>
          dedupeIssues([...prev.filter((issue) => !isScheduleIssue(issue)), scheduleFailure])
        );
        return false;
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
        const rawOverrides =
          window.localStorage.getItem(storageKeys.postseasonOverrides) ??
          window.localStorage.getItem(LEGACY_STORAGE_KEYS.postseasonOverrides);
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

  const rosterByTeam = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roster) m.set(r.team, r.owner);
    return m;
  }, [roster]);

  function filteredWeekGames(w: number): AppGame[] {
    const next = games
      .filter((g) => g.week === w)
      .filter((g) => {
        const confOk =
          selectedConference === 'ALL' ||
          g.homeConf === selectedConference ||
          g.awayConf === selectedConference;
        const tf = teamFilter.toLowerCase();
        const teamOk =
          !tf || g.csvHome.toLowerCase().includes(tf) || g.csvAway.toLowerCase().includes(tf);
        return confOk && teamOk;
      })
      .sort((a, b) => {
        const aMarquee = Number(
          Boolean(rosterByTeam.get(a.csvHome) || rosterByTeam.get(a.csvAway))
        );
        const bMarquee = Number(
          Boolean(rosterByTeam.get(b.csvHome) || rosterByTeam.get(b.csvAway))
        );
        return bMarquee - aMarquee || a.csvHome.localeCompare(b.csvHome);
      });

    if (IS_DEBUG) {
      summarizeGames(`displayGames: week ${w}`, next);
    }

    return next;
  }

  const refreshLive = useCallback(async () => {
    setIssues([]);
    setDiag([]);
    if (!games.length) {
      setIssues((p) => [...p, 'No games loaded. CFBD schedule load may have failed.']);
      return;
    }

    setLoadingLive(true);
    try {
      const teams = await fetchTeamsCatalog().catch(() => []);

      try {
        const oddsRes = await fetch(`/api/odds`, { cache: 'no-store' });
        if (oddsRes.ok) {
          const oddsPayload = (await oddsRes.json()) as OddsEvent[] | { items?: OddsEvent[] };
          const oddsEvents = Array.isArray(oddsPayload) ? oddsPayload : (oddsPayload.items ?? []);
          const next = buildOddsByGame({ games, oddsEvents, aliasMap, teams });
          setOddsByKey(next);
        } else {
          const t = await oddsRes.text().catch(() => '');
          setIssues((p) => [...p, `Odds error ${oddsRes.status}: ${t}`]);
        }
      } catch (err) {
        setIssues((p) => [...p, `Odds fetch failed: ${(err as Error).message}`]);
      }

      try {
        const {
          scoresByKey: nextScores,
          issues: scoreIssues,
          diag: scoreDiag,
        } = await fetchScoresByGame({
          games,
          aliasMap,
          season: selectedSeason,
          teams,
        });

        if (scoreIssues.length) setIssues((p) => [...p, ...scoreIssues]);
        if (scoreDiag.length) setDiag((p) => [...p, ...scoreDiag]);
        setScoresByKey((prev) => ({ ...prev, ...nextScores }));
      } catch (err) {
        setIssues((p) => [...p, `Scores fetch failed: ${(err as Error).message}`]);
      }

      setLastRefreshAt(new Date().toLocaleString());
    } finally {
      setLoadingLive(false);
    }
  }, [games, aliasMap, selectedSeason]);

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
            onClick={() => void refreshLive()}
            disabled={loadingLive || games.length === 0}
            title={games.length === 0 ? 'Schedule load failed' : 'Refresh odds & scores'}
          >
            {loadingLive ? 'Refreshing…' : 'Refresh odds & scores'}
          </button>
          <button
            className="px-3 py-2 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            onClick={openEditor}
            title="Edit alias map (persists on server)"
          >
            Edit Aliases
          </button>
          <button
            className="px-3 py-2 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            onClick={() => void loadScheduleFromApi()}
            title="Reload schedule from CFBD"
          >
            Reload schedule
          </button>
          {lastRefreshAt && (
            <span className="text-xs text-gray-600 dark:text-zinc-400">Last: {lastRefreshAt}</span>
          )}
        </div>
      </header>

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

      {weeks.length > 0 && (
        <>
          <WeekControls
            weeks={weeks}
            selectedWeek={selectedWeek}
            selectedConference={selectedConference}
            conferences={conferences}
            teamFilter={teamFilter}
            onSelectWeek={setSelectedWeek}
            onSelectedConferenceChange={setSelectedConference}
            onTeamFilterChange={setTeamFilter}
          />

          {selectedWeek != null && (
            <GameWeekPanel
              games={filteredWeekGames(selectedWeek)}
              byes={byes[selectedWeek] ?? []}
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
