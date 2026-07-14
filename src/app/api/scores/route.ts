import { promises as fs } from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGamesUrl } from '@/lib/cfbd';
import { type TeamCatalogItem } from '@/lib/teamIdentity';
import { getScopedAliasMap } from '@/lib/server/globalAliasStore';
import { requireAdminAuth } from '@/lib/server/adminAuth';
import {
  recordRouteCacheHit,
  recordRouteCacheMiss,
  recordRouteRequest,
} from '@/lib/server/apiUsageBudget';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import { seasonPartitionScope, yearScope } from '@/lib/providerRefreshScope';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
} from '@/lib/server/providerRefreshStatus';
import { loadReconciledSeasonScores } from '@/lib/server/scoreCacheReader';
import { getApplicableScoreSeasonTypes } from '@/lib/server/scoreApplicability';
import { getLeagues } from '@/lib/leagueRegistry';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import { pruneScoresCache, type CacheEntry, type CacheKey } from '@/lib/scores/cache';
import { seasonYearForToday, toScorePackFromCfbd } from '@/lib/scores/normalizers';
import type {
  CfbdFallbackReason,
  CfbdGameLoose,
  ScorePack,
  ScoresMeta,
  ScoresResponse,
  SeasonType,
} from '@/lib/scores/types';

export const dynamic = 'force-dynamic';
export const revalidate = 300;

const IS_DEBUG = process.env.NEXT_PUBLIC_DEBUG === '1' || process.env.DEBUG_CFBD === '1';
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 250;

const CFBD_RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2_000,
  jitterRatio: 0.2,
  retryOnHttpStatuses: [408, 425, 429, 500, 502, 503, 504],
} as const;
const CFBD_PACING_POLICY = {
  key: 'cfbd',
  minIntervalMs: 150,
} as const;

const SCORES_CACHE: Record<CacheKey, CacheEntry> = {};

function mapCfbdErrorToReason(error: unknown): CfbdFallbackReason {
  if (error instanceof UpstreamFetchError) {
    return `cfbd-${error.details.kind}` as CfbdFallbackReason;
  }
  return 'cfbd-unknown-error';
}

function responseFrom(items: ScorePack[], meta: ScoresMeta, status = 200) {
  return NextResponse.json<ScoresResponse>({ items, meta }, { status });
}

/**
 * Pick the freshest of two scores cache entries by `at`. Used on the public
 * stale-serve path so an older in-memory entry never shadows a newer durable
 * entry written by an authorized refresh or another instance. Ties keep `a`
 * (the in-memory entry).
 */
function pickFreshestScoresEntry(
  a: CacheEntry | undefined,
  b: CacheEntry | undefined
): CacheEntry | undefined {
  if (!a) return b;
  if (!b) return a;
  return b.at > a.at ? b : a;
}

async function readTeamsCatalog(): Promise<TeamCatalogItem[]> {
  const raw = await fs.readFile(path.join(process.cwd(), 'src/data/teams.json'), 'utf8');
  const parsed = JSON.parse(raw) as { items?: TeamCatalogItem[] };
  return Array.isArray(parsed.items) ? parsed.items : [];
}

/**
 * Season-wide (week=null) public read. Delegates to the shared cache-only
 * reconciler (`loadReconciledSeasonScores`, PLATFORM-084B) so the season-wide
 * and per-week `scores` cache entries are merged at the ROW level, deduped by
 * canonical game identity with the newest contributing cache entry winning per
 * game — the SAME reconciled view the canonical standings selector and
 * season-rollover archive build now consume. This means:
 *   - a week cache refreshed after the season snapshot is never masked (runs on
 *     every read, even when the season entry is within TTL);
 *   - the internal loader needs no per-week client fan-out (one bounded read);
 *   - the same game contributed by two entries reconciles to a single row
 *     instead of duplicating (identity goes through teamIdentity.ts);
 *   - an empty week fallback contributes no rows, so it cannot erase a populated
 *     season row.
 * No upstream call is made. Cache meta reports 'hit' when the freshest
 * contributor is within TTL, else 'stale'. The public route keeps its own
 * bundled-catalog + league-agnostic alias source for identity resolution so
 * this read's behavior is unchanged.
 */
async function aggregateSeasonScoresResponse(params: {
  year: number;
  seasonType: SeasonType;
  now: number;
}) {
  const { year, seasonType, now } = params;

  const [teams, aliasMap] = await Promise.all([
    readTeamsCatalog(),
    // League-agnostic (the public /api/scores request carries no league):
    // empty slug -> global > year > seed, matching schedule/standings identity.
    getScopedAliasMap('', year),
  ]);

  const { items, newest } = await loadReconciledSeasonScores({
    year,
    seasonType,
    teams,
    aliasMap,
  });

  // `newest` is null iff nothing was cached (contributorCount === 0).
  if (!newest) {
    // Nothing cached at all — controlled empty (200 so the loader treats it as a
    // resolved response and does not fan out to per-week requests).
    recordRouteCacheMiss('scores');
    return responseFrom([], {
      source: 'cfbd',
      cache: 'stale',
      fallbackUsed: false,
      generatedAt: new Date(now).toISOString(),
      cfbdFallbackReason: 'upstream-suppressed',
    });
  }

  const isFresh = now - newest.at < CACHE_TTL_MS;
  if (isFresh) {
    recordRouteCacheHit('scores');
  } else {
    recordRouteCacheMiss('scores');
  }
  return responseFrom(items, {
    source: newest.source,
    cache: isFresh ? 'hit' : 'stale',
    fallbackUsed: newest.source === 'espn',
    generatedAt: new Date(newest.at).toISOString(),
    cfbdFallbackReason: newest.cfbdFallbackReason,
  });
}

function badRequest(field: string, value: string | null, error: string) {
  return NextResponse.json({ error, field, value }, { status: 400 });
}

function parseNonNegativeInt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return parsed >= 0 ? parsed : null;
}

/**
 * Invalidate canonical standings for every league at the given year. Scores
 * are season-scoped, not league-scoped, so we walk the registry. The set is
 * small; per-tag revalidate is cheap. Failures are swallowed so a registry
 * read error does not roll back a successful score write.
 */
async function invalidateStandingsForYear(year: number): Promise<void> {
  try {
    const leagues = await getLeagues();
    for (const league of leagues) {
      invalidateStandings(league.slug, year);
    }
  } catch {
    // Non-fatal — scores already persisted; canonical will refresh on the
    // next mutation or natural cache turnover.
  }
}

function logDebug(params: {
  requestId: string | null;
  event: string;
  endpoint?: string;
  year: number;
  week: number | null;
  seasonType: SeasonType;
  cacheKey: string;
  itemCount?: number;
  detail?: unknown;
}) {
  if (!IS_DEBUG) return;
  const { requestId, event, endpoint, year, week, seasonType, cacheKey, itemCount, detail } =
    params;

  console.log('cfbd route debug', {
    route: 'scores',
    requestId,
    event,
    endpoint: endpoint ?? null,
    year,
    week,
    seasonType,
    cacheKey,
    itemCount: itemCount ?? null,
    detail: detail ?? null,
  });
}

type ScorePartitionResult =
  | {
      kind: 'success';
      seasonType: SeasonType;
      items: ScorePack[];
      committedAt: string;
      commitSeq: number;
    }
  | { kind: 'noop'; seasonType: SeasonType }
  | {
      kind: 'failure';
      seasonType: SeasonType;
      error: string;
      code: CfbdFallbackReason;
      status: number;
      details?: unknown;
    };

/**
 * Refresh ONE score partition (fetch → classify → durable-first commit) and return
 * a structured result WITHOUT touching provider-refresh status. This is the shared
 * unit for both a single-partition refresh (which records its own attempt) and the
 * aggregate refresh (which records ONE attempt across all applicable partitions),
 * so an aggregate operator action can never split into competing per-partition
 * attempts where one partition's success/no-op erases another's failure
 * (6th-review finding #4). Provider/commit errors are RETURNED (kind 'failure'),
 * not thrown, so the aggregate can collect every partition's outcome. Classifier
 * parity with 085C: a non-array payload and a nonempty→zero-rows payload are
 * schema drift (failure); a genuinely empty CFBD array is valid absence (no-op).
 */
async function refreshScorePartition(params: {
  year: number;
  week: number | null;
  seasonType: SeasonType;
  cfbdApiKey: string;
  now: number;
  requestId: string | null;
}): Promise<ScorePartitionResult> {
  const { year, week, seasonType, cfbdApiKey, now, requestId } = params;
  const cacheKey: CacheKey = `${year}-${week ?? 'all'}-${seasonType}`;
  try {
    const cfbdUrl = buildCfbdGamesUrl({ year, seasonType, week });
    const endpoint = `${cfbdUrl.origin}${cfbdUrl.pathname}${cfbdUrl.search}`;

    const rawGames = await fetchUpstreamJson<CfbdGameLoose[]>(cfbdUrl.toString(), {
      cache: 'no-store',
      timeoutMs: 12_000,
      headers: { Authorization: `Bearer ${cfbdApiKey}` },
      retry: CFBD_RETRY_POLICY,
      pacing: CFBD_PACING_POLICY,
    });

    if (!Array.isArray(rawGames)) {
      throw new Error(`scores ${seasonType} ${year}: provider returned a non-array payload`);
    }

    const items: ScorePack[] = [];
    for (const game of rawGames) {
      const pack = toScorePackFromCfbd(game);
      if (pack) items.push(pack);
    }

    if (rawGames.length > 0 && items.length === 0) {
      throw new Error(
        `scores ${seasonType} ${year}: provider returned ${rawGames.length} rows but none normalized to a valid score (schema drift)`
      );
    }

    if (items.length === 0) {
      // Genuinely empty CFBD partition (valid absence, e.g. postseason before
      // bowls): do NOT write (prior-good rows preserved) — the caller records a
      // no-op, never a failure. No ESPN fallback.
      logDebug({
        requestId,
        event: 'upstream_empty',
        endpoint,
        year,
        week,
        seasonType,
        cacheKey,
        itemCount: 0,
      });
      return { kind: 'noop', seasonType };
    }

    const nextEntry: CacheEntry = {
      at: now,
      items,
      source: 'cfbd',
      cfbdFallbackReason: 'none',
    };
    // Durable-first commit order (PLATFORM-085A): persist BEFORE the process cache
    // and standings invalidation; a failed durable write returns a failure below
    // and preserves prior-good data.
    await setAppState('scores', cacheKey, nextEntry);
    const committedAt = new Date().toISOString();
    const commitSeq = nextProviderCommitSeq();
    SCORES_CACHE[cacheKey] = nextEntry;
    await invalidateStandingsForYear(year);
    pruneScoresCache(SCORES_CACHE, MAX_CACHE_ENTRIES, (evicted, cacheSize) => {
      if (IS_DEBUG) {
        console.log('cfbd cache evicted', {
          route: 'scores',
          cacheSize,
          maxEntries: MAX_CACHE_ENTRIES,
          evicted,
        });
      }
    });
    return { kind: 'success', seasonType, items, committedAt, commitSeq };
  } catch (error) {
    const cfbdFallbackReason = mapCfbdErrorToReason(error);
    if (error instanceof UpstreamFetchError) {
      logDebug({
        requestId,
        event: 'upstream_failed',
        endpoint: error.details.url,
        year,
        week,
        seasonType,
        cacheKey,
        detail: {
          kind: error.details.kind,
          status: error.details.status ?? null,
          message: error.details.message,
        },
      });
    } else {
      logDebug({
        requestId,
        event: 'upstream_failed',
        year,
        week,
        seasonType,
        cacheKey,
        detail: error instanceof Error ? error.message : 'unknown error',
      });
    }
    return {
      kind: 'failure',
      seasonType,
      error: error instanceof Error ? error.message : 'CFBD score refresh failed',
      code: cfbdFallbackReason,
      status: error instanceof UpstreamFetchError ? (error.details.status ?? 502) : 502,
      details: error instanceof UpstreamFetchError ? error.details : undefined,
    };
  }
}

/**
 * Parse an EXPLICIT aggregate `seasonTypes` override into its valid, de-duped
 * subset. Returns `[]` when the param is absent or carries no supported season
 * type — the caller then falls back to server-derived applicability (7th-review
 * finding #1), so a missing/invalid client list can never force an unnecessary
 * partition refresh. A nonempty result is an explicit targeted repair.
 */
function parseExplicitSeasonTypes(raw: string | null): SeasonType[] {
  if (!raw) return [];
  const seen = new Set<SeasonType>();
  const result: SeasonType[] = [];
  for (const token of raw.split(',')) {
    const st = token.trim();
    if ((st === 'regular' || st === 'postseason') && !seen.has(st)) {
      seen.add(st);
      result.push(st);
    }
  }
  return result;
}

/**
 * Aggregate authorized score refresh: fan out over the APPLICABLE partitions under
 * ONE provider-refresh attempt so the operator action has a single truthful status
 * owner. No applicable partition's success or no-op can erase another partition's
 * failure, because the attempt resolves exactly once from the COMBINED partition
 * outcomes (6th-review finding #4):
 *   - any partition failed      → aggregate FAILURE (partial when some committed);
 *                                 prior-good last-success preserved, 502.
 *   - all applicable are no-ops → aggregate NO-OP (no commit, last-success kept).
 *   - ≥1 committed, none failed → aggregate SUCCESS (rows summed, ordered by the
 *                                 newest partition commit).
 */
async function handleAggregateScoreRefresh(params: {
  year: number;
  seasonTypesParam: string | null;
  cfbdApiKey: string;
  now: number;
  requestId: string | null;
}): Promise<NextResponse> {
  const { year, seasonTypesParam, cfbdApiKey, now, requestId } = params;
  // Server-authoritative applicability (7th-review finding #1): an explicit,
  // validated `seasonTypes` list is a targeted repair; otherwise derive the
  // applicable partitions CACHE-ONLY from this year's schedule so an ordinary
  // refresh never fires a doomed postseason request before bowls exist and never
  // depends on the client sending a correct list.
  const explicitSeasonTypes = parseExplicitSeasonTypes(seasonTypesParam);
  const seasonTypes =
    explicitSeasonTypes.length > 0
      ? explicitSeasonTypes
      : await getApplicableScoreSeasonTypes(year);

  // Aggregate refresh covers the COMPLETE intended year target (every applicable
  // partition below), so it records the explicit YEAR ROLLUP after deriving a
  // truthful aggregate outcome. A single partition never advances this rollup
  // (the per-partition path uses a season-partition scope instead).
  const scoresYearScope = yearScope(year);
  const providerAttempt = await beginProviderRefreshAttempt('scores', scoresYearScope, {
    startedAt: new Date(now).toISOString(),
  });

  if (cfbdApiKey.length === 0) {
    await recordProviderRefreshFailure('scores', scoresYearScope, {
      attempt: providerAttempt,
      error: 'CFBD_API_KEY missing',
      code: 'cfbd-api-key-missing',
      status: 502,
      failedPartitions: seasonTypes,
      durationMs: Date.now() - now,
    });
    return NextResponse.json(
      {
        error: 'score refresh unavailable: CFBD API key missing',
        metadata: { cfbdFallbackReason: 'api-key-missing' as CfbdFallbackReason },
      },
      { status: 502 }
    );
  }

  // Aggregate refresh is season-wide (week=null) per applicable partition.
  const results = await Promise.all(
    seasonTypes.map((seasonType) =>
      refreshScorePartition({ year, week: null, seasonType, cfbdApiKey, now, requestId })
    )
  );

  const successes = results.filter(
    (r): r is Extract<ScorePartitionResult, { kind: 'success' }> => r.kind === 'success'
  );
  const failures = results.filter(
    (r): r is Extract<ScorePartitionResult, { kind: 'failure' }> => r.kind === 'failure'
  );
  const rowsCommitted = successes.reduce((n, r) => n + r.items.length, 0);
  const durationMs = Date.now() - now;

  if (failures.length > 0) {
    // ≥1 partition failed → the aggregate action FAILED (partial when some also
    // committed). Record ONE failure listing every failed partition; prior-good
    // last-success is preserved and CANNOT be advanced by the committed partition.
    const firstFailure = failures[0]!;
    await recordProviderRefreshFailure('scores', scoresYearScope, {
      attempt: providerAttempt,
      error: `score refresh failed for partition(s): ${failures.map((f) => f.seasonType).join(', ')}`,
      code: firstFailure.code,
      status: firstFailure.status,
      partialFailure: successes.length > 0,
      failedPartitions: failures.map((f) => f.seasonType),
      durationMs,
    });
    return NextResponse.json(
      {
        error: 'score refresh failed',
        detail: {
          failedSeasonTypes: failures.map((f) => f.seasonType),
          committedSeasonTypes: successes.map((s) => s.seasonType),
        },
        metadata: { cfbdFallbackReason: firstFailure.code },
      },
      { status: firstFailure.status }
    );
  }

  if (successes.length === 0) {
    // Every applicable partition was a valid empty no-op → aggregate no-op: no
    // commit, prior-good preserved, last-success not advanced.
    await recordProviderRefreshNoop('scores', scoresYearScope, {
      attempt: providerAttempt,
      source: 'cfbd',
      durationMs,
    });
    return responseFrom([], {
      source: 'cfbd',
      cache: 'miss',
      fallbackUsed: false,
      generatedAt: new Date(now).toISOString(),
      cfbdFallbackReason: 'cfbd-empty',
    });
  }

  // ≥1 partition committed and none failed → aggregate SUCCESS. Order last-success
  // by the newest partition commit (commitSeq is strictly increasing per commit).
  const newest = successes.reduce((a, b) => (b.commitSeq > a.commitSeq ? b : a));
  await recordProviderRefreshSuccess('scores', scoresYearScope, {
    attempt: providerAttempt,
    committedAt: newest.committedAt,
    commitSeq: newest.commitSeq,
    source: 'cfbd',
    rowsCommitted,
    durationMs,
  });
  return responseFrom(
    successes.flatMap((r) => r.items),
    {
      source: 'cfbd',
      cache: 'miss',
      fallbackUsed: false,
      generatedAt: new Date(now).toISOString(),
      cfbdFallbackReason: 'none',
    }
  );
}

export async function GET(req: Request) {
  recordRouteRequest('scores');
  const url = new URL(req.url);
  const weekParam = url.searchParams.get('week');
  const yearParam = url.searchParams.get('year');
  const seasonParam = url.searchParams.get('seasonType');
  const requestId = req.headers.get('x-request-id');

  let week: number | null = null;
  if (weekParam !== null) {
    const parsedWeek = parseNonNegativeInt(weekParam);
    if (parsedWeek === null) {
      return badRequest('week', weekParam, 'week must be a non-negative integer when provided');
    }
    week = parsedWeek;
  }

  const currentYear = new Date().getUTCFullYear();
  const minYear = 2000;
  const maxYear = currentYear + 1;
  let year = seasonYearForToday();
  if (yearParam !== null) {
    const parsedYear = parseNonNegativeInt(yearParam);
    if (parsedYear === null || parsedYear < minYear || parsedYear > maxYear) {
      return badRequest(
        'year',
        yearParam,
        `year must be an integer between ${minYear} and ${maxYear}`
      );
    }
    year = parsedYear;
  }

  let seasonType: SeasonType = 'regular';
  if (seasonParam !== null) {
    if (seasonParam === 'regular' || seasonParam === 'postseason') {
      seasonType = seasonParam;
    } else {
      return badRequest('seasonType', seasonParam, 'seasonType must be "regular" or "postseason"');
    }
  }

  const cacheKey: CacheKey = `${year}-${week ?? 'all'}-${seasonType}`;
  const now = Date.now();

  // Only an authorized admin refresh may spend upstream CFBD quota
  // (PLATFORM-075). Public/anonymous traffic is a pure cache reader below and
  // can never trigger a cold-cache provider fetch.
  const refreshRequested = url.searchParams.get('refresh') === '1';
  if (refreshRequested) {
    const authFailure = await requireAdminAuth(req);
    if (authFailure) return authFailure;
  }

  if (!refreshRequested) {
    // ---- Public/anonymous path: never spends CFBD quota ----
    if (week === null) {
      // Season-wide read: always reconcile the season entry with every
      // week-scoped cache server-side (even when the season entry is fresh), so a
      // week cache refreshed after the season snapshot is never masked, and the
      // loader needs no per-week client fan-out. Nothing cached -> controlled
      // empty (200) response. No upstream call.
      return await aggregateSeasonScoresResponse({ year, seasonType, now });
    }

    // Week-scoped read: a leaf request (no downstream fan-out).
    const memoryHit = SCORES_CACHE[cacheKey];
    if (memoryHit && now - memoryHit.at < CACHE_TTL_MS) {
      recordRouteCacheHit('scores');
      return responseFrom(memoryHit.items, {
        source: memoryHit.source,
        cache: 'hit',
        fallbackUsed: memoryHit.source === 'espn',
        generatedAt: new Date(memoryHit.at).toISOString(),
        cfbdFallbackReason: memoryHit.cfbdFallbackReason,
      });
    }

    const stored = await getAppState<CacheEntry>('scores', cacheKey);
    const storedValue = stored?.value;
    if (storedValue && now - storedValue.at < CACHE_TTL_MS) {
      SCORES_CACHE[cacheKey] = storedValue;
      pruneScoresCache(SCORES_CACHE, MAX_CACHE_ENTRIES);
      recordRouteCacheHit('scores');
      return responseFrom(storedValue.items, {
        source: storedValue.source,
        cache: 'hit',
        fallbackUsed: storedValue.source === 'espn',
        generatedAt: new Date(storedValue.at).toISOString(),
        cfbdFallbackReason: storedValue.cfbdFallbackReason,
      });
    }

    // No fresh week cache. Serve the stale entry, or a controlled empty response.
    // Anonymous callers never trigger an upstream fetch (PLATFORM-075).
    recordRouteCacheMiss('scores');
    const staleEntry = pickFreshestScoresEntry(memoryHit, storedValue);
    if (staleEntry) {
      if (staleEntry === storedValue) {
        SCORES_CACHE[cacheKey] = staleEntry;
        pruneScoresCache(SCORES_CACHE, MAX_CACHE_ENTRIES);
      }
      return responseFrom(staleEntry.items, {
        source: staleEntry.source,
        cache: 'stale',
        fallbackUsed: staleEntry.source === 'espn',
        generatedAt: new Date(staleEntry.at).toISOString(),
        cfbdFallbackReason: staleEntry.cfbdFallbackReason,
      });
    }
    return responseFrom([], {
      source: 'cfbd',
      cache: 'stale',
      fallbackUsed: false,
      generatedAt: new Date(now).toISOString(),
      cfbdFallbackReason: 'upstream-suppressed',
    });
  }

  // ---- Authorized refresh path: fetch upstream (CFBD only) ----
  //
  // CFBD is the SOLE normal production score provider (PLATFORM-086A rereview):
  // ESPN was removed as an automatic fallback and as a durable score source. The
  // reliability mechanism is prior-good CFBD cache retention, not a parallel
  // provider — a CFBD failure preserves the prior-good durable cache and reports
  // a failure rather than silently substituting a second source.
  recordRouteCacheMiss('scores');

  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';

  // Aggregate refresh (6th-review finding #4): fan out over the applicable
  // partitions under ONE 'scores' attempt so no partition's no-op/success can
  // erase another partition's failure. The admin panels issue exactly this
  // request; a per-partition refresh (below) is still available for direct repair.
  if (url.searchParams.get('aggregate') === '1') {
    return await handleAggregateScoreRefresh({
      year,
      seasonTypesParam: url.searchParams.get('seasonTypes'),
      cfbdApiKey,
      now,
      requestId,
    });
  }

  // Single-partition refresh: records its OWN truthful 'scores' attempt so a
  // direct one-partition repair (or test) stays observable. Begin BEFORE the
  // credential check so a missing-key early return still resolves the attempt
  // (rereview finding #5).
  // Single-partition repair records against only its (year, seasonType) partition
  // — never the year rollup, so a targeted one-partition refresh cannot present as
  // whole-year score freshness.
  const partitionScope = seasonPartitionScope(year, seasonType);
  const providerAttempt = await beginProviderRefreshAttempt('scores', partitionScope, {
    startedAt: new Date(now).toISOString(),
  });

  if (cfbdApiKey.length === 0) {
    await recordProviderRefreshFailure('scores', partitionScope, {
      attempt: providerAttempt,
      error: 'CFBD_API_KEY missing',
      code: 'cfbd-api-key-missing',
      status: 502,
      durationMs: Date.now() - now,
    });
    return NextResponse.json(
      {
        error: 'score refresh unavailable: CFBD API key missing',
        metadata: { cfbdFallbackReason: 'api-key-missing' as CfbdFallbackReason },
      },
      { status: 502 }
    );
  }

  const result = await refreshScorePartition({
    year,
    week,
    seasonType,
    cfbdApiKey,
    now,
    requestId,
  });

  if (result.kind === 'noop') {
    // Valid empty CFBD partition → no-op (prior-good preserved), successful empty.
    await recordProviderRefreshNoop('scores', partitionScope, {
      attempt: providerAttempt,
      source: 'cfbd',
      durationMs: Date.now() - now,
    });
    return responseFrom([], {
      source: 'cfbd',
      cache: 'miss',
      fallbackUsed: false,
      generatedAt: new Date(now).toISOString(),
      cfbdFallbackReason: 'cfbd-empty',
    });
  }

  if (result.kind === 'failure') {
    // CFBD failed (fetch, validation, or durable persistence): prior-good durable
    // cache preserved, failed attempt recorded, failure returned. No ESPN.
    await recordProviderRefreshFailure('scores', partitionScope, {
      attempt: providerAttempt,
      error: result.error,
      code: result.code,
      status: result.status,
      durationMs: Date.now() - now,
    });
    return NextResponse.json(
      {
        error: 'score refresh failed',
        detail: result.details ?? result.error,
        metadata: { cfbdFallbackReason: result.code },
      },
      { status: result.status }
    );
  }

  await recordProviderRefreshSuccess('scores', partitionScope, {
    attempt: providerAttempt,
    committedAt: result.committedAt,
    commitSeq: result.commitSeq,
    source: 'cfbd',
    rowsCommitted: result.items.length,
    durationMs: Date.now() - now,
  });
  return responseFrom(result.items, {
    source: 'cfbd',
    cache: 'miss',
    fallbackUsed: false,
    generatedAt: new Date(now).toISOString(),
    cfbdFallbackReason: 'none',
  });
}
