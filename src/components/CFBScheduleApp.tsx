'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

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
import { SEED_ALIASES, type AliasMap, stripDiacritics } from '../lib/teamNames';
import { saveServerAliases } from '../lib/aliasesApi';
import { bootstrapAliasesAndCaches } from '../lib/bootstrap';
import { stageAliasFromMiss } from '../lib/aliasStaging';
import { reconcileNamesWithCatalog } from '../lib/reconcileNames';
import { rebuildGamesFromAliasMap } from '../lib/rebuildGames';
import { pillClass } from '../lib/gameUi';

/* =========================
   Flags / Season
   ========================= */
const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === '1';
const SEASON = Number(process.env.NEXT_PUBLIC_SEASON ?? new Date().getFullYear());

/* =========================
   Types
   ========================= */

type Game = {
  key: string;
  week: number;

  // Display names from CSV
  csvAway: string;
  csvHome: string;
  neutral: boolean;

  // Reconciled canonical names (for odds/scores matching)
  canAway: string;
  canHome: string;

  // Conferences for both schools (from CSV)
  awayConf: string;
  homeConf: string;
};

/* =========================
   Small utils
   ========================= */

function neutralKey(week: number, a: string, b: string): string {
  const pair = [a, b].sort((x, y) => x.localeCompare(y));
  return `${week}-${pair[0]}-${pair[1]}-N`;
}

/* =========================
   Component
   ========================= */

export default function CFBScheduleApp(): React.ReactElement {
  const [games, setGames] = useState<Game[]>([]);
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

  /* === New: diagnostics + alias staging UI state === */
  const [diag, setDiag] = useState<DiagEntry[]>([]);
  const [aliasStaging, setAliasStaging] = useState<AliasStaging>({ upserts: {}, deletes: [] });
  const [aliasToast, setAliasToast] = useState<string | null>(null);

  const [scheduleLoadedFromCache, setScheduleLoadedFromCache] = useState<boolean>(false);
  const [ownersLoadedFromCache, setOwnersLoadedFromCache] = useState<boolean>(false);
  const [hasCachedSchedule, setHasCachedSchedule] = useState<boolean>(false);
  const [hasCachedOwners, setHasCachedOwners] = useState<boolean>(false);

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

  /* ===== Owners CSV ===== */

  const tryParseOwnersCSV = useCallback((text: string) => {
    setRoster(parseOwnersCsv(text));
  }, []);

  /* ===== CSV name reconciliation using aliasMap first ===== */

  const reconcileNames = useCallback(
    async (csvTeams: string[]): Promise<Record<string, string>> => {
      return reconcileNamesWithCatalog({
        csvTeams,
        aliasMap,
        season: SEASON,
        onTeamsCatalogError: (message) => {
          setIssues((p) => [...p, `Teams catalog fetch failed: ${message}`]);
        },
        persistLearnedAliases: async (upserts) => {
          try {
            await persistAliasChanges(upserts, []);
          } catch {
            // ignore network failures; best-effort
          }
        },
      });
    },
    [aliasMap, persistAliasChanges]
  );

  /* ===== Schedule CSV (Two-pass + conflict detection + alias use) ===== */

  const tryParseScheduleCSV = useCallback(
    async (text: string) => {
      const parsed = parseScheduleCsv(text, {
        onConflict: (msg) => setIssues((p) => [...p, msg]),
      });
      const { draftGames, byeMap, conferences: parsedConferences } = parsed;
      if (!draftGames.length) return;

      // Reconcile canonical names using aliasMap + catalog fallback
      const csvTeams = Array.from(
        new Set<string>(draftGames.flatMap((g) => [g.csvHome, g.csvAway]))
      );
      const mapObj = await reconcileNames(csvTeams);

      const finalGames: Game[] = draftGames.map((g) => {
        const canAway = mapObj[g.csvAway] ?? g.csvAway;
        const canHome = mapObj[g.csvHome] ?? g.csvHome;
        const key = g.neutral
          ? neutralKey(g.week, canHome, canAway)
          : `${g.week}-${canHome}-${canAway}-H`;
        return {
          key,
          week: g.week,
          csvAway: g.csvAway,
          csvHome: g.csvHome,
          neutral: g.neutral,
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
      if (selectedWeek == null && finalGames.length) setSelectedWeek(finalGames[0]!.week);
    },
    [reconcileNames, selectedWeek, setIssues]
  );

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
  }, []);

  const clearOwnersDerivedState = useCallback(() => {
    setRoster([]);
  }, []);

  const clearCachedSchedule = useCallback(() => {
    window.localStorage.removeItem('cfb_schedule_csv');
    setHasCachedSchedule(false);
    setScheduleLoadedFromCache(false);
    clearScheduleDerivedState();
  }, [clearScheduleDerivedState]);

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

  /* ===== Initial load: aliases (server -> localStorage), cached CSVs ===== */

  // Bootstrap aliases and cached CSV payloads once, then parse through the same handlers.
  useEffect(() => {
    (async () => {
      const {
        aliasMap: bootAliasMap,
        aliasLoadIssue,
        scheduleCsvText,
        ownersCsvText,
      } = await bootstrapAliasesAndCaches({ season: SEASON, seedAliases: SEED_ALIASES });

      setAliasMap(bootAliasMap);
      if (aliasLoadIssue) setIssues((p) => [...p, aliasLoadIssue]);

      setHasCachedSchedule(Boolean(scheduleCsvText));
      setHasCachedOwners(Boolean(ownersCsvText));
      if (scheduleCsvText) {
        setScheduleLoadedFromCache(true);
        void tryParseScheduleCSV(scheduleCsvText);
      }
      if (ownersCsvText) {
        setOwnersLoadedFromCache(true);
        tryParseOwnersCSV(ownersCsvText);
      }
    })();
  }, [tryParseScheduleCSV, tryParseOwnersCSV]);

  /* ===== File inputs ===== */

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

  /* ===== Derived ===== */

  const rosterByTeam = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of roster) m.set(r.team, r.owner);
    return m;
  }, [roster]);

  function filteredWeekGames(w: number): Game[] {
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
        const aMarquee = Number(
          Boolean(rosterByTeam.get(a.csvHome) || rosterByTeam.get(a.csvAway))
        );
        const bMarquee = Number(
          Boolean(rosterByTeam.get(b.csvHome) || rosterByTeam.get(b.csvAway))
        );
        return bMarquee - aMarquee || a.csvHome.localeCompare(b.csvHome);
      });
  }

  /* ===== Refresh odds & scores ===== */

  // Live refresh remains orchestrated here; heavy odds/scores logic is delegated to src/lib.
  const refreshLive = useCallback(async () => {
    setIssues([]);
    setDiag([]); // clear structured diagnostics at start
    if (!games.length) {
      setIssues((p) => [...p, 'No games loaded. Upload your Schedule CSV first.']);
      return;
    }
    setLoadingLive(true);
    try {
      // ---- ODDS ----
      try {
        const oddsRes = await fetch(`/api/odds`, { cache: 'no-store' });
        if (oddsRes.ok) {
          const oddsEvents = (await oddsRes.json()) as OddsEvent[];
          const next = buildOddsByGame(games, oddsEvents, aliasMap);
          setOddsByKey(next);
        } else {
          const t = await oddsRes.text().catch(() => '');
          setIssues((p) => [...p, `Odds error ${oddsRes.status}: ${t}`]);
        }
      } catch (err) {
        setIssues((p) => [...p, `Odds fetch failed: ${(err as Error).message}`]);
      }

      // ---- SCORES (robust week-scoped matching with FBS filter + quiet prior-week finals) ----
      try {
        const {
          scoresByKey: nextScores,
          issues: scoreIssues,
          diag: scoreDiag,
        } = await fetchScoresByGame({
          games,
          aliasMap,
          season: SEASON,
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

  /* ===== New: alias quick-add helpers (after refreshLive to avoid cyclic deps) ===== */

  const stageAliasWithToast = useCallback(
    (providerName: string, csvName: string) => {
      setAliasStaging((prev) => stageAliasFromMiss(providerName, csvName, prev));
      showAliasToast(`Staged alias: "${providerName}" → "${csvName}"`);
    },
    [showAliasToast]
  );

  const rebuildGamesWithCurrentAliases = useCallback(async () => {
    if (!games.length) return;
    const teams = Array.from(new Set<string>(games.flatMap((g) => [g.csvHome, g.csvAway])));
    const mapObj = await reconcileNames(teams);
    const rebuilt = rebuildGamesFromAliasMap(games, mapObj);
    setGames(rebuilt);
  }, [games, reconcileNames]);

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
      await rebuildKeysAndRefresh();
    } catch (err) {
      setIssues((p) => [...p, `Alias save failed: ${(err as Error).message}`]);
      showAliasToast('Alias save failed.', 1800);
    }
  }, [aliasStaging, persistAliasChanges, rebuildKeysAndRefresh, showAliasToast]);

  /* ===== Alias editor (optional) ===== */

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
    // Build upserts and deletes from draft vs existing
    const cleaned: AliasMap = {};
    for (const row of editDraft) {
      const k = stripDiacritics(row.key).toLowerCase().trim();
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
      // Rebuild game keys with new aliases only if games are loaded
      await rebuildGamesWithCurrentAliases();
    } catch (err) {
      setIssues((p) => [...p, `Alias save failed: ${(err as Error).message}`]);
    }
  }, [editDraft, aliasMap, persistAliasChanges, rebuildGamesWithCurrentAliases]);

  /* ===== UI ===== */

  return (
    <div className="p-6 space-y-6 text-gray-900 bg-white dark:text-zinc-100 dark:bg-zinc-950">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">CFB Office Pool</h1>
          <p className="text-sm text-gray-600 dark:text-zinc-400">
            Upload CSVs, maintain team aliases (persistent), then refresh odds &amp; scores.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <button
            className={`px-3 py-2 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 ${
              loadingLive ? 'opacity-60' : ''
            }`}
            onClick={() => void refreshLive()}
            disabled={loadingLive || games.length === 0}
            title={games.length === 0 ? 'Upload your Schedule CSV first' : 'Refresh odds & scores'}
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
            />
          )}
        </>
      )}
    </div>
  );
}
