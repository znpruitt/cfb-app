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
import { parseScheduleCsv } from '../lib/parseScheduleCsv';
import { SEED_ALIASES, type AliasMap } from '../lib/teamNames';
import { normalizeAliasLookup } from '../lib/teamNormalization';
import { saveServerAliases } from '../lib/aliasesApi';
import { bootstrapAliasesAndCaches } from '../lib/bootstrap';
import { stageAliasFromMiss } from '../lib/aliasStaging';
import { reconcileNamesWithCatalog } from '../lib/reconcileNames';
import { rebuildGamesFromAliasMap, rebuildGamesFromIdentity } from '../lib/rebuildGames';
import { pillClass } from '../lib/gameUi';
import { buildScheduleFromApi, fetchSeasonSchedule, type AppGame } from '../lib/schedule';
import { fetchTeamsCatalog } from '../lib/teamsCatalog';

const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === '1';
const SEASON = Number(process.env.NEXT_PUBLIC_SEASON ?? new Date().getFullYear());

export default function CFBScheduleApp(): React.ReactElement {
  const hasBootstrappedRef = useRef<boolean>(false);

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
  const [manualPostseasonOverrides, setManualPostseasonOverrides] = useState<Record<string, Partial<AppGame>>>({});
  const [aliasStaging, setAliasStaging] = useState<AliasStaging>({ upserts: {}, deletes: [] });
  const [aliasToast, setAliasToast] = useState<string | null>(null);

  // Legacy schedule CSV cache is retained as migration fallback while API-first becomes default.
  const [scheduleLoadedFromCache, setScheduleLoadedFromCache] = useState<boolean>(false);
  const [ownersLoadedFromCache, setOwnersLoadedFromCache] = useState<boolean>(false);
  const [hasCachedSchedule, setHasCachedSchedule] = useState<boolean>(false);
  const [hasCachedOwners, setHasCachedOwners] = useState<boolean>(false);
  const [scheduleSource, setScheduleSource] = useState<'api' | 'csv-legacy' | 'none'>('none');

  const applySavedAliasMap = useCallback((saved: AliasMap) => {
    setAliasMap(saved);
    window.localStorage.setItem('cfb_name_map', JSON.stringify(saved));
  }, []);

  const persistAliasChanges = useCallback(
    async (upserts: AliasMap, deletes: string[] = []): Promise<AliasMap> => {
      const saved = await saveServerAliases(upserts, deletes, SEASON);
      applySavedAliasMap(saved);
      return saved;
    },
    [applySavedAliasMap]
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
    setScheduleSource('none');
  }, []);

  const clearOwnersDerivedState = useCallback(() => {
    setRoster([]);
  }, []);

  const reconcileNames = useCallback(
    async (csvTeams: string[]): Promise<Record<string, string>> => {
      return reconcileNamesWithCatalog({
        csvTeams,
        aliasMap,
        season: SEASON,
        onTeamsCatalogError: (message) => {
          setIssues((p) => [...p, `Teams catalog fetch failed: ${message}`]);
        },
        onIdentityDiag: (entry) => setDiag((p) => [...p, entry]),
        persistLearnedAliases: async (upserts) => {
          try {
            await persistAliasChanges(upserts, []);
          } catch {
            // best-effort only
          }
        },
      });
    },
    [aliasMap, persistAliasChanges]
  );

  const tryParseScheduleCSV = useCallback(
    async (text: string) => {
      const parsed = parseScheduleCsv(text, {
        onConflict: (msg) => setIssues((p) => [...p, msg]),
      });
      const { draftGames, byeMap, conferences: parsedConferences } = parsed;
      if (!draftGames.length) {
        clearScheduleDerivedState();
        return;
      }

      const csvTeams = Array.from(new Set<string>(draftGames.flatMap((g) => [g.csvHome, g.csvAway])));
      const mapObj = await reconcileNames(csvTeams);

      const finalGames: AppGame[] = draftGames.map((g) => {
        const canAway = mapObj[g.csvAway] ?? g.csvAway;
        const canHome = mapObj[g.csvHome] ?? g.csvHome;
        const key = g.neutral
          ? `${g.week}-${[canHome, canAway].sort((x, y) => x.localeCompare(y)).join('-')}-N`
          : `${g.week}-${canHome}-${canAway}-H`;
        return {
          key,
          eventId: key,
          week: g.week,
          date: null,
          stage: 'regular',
          status: 'scheduled',
          stageOrder: 1,
          slotOrder: 0,
          eventKey: key,
          label: null,
          conference: null,
          bowlName: null,
          playoffRound: null,
          providerGameId: null,
          neutral: g.neutral,
          venue: null,
          isPlaceholder: false,
          participants: {
            home: { kind: 'team', teamId: canHome.toLowerCase(), displayName: g.csvHome, canonicalName: canHome, rawName: g.csvHome },
            away: { kind: 'team', teamId: canAway.toLowerCase(), displayName: g.csvAway, canonicalName: canAway, rawName: g.csvAway },
          },
          csvAway: g.csvAway,
          csvHome: g.csvHome,
          canAway,
          canHome,
          awayConf: g.awayConf,
          homeConf: g.homeConf,
        };
      });

      setGames(finalGames);
      setWeeks([...new Set(finalGames.map((g) => g.week))].sort((a, b) => a - b));
      setByes(byeMap);
      setConferences(parsedConferences);
      setScheduleSource('csv-legacy');
      if (selectedWeek == null && finalGames.length) setSelectedWeek(finalGames[0]!.week);
    },
    [clearScheduleDerivedState, reconcileNames, selectedWeek]
  );

  // API-first schedule loader. CFBD now defines the game universe for normal operation.
  const loadScheduleFromApi = useCallback(async (overrideAliasMap?: AliasMap, overrideManualOverrides?: Record<string, Partial<AppGame>>): Promise<boolean> => {
    try {
      const [scheduleItems, teams] = await Promise.all([
        fetchSeasonSchedule(SEASON),
        fetchTeamsCatalog(),
      ]);
      const built = buildScheduleFromApi({
        scheduleItems,
        teams,
        aliasMap: overrideAliasMap ?? aliasMap,
        season: SEASON,
        manualOverrides: overrideManualOverrides ?? manualPostseasonOverrides,
      });

      if (built.issues.length) {
        setIssues((prev) => [...prev, ...built.issues]);
      }
      if (IS_DEBUG && built.hydrationDiagnostics.length) {
        setIssues((prev) => [...prev, ...built.hydrationDiagnostics.slice(0, 8).map((d) => `hydrate:${d.action}:${d.eventId}:${d.reason}`)]);
      }

      if (!built.games.length) {
        clearScheduleDerivedState();
        return false;
      }

      setGames(built.games);
      setWeeks(built.weeks);
      setByes(built.byes);
      setConferences(built.conferences);
      setScheduleSource('api');
      if (selectedWeek == null && built.games.length) setSelectedWeek(built.games[0]!.week);
      return true;
    } catch (error) {
      setIssues((prev) => [...prev, `CFBD schedule load failed: ${(error as Error).message}`]);
      return false;
    }
  }, [aliasMap, clearScheduleDerivedState, selectedWeek, manualPostseasonOverrides]);

  const clearCachedSchedule = useCallback(() => {
    window.localStorage.removeItem('cfb_schedule_csv');
    setHasCachedSchedule(false);
    setScheduleLoadedFromCache(false);
    if (scheduleSource === 'csv-legacy') {
      clearScheduleDerivedState();
    }
  }, [clearScheduleDerivedState, scheduleSource]);

  const clearCachedOwners = useCallback(() => {
    window.localStorage.removeItem('cfb_owners_csv');
    setHasCachedOwners(false);
    setOwnersLoadedFromCache(false);
    clearOwnersDerivedState();
  }, [clearOwnersDerivedState]);

  const showAliasToast = useCallback((message: string, timeoutMs: number = 1200) => {
    setAliasToast(message);
    setTimeout(() => setAliasToast(null), timeoutMs);
  }, []);

  useEffect(() => {
    if (hasBootstrappedRef.current) return;
    hasBootstrappedRef.current = true;

    (async () => {
      const { aliasMap: bootAliasMap, aliasLoadIssue, scheduleCsvText, ownersCsvText } =
        await bootstrapAliasesAndCaches({ season: SEASON, seedAliases: SEED_ALIASES });

      setAliasMap(bootAliasMap);
      if (aliasLoadIssue) setIssues((p) => [...p, aliasLoadIssue]);

      setHasCachedSchedule(Boolean(scheduleCsvText));
      setHasCachedOwners(Boolean(ownersCsvText));

      let loadedOverrides: Record<string, Partial<AppGame>> = {};
      try {
        const rawOverrides = window.localStorage.getItem('cfb_postseason_overrides');
        if (rawOverrides) loadedOverrides = JSON.parse(rawOverrides) as Record<string, Partial<AppGame>>;
      } catch {
        loadedOverrides = {};
      }
      setManualPostseasonOverrides(loadedOverrides);

      const apiLoaded = await loadScheduleFromApi(bootAliasMap, loadedOverrides);

      if (!apiLoaded && scheduleCsvText) {
        setScheduleLoadedFromCache(true);
        await tryParseScheduleCSV(scheduleCsvText);
      }

      if (ownersCsvText) {
        setOwnersLoadedFromCache(true);
        tryParseOwnersCSV(ownersCsvText);
      }
    })();
  }, [loadScheduleFromApi, tryParseOwnersCSV, tryParseScheduleCSV]);

  const onScheduleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      window.localStorage.setItem('cfb_schedule_csv', text);
      setHasCachedSchedule(true);
      setScheduleLoadedFromCache(false);
      await tryParseScheduleCSV(text);
    },
    [tryParseScheduleCSV]
  );

  const onOwnersFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      window.localStorage.setItem('cfb_owners_csv', text);
      setHasCachedOwners(true);
      setOwnersLoadedFromCache(false);
      tryParseOwnersCSV(text);
    },
    [tryParseOwnersCSV]
  );

  const rosterByTeam = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roster) m.set(r.team, r.owner);
    return m;
  }, [roster]);

  function filteredWeekGames(w: number): AppGame[] {
    return games
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
        const aMarquee = Number(Boolean(rosterByTeam.get(a.csvHome) || rosterByTeam.get(a.csvAway)));
        const bMarquee = Number(Boolean(rosterByTeam.get(b.csvHome) || rosterByTeam.get(b.csvAway)));
        return bMarquee - aMarquee || a.csvHome.localeCompare(b.csvHome);
      });
  }

  const refreshLive = useCallback(async () => {
    setIssues([]);
    setDiag([]);
    if (!games.length) {
      setIssues((p) => [...p, 'No games loaded. CFBD schedule load may have failed; CSV fallback is still available.']);
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
        const { scoresByKey: nextScores, issues: scoreIssues, diag: scoreDiag } = await fetchScoresByGame({
          games,
          aliasMap,
          season: SEASON,
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
  }, [games, aliasMap]);

  const stageAliasWithToast = useCallback(
    (providerName: string, csvName: string) => {
      setAliasStaging((prev) => stageAliasFromMiss(providerName, csvName, prev));
      showAliasToast(`Staged alias: "${providerName}" → "${csvName}"`);
    },
    [showAliasToast]
  );

  const rebuildGamesWithCurrentAliases = useCallback(async () => {
    if (!games.length) return;

    const teams = await fetchTeamsCatalog().catch(() => []);
    if (teams.length) {
      const rebuilt = rebuildGamesFromIdentity({ games, teams, aliasMap });
      setGames(rebuilt);
      return;
    }

    // Keep CSV-legacy alias edits functional even if teams catalog is temporarily unavailable.
    const aliasResolvedByCsvName = Object.fromEntries(
      Array.from(new Set(games.flatMap((g) => [g.csvHome, g.csvAway]))).map((raw) => {
        const key = normalizeAliasLookup(raw);
        return [raw, aliasMap[key] ?? raw];
      })
    );
    const rebuilt = rebuildGamesFromAliasMap(games, aliasResolvedByCsvName);
    setGames(rebuilt);
    setIssues((prev) => [...prev, 'Teams catalog unavailable: rebuilt game keys from aliases only.']);
  }, [games, aliasMap]);

  const rebuildKeysAndRefresh = useCallback(async () => {
    await rebuildGamesWithCurrentAliases();
    await refreshLive();
  }, [rebuildGamesWithCurrentAliases, refreshLive]);

  const commitStagedAliases = useCallback(async () => {
    if (!Object.keys(aliasStaging.upserts).length && !aliasStaging.deletes.length) return;
    try {
      await persistAliasChanges(aliasStaging.upserts, aliasStaging.deletes);
      setAliasStaging({ upserts: {}, deletes: [] });
      showAliasToast('Aliases saved. Rebuilding…', 1800);

      if (scheduleSource === 'api') {
        await loadScheduleFromApi();
      } else {
        await rebuildKeysAndRefresh();
      }
    } catch (err) {
      setIssues((p) => [...p, `Alias save failed: ${(err as Error).message}`]);
      showAliasToast('Alias save failed.', 1800);
    }
  }, [aliasStaging, persistAliasChanges, showAliasToast, scheduleSource, loadScheduleFromApi, rebuildKeysAndRefresh]);

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
      if (scheduleSource === 'api') {
        await loadScheduleFromApi();
      } else {
        await rebuildGamesWithCurrentAliases();
      }
    } catch (err) {
      setIssues((p) => [...p, `Alias save failed: ${(err as Error).message}`]);
    }
  }, [editDraft, aliasMap, persistAliasChanges, scheduleSource, loadScheduleFromApi, rebuildGamesWithCurrentAliases]);


  const savePostseasonOverride = useCallback((eventId: string, patch: Partial<AppGame>) => {
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
      window.localStorage.setItem('cfb_postseason_overrides', JSON.stringify(next));
      nextOverrides = next;

      const override = next[eventId];
      if (override) {
        setGames((prevGames) => prevGames.map((g) => (g.eventId === eventId ? applyOverride(g, override) : g)));
      }

      return next;
    });

    if (scheduleSource === 'api' && nextOverrides) {
      void loadScheduleFromApi(undefined, nextOverrides);
    }
  }, [loadScheduleFromApi, scheduleSource]);
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
        season={SEASON}
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
        scheduleLoadedFromCache={scheduleLoadedFromCache}
        ownersLoadedFromCache={ownersLoadedFromCache}
        hasCachedSchedule={hasCachedSchedule}
        hasCachedOwners={hasCachedOwners}
        scheduleSource={scheduleSource}
        onScheduleFile={onScheduleFile}
        onOwnersFile={onOwnersFile}
        onClearCachedSchedule={clearCachedSchedule}
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
