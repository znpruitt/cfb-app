import type { DiagEntry } from './diagnostics';
import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity';
import type { AliasMap } from './teamNames';
import { fetchTeamsCatalog } from './teamsCatalog';

export type ScoreTeam = { team: string; score: number | null };
export type ScorePack = {
  status: string;
  home: ScoreTeam;
  away: ScoreTeam;
  time: string | null;
};

export type ScoresDiagEntry = Extract<
  DiagEntry,
  { kind: 'scores_miss' | 'week_mismatch' | 'identity_resolution' }
>;

type GameLike = {
  key: string;
  week: number;
  canHome: string;
  canAway: string;
  csvHome: string;
  csvAway: string;
  participants?: { home?: { kind?: string }; away?: { kind?: string } };
};

type WireFlat = {
  week?: number | null;
  status: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  time: string | null;
};
type WireSide = { team?: string; score?: number | null } | null | undefined;
type WireObj = {
  week?: number | null;
  status: string;
  time: string | null;
  home: WireSide;
  away: WireSide;
};

type ScoreRow = {
  week: number | null;
  homeName: string;
  awayName: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  time: string | null;
};

function extractRow(sg: WireFlat | WireObj): ScoreRow {
  if (typeof (sg as WireFlat).home === 'string') {
    const flat = sg as WireFlat;
    return {
      week: typeof flat.week === 'number' ? flat.week : null,
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
    week: typeof obj.week === 'number' ? obj.week : null,
    homeName: (h?.team ?? '') as string,
    awayName: (a?.team ?? '') as string,
    homeScore: (typeof h?.score === 'number' ? h?.score : (h?.score ?? null)) as number | null,
    awayScore: (typeof a?.score === 'number' ? a?.score : (a?.score ?? null)) as number | null,
    status: obj.status || '',
    time: obj.time ?? null,
  };
}

function parseScorePayload(payload: unknown): Array<WireFlat | WireObj> {
  if (Array.isArray(payload)) {
    return payload as Array<WireFlat | WireObj>;
  }
  if (
    payload &&
    typeof payload === 'object' &&
    Array.isArray((payload as { items?: unknown }).items)
  ) {
    return (payload as { items: Array<WireFlat | WireObj> }).items;
  }
  return [];
}

function groupRowsByWeek(rows: ScoreRow[]): Map<number, ScoreRow[]> {
  const out = new Map<number, ScoreRow[]>();
  for (const row of rows) {
    if (typeof row.week !== 'number') continue;
    const bucket = out.get(row.week) ?? [];
    bucket.push(row);
    out.set(row.week, bucket);
  }
  return out;
}

async function fetchScoreRows(params: {
  season: number;
  weeks: number[];
  issues: string[];
}): Promise<ScoreRow[]> {
  const { season, weeks, issues } = params;

  const seasonRes = await fetch(`/api/scores?year=${season}`, { cache: 'no-store' });
  if (seasonRes.ok) {
    const seasonRaw = parseScorePayload(await seasonRes.json());
    return seasonRaw.map(extractRow);
  }

  const seasonErr = await seasonRes.text().catch(() => '');
  const seasonFallbackIssue = `Scores season ${season}: ${seasonRes.status} ${seasonErr}`;

  const rows: ScoreRow[] = [];
  for (const w of weeks) {
    const weekRes = await fetch(`/api/scores?week=${w}&year=${season}`, { cache: 'no-store' });
    if (!weekRes.ok) {
      const weekErr = await weekRes.text().catch(() => '');
      issues.push(`Scores week ${w}: ${weekRes.status} ${weekErr}`);
      continue;
    }

    const raw = parseScorePayload(await weekRes.json());
    for (const row of raw) {
      const parsed = extractRow(row);
      rows.push({ ...parsed, week: parsed.week ?? w });
    }
  }

  if (rows.length === 0) {
    issues.push(seasonFallbackIssue);
  }

  return rows;
}

export async function fetchScoresByGame(params: {
  games: GameLike[];
  aliasMap: AliasMap;
  season: number;
  teams?: TeamCatalogItem[];
}): Promise<{ scoresByKey: Record<string, ScorePack>; issues: string[]; diag: ScoresDiagEntry[] }> {
  const { games, aliasMap, season, teams: providedTeams } = params;
  const issues: string[] = [];
  const diag: ScoresDiagEntry[] = [];

  const teams = providedTeams ?? (await fetchTeamsCatalog().catch(() => []));
  const observedNames = Array.from(
    new Set(games.flatMap((g) => [g.csvHome, g.csvAway, g.canHome, g.canAway]))
  );
  const resolver = createTeamIdentityResolver({ aliasMap, teams, observedNames });

  const loadedWeeks = Array.from(new Set<number>(games.map((g) => g.week))).sort((a, b) => a - b);
  const globalIndex = new Map<string, Array<{ week: number; game: GameLike }>>();

  for (const g of games) {
    const hasTeamParticipants =
      (g.participants?.home?.kind ?? 'team') === 'team' &&
      (g.participants?.away?.kind ?? 'team') === 'team';
    if (!hasTeamParticipants || !g.canHome || !g.canAway) continue;
    const involvesFbs = resolver.isFbsName(g.canHome) || resolver.isFbsName(g.canAway);
    if (teams.length > 0 && !involvesFbs) continue;

    const keys = new Set<string>();
    keys.add(resolver.buildPairKey(g.canHome, g.canAway));
    keys.add(resolver.buildPairKey(g.csvHome, g.csvAway));

    for (const key of keys) {
      const entries = globalIndex.get(key) ?? [];
      entries.push({ week: g.week, game: g });
      globalIndex.set(key, entries);
    }
  }

  const rows = await fetchScoreRows({ season, weeks: loadedWeeks, issues });
  const rowsByWeek = groupRowsByWeek(rows);

  const nextScores: Record<string, ScorePack> = {};
  let weekMismatchCount = 0;
  let hardMissCount = 0;
  const maxIssuesPerKind = 10;

  for (const week of loadedWeeks) {
    const weeklyRows = rowsByWeek.get(week) ?? [];
    for (const row of weeklyRows) {
      const rowInvolvesFbs =
        teams.length === 0 || resolver.isFbsName(row.homeName) || resolver.isFbsName(row.awayName);
      if (teams.length > 0 && !rowInvolvesFbs) continue;

      const matchKey = resolver.buildPairKey(row.homeName, row.awayName);
      const matchesAllWeeks = globalIndex.get(matchKey) ?? [];

      if (matchesAllWeeks.length === 0) {
        if (hardMissCount < maxIssuesPerKind) {
          const homeRes = resolver.resolveName(row.homeName);
          const awayRes = resolver.resolveName(row.awayName);

          issues.push(`missing-score-match: week ${week} ${row.homeName} vs ${row.awayName}`);
          diag.push({
            kind: 'scores_miss',
            issueClassification: 'missing-score-match',
            week,
            providerHome: row.homeName,
            providerAway: row.awayName,
            homeIdentity: {
              normalizedInput: homeRes.normalizedInput,
              resolutionSource: homeRes.resolutionSource,
              status: homeRes.status,
              candidates: homeRes.candidates,
            },
            awayIdentity: {
              normalizedInput: awayRes.normalizedInput,
              resolutionSource: awayRes.resolutionSource,
              status: awayRes.status,
              candidates: awayRes.candidates,
            },
          });

          if (homeRes.status !== 'resolved') {
            diag.push({
              kind: 'identity_resolution',
              issueClassification: 'identity-unresolved',
              flow: 'scores',
              rawInput: homeRes.rawInput,
              normalizedInput: homeRes.normalizedInput,
              resolutionSource: homeRes.resolutionSource,
              status: homeRes.status,
              notes: homeRes.notes,
              candidates: homeRes.candidates,
            });
          }
          if (awayRes.status !== 'resolved') {
            diag.push({
              kind: 'identity_resolution',
              issueClassification: 'identity-unresolved',
              flow: 'scores',
              rawInput: awayRes.rawInput,
              normalizedInput: awayRes.normalizedInput,
              resolutionSource: awayRes.resolutionSource,
              status: awayRes.status,
              notes: awayRes.notes,
              candidates: awayRes.candidates,
            });
          }
        }

        hardMissCount++;
        continue;
      }

      const sameWeek = matchesAllWeeks.find((candidate) => candidate.week === week);
      if (sameWeek) {
        nextScores[sameWeek.game.key] = {
          status: row.status,
          time: row.time,
          home: { team: row.homeName, score: row.homeScore },
          away: { team: row.awayName, score: row.awayScore },
        };
        continue;
      }

      const otherWeeks = Array.from(new Set(matchesAllWeeks.map((entry) => entry.week))).sort(
        (a, b) => a - b
      );
      const isFinal = (row.status || '').toLowerCase().includes('final');
      const isPrevWeekCarryover = otherWeeks.includes(week - 1);
      if (isFinal && isPrevWeekCarryover) continue;

      const alreadyCaptured = matchesAllWeeks.some(({ game }) => Boolean(nextScores[game.key]));
      if (alreadyCaptured) continue;

      if (weekMismatchCount < maxIssuesPerKind) {
        const candidates = matchesAllWeeks.map(({ week: candidateWeek, game }) => ({
          csvHome: game.csvHome,
          csvAway: game.csvAway,
          week: candidateWeek,
        }));

        issues.push(
          `missing-score-match: week ${week} ${row.homeName} vs ${row.awayName} (week mismatch)`
        );

        diag.push({
          kind: 'week_mismatch',
          week,
          providerHome: row.homeName,
          providerAway: row.awayName,
          candidates,
        });
      }
      weekMismatchCount++;
    }
  }

  return { scoresByKey: nextScores, issues, diag };
}
