import type { DiagEntry } from './diagnostics';
import {
  attachScoresToSchedule,
  buildScheduleIndex,
  type NormalizedScoreRow,
  type ScheduleGameForIndex,
} from './scoreAttachment';
import {
  summarizeAttachmentReasons,
  type ScoreAttachmentDiagnostic,
} from './scoreAttachmentDiagnostics';
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
  { kind: 'scores_miss' | 'week_mismatch' | 'identity_resolution' | 'ignored_score_row' }
>;

type GameLike = {
  key: string;
  week: number;
  date?: string | null;
  stage?: 'regular' | 'conference_championship' | 'bowl' | 'playoff';
  providerGameId?: string | null;
  canHome: string;
  canAway: string;
  csvHome: string;
  csvAway: string;
  participants?: { home?: { kind?: string }; away?: { kind?: string } };
};

type WireFlat = {
  id?: string | number | null;
  seasonType?: 'regular' | 'postseason' | null;
  startDate?: string | null;
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
  id?: string | number | null;
  seasonType?: 'regular' | 'postseason' | null;
  startDate?: string | null;
  week?: number | null;
  status: string;
  time: string | null;
  home: WireSide;
  away: WireSide;
};

type ScoreRow = {
  providerEventId: string | null;
  seasonType: 'regular' | 'postseason' | null;
  date: string | null;
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
      providerEventId:
        flat.id != null && String(flat.id).trim().length > 0 ? String(flat.id).trim() : null,
      seasonType:
        flat.seasonType === 'regular' || flat.seasonType === 'postseason' ? flat.seasonType : null,
      date: flat.startDate ?? null,
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
    providerEventId:
      obj.id != null && String(obj.id).trim().length > 0 ? String(obj.id).trim() : null,
    seasonType:
      obj.seasonType === 'regular' || obj.seasonType === 'postseason' ? obj.seasonType : null,
    date: obj.startDate ?? null,
    week: typeof obj.week === 'number' ? obj.week : null,
    homeName: (h?.team ?? '') as string,
    awayName: (a?.team ?? '') as string,
    homeScore: (typeof h?.score === 'number' ? h?.score : (h?.score ?? null)) as number | null,
    awayScore: (typeof a?.score === 'number' ? a?.score : (a?.score ?? null)) as number | null,
    status: obj.status || '',
    time: obj.time ?? null,
  };
}

function buildApiUrl(path: string, apiBaseUrl?: string): string {
  if (!apiBaseUrl) return path;
  return `${apiBaseUrl}${path}`;
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

// Invariant: internal score fetches must always propagate explicit season type scope
// derived from canonical schedule games. Relying on /api/scores default seasonType=regular
// can silently exclude postseason rows from the attachment pipeline.
async function fetchScoreRows(params: {
  season: number;
  weeks: number[];
  seasonTypes: Array<'regular' | 'postseason'>;
  issues: string[];
  apiBaseUrl?: string;
}): Promise<{ rows: ScoreRow[]; requestUrls: string[] }> {
  const { season, weeks, seasonTypes, issues, apiBaseUrl } = params;

  const rows: ScoreRow[] = [];
  const requestUrls: string[] = [];

  for (const seasonType of seasonTypes) {
    let seasonTypeRowCount = 0;
    const seasonUrl = buildApiUrl(
      `/api/scores?year=${season}&seasonType=${seasonType}`,
      apiBaseUrl
    );
    requestUrls.push(seasonUrl);
    const seasonRes = await fetch(seasonUrl, {
      cache: 'no-store',
    });
    if (seasonRes.ok) {
      const seasonRaw = parseScorePayload(await seasonRes.json());
      const parsedSeasonRows = seasonRaw
        .map(extractRow)
        .map((row) => ({ ...row, seasonType: row.seasonType ?? seasonType }));
      seasonTypeRowCount += parsedSeasonRows.length;
      rows.push(...parsedSeasonRows);
      continue;
    }

    const seasonErr = await seasonRes.text().catch(() => '');
    const seasonFallbackIssue = `Scores season ${season} (${seasonType}): ${seasonRes.status} ${seasonErr}`;

    for (const w of weeks) {
      const weekUrl = buildApiUrl(
        `/api/scores?week=${w}&year=${season}&seasonType=${seasonType}`,
        apiBaseUrl
      );
      requestUrls.push(weekUrl);
      const weekRes = await fetch(weekUrl, {
        cache: 'no-store',
      });
      if (!weekRes.ok) {
        const weekErr = await weekRes.text().catch(() => '');
        issues.push(`Scores week ${w} (${seasonType}): ${weekRes.status} ${weekErr}`);
        continue;
      }

      const raw = parseScorePayload(await weekRes.json());
      for (const row of raw) {
        const parsed = extractRow(row);
        rows.push({
          ...parsed,
          seasonType: parsed.seasonType ?? seasonType,
          week: parsed.week ?? w,
        });
        seasonTypeRowCount += 1;
      }
    }

    if (seasonTypeRowCount === 0) {
      issues.push(seasonFallbackIssue);
    }
  }

  return { rows, requestUrls };
}

function seasonTypeFromStage(stage?: GameLike['stage']): 'regular' | 'postseason' {
  return stage === 'regular' || stage == null ? 'regular' : 'postseason';
}

function filterRowsToScheduleScope(
  rows: NormalizedScoreRow[],
  games: GameLike[]
): NormalizedScoreRow[] {
  const allowedWeeks = new Set(games.map((game) => game.week));
  const allowedSeasonTypes = new Set(games.map((game) => seasonTypeFromStage(game.stage)));

  return rows.filter((row) => {
    if (row.week != null && allowedWeeks.size > 0 && !allowedWeeks.has(row.week)) {
      return false;
    }

    if (row.seasonType && allowedSeasonTypes.size > 0 && !allowedSeasonTypes.has(row.seasonType)) {
      return false;
    }

    return true;
  });
}

export async function fetchScoresByGame(params: {
  games: GameLike[];
  aliasMap: AliasMap;
  season: number;
  teams?: TeamCatalogItem[];
  debugTrace?: boolean;
  apiBaseUrl?: string;
  fallbackScopeGames?: GameLike[];
}): Promise<{
  scoresByKey: Record<string, ScorePack>;
  issues: string[];
  diag: ScoresDiagEntry[];
  debugSnapshot?: {
    providerRowCount: number;
    attachedCount: number;
    diagnosticsCount: number;
    requestUrls: string[];
    loadedWeeks: number[];
    loadedSeasonTypes: Array<'regular' | 'postseason'>;
  };
  debugDiagnostics?: ScoreAttachmentDiagnostic[];
}> {
  const {
    games,
    aliasMap,
    season,
    teams: providedTeams,
    debugTrace = false,
    apiBaseUrl,
    fallbackScopeGames,
  } = params;
  const issues: string[] = [];

  if (games.length === 0) {
    return { scoresByKey: {}, issues, diag: [] };
  }
  const diag: ScoresDiagEntry[] = [];

  const teams = providedTeams ?? (await fetchTeamsCatalog().catch(() => []));
  const observedNames = Array.from(
    new Set(games.flatMap((g) => [g.csvHome, g.csvAway, g.canHome, g.canAway]))
  );
  const resolver = createTeamIdentityResolver({ aliasMap, teams, observedNames });

  const fallbackGames = fallbackScopeGames?.length ? fallbackScopeGames : games;
  const loadedWeeks = Array.from(new Set<number>(fallbackGames.map((g) => g.week))).sort(
    (a, b) => a - b
  );
  const loadedSeasonTypes = Array.from(
    new Set(fallbackGames.map((g) => seasonTypeFromStage(g.stage)))
  );
  const scheduleIndexGames: ScheduleGameForIndex[] = games.map((game) => ({
    key: game.key,
    week: game.week,
    date: game.date ?? null,
    stage: game.stage ?? 'regular',
    providerGameId: game.providerGameId ?? null,
    canHome: game.canHome,
    canAway: game.canAway,
    participants: {
      home: { kind: game.participants?.home?.kind ?? 'team' },
      away: { kind: game.participants?.away?.kind ?? 'team' },
    },
  }));
  const scheduleIndex = buildScheduleIndex(scheduleIndexGames, resolver);

  const { rows, requestUrls } = await fetchScoreRows({
    season,
    weeks: loadedWeeks,
    seasonTypes: loadedSeasonTypes,
    issues,
    apiBaseUrl,
  });
  const normalizedRows: NormalizedScoreRow[] = rows.map((row) => ({
    week: row.week,
    seasonType: row.seasonType,
    providerEventId: row.providerEventId,
    status: row.status,
    time: row.time,
    date: row.date,
    home: { team: row.homeName, score: row.homeScore },
    away: { team: row.awayName, score: row.awayScore },
  }));

  const scopedRows = filterRowsToScheduleScope(normalizedRows, games);

  const attached = attachScoresToSchedule({
    rows: scopedRows,
    scheduleIndex,
    resolver,
    debugTrace,
    source: 'cfbd_scores',
  });

  if (debugTrace) {
    for (const diagnostic of attached.diagnostics.slice(0, 50)) {
      diag.push({
        kind: 'ignored_score_row',
        week: diagnostic.provider.week,
        providerHome: diagnostic.provider.homeTeamRaw ?? '',
        providerAway: diagnostic.provider.awayTeamRaw ?? '',
        reason: diagnostic.reason,
        diagnostic,
        debugOnly: true,
      });
    }
  }

  if (attached.diagnostics.length > 0 && process.env.NEXT_PUBLIC_DEBUG === '1') {
    console.log('scores ignored provider rows', summarizeAttachmentReasons(attached.diagnostics));
  }

  return {
    scoresByKey: attached.scoresByKey,
    issues,
    diag,
    debugSnapshot: debugTrace
      ? {
          providerRowCount: scopedRows.length,
          attachedCount: attached.attachedCount,
          diagnosticsCount: attached.diagnostics.length,
          requestUrls,
          loadedWeeks,
          loadedSeasonTypes,
        }
      : undefined,
    debugDiagnostics: debugTrace ? attached.diagnostics : undefined,
  };
}
