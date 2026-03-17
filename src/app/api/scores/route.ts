import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGamesUrl } from '@/lib/cfbd';
import {
  recordRouteCacheHit,
  recordRouteCacheMiss,
  recordRouteRequest,
} from '@/lib/server/apiUsageBudget';
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

function badRequest(field: string, value: string | null, error: string) {
  return NextResponse.json({ error, field, value }, { status: 400 });
}

function parseNonNegativeInt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return parsed >= 0 ? parsed : null;
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
  const hit = SCORES_CACHE[cacheKey];
  if (hit && now - hit.at < CACHE_TTL_MS) {
    recordRouteCacheHit('scores');
    return responseFrom(hit.items, {
      source: hit.source,
      cache: 'hit',
      fallbackUsed: hit.source === 'espn',
      generatedAt: new Date(hit.at).toISOString(),
      cfbdFallbackReason: hit.cfbdFallbackReason,
    });
  }

  recordRouteCacheMiss('scores');

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
        SCORES_CACHE[cacheKey] = {
          at: now,
          items,
          source: 'cfbd',
          cfbdFallbackReason: 'none',
        };
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

    SCORES_CACHE[cacheKey] = {
      at: now,
      items,
      source: 'espn',
      cfbdFallbackReason,
    };
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

    return responseFrom(items, {
      source: 'espn',
      cache: 'miss',
      fallbackUsed: true,
      generatedAt: new Date(now).toISOString(),
      cfbdFallbackReason,
    });
  } catch (error) {
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
