import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGamesUrl } from '@/lib/cfbd';
import {
  mapCfbdScheduleGame,
  type CfbdScheduleGame,
  type ScheduleItem,
  type SeasonType,
} from '@/lib/schedule/cfbdSchedule';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import type { CacheEntry } from '../../schedule/cache';

export const dynamic = 'force-dynamic';

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

function activeSeasonYear(now = new Date()): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 7 ? year : year - 1;
}

async function fetchSeasonTypeItems(year: number, seasonType: SeasonType): Promise<ScheduleItem[]> {
  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    throw new Error('CFBD_API_KEY missing');
  }

  const cfbdUrl = buildCfbdGamesUrl({ year, seasonType, week: null });
  const upstream = await fetchUpstreamJson<CfbdScheduleGame[]>(cfbdUrl.toString(), {
    cache: 'no-store',
    timeoutMs: 12_000,
    headers: { Authorization: `Bearer ${cfbdApiKey}` },
    retry: CFBD_RETRY_POLICY,
    pacing: CFBD_PACING_POLICY,
  });

  const items: ScheduleItem[] = [];
  for (const game of upstream) {
    const result = mapCfbdScheduleGame(game, seasonType);
    if (result.ok) items.push(result.item);
  }
  return items;
}

export async function POST(req: Request): Promise<Response> {
  const authFailure = await requireAdminRequest(req);
  if (authFailure) return authFailure;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'request body must be valid JSON' }, { status: 400 });
  }

  const { year, force } = body as { year?: unknown; force?: unknown };

  if (
    typeof year !== 'number' ||
    !Number.isFinite(year) ||
    !Number.isInteger(year) ||
    year < 2000
  ) {
    return NextResponse.json(
      { error: 'year must be a finite integer >= 2000', field: 'year' },
      { status: 400 }
    );
  }

  const activeSeason = activeSeasonYear();
  if (year === activeSeason) {
    return NextResponse.json(
      {
        error: `year ${year} is the active season — use the existing schedule route to refresh active season cache`,
        field: 'year',
      },
      { status: 400 }
    );
  }

  const cacheKey = `${year}-all-all`;

  if (!force) {
    const existing = await getAppState<CacheEntry>('schedule', cacheKey);
    if (existing) {
      return NextResponse.json({ alreadyCached: true, year });
    }
  }

  let regularItems: ScheduleItem[];
  let postseasonItems: ScheduleItem[];

  try {
    [regularItems, postseasonItems] = await Promise.all([
      fetchSeasonTypeItems(year, 'regular'),
      fetchSeasonTypeItems(year, 'postseason'),
    ]);
  } catch (err) {
    if (err instanceof UpstreamFetchError) {
      return NextResponse.json(
        { error: 'CFBD API error', detail: err.details },
        { status: err.details.status ?? 502 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown error fetching schedule from CFBD' },
      { status: 502 }
    );
  }

  const items = [...regularItems, ...postseasonItems].sort(
    (a, b) => a.week - b.week || (a.startDate ?? '').localeCompare(b.startDate ?? '')
  );

  const now = Date.now();
  const entry: CacheEntry = {
    at: now,
    items,
    partialFailure: false,
    failedSeasonTypes: [],
  };

  await setAppState('schedule', cacheKey, entry);

  return NextResponse.json({
    success: true,
    year,
    gameCount: items.length,
    cachedAt: new Date(now).toISOString(),
  });
}
