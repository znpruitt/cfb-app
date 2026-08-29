import type { DiagEntry } from './diagnostics.ts';
import {
  attachScoresToSchedule,
  buildScheduleIndex,
  type NormalizedScoreRow,
  type ScheduleGameForIndex,
} from './scoreAttachment.ts';
import {
  summarizeAttachmentReasons,
  type ScoreAttachmentDiagnostic,
} from './scoreAttachmentDiagnostics.ts';
import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity.ts';
import type { AliasMap } from './teamNames.ts';
import { fetchTeamsCatalog } from './teamsCatalog.ts';

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
  providerWeek?: number;
  canonicalWeek?: number;
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

/**
 * The durable `meta.generatedAt` (ms) of a `/api/scores` response, or `null` when
 * it carries none or an unparseable one (PLATFORM-086B2B). The caller decides
 * whether to trust it — an empty `upstream-suppressed` response stamps its meta
 * with request-time, which is NOT freshness, so only nonempty responses count.
 */
function extractMetaGeneratedAtMs(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const meta = (payload as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object') return null;
  const generatedAt = (meta as { generatedAt?: unknown }).generatedAt;
  if (typeof generatedAt !== 'string') return null;
  const ms = Date.parse(generatedAt);
  return Number.isFinite(ms) ? ms : null;
}

/** Exact-partition provider observation timestamp; never inferred from generatedAt. */
function extractMetaLiveObservedAtMs(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const meta = (payload as { meta?: unknown }).meta;
  if (!meta || typeof meta !== 'object') return null;
  const liveObservedAt = (meta as { liveObservedAt?: unknown }).liveObservedAt;
  if (typeof liveObservedAt !== 'string') return null;
  const ms = Date.parse(liveObservedAt);
  return Number.isFinite(ms) ? ms : null;
}

type ScoreFetchMode =
  | { kind: 'season'; weeks: number[]; seasonTypes: Array<'regular' | 'postseason'> }
  | {
      // Exact-partition cache-read mode (PLATFORM-086B2B auto ticks): fetch only
      // the given `(providerWeek, seasonType)` partitions via week-scoped URLs.
      // Never season-wide, never `refresh=1`, never admin credentials.
      kind: 'partitions';
      partitions: Array<{ providerWeek: number; seasonType: 'regular' | 'postseason' }>;
    };

// Invariant: internal score fetches must always propagate explicit season type scope
// derived from canonical schedule games. Relying on /api/scores default seasonType=regular
// can silently exclude postseason rows from the attachment pipeline.
async function fetchScoreRows(params: {
  season: number;
  mode: ScoreFetchMode;
  issues: string[];
  apiBaseUrl?: string;
  refresh?: boolean;
  authHeaders?: HeadersInit;
}): Promise<{
  rows: ScoreRow[];
  requestUrls: string[];
  snapshotAt: string | null;
  liveObservedAt: string | null;
  failedSeasonTypes: Array<'regular' | 'postseason'>;
}> {
  const { season, mode, issues, apiBaseUrl, refresh = false, authHeaders } = params;

  // Exact-partition (auto) reads are strictly cache-only: no refresh, no admin
  // credentials, no season-wide call — regardless of what the caller passed.
  const isPartitionMode = mode.kind === 'partitions';

  // Only an authorized (admin) refresh may spend CFBD quota (PLATFORM-075).
  // The public path omits refresh and reads cache only; the admin manual refresh
  // propagates refresh=1 + admin credentials so scores still update upstream.
  const refreshSuffix = refresh && !isPartitionMode ? '&refresh=1' : '';
  const fetchInit: RequestInit = {
    cache: 'no-store',
    ...(authHeaders && !isPartitionMode ? { headers: authHeaders } : {}),
  };

  const rows: ScoreRow[] = [];
  const requestUrls: string[] = [];
  const failedSeasonTypes = new Set<'regular' | 'postseason'>();

  // Served-freshness floor: the OLDEST durable `meta.generatedAt` across the
  // nonempty responses that contributed rows. An empty response (nothing to
  // display) never sets freshness — its request-time meta would fake it.
  //
  // KNOWN LIMITATION (deferred, PLATFORM-086B2B): this is a per-PARTITION floor,
  // not per-GAME. A partition's `meta.generatedAt` is its NEWEST effective row, so
  // a freshly-updated game can ride over a stale sibling in the same partition
  // (e.g. one game the live cron kept updating while another dropped out of the
  // scoreboard). The global `isStale` overlay flag can then read fresh for that
  // stale game. This is strictly better than the pre-086B2B behavior (client poll
  // time reported every game fresh after any poll); true per-game freshness needs
  // per-game timestamps threaded to a per-game overlay staleness model — a
  // separate follow-up, not this activation slice.
  let oldestSnapshotMs: number | null = null;
  const noteSnapshot = (payload: unknown, itemCount: number): void => {
    if (itemCount <= 0) return;
    const ms = extractMetaGeneratedAtMs(payload);
    if (ms === null) return;
    if (oldestSnapshotMs === null || ms < oldestSnapshotMs) oldestSnapshotMs = ms;
  };

  if (isPartitionMode) {
    // Any requested partition that fails to read means the served set is
    // incomplete: retained prior rows for that partition are stale, so freshness
    // must NOT advance globally (a single successful sibling would otherwise mark
    // the whole overlay fresh). One failure suppresses the snapshot entirely, so
    // the client keeps its prior (older) freshness and the overlay ages honestly.
    let partitionReadFailed = false;
    let oldestLiveObservationMs: number | null = null;
    let liveObservationIncomplete = false;
    for (const { providerWeek, seasonType } of mode.partitions) {
      // `live=1` is a cache-only hint (NOT a refresh): it tells the route to
      // consult DURABLE app-state rather than serve a per-instance in-process
      // copy that can lag a cross-instance cron write by up to its TTL — so a
      // 3-minute poll actually reflects the latest merged scores. No provider
      // call, no credentials, no `refresh=1`.
      const url = buildApiUrl(
        `/api/scores?week=${providerWeek}&year=${season}&seasonType=${seasonType}&live=1`,
        apiBaseUrl
      );
      requestUrls.push(url);
      const res = await fetch(url, fetchInit);
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        issues.push(`Scores week ${providerWeek} (${seasonType}): ${res.status} ${err}`);
        partitionReadFailed = true;
        liveObservationIncomplete = true;
        failedSeasonTypes.add(seasonType);
        continue;
      }
      const json = await res.json();
      const raw = parseScorePayload(json);
      for (const row of raw) {
        const parsed = extractRow(row);
        rows.push({
          ...parsed,
          seasonType: parsed.seasonType ?? seasonType,
          week: parsed.week ?? providerWeek,
        });
      }
      noteSnapshot(json, raw.length);
      const observedMs = extractMetaLiveObservedAtMs(json);
      if (observedMs === null) {
        liveObservationIncomplete = true;
      } else if (oldestLiveObservationMs === null || observedMs < oldestLiveObservationMs) {
        oldestLiveObservationMs = observedMs;
      }
    }

    return {
      rows,
      requestUrls,
      snapshotAt:
        partitionReadFailed || oldestSnapshotMs === null
          ? null
          : new Date(oldestSnapshotMs).toISOString(),
      liveObservedAt:
        partitionReadFailed || liveObservationIncomplete || oldestLiveObservationMs === null
          ? null
          : new Date(oldestLiveObservationMs).toISOString(),
      failedSeasonTypes: Array.from(failedSeasonTypes),
    };
  }

  for (const seasonType of mode.seasonTypes) {
    let seasonTypeRowCount = 0;
    let seasonTypeReadFailed = false;
    const seasonUrl = buildApiUrl(
      `/api/scores?year=${season}&seasonType=${seasonType}${refreshSuffix}`,
      apiBaseUrl
    );
    requestUrls.push(seasonUrl);
    const seasonRes = await fetch(seasonUrl, fetchInit);
    if (seasonRes.ok) {
      const seasonJson = await seasonRes.json();
      const seasonRaw = parseScorePayload(seasonJson);
      const parsedSeasonRows = seasonRaw
        .map(extractRow)
        .map((row) => ({ ...row, seasonType: row.seasonType ?? seasonType }));
      seasonTypeRowCount += parsedSeasonRows.length;
      rows.push(...parsedSeasonRows);
      noteSnapshot(seasonJson, parsedSeasonRows.length);
      continue;
    }

    const seasonErr = await seasonRes.text().catch(() => '');
    const seasonFallbackIssue = `Scores season ${season} (${seasonType}): ${seasonRes.status} ${seasonErr}`;

    for (const w of mode.weeks) {
      const weekUrl = buildApiUrl(
        `/api/scores?week=${w}&year=${season}&seasonType=${seasonType}${refreshSuffix}`,
        apiBaseUrl
      );
      requestUrls.push(weekUrl);
      const weekRes = await fetch(weekUrl, fetchInit);
      if (!weekRes.ok) {
        const weekErr = await weekRes.text().catch(() => '');
        issues.push(`Scores week ${w} (${seasonType}): ${weekRes.status} ${weekErr}`);
        seasonTypeReadFailed = true;
        continue;
      }

      const weekJson = await weekRes.json();
      const raw = parseScorePayload(weekJson);
      for (const row of raw) {
        const parsed = extractRow(row);
        rows.push({
          ...parsed,
          seasonType: parsed.seasonType ?? seasonType,
          week: parsed.week ?? w,
        });
        seasonTypeRowCount += 1;
      }
      noteSnapshot(weekJson, raw.length);
    }

    if (seasonTypeRowCount === 0) {
      issues.push(seasonFallbackIssue);
      seasonTypeReadFailed = true;
    }
    if (seasonTypeReadFailed) failedSeasonTypes.add(seasonType);
  }

  return {
    rows,
    requestUrls,
    snapshotAt: oldestSnapshotMs === null ? null : new Date(oldestSnapshotMs).toISOString(),
    liveObservedAt: null,
    failedSeasonTypes: Array.from(failedSeasonTypes),
  };
}

function seasonTypeFromStage(stage?: GameLike['stage']): 'regular' | 'postseason' {
  return stage === 'regular' || stage == null ? 'regular' : 'postseason';
}

function filterRowsToScheduleScope(
  rows: NormalizedScoreRow[],
  games: GameLike[]
): NormalizedScoreRow[] {
  const allowedWeeks = new Set(
    games.flatMap((game) => [game.week, game.providerWeek ?? game.week])
  );
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
  // Authorized (admin) manual refresh: propagate refresh=1 + admin credentials
  // so scores update upstream. Omitted on the public/auto path (cache-only).
  refresh?: boolean;
  authHeaders?: HeadersInit;
  /**
   * Exact-partition cache-read mode (PLATFORM-086B2B auto ticks). When provided,
   * only these `(providerWeek, seasonType)` partitions are read via week-scoped
   * URLs — no season-wide call, and `refresh`/`authHeaders` are ignored (the auto
   * path is strictly cache-only). Omit for season-wide hydration and manual
   * refresh, which keep the season-wide-first behavior.
   */
  partitions?: Array<{ providerWeek: number; seasonType: 'regular' | 'postseason' }>;
}): Promise<{
  scoresByKey: Record<string, ScorePack>;
  issues: string[];
  diag: ScoresDiagEntry[];
  /**
   * The served-freshness timestamp of the contributing cache partitions (oldest
   * durable `meta.generatedAt` across nonempty responses), or `null` when nothing
   * durable contributed. Used to drive the client freshness label; never derived
   * from an empty/suppressed response's request-time.
   */
  snapshotAt: string | null;
  /**
   * Oldest clean exact-partition provider observation covering every requested
   * partition. Null for hydration/manual modes or any incomplete response.
   */
  liveObservedAt: string | null;
  /** Schedule phases whose requested cache read was incomplete. */
  failedSeasonTypes: Array<'regular' | 'postseason'>;
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
    refresh = false,
    authHeaders,
    partitions,
  } = params;
  const issues: string[] = [];

  if (games.length === 0) {
    return {
      scoresByKey: {},
      issues,
      diag: [],
      snapshotAt: null,
      liveObservedAt: null,
      failedSeasonTypes: [],
    };
  }
  const diag: ScoresDiagEntry[] = [];

  const teams = providedTeams ?? (await fetchTeamsCatalog().catch(() => []));
  const observedNames = Array.from(
    new Set(games.flatMap((g) => [g.csvHome, g.csvAway, g.canHome, g.canAway]))
  );
  const resolver = createTeamIdentityResolver({ aliasMap, teams, observedNames });

  const fallbackGames = fallbackScopeGames ?? games;
  const seasonWeeks = Array.from(
    new Set<number>(fallbackGames.flatMap((g) => [g.week, g.providerWeek ?? g.week]))
  ).sort((a, b) => a - b);
  const seasonSeasonTypes = Array.from(
    new Set(fallbackGames.map((g) => seasonTypeFromStage(g.stage)))
  );

  const mode: ScoreFetchMode =
    partitions && partitions.length > 0
      ? { kind: 'partitions', partitions }
      : { kind: 'season', weeks: seasonWeeks, seasonTypes: seasonSeasonTypes };

  const loadedWeeks =
    mode.kind === 'partitions'
      ? Array.from(new Set(mode.partitions.map((p) => p.providerWeek))).sort((a, b) => a - b)
      : seasonWeeks;
  const loadedSeasonTypes =
    mode.kind === 'partitions'
      ? Array.from(new Set(mode.partitions.map((p) => p.seasonType)))
      : seasonSeasonTypes;
  const scheduleIndexGames: ScheduleGameForIndex[] = games.map((game) => ({
    key: game.key,
    week: game.week,
    providerWeek: game.providerWeek ?? game.week,
    canonicalWeek: game.canonicalWeek ?? game.week,
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

  const { rows, requestUrls, snapshotAt, liveObservedAt, failedSeasonTypes } = await fetchScoreRows(
    {
      season,
      mode,
      issues,
      apiBaseUrl,
      refresh,
      authHeaders,
    }
  );
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
    snapshotAt,
    liveObservedAt,
    failedSeasonTypes,
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
