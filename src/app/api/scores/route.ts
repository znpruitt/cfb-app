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
import {
  beginProviderRefreshAttempt,
  recordProviderRefreshFailure,
  recordProviderRefreshSuccess,
} from '@/lib/server/providerRefreshStatus';
import { loadReconciledSeasonScores } from '@/lib/server/scoreCacheReader';
import { getLeagues } from '@/lib/leagueRegistry';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import { pruneScoresCache, type CacheEntry, type CacheKey } from '@/lib/scores/cache';
import {
  seasonYearForToday,
  toScorePackFromCfbd,
  toScorePackFromEspn,
} from '@/lib/scores/normalizers';
import type {
  CfbdFallbackReason,
  CfbdGameLoose,
  EspnScoreboard,
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
const ESPN_RETRY_POLICY = {
  maxAttempts: 2,
  baseDelayMs: 200,
  maxDelayMs: 1_000,
  jitterRatio: 0.2,
  retryOnHttpStatuses: [408, 425, 429, 500, 502, 503, 504],
} as const;
const ESPN_PACING_POLICY = {
  key: 'espn',
  minIntervalMs: 100,
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

  // Only an authorized admin refresh may spend upstream CFBD/ESPN quota
  // (PLATFORM-075). Public/anonymous traffic is a pure cache reader below and
  // can never trigger a cold-cache provider fetch.
  const refreshRequested = url.searchParams.get('refresh') === '1';
  if (refreshRequested) {
    const authFailure = await requireAdminAuth(req);
    if (authFailure) return authFailure;
  }

  if (!refreshRequested) {
    // ---- Public/anonymous path: never spends CFBD/ESPN quota ----
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

  // ---- Authorized refresh path: fetch upstream (CFBD -> ESPN fallback) ----
  recordRouteCacheMiss('scores');

  // Provider-refresh observability (PLATFORM-086A): record the attempt before the
  // fetch; success is recorded only after a durable commit, failure on any 502.
  const providerAttemptStartedAt = new Date(now).toISOString();
  await beginProviderRefreshAttempt('scores', providerAttemptStartedAt);

  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  const cfbdApiKeyMissing = cfbdApiKey.length === 0;
  let cfbdFallbackReason: CfbdFallbackReason = cfbdApiKeyMissing ? 'api-key-missing' : 'none';

  try {
    if (cfbdApiKey) {
      const cfbdUrl = buildCfbdGamesUrl({ year, seasonType, week });
      const endpoint = `${cfbdUrl.origin}${cfbdUrl.pathname}${cfbdUrl.search}`;

      const rawGames = await fetchUpstreamJson<CfbdGameLoose[]>(cfbdUrl.toString(), {
        cache: 'no-store',
        timeoutMs: 12_000,
        headers: { Authorization: `Bearer ${cfbdApiKey}` },
        retry: CFBD_RETRY_POLICY,
        pacing: CFBD_PACING_POLICY,
      });

      const items: ScorePack[] = [];
      for (const game of rawGames) {
        const pack = toScorePackFromCfbd(game);
        if (pack) items.push(pack);
      }

      if (items.length === 0) {
        cfbdFallbackReason = 'cfbd-empty';
        logDebug({
          requestId,
          event: 'upstream_empty',
          endpoint,
          year,
          week,
          seasonType,
          cacheKey,
          itemCount: items.length,
        });
      }

      if (items.length > 0) {
        const nextEntry: CacheEntry = {
          at: now,
          items,
          source: 'cfbd',
          cfbdFallbackReason: 'none',
        };
        // Durable-first commit order (PLATFORM-085A): persist to app-state
        // BEFORE publishing to the process cache and invalidating standings, so
        // a failed durable write can never leave this instance serving "fresh"
        // scores that no other instance can durably reproduce. A setAppState
        // throw propagates, skipping the memory update and the invalidation.
        await setAppState('scores', cacheKey, nextEntry);
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

        await recordProviderRefreshSuccess('scores', {
          attemptStartedAt: providerAttemptStartedAt,
          source: 'cfbd',
          rowsCommitted: items.length,
          durationMs: Date.now() - now,
        });

        return responseFrom(items, {
          source: 'cfbd',
          cache: 'miss',
          fallbackUsed: false,
          generatedAt: new Date(now).toISOString(),
          cfbdFallbackReason: 'none',
        });
      }
    }
  } catch (error) {
    cfbdFallbackReason = mapCfbdErrorToReason(error);

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
    // swallow CFBD failure and try ESPN fallback
  }

  try {
    if (week == null) {
      await recordProviderRefreshFailure('scores', {
        attemptStartedAt: providerAttemptStartedAt,
        error: 'season-wide fallback unavailable',
        code: cfbdFallbackReason,
        status: 502,
        durationMs: Date.now() - now,
      });
      return NextResponse.json(
        {
          error: 'season-wide fallback unavailable without CFBD API key',
          metadata: {
            cfbdFallbackReason,
          },
        },
        { status: 502 }
      );
    }

    const espnSeason = seasonType === 'regular' ? '2' : '3';
    const espnUrl = new URL(
      'https://site.web.api.espn.com/apis/v2/sports/football/college-football/scoreboard'
    );
    espnUrl.searchParams.set('week', String(week));
    espnUrl.searchParams.set('year', String(year));
    espnUrl.searchParams.set('seasontype', espnSeason);

    const scoreboard = await fetchUpstreamJson<EspnScoreboard>(espnUrl.toString(), {
      cache: 'no-store',
      timeoutMs: 12_000,
      retry: ESPN_RETRY_POLICY,
      pacing: ESPN_PACING_POLICY,
    });

    const items: ScorePack[] = [];
    for (const event of scoreboard.events ?? []) {
      const pack = toScorePackFromEspn(event, week, seasonType);
      if (pack) items.push(pack);
    }

    const nextEntry: CacheEntry = {
      at: now,
      items,
      source: 'espn',
      cfbdFallbackReason,
    };
    // Durable-first commit order (PLATFORM-085A): persist before publishing to
    // the process cache and invalidating standings (see the CFBD path above).
    await setAppState('scores', cacheKey, nextEntry);
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

    await recordProviderRefreshSuccess('scores', {
      attemptStartedAt: providerAttemptStartedAt,
      source: 'espn',
      rowsCommitted: items.length,
      durationMs: Date.now() - now,
    });

    return responseFrom(items, {
      source: 'espn',
      cache: 'miss',
      fallbackUsed: true,
      generatedAt: new Date(now).toISOString(),
      cfbdFallbackReason,
    });
  } catch (error) {
    await recordProviderRefreshFailure('scores', {
      attemptStartedAt: providerAttemptStartedAt,
      error: error instanceof Error ? error.message : 'all sources failed',
      code: cfbdFallbackReason,
      status: error instanceof UpstreamFetchError ? (error.details.status ?? 502) : 502,
      durationMs: Date.now() - now,
    });
    if (error instanceof UpstreamFetchError) {
      return NextResponse.json(
        {
          error: 'all sources failed',
          detail: error.details,
          metadata: {
            ...(cfbdApiKeyMissing
              ? {
                  cfbdApiKeyMissing: true,
                  seasonWideEspnFallbackPossible: false,
                }
              : {}),
            cfbdFallbackReason,
          },
        },
        { status: error.details.status ?? 502 }
      );
    }

    const detail = error instanceof Error ? error.message : 'unknown error';
    return NextResponse.json(
      {
        error: 'all sources failed',
        detail,
        metadata: {
          ...(cfbdApiKeyMissing
            ? {
                cfbdApiKeyMissing: true,
                seasonWideEspnFallbackPossible: false,
              }
            : {}),
          cfbdFallbackReason,
        },
      },
      { status: 502 }
    );
  }
}
