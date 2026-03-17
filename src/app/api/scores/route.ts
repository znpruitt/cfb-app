import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGamesUrl } from '@/lib/cfbd';
import {
  recordRouteCacheHit,
  recordRouteCacheMiss,
  recordRouteRequest,
} from '@/lib/server/apiUsageBudget';

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

type SeasonType = 'regular' | 'postseason';
type CfbdFallbackReason =
  | 'none'
  | 'api-key-missing'
  | 'cfbd-empty'
  | 'cfbd-timeout'
  | 'cfbd-aborted'
  | 'cfbd-network'
  | 'cfbd-http'
  | 'cfbd-parse'
  | 'cfbd-unknown-error';

interface ScorePack {
  id?: string | null;
  seasonType?: SeasonType | null;
  startDate?: string | null;
  week: number | null;
  status: string;
  home: { team: string; score: number | null };
  away: { team: string; score: number | null };
  time: string | null;
}

// App-facing contract: provider-specific score payloads are normalized into ScorePack items.

interface ScoresMeta {
  source: 'cfbd' | 'espn';
  cache: 'hit' | 'miss';
  fallbackUsed: boolean;
  generatedAt: string;
  cfbdFallbackReason: CfbdFallbackReason;
}

interface ScoresResponse {
  items: ScorePack[];
  meta: ScoresMeta;
}

type CfbdGameLoose = {
  id?: number | string;
  season?: number;
  week?: number | string;
  season_type?: string;
  seasonType?: string;
  start_date?: string | null;
  startDate?: string | null;

  home_team?: string;
  away_team?: string;
  home_points?: number | null;
  away_points?: number | null;
  status?: string | null;

  homeTeam?: string;
  awayTeam?: string;
  home?: string;
  away?: string;
  home_name?: string;
  away_name?: string;

  homePoints?: number | null;
  awayPoints?: number | null;
  home_score?: number | null;
  away_score?: number | null;

  completed?: boolean | null;
};

interface EspnTeamRef {
  team: { displayName: string };
  score?: string;
  homeAway?: 'home' | 'away';
}

interface EspnCompetition {
  status: { type: { name: string; description: string; shortDetail?: string } };
  competitors: EspnTeamRef[];
}

interface EspnEvent {
  competitions: EspnCompetition[];
}

interface EspnScoreboard {
  events: EspnEvent[];
}

function seasonYearForToday(now = new Date()): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 7 ? year : year - 1;
}

function firstStr(fields: Array<string | undefined | null>): string | undefined {
  for (const field of fields) {
    const value = typeof field === 'string' ? field.trim() : undefined;
    if (value) return value;
  }
  return undefined;
}

function firstNum(fields: Array<number | undefined | null>): number | null {
  for (const field of fields) {
    if (typeof field === 'number' && Number.isFinite(field)) return field;
  }
  return null;
}

function toStatus(status?: string | null, completed?: boolean | null): string {
  const normalized = (status ?? '').toLowerCase();
  if (normalized.includes('final')) return 'final';
  if (normalized.includes('progress') || normalized.includes('half') || normalized.includes('q')) {
    return 'in progress';
  }
  if (completed) return 'final';
  if (normalized.includes('sched')) return 'scheduled';
  return normalized ? status! : 'scheduled';
}

function toScorePackFromCfbd(game: CfbdGameLoose): ScorePack | null {
  const homeTeam = firstStr([game.home_team, game.homeTeam, game.home, game.home_name]);
  const awayTeam = firstStr([game.away_team, game.awayTeam, game.away, game.away_name]);
  if (!homeTeam || !awayTeam) return null;

  const homeScore = firstNum([
    game.home_points ?? null,
    game.homePoints ?? null,
    game.home_score ?? null,
  ]);
  const awayScore = firstNum([
    game.away_points ?? null,
    game.awayPoints ?? null,
    game.away_score ?? null,
  ]);

  return {
    id: game.id != null && String(game.id).trim().length > 0 ? String(game.id).trim() : null,
    seasonType:
      game.season_type === 'postseason' || game.seasonType === 'postseason'
        ? 'postseason'
        : game.season_type === 'regular' || game.seasonType === 'regular'
          ? 'regular'
          : null,
    startDate: game.start_date ?? game.startDate ?? null,
    week:
      typeof game.week === 'number'
        ? game.week
        : /^\d+$/.test(String(game.week ?? ''))
          ? Number.parseInt(String(game.week), 10)
          : null,
    status: toStatus(game.status, game.completed ?? null),
    time: game.start_date ?? null,
    home: { team: homeTeam, score: homeScore },
    away: { team: awayTeam, score: awayScore },
  };
}

function toScorePackFromEspn(
  event: EspnEvent & { id?: string },
  week: number | null,
  seasonType: SeasonType
): ScorePack | null {
  const competition = event.competitions?.[0];
  if (!competition) return null;

  const statusType = competition.status?.type;
  const name = (statusType?.name ?? '').toLowerCase();
  const description = (statusType?.description ?? '').toLowerCase();

  let status = 'scheduled';
  if (name.includes('final') || description.includes('final')) status = 'final';
  else if (
    name.includes('progress') ||
    description.includes('progress') ||
    description.includes('half') ||
    description.includes('q')
  ) {
    status = 'in progress';
  }

  const homeRef = competition.competitors.find((competitor) => competitor.homeAway === 'home');
  const awayRef = competition.competitors.find((competitor) => competitor.homeAway === 'away');
  if (!homeRef || !awayRef) return null;

  const homeScore = Number.parseInt(homeRef.score ?? '', 10);
  const awayScore = Number.parseInt(awayRef.score ?? '', 10);

  return {
    id: event.id ?? null,
    seasonType,
    startDate: null,
    week,
    status,
    time: statusType?.shortDetail ?? null,
    home: {
      team: homeRef.team.displayName,
      score: Number.isFinite(homeScore) ? homeScore : null,
    },
    away: {
      team: awayRef.team.displayName,
      score: Number.isFinite(awayScore) ? awayScore : null,
    },
  };
}

type CacheWeek = number | 'all';
type CacheKey = `${number}-${CacheWeek}-${SeasonType}`;

type CacheEntry = {
  at: number;
  items: ScorePack[];
  source: 'cfbd' | 'espn';
  cfbdFallbackReason: CfbdFallbackReason;
};

const SCORES_CACHE: Record<CacheKey, CacheEntry> = {};

function pruneCache(cache: Record<CacheKey, CacheEntry>, label: string) {
  const entries = Object.entries(cache) as Array<[CacheKey, CacheEntry]>;
  if (entries.length <= MAX_CACHE_ENTRIES) return;

  const toDelete = entries
    .sort((a, b) => a[1].at - b[1].at)
    .slice(0, entries.length - MAX_CACHE_ENTRIES)
    .map(([key]) => key);

  for (const key of toDelete) {
    delete cache[key];
  }

  if (IS_DEBUG) {
    console.log('cfbd cache evicted', {
      route: label,
      cacheSize: entries.length,
      maxEntries: MAX_CACHE_ENTRIES,
      evicted: toDelete.length,
    });
  }
}

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
        pruneCache(SCORES_CACHE, 'scores');

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
    pruneCache(SCORES_CACHE, 'scores');

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
