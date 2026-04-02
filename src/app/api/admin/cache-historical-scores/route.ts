import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGamesUrl } from '@/lib/cfbd';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';
import type { CacheEntry, CacheKey } from '@/lib/scores/cache';
import { seasonYearForToday, toScorePackFromCfbd } from '@/lib/scores/normalizers';
import type { CfbdGameLoose, ScorePack, SeasonType } from '@/lib/scores/types';

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

async function fetchScoreItems(year: number, seasonType: SeasonType): Promise<ScorePack[]> {
  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    throw new Error('CFBD_API_KEY missing');
  }

  const cfbdUrl = buildCfbdGamesUrl({ year, seasonType, week: null });
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
  return items;
}

export async function POST(req: Request): Promise<Response> {
  const authFailure = requireAdminRequest(req);
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

  const activeSeason = seasonYearForToday();
  if (year === activeSeason) {
    return NextResponse.json(
      {
        error: `year ${year} is the active season — use the existing scores route to refresh active season cache`,
        field: 'year',
      },
      { status: 400 }
    );
  }

  const regularKey = `${year}-all-regular` as CacheKey;
  const postseasonKey = `${year}-all-postseason` as CacheKey;

  if (!force) {
    const [existingRegular, existingPostseason] = await Promise.all([
      getAppState<CacheEntry>('scores', regularKey),
      getAppState<CacheEntry>('scores', postseasonKey),
    ]);
    if (existingRegular && existingPostseason) {
      return NextResponse.json({ alreadyCached: true, year });
    }
  }

  let regularItems: ScorePack[];
  let postseasonItems: ScorePack[];

  try {
    [regularItems, postseasonItems] = await Promise.all([
      fetchScoreItems(year, 'regular'),
      fetchScoreItems(year, 'postseason'),
    ]);
  } catch (err) {
    if (err instanceof UpstreamFetchError) {
      return NextResponse.json(
        { error: 'CFBD API error', detail: err.details },
        { status: err.details.status ?? 502 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown error fetching scores from CFBD' },
      { status: 502 }
    );
  }

  const now = Date.now();

  await Promise.all([
    setAppState<CacheEntry>('scores', regularKey, {
      at: now,
      items: regularItems,
      source: 'cfbd',
      cfbdFallbackReason: 'none',
    }),
    setAppState<CacheEntry>('scores', postseasonKey, {
      at: now,
      items: postseasonItems,
      source: 'cfbd',
      cfbdFallbackReason: 'none',
    }),
  ]);

  return NextResponse.json({
    success: true,
    year,
    scoreCount: regularItems.length + postseasonItems.length,
    cachedAt: new Date(now).toISOString(),
  });
}
