'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

/* =========================
   Flags / Season
   ========================= */
const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === '1';
const SEASON = Number(process.env.NEXT_PUBLIC_SEASON ?? new Date().getFullYear());

/* =========================
   Types
   ========================= */

type OwnerRow = { team: string; owner: string };

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

type ScoreTeam = { team: string; score: number | null };
type ScorePack = {
  status: string;
  home: ScoreTeam;
  away: ScoreTeam;
  time: string | null;
};

type OddsOutcome = { name?: string; price?: number; point?: number };
type OddsMarket = { key?: string; outcomes?: OddsOutcome[] };
type OddsBookmaker = { key?: string; title?: string; markets?: OddsMarket[] };
type OddsEvent = { home_team?: string; away_team?: string; bookmakers?: OddsBookmaker[] };

type CombinedOdds = {
  favorite: string | null;
  spread: number | null;
  total: number | null;
  mlHome: number | null;
  mlAway: number | null;
  source?: string | null;
};

type AliasMap = Record<string, string>;

/* === New: Structured diagnostics + alias staging === */
type DiagEntry =
  | {
      kind: 'scores_miss';
      week: number;
      providerHome: string;
      providerAway: string;
      candidates?: Array<{ csvHome: string; csvAway: string; week: number }>;
    }
  | {
      kind: 'week_mismatch';
      week: number;
      providerHome: string;
      providerAway: string;
      candidates: Array<{ csvHome: string; csvAway: string; week: number }>;
    }
  | { kind: 'generic'; message: string };

type AliasStaging = { upserts: Record<string, string>; deletes: string[] };

/* =========================
   Name normalization & base aliases
   (server map is the source of truth; these just provide helpful seeds
   if your server map is empty the first time)
   ========================= */

const SEED_ALIASES: AliasMap = {
  'app state': 'appalachian state',
  utsa: 'texas san antonio',
  'texas a&m': 'texas am',
  'texas a and m': 'texas am',
  'ole miss': 'mississippi',
  uh: 'houston',
  ucf: 'central florida',
  'ul monroe': 'louisiana monroe',
  umass: 'massachusetts',
  byu: 'brigham young',
  smu: 'southern methodist',
  sjsu: 'san jose state',
  'san jose state': 'san jose state', // catches “san josé state” via diacritic strip
  uconn: 'connecticut',
  'colorado st': 'colorado state',
  'wash st': 'washington state',
  'southeastern la': 'se louisiana',
  'louisiana monroe': 'ul monroe',
  albany: 'ualbany',
  unlv: 'nevada-las vegas',
};

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function applyAliases(baseLower: string, aliases: AliasMap): string {
  return aliases[baseLower] ?? baseLower;
}

function normWithAliases(s: string, aliases: AliasMap): string {
  let t = stripDiacritics(s).toLowerCase().trim();
  t = applyAliases(t, aliases);
  t = t.replace(/\b(university|univ|the|of|and|&)\b/g, ' ');
  t = t.replace(/[^a-z0-9]+/g, '');
  return t;
}

function variants(raw: string, aliases: AliasMap): string[] {
  const base = normWithAliases(raw, aliases);
  if (!base) return [];
  const out = new Set<string>([base]);
  const tokens = base.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length >= 2) out.add(tokens[0] + tokens[1]);
  if (tokens.length >= 1) out.add(tokens[0]);
  return Array.from(out);
}

/* =========================
   Small utils
   ========================= */

function clamp(s: unknown): string {
  return typeof s === 'string' ? s.trim() : String(s ?? '').trim();
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cur.push(cell.trim());
        cell = '';
      } else if (ch === '\n') {
        cur.push(cell.trim());
        rows.push(cur);
        cur = [];
        cell = '';
      } else if (ch === '\r') {
        // ignore
      } else {
        cell += ch;
      }
    }
  }
  cur.push(cell.trim());
  rows.push(cur);

  if (rows.length && rows[rows.length - 1]!.length === 1 && rows[rows.length - 1]![0] === '') {
    rows.pop();
  }
  return rows;
}

function neutralKey(week: number, a: string, b: string): string {
  const pair = [a, b].sort((x, y) => x.localeCompare(y));
  return `${week}-${pair[0]}-${pair[1]}-N`;
}

function gameStateFromScore(score?: ScorePack): 'final' | 'inprogress' | 'scheduled' | 'unknown' {
  if (!score) return 'unknown';
  const s = (score.status || '').toLowerCase();
  if (s.includes('final') || s.includes('post')) return 'final';
  if (s.includes('in ') || s.includes(' q') || s.includes('quarter') || s.includes('half'))
    return 'inprogress';
  if (s.includes('sched') || s.includes('pregame')) return 'scheduled';
  return 'unknown';
}

function statusClasses(
  state: 'final' | 'inprogress' | 'scheduled' | 'unknown',
  hasInfo: boolean
): string {
  if (!hasInfo) {
    return 'border rounded border-l-4 border-l-red-600 bg-red-50 text-gray-900 dark:border-l-red-400 dark:bg-red-900/25 dark:text-zinc-100';
  }
  switch (state) {
    case 'final':
      return 'border rounded border-l-4 border-l-emerald-600 bg-emerald-50 text-gray-900 dark:border-l-emerald-400 dark:bg-emerald-900/25 dark:text-zinc-100';
    case 'inprogress':
      return 'border rounded border-l-4 border-l-amber-600 bg-amber-50 text-gray-900 dark:border-l-amber-400 dark:bg-amber-900/25 dark:text-zinc-100';
    case 'scheduled':
      return 'border rounded border-l-4 border-l-blue-600 bg-blue-50 text-gray-900 dark:border-l-blue-400 dark:bg-blue-900/25 dark:text-zinc-100';
    default:
      return 'border rounded text-gray-900 dark:text-zinc-100';
  }
}

function chipClass(): string {
  return 'text-[10px] uppercase tracking-wide border rounded px-1 py-0.5 bg-white text-gray-700 border-gray-300 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600';
}

function pillClass(): string {
  return 'text-xs border rounded px-1 py-0.5 bg-white text-gray-700 border-gray-300 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600';
}

/* =========================
   Server alias helpers
   ========================= */

async function loadServerAliases(year: number = SEASON): Promise<AliasMap> {
  const res = await fetch(`/api/aliases?year=${year}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`aliases GET ${res.status}`);
  const data = (await res.json()) as { year: number; map: AliasMap };
  return data.map ?? {};
}

async function saveServerAliases(
  upserts: AliasMap,
  deletes: string[] = [],
  year: number = SEASON
): Promise<AliasMap> {
  const res = await fetch(`/api/aliases?year=${year}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ upserts, deletes }),
  });
  if (!res.ok) throw new Error(`aliases PUT ${res.status}`);
  const data = (await res.json()) as { year: number; map: AliasMap };
  return data.map ?? {};
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

  /* ===== Owners CSV ===== */

  const tryParseOwnersCSV = useCallback((text: string) => {
    const rows = parseCSV(text);
    if (rows.length < 2) {
      setRoster([]);
      return;
    }
    const header = rows[0]!.map((h) => h.toLowerCase());
    const teamIdx = header.findIndex((h) => h.includes('team'));
    const ownerIdx = header.findIndex((h) => h.includes('owner'));

    const list: OwnerRow[] = rows
      .slice(1)
      .map((r) => {
        const team = clamp(teamIdx >= 0 ? r[teamIdx] : r[0]);
        const owner = clamp(ownerIdx >= 0 ? r[ownerIdx] : r[1]);
        return { team, owner };
      })
      .filter((x) => x.team && x.owner);

    setRoster(list);
  }, []);

  /* ===== CSV name reconciliation using aliasMap first ===== */

  const reconcileNames = useCallback(
    async (csvTeams: string[]): Promise<Record<string, string>> => {
      // 1) Try alias map (server-sourced + cached)
      const out: Record<string, string> = {};
      let missing: string[] = [];

      for (const raw of csvTeams) {
        const base = stripDiacritics(raw).toLowerCase().trim();
        const aliased = aliasMap[base];
        if (aliased) {
          out[raw] = aliased;
        } else {
          out[raw] = raw;
          missing.push(raw);
        }
      }

      // 2) Optionally try CFBD catalog to auto-fill misses (best-effort)
      if (missing.length) {
        try {
          const year = SEASON;
          const resp = await fetch(`/api/teams?year=${year}`, { cache: 'no-store' });
          if (resp.ok) {
            const data = (await resp.json()) as {
              items: Array<{ school: string; mascot?: string | null }>;
            };
            const index = new Map<string, string>(); // normalized -> canonical school
            for (const item of data.items) {
              const school = item.school;
              const vs = new Set<string>(variants(school, aliasMap));
              if (item.mascot) vs.add(normWithAliases(`${school} ${item.mascot}`, aliasMap));
              vs.forEach((v) => index.set(v, school));
            }

            const upserts: AliasMap = {};
            const newlyResolved: string[] = [];
            for (const raw of missing) {
              const keys = variants(raw, aliasMap);
              let hit: string | undefined;
              for (const k of keys) {
                if (index.has(k)) {
                  hit = index.get(k);
                  break;
                }
              }
              if (!hit) {
                // fuzzy: startsWith either direction
                const nk = normWithAliases(raw, aliasMap);
                for (const [k, school] of index.entries()) {
                  if (k.startsWith(nk) || nk.startsWith(k)) {
                    hit = school;
                    break;
                  }
                }
              }
              if (hit) {
                out[raw] = hit;
                upserts[stripDiacritics(raw).toLowerCase().trim()] = hit;
                newlyResolved.push(raw);
              }
            }

            // Persist any newly learned aliases
            if (Object.keys(upserts).length) {
              try {
                const saved = await saveServerAliases(upserts, []);
                setAliasMap(saved);
                window.localStorage.setItem('cfb_name_map', JSON.stringify(saved));
              } catch {
                // ignore network failures; best-effort
              }
            }

            // prune from missing
            missing = missing.filter((m) => !newlyResolved.includes(m));
          }
        } catch (err) {
          setIssues((p) => [...p, `Teams catalog fetch failed: ${(err as Error).message}`]);
        }
      }

      return out;
    },
    [aliasMap, setAliasMap, setIssues]
  );

  /* ===== Schedule CSV (Two-pass + conflict detection + alias use) ===== */

  const tryParseScheduleCSV = useCallback(
    async (text: string) => {
      const rows = parseCSV(text);
      if (!rows.length) return;

      // Identify week columns from header (Col C.. up to Week 16)
      const header = rows[0] ?? [];
      const weekCols: Array<{ index: number; week: number }> = [];
      const weekFromHeader = (name: string): number | null => {
        const m = name.match(/week\s*(\d+)/i);
        return m ? Number.parseInt(m[1]!, 10) : null;
      };
      for (let idx = 2; idx < header.length && idx <= 18; idx++) {
        const wk = weekFromHeader(header[idx] || '');
        const w = Number.isFinite(wk) && wk !== null ? wk : idx - 2;
        weekCols.push({ index: idx, week: w });
      }

      // Pass 1: team -> conference
      const teamConf = new Map<string, string>();
      const confSet = new Set<string>();
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]!;
        if (row.length < 2) continue;
        const conference = clamp(row[0]);
        const team = clamp(row[1]);
        if (!team) continue;
        teamConf.set(team, conference);
        if (conference) confSet.add(conference);
      }

      // Track conflicts per (week, pair)
      type Site = 'HOME' | 'AWAY' | 'NEUTRAL';
      type SiteObserved = { type: Site; homeCSV?: string; awayCSV?: string };
      const conflictMap = new Map<string, SiteObserved>(); // `${week}__${sorted(csvA,csvB)}`
      const pairKey = (w: number, a: string, b: string): string => {
        const sorted = [a, b].sort((x, y) => x.localeCompare(y));
        return `${w}__${sorted[0]}__${sorted[1]}`;
      };
      const noteConflict = (msg: string) => setIssues((p) => [...p, msg]);

      const parsedDraft: Array<{
        week: number;
        csvAway: string;
        csvHome: string;
        neutral: boolean;
        awayConf: string;
        homeConf: string;
      }> = [];

      const seenMerge = new Map<string, { awayConf: string; homeConf: string }>();
      const byeMap: Record<number, string[]> = {};
      const weekSet = new Set<number>();
      const csvTeamsSet = new Set<string>();

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]!;
        if (row.length < 2) continue;
        const team = clamp(row[1]);
        if (!team) continue;

        for (const col of weekCols) {
          const cell = clamp(row[col.index] ?? '');
          if (!cell) continue;
          const w = col.week;
          weekSet.add(w);

          if (/^BYE$/i.test(cell)) {
            (byeMap[w] ||= []).push(team);
            continue;
          }

          // Parse from this row's perspective
          let claim: SiteObserved;
          let csvHome = '';
          let csvAway = '';
          let neutral = false;

          if (/^@/i.test(cell)) {
            const opp = cell.replace(/^@\s*/i, '');
            csvTeamsSet.add(opp);
            csvTeamsSet.add(team);
            csvHome = opp;
            csvAway = team;
            neutral = false;
            claim = { type: 'AWAY', homeCSV: opp, awayCSV: team };
          } else if (/^vs\s+/i.test(cell)) {
            const opp = cell.replace(/^vs\s+/i, '');
            csvTeamsSet.add(opp);
            csvTeamsSet.add(team);
            csvHome = opp;
            csvAway = team;
            neutral = true;
            claim = { type: 'NEUTRAL', homeCSV: opp, awayCSV: team };
          } else {
            const opp = cell;
            csvTeamsSet.add(opp);
            csvTeamsSet.add(team);
            csvHome = team;
            csvAway = opp;
            neutral = false;
            claim = { type: 'HOME', homeCSV: team, awayCSV: opp };
          }

          const pk = pairKey(w, csvHome, csvAway);
          const prev = conflictMap.get(pk);
          if (!prev) {
            conflictMap.set(pk, claim);
          } else {
            if (claim.type === 'NEUTRAL' && prev.type !== 'NEUTRAL') {
              noteConflict(
                `Conflict: Week ${w} ${csvAway} vs ${csvHome} — neutral for one row only.`
              );
            } else if (prev.type === 'NEUTRAL' && claim.type !== 'NEUTRAL') {
              noteConflict(
                `Conflict: Week ${w} ${csvAway} vs ${csvHome} — neutral for one row only.`
              );
            } else if (
              claim.type === 'HOME' &&
              prev.type === 'HOME' &&
              prev.homeCSV &&
              claim.homeCSV &&
              prev.homeCSV !== claim.homeCSV
            ) {
              noteConflict(
                `Conflict: Week ${w} ${csvAway} vs ${csvHome} — both rows claim HOME (different teams).`
              );
            } else if (
              claim.type === 'AWAY' &&
              prev.type === 'AWAY' &&
              prev.awayCSV &&
              claim.awayCSV &&
              prev.awayCSV !== claim.awayCSV
            ) {
              noteConflict(
                `Conflict: Week ${w} ${csvAway} vs ${csvHome} — both rows claim AWAY (different teams).`
              );
            }
          }

          const curHomeConf = teamConf.get(csvHome) ?? '';
          const curAwayConf = teamConf.get(csvAway) ?? '';
          const key = neutral ? neutralKey(w, csvHome, csvAway) : `${w}-${csvHome}-${csvAway}-H`;

          const stored = seenMerge.get(key);
          if (stored) {
            const mergedHome = stored.homeConf || curHomeConf;
            const mergedAway = stored.awayConf || curAwayConf;
            seenMerge.set(key, { homeConf: mergedHome, awayConf: mergedAway });
          } else {
            seenMerge.set(key, { homeConf: curHomeConf, awayConf: curAwayConf });
          }

          const exists = parsedDraft.find((g) =>
            neutral
              ? neutralKey(g.week, g.csvHome, g.csvAway) === key
              : `${g.week}-${g.csvHome}-${g.csvAway}-H` === key
          );
          if (!exists) {
            parsedDraft.push({
              week: w,
              csvAway,
              csvHome,
              neutral,
              awayConf: curAwayConf,
              homeConf: curHomeConf,
            });
          }
        }
      }

      // Merge conferences
      for (let i = 0; i < parsedDraft.length; i++) {
        const g = parsedDraft[i]!;
        const k = g.neutral
          ? neutralKey(g.week, g.csvHome, g.csvAway)
          : `${g.week}-${g.csvHome}-${g.csvAway}-H`;
        const merged = seenMerge.get(k);
        if (merged) {
          parsedDraft[i] = {
            ...g,
            awayConf: g.awayConf || merged.awayConf,
            homeConf: g.homeConf || merged.homeConf,
          };
        }
      }

      // Reconcile canonical names using aliasMap + catalog fallback
      const csvTeams = Array.from(
        new Set<string>(parsedDraft.flatMap((g) => [g.csvHome, g.csvAway]))
      );
      const mapObj = await reconcileNames(csvTeams);

      const finalGames: Game[] = parsedDraft.map((g) => {
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
      setConferences(['ALL', ...Array.from(confSet).sort((a, b) => a.localeCompare(b))]);
      if (selectedWeek == null && finalGames.length) setSelectedWeek(finalGames[0]!.week);
    },
    [reconcileNames, selectedWeek, setIssues]
  );

  /* ===== Initial load: aliases (server -> localStorage), cached CSVs ===== */

  useEffect(() => {
    (async () => {
      try {
        // Load server aliases; seed with defaults if server is empty
        let serverMap = await loadServerAliases();
        if (!Object.keys(serverMap).length && Object.keys(SEED_ALIASES).length) {
          serverMap = await saveServerAliases(SEED_ALIASES);
        }
        setAliasMap(serverMap);
        window.localStorage.setItem('cfb_name_map', JSON.stringify(serverMap));
      } catch (err) {
        setIssues((p) => [...p, `Aliases load failed: ${(err as Error).message}`]);
        // Fall back to any local cache or seeds
        const cached =
          typeof window !== 'undefined' ? window.localStorage.getItem('cfb_name_map') : null;
        if (cached) {
          try {
            const local = JSON.parse(cached) as AliasMap;
            setAliasMap(local);
          } catch {
            setAliasMap({ ...SEED_ALIASES });
          }
        } else {
          setAliasMap({ ...SEED_ALIASES });
        }
      }

      // Load any cached CSVs
      const schedText =
        typeof window !== 'undefined' ? window.localStorage.getItem('cfb_schedule_csv') : null;
      const ownersText =
        typeof window !== 'undefined' ? window.localStorage.getItem('cfb_owners_csv') : null;
      if (schedText) void tryParseScheduleCSV(schedText);
      if (ownersText) tryParseOwnersCSV(ownersText);
    })();
  }, [tryParseScheduleCSV, tryParseOwnersCSV]);

  /* ===== File inputs ===== */

  const onScheduleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      window.localStorage.setItem('cfb_schedule_csv', text);
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
          const next: Record<string, CombinedOdds> = {};

          const pickPreferredBook = (ev: OddsEvent): OddsBookmaker | undefined => {
            const pref = [
              'draftkings',
              'betmgm',
              'caesars',
              'fanduel',
              'espnbet',
              'pointsbet',
              'bet365',
            ];
            const books = ev.bookmakers ?? [];
            for (const want of pref) {
              const hit = books.find((b) => (b.key || '').toLowerCase() === want);
              if (hit) return hit;
            }
            return books[0];
          };

          for (const g of games) {
            const ghVars = variants(g.canHome, aliasMap);
            const gaVars = variants(g.canAway, aliasMap);
            const gh = normWithAliases(g.canHome, aliasMap);
            const ga = normWithAliases(g.canAway, aliasMap);

            const match = oddsEvents.find((e) => {
              const eh = normWithAliases(e.home_team || '', aliasMap);
              const ea = normWithAliases(e.away_team || '', aliasMap);
              if ((eh === gh && ea === ga) || (eh === ga && ea === gh)) return true;
              const startsEither =
                (ghVars.some((v) => eh.startsWith(v)) && gaVars.some((v) => ea.startsWith(v))) ||
                (ghVars.some((v) => ea.startsWith(v)) && gaVars.some((v) => eh.startsWith(v)));
              if (startsEither) return true;
              const containsEither =
                (ghVars.some((v) => eh.includes(v)) && gaVars.some((v) => ea.includes(v))) ||
                (ghVars.some((v) => ea.includes(v)) && gaVars.some((v) => eh.includes(v)));
              return containsEither;
            });

            if (!match) continue;

            const book = pickPreferredBook(match);
            const sourceTitle = book?.title || book?.key || null;
            const markets = book?.markets ?? [];
            const getMarket = (key: string): OddsMarket | undefined =>
              markets.find((m) => (m.key || '').toLowerCase() === key);

            const h2h = getMarket('h2h');
            const spreads = getMarket('spreads');
            const totals = getMarket('totals');

            let favorite: string | null = null;
            let spread: number | null = null;
            let total: number | null = null;
            let mlHome: number | null = null;
            let mlAway: number | null = null;

            if (h2h?.outcomes) {
              for (const o of h2h.outcomes) {
                const nm = normWithAliases(o.name || '', aliasMap);
                if (nm === normWithAliases(match.home_team || '', aliasMap))
                  mlHome = typeof o.price === 'number' ? o.price : null;
                if (nm === normWithAliases(match.away_team || '', aliasMap))
                  mlAway = typeof o.price === 'number' ? o.price : null;
              }
            }

            if (spreads?.outcomes) {
              const hs = spreads.outcomes.find(
                (o) =>
                  normWithAliases(o.name || '', aliasMap) ===
                  normWithAliases(match.home_team || '', aliasMap)
              );
              const as = spreads.outcomes.find(
                (o) =>
                  normWithAliases(o.name || '', aliasMap) ===
                  normWithAliases(match.away_team || '', aliasMap)
              );
              const hPoint = typeof hs?.point === 'number' ? hs.point : null;
              const aPoint = typeof as?.point === 'number' ? as.point : null;
              if (hPoint != null && aPoint != null) {
                const hAbs = Math.abs(hPoint);
                const aAbs = Math.abs(aPoint);
                spread = hAbs <= aAbs ? hPoint : aPoint;
                favorite = hAbs < aAbs ? match.home_team || null : match.away_team || null;
              }
            }

            if (totals?.outcomes) {
              const over = totals.outcomes.find((o) =>
                (o.name || '').toLowerCase().includes('over')
              );
              if (typeof over?.point === 'number') total = over.point;
            }

            next[g.key] = { favorite, spread, total, mlHome, mlAway, source: sourceTitle };
          }

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
        type WireFlat = {
          status: string;
          home: string;
          away: string;
          homeScore: number | null;
          awayScore: number | null;
          time: string | null;
        };
        type WireSide = { team?: string; score?: number | null } | null | undefined;
        type WireObj = {
          status: string;
          time: string | null;
          home: WireSide;
          away: WireSide;
        };

        const extractRow = (sg: WireFlat | WireObj) => {
          if (typeof (sg as WireFlat).home === 'string') {
            const flat = sg as WireFlat;
            return {
              homeName: flat.home || '',
              awayName: flat.away || '',
              homeScore: flat.homeScore ?? null,
              awayScore: flat.awayScore ?? null,
              status: flat.status || '',
              time: flat.time ?? null,
            };
          }
          const obj = sg as WireObj;
          const h = obj.home ?? null;
          const a = obj.away ?? null;
          return {
            homeName: (h?.team ?? '') as string,
            awayName: (a?.team ?? '') as string,
            homeScore: (typeof h?.score === 'number' ? h?.score : (h?.score ?? null)) as
              | number
              | null,
            awayScore: (typeof a?.score === 'number' ? a?.score : (a?.score ?? null)) as
              | number
              | null,
            status: obj.status || '',
            time: obj.time ?? null,
          };
        };

        // Build FBS set (normalized variants for robust matching)
        const fbsNorm = new Set<string>();
        try {
          const rFbs = await fetch(`/api/teams?year=${SEASON}&level=FBS`, { cache: 'no-store' });
          if (rFbs.ok) {
            const data = (await rFbs.json()) as {
              items: Array<{ school: string; mascot?: string | null }>;
            };
            for (const t of data.items) {
              for (const v of variants(t.school, aliasMap)) fbsNorm.add(v);
              if (t.mascot) fbsNorm.add(normWithAliases(`${t.school} ${t.mascot}`, aliasMap));
            }
          }
        } catch {
          /* best-effort */
        }

        // If we fail to build the FBS set, do NOT filter at all.
        const fbsFilterActive = fbsNorm.size > 0;

        const isFBSName = (name: string) => {
          if (!fbsFilterActive) return true; // fallback: allow all
          const vs = variants(name, aliasMap);
          return vs.some((v) => fbsNorm.has(v));
        };

        // Global index of normalized *pairs* → list of {week, game}
        const weeksSet = new Set<number>(games.map((g) => g.week));
        const pairKey = (a: string, b: string) => {
          const x = normWithAliases(a, aliasMap);
          const y = normWithAliases(b, aliasMap);
          return [x, y].sort().join('__');
        };

        const globalIndex = new Map<string, Array<{ week: number; game: Game }>>();
        for (const g of games) {
          // Only index games that involve at least one FBS team (unless filter is inactive)
          const involvesFbs = fbsFilterActive
            ? isFBSName(g.canHome) ||
              isFBSName(g.canAway) ||
              isFBSName(g.csvHome) ||
              isFBSName(g.csvAway)
            : true;

          if (!involvesFbs) continue;

          const keys = new Set<string>();
          keys.add(pairKey(g.canHome, g.canAway)); // canonical pair
          keys.add(pairKey(g.csvHome, g.csvAway)); // csv pair (fallback)

          for (const k of keys) {
            const arr = globalIndex.get(k) ?? [];
            arr.push({ week: g.week, game: g });
            globalIndex.set(k, arr);
          }
        }

        const nextScores: Record<string, ScorePack> = {};

        // Diagnostic caps
        let weekMismatchCount = 0;
        let hardMissCount = 0;
        const maxIssuesPerKind = 10;

        for (const w of weeksSet) {
          const r = await fetch(`/api/scores?week=${w}`, { cache: 'no-store' });
          if (!r.ok) {
            const t = await r.text().catch(() => '');
            setIssues((p) => [...p, `Scores week ${w}: ${r.status} ${t}`]);
            continue;
          }

          const raw = (await r.json()) as Array<WireFlat | WireObj>;

          for (const row of raw) {
            const { homeName, awayName, homeScore, awayScore, status, time } = extractRow(row);

            // Skip pure FCS-vs-FCS rows from diagnostics when the FBS filter is active
            const rowInvolvesFbs = fbsFilterActive
              ? isFBSName(homeName) || isFBSName(awayName)
              : true;
            if (fbsFilterActive && !rowInvolvesFbs) {
              // Still let these populate if we ever indexed them
              const kFcs = pairKey(homeName, awayName);
              const maybe = globalIndex.get(kFcs);
              if (!maybe || maybe.length === 0) continue;
            }

            const k = pairKey(homeName, awayName);
            const matchesAllWeeks = globalIndex.get(k) ?? [];
            if (matchesAllWeeks.length === 0) {
              if (rowInvolvesFbs && hardMissCount < maxIssuesPerKind) {
                setIssues((p) => [...p, `Scores miss (week ${w}): "${homeName}" vs "${awayName}"`]);
                setDiag((prev) => [
                  ...prev,
                  { kind: 'scores_miss', week: w, providerHome: homeName, providerAway: awayName },
                ]);
              }
              if (rowInvolvesFbs) hardMissCount++;
              continue;
            }

            // Try to find a game scheduled in this same week first
            const sameWeek = matchesAllWeeks.find((m) => m.week === w);
            if (sameWeek) {
              const g = sameWeek.game;
              nextScores[g.key] = {
                status,
                time,
                home: { team: homeName, score: homeScore },
                away: { team: awayName, score: awayScore },
              };
              continue;
            }

            // No same-week match; silence common “prior-week final” noise.
            const otherWeeks = Array.from(new Set(matchesAllWeeks.map((m) => m.week))).sort(
              (a, b) => a - b
            );
            const isFinal = (status || '').toLowerCase().includes('final');
            const isPrevWeekCarryover = otherWeeks.includes(w - 1);

            // If it’s a FINAL from the immediately previous week, ignore quietly.
            if (isFinal && isPrevWeekCarryover) {
              continue;
            }

            // If we already captured this pair for any week during this refresh, ignore quietly.
            const alreadyCaptured = matchesAllWeeks.some(({ game }) =>
              Boolean(nextScores[game.key])
            );
            if (alreadyCaptured) {
              continue;
            }

            // Otherwise, surface as week mismatch (capped) with scheduled context.
            if (rowInvolvesFbs && weekMismatchCount < maxIssuesPerKind) {
              const candidates = matchesAllWeeks.map(({ week: wk, game }) => ({
                csvHome: game.csvHome,
                csvAway: game.csvAway,
                week: wk,
              }));
              const scheduledPairs = Array.from(
                new Map(
                  matchesAllWeeks.map(({ week: wk, game }) => [
                    `${wk}-${game.csvHome}-${game.csvAway}`,
                    `wk ${wk}: "${game.csvAway}" vs "${game.csvHome}"`,
                  ])
                ).values()
              ).join('; ');

              setIssues((p) => [
                ...p,
                `Scores week ${w}: provider reported "${homeName}" vs "${awayName}". Closest scheduled matchup(s): ${scheduledPairs}. Ignoring due to week mismatch.`,
              ]);
              setDiag((prev) => [
                ...prev,
                {
                  kind: 'week_mismatch',
                  week: w,
                  providerHome: homeName,
                  providerAway: awayName,
                  candidates,
                },
              ]);
            }
            if (rowInvolvesFbs) weekMismatchCount++;
          }
        }

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

  function stageAliasFromMiss(
    providerName: string,
    csvName: string,
    prev: AliasStaging
  ): AliasStaging {
    const a = stripDiacritics(providerName).toLowerCase().trim();
    const c = csvName.trim();
    if (!a || !c) return prev;
    return { upserts: { ...prev.upserts, [a]: c }, deletes: prev.deletes.filter((d) => d !== a) };
  }

  const rebuildKeysAndRefresh = useCallback(async () => {
    if (games.length) {
      const teams = Array.from(new Set<string>(games.flatMap((g) => [g.csvHome, g.csvAway])));
      const mapObj = await reconcileNames(teams);
      const rebuilt = games.map((g) => {
        const canAway = mapObj[g.csvAway] ?? g.csvAway;
        const canHome = mapObj[g.csvHome] ?? g.csvHome;
        const key = g.neutral
          ? neutralKey(g.week, canHome, canAway)
          : `${g.week}-${canHome}-${canAway}-H`;
        return { ...g, canAway, canHome, key };
      });
      setGames(rebuilt);
    }
    await refreshLive();
  }, [games, reconcileNames, refreshLive]);

  const commitStagedAliases = useCallback(async () => {
    if (!Object.keys(aliasStaging.upserts).length && !aliasStaging.deletes.length) return;
    try {
      const saved = await saveServerAliases(aliasStaging.upserts, aliasStaging.deletes);
      setAliasMap(saved);
      window.localStorage.setItem('cfb_name_map', JSON.stringify(saved));
      setAliasStaging({ upserts: {}, deletes: [] });
      setAliasToast('Aliases saved. Rebuilding…');
      await rebuildKeysAndRefresh();
    } catch (err) {
      setIssues((p) => [...p, `Alias save failed: ${(err as Error).message}`]);
      setAliasToast('Alias save failed.');
    } finally {
      setTimeout(() => setAliasToast(null), 1800);
    }
  }, [aliasStaging, rebuildKeysAndRefresh]);

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
      const saved = await saveServerAliases(cleaned, deletes);
      setAliasMap(saved);
      window.localStorage.setItem('cfb_name_map', JSON.stringify(saved));
      setEditOpen(false);
      // Rebuild game keys with new aliases only if games are loaded
      if (games.length) {
        const teams = Array.from(new Set<string>(games.flatMap((g) => [g.csvHome, g.csvAway])));
        const mapObj = await reconcileNames(teams);
        const rebuilt = games.map((g) => {
          const canAway = mapObj[g.csvAway] ?? g.csvAway;
          const canHome = mapObj[g.csvHome] ?? g.csvHome;
          const key = g.neutral
            ? neutralKey(g.week, canHome, canAway)
            : `${g.week}-${canHome}-${canAway}-H`;
          return { ...g, canAway, canHome, key };
        });
        setGames(rebuilt);
      }
    } catch (err) {
      setIssues((p) => [...p, `Alias save failed: ${(err as Error).message}`]);
    }
  }, [editDraft, aliasMap, games, reconcileNames]);

  /* ===== UI helpers ===== */

  const weekButtons = weeks.map((w) => (
    <button
      key={w}
      className={`px-3 py-1 rounded border ${
        selectedWeek === w
          ? 'border-gray-900 bg-gray-900 text-white dark:border-zinc-200 dark:bg-zinc-200 dark:text-zinc-900'
          : 'border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
      }`}
      onClick={() => setSelectedWeek(w)}
    >
      Week {w}
    </button>
  ));

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

      {(issues.length > 0 || diag.length > 0) && (
        <div className="rounded border border-l-4 border-gray-300 border-l-red-600 bg-red-50 p-3 text-sm text-gray-900 dark:border-zinc-700 dark:border-l-red-400 dark:bg-red-900/25 dark:text-zinc-100 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-medium">Issues</div>
            <div className="flex items-center gap-2">
              <button
                className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 disabled:opacity-50"
                disabled={!Object.keys(aliasStaging.upserts).length && !aliasStaging.deletes.length}
                onClick={() => void commitStagedAliases()}
                title="Save staged aliases and refresh"
              >
                Save staged aliases
              </button>
              {aliasToast && <span className="text-xs">{aliasToast}</span>}
            </div>
          </div>

          {/* Original human-readable list */}
          {issues.length > 0 && (
            <ul className="list-disc pl-5 space-y-1">
              {issues.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          {/* Actionable structured table */}
          {diag.length > 0 && (
            <div className="overflow-x-auto rounded border border-gray-200 dark:border-zinc-700">
              <table className="min-w-full text-xs">
                <thead className="bg-white/60 dark:bg-zinc-800">
                  <tr>
                    <th className="text-left p-2">Type</th>
                    <th className="text-left p-2">Week</th>
                    <th className="text-left p-2">Provider Home</th>
                    <th className="text-left p-2">Provider Away</th>
                    <th className="text-left p-2">Candidates (CSV)</th>
                    <th className="text-left p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {diag.map((d, i) => {
                    if (d.kind === 'scores_miss') {
                      return (
                        <tr key={`d-${i}`} className="border-t dark:border-zinc-700">
                          <td className="p-2">Scores miss</td>
                          <td className="p-2">{d.week}</td>
                          <td className="p-2">{d.providerHome}</td>
                          <td className="p-2">{d.providerAway}</td>
                          <td className="p-2 text-zinc-500">—</td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="px-2 py-1 rounded border"
                                onClick={() => {
                                  setAliasStaging((prev) =>
                                    stageAliasFromMiss(d.providerHome, d.providerHome, prev)
                                  );
                                  setAliasToast(
                                    `Staged alias: "${d.providerHome}" → "${d.providerHome}"`
                                  );
                                  setTimeout(() => setAliasToast(null), 1200);
                                }}
                                title='Map provider "home" label to its own canonical (fixes diacritics/case/spacing)'
                              >
                                Map Home→Home
                              </button>
                              <button
                                className="px-2 py-1 rounded border"
                                onClick={() => {
                                  setAliasStaging((prev) =>
                                    stageAliasFromMiss(d.providerAway, d.providerAway, prev)
                                  );
                                  setAliasToast(
                                    `Staged alias: "${d.providerAway}" → "${d.providerAway}"`
                                  );
                                  setTimeout(() => setAliasToast(null), 1200);
                                }}
                                title='Map provider "away" label to its own canonical'
                              >
                                Map Away→Away
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    if (d.kind === 'week_mismatch') {
                      return (
                        <tr key={`d-${i}`} className="border-t dark:border-zinc-700">
                          <td className="p-2">Week mismatch</td>
                          <td className="p-2">{d.week}</td>
                          <td className="p-2">{d.providerHome}</td>
                          <td className="p-2">{d.providerAway}</td>
                          <td className="p-2">
                            {d.candidates?.length ? (
                              <div className="flex flex-wrap gap-1">
                                {d.candidates.map((c, idx) => (
                                  <span key={idx} className={pillClass()}>
                                    wk {c.week}: “{c.csvAway}” @ “{c.csvHome}”
                                  </span>
                                ))}
                              </div>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-2">
                              {d.candidates?.slice(0, 4).map((c, idx) => (
                                <div key={idx} className="flex gap-1">
                                  <button
                                    className="px-2 py-1 rounded border"
                                    onClick={() => {
                                      setAliasStaging((prev) =>
                                        stageAliasFromMiss(d.providerHome, c.csvHome, prev)
                                      );
                                      setAliasToast(
                                        `Staged alias: "${d.providerHome}" → "${c.csvHome}"`
                                      );
                                      setTimeout(() => setAliasToast(null), 1200);
                                    }}
                                    title={`Map provider home → ${c.csvHome}`}
                                  >
                                    Map Home→{c.csvHome}
                                  </button>
                                  <button
                                    className="px-2 py-1 rounded border"
                                    onClick={() => {
                                      setAliasStaging((prev) =>
                                        stageAliasFromMiss(d.providerAway, c.csvAway, prev)
                                      );
                                      setAliasToast(
                                        `Staged alias: "${d.providerAway}" → "${c.csvAway}"`
                                      );
                                      setTimeout(() => setAliasToast(null), 1200);
                                    }}
                                    title={`Map provider away → ${c.csvAway}`}
                                  >
                                    Map Away→{c.csvAway}
                                  </button>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={`d-${i}`} className="border-t dark:border-zinc-700">
                        <td className="p-2">Note</td>
                        <td className="p-2">—</td>
                        <td className="p-2" colSpan={4}>
                          —
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Alias Editor Panel */}
      {editOpen && (
        <section className="rounded border border-gray-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Team Alias Editor (Season {SEASON})</h2>
            <div className="flex gap-2">
              <button
                className="px-3 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                onClick={() => setEditOpen(false)}
              >
                Close
              </button>
              <button
                className="px-3 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                onClick={addDraftRow}
              >
                Add Row
              </button>
              <button
                className="px-3 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                onClick={() => void saveDraft()}
              >
                Save
              </button>
            </div>
          </div>

          <div className="text-xs text-gray-600 dark:text-zinc-400">
            Left column is the <em>input form</em> (lowercased, accents removed). Right column is
            the <em>canonical team name</em> to use for data.
          </div>

          <div className="max-h-[360px] overflow-auto border border-gray-200 dark:border-zinc-700 rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-zinc-800">
                <tr>
                  <th className="text-left p-2 border-b dark:border-zinc-700">Input (alias)</th>
                  <th className="text-left p-2 border-b dark:border-zinc-700">
                    Canonical (school)
                  </th>
                  <th className="text-left p-2 border-b dark:border-zinc-700 w-10"> </th>
                </tr>
              </thead>
              <tbody>
                {editDraft.map((row, i) => (
                  <tr key={`${i}-${row.key}`}>
                    <td className="p-2 border-b dark:border-zinc-700">
                      <input
                        className="w-full border border-gray-300 rounded px-2 py-1 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        value={row.key}
                        onChange={(e) => updateDraftKey(i, e.target.value)}
                        placeholder="e.g., app state"
                      />
                    </td>
                    <td className="p-2 border-b dark:border-zinc-700">
                      <input
                        className="w-full border border-gray-300 rounded px-2 py-1 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        value={row.value}
                        onChange={(e) => updateDraftValue(i, e.target.value)}
                        placeholder="e.g., Appalachian State"
                      />
                    </td>
                    <td className="p-2 border-b dark:border-zinc-700">
                      <button
                        className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                        onClick={() => removeDraftRow(i)}
                        title="Remove"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {editDraft.length === 0 && (
                  <tr>
                    <td className="p-2 text-sm text-gray-600 dark:text-zinc-400" colSpan={3}>
                      No aliases yet. Click “Add Row” to create one.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Uploads */}
      <section className="rounded border border-gray-300 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900 space-y-3">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm font-medium mb-1">Schedule CSV</div>
            <input
              type="file"
              accept=".csv"
              onChange={onScheduleFile}
              className="text-sm file:mr-2 file:rounded file:border file:px-2 file:py-1 file:bg-white file:border-gray-300 dark:file:bg-zinc-800 dark:file:border-zinc-700"
            />
            <div className="text-xs text-gray-600 dark:text-zinc-400 mt-1">
              Columns: <code>Conference, Team, Week 0..Week 16</code>. Cells use <code>@ Opp</code>,{' '}
              <code>vs Opp</code>, <code>Opp</code>, or <code>BYE</code>.
            </div>
          </div>
          <div>
            <div className="text-sm font-medium mb-1">Owners CSV</div>
            <input
              type="file"
              accept=".csv"
              onChange={onOwnersFile}
              className="text-sm file:mr-2 file:rounded file:border file:px-2 file:py-1 file:bg-white file:border-gray-300 dark:file:bg-zinc-800 dark:file:border-zinc-700"
            />
            <div className="text-xs text-gray-600 dark:text-zinc-400 mt-1">
              Columns: <code>Team, Owner</code>.
            </div>
          </div>
        </div>
        <div className="text-xs text-gray-600 dark:text-zinc-400">
          Loaded — Games:{' '}
          <strong className="text-gray-900 dark:text-zinc-100">{games.length}</strong> | Weeks:{' '}
          <strong className="text-gray-900 dark:text-zinc-100">{weeks.length}</strong> |
          Conferences:{' '}
          <strong className="text-gray-900 dark:text-zinc-100">
            {conferences.length > 0 ? conferences.length - 1 : 0}
          </strong>{' '}
          | Owners: <strong className="text-gray-900 dark:text-zinc-100">{roster.length}</strong>
        </div>
      </section>

      {weeks.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm">Conference:</label>
            <select
              value={selectedConference}
              onChange={(e) => setSelectedConference(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            >
              {conferences.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <input
              placeholder="Filter by team"
              className="border border-gray-300 rounded px-2 py-1 bg-white text-gray-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">{weekButtons}</div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded border-l-4 border border-gray-300 border-l-emerald-600 bg-emerald-50 text-gray-900 dark:border-zinc-700 dark:border-l-emerald-400 dark:bg-emerald-900/25 dark:text-zinc-100">
              Final
            </span>
            <span className="px-2 py-0.5 rounded border-l-4 border border-gray-300 border-l-amber-600 bg-amber-50 text-gray-900 dark:border-zinc-700 dark:border-l-amber-400 dark:bg-amber-900/25 dark:text-zinc-100">
              In Progress
            </span>
            <span className="px-2 py-0.5 rounded border-l-4 border border-gray-300 border-l-blue-600 bg-blue-50 text-gray-900 dark:border-zinc-700 dark:border-l-blue-400 dark:bg-blue-900/25 dark:text-zinc-100">
              Scheduled
            </span>
            <span className="px-2 py-0.5 rounded border-l-4 border border-gray-300 border-l-red-600 bg-red-50 text-gray-900 dark:border-zinc-700 dark:border-l-red-400 dark:bg-red-900/25 dark:text-zinc-100">
              Missing scores &amp; odds
            </span>
          </div>

          {selectedWeek != null && (
            <>
              <div className="grid gap-2">
                {filteredWeekGames(selectedWeek).map((g) => {
                  const score = scoresByKey[g.key];
                  const odds = oddsByKey[g.key];
                  const state = gameStateFromScore(score);
                  const hasAnyInfo = Boolean(score || odds);
                  const frameClasses = statusClasses(state, hasAnyInfo);

                  const chips: string[] = [];
                  if (!score && !odds) chips.push('No scores/odds');
                  if (score) {
                    chips.push(
                      state === 'final'
                        ? 'Final'
                        : state === 'inprogress'
                          ? 'In Progress'
                          : state === 'scheduled'
                            ? 'Scheduled'
                            : '—'
                    );
                  }
                  if (!odds) chips.push('No odds');

                  return (
                    <details key={g.key} className={frameClasses}>
                      <summary className="cursor-pointer px-3 py-2 flex items-center justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {g.neutral ? (
                              <>
                                {g.csvAway} <span className="opacity-60">vs</span> {g.csvHome}{' '}
                                <span className={pillClass() + ' ml-1'}>Neutral</span>
                              </>
                            ) : (
                              <>
                                {g.csvAway} <span className="opacity-60">@</span> {g.csvHome}
                              </>
                            )}
                          </span>
                          {g.homeConf && <span className={pillClass()}>{g.homeConf}</span>}
                          {g.awayConf && <span className={pillClass()}>{g.awayConf}</span>}
                          {rosterByTeam.get(g.csvHome) && (
                            <span className={pillClass()}>Home: {rosterByTeam.get(g.csvHome)}</span>
                          )}
                          {rosterByTeam.get(g.csvAway) && (
                            <span className={pillClass()}>Away: {rosterByTeam.get(g.csvAway)}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {chips.map((c) => (
                            <span key={c} className={chipClass()}>
                              {c}
                            </span>
                          ))}
                        </div>
                      </summary>

                      <div className="grid md:grid-cols-3 gap-3 p-3">
                        <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                          <div className="font-medium mb-2">Matchup</div>
                          <div>
                            <strong>Home</strong>: {g.csvHome}{' '}
                            {g.homeConf && (
                              <span className={pillClass() + ' ml-1'}>{g.homeConf}</span>
                            )}
                          </div>
                          <div>
                            <strong>Away</strong>: {g.csvAway}{' '}
                            {g.awayConf && (
                              <span className={pillClass() + ' ml-1'}>{g.awayConf}</span>
                            )}
                          </div>
                          <div>
                            <strong>Week</strong>: {g.week}
                          </div>
                          {IS_DEBUG && (
                            <div className="text-xs text-gray-600 dark:text-zinc-400 mt-2">
                              Canonical (for data): {g.canAway} @ {g.canHome}
                            </div>
                          )}
                        </div>

                        <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                          <div className="font-medium mb-1">Vegas Odds</div>
                          {odds?.source && (
                            <div className="text-xs text-gray-600 dark:text-zinc-400 mb-1">
                              Source: {odds.source}
                            </div>
                          )}
                          {odds ? (
                            <div className="grid grid-cols-2 gap-2 text-sm">
                              <div>Favorite</div>
                              <div className="text-right">{odds.favorite ?? '—'}</div>
                              <div>Spread</div>
                              <div className="text-right">{odds.spread ?? '—'}</div>
                              <div>Total</div>
                              <div className="text-right">{odds.total ?? '—'}</div>
                              <div>ML Home</div>
                              <div className="text-right">{odds.mlHome ?? '—'}</div>
                              <div>ML Away</div>
                              <div className="text-right">{odds.mlAway ?? '—'}</div>
                            </div>
                          ) : (
                            <div className="text-xs text-gray-600 dark:text-zinc-400">
                              No odds loaded.
                            </div>
                          )}
                        </div>

                        <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                          <div className="font-medium mb-2">Live / Final</div>
                          {score ? (
                            <div className="flex items-center justify-between">
                              <div className="space-y-1">
                                <div>
                                  {score.away.team} <strong>{score.away.score ?? ''}</strong>
                                </div>
                                <div>
                                  {score.home.team} <strong>{score.home.score ?? ''}</strong>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs uppercase tracking-wide">
                                  {score.status}
                                </div>
                                {score.time && <div className="text-xs">{score.time}</div>}
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-gray-600 dark:text-zinc-400">
                              No score loaded.
                            </div>
                          )}
                        </div>
                      </div>
                    </details>
                  );
                })}
              </div>

              {(byes[selectedWeek] ?? []).length > 0 && (
                <div className="rounded border border-gray-300 bg-white mt-4 dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="p-3 font-medium">
                    Teams on BYE ({(byes[selectedWeek] ?? []).length})
                  </div>
                  <div className="p-3 flex flex-wrap gap-2">
                    {(byes[selectedWeek] ?? []).map((t) => (
                      <span key={t} className={pillClass()}>
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
