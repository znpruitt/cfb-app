import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdSpRatingsUrl } from '@/lib/cfbd';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState, setAppState } from '@/lib/server/appStateStore';

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

type CfbdSpRating = {
  year: number;
  team: string;
  conference: string;
  rating: number | null;
  ranking: number | null;
};

export type SpRatingCacheEntry = {
  ratings: CfbdSpRating[];
  cachedAt: string;
};

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

  if (!force) {
    const existing = await getAppState<SpRatingCacheEntry>('sp-ratings', String(year));
    if (existing) {
      return NextResponse.json({ alreadyCached: true, year, teamCount: existing.value.ratings.length });
    }
  }

  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    return NextResponse.json({ error: 'CFBD_API_KEY missing' }, { status: 500 });
  }

  let ratings: CfbdSpRating[];
  try {
    const cfbdUrl = buildCfbdSpRatingsUrl({ year });
    ratings = await fetchUpstreamJson<CfbdSpRating[]>(cfbdUrl.toString(), {
      cache: 'no-store',
      timeoutMs: 12_000,
      headers: { Authorization: `Bearer ${cfbdApiKey}` },
      retry: CFBD_RETRY_POLICY,
      pacing: CFBD_PACING_POLICY,
    });
  } catch (err) {
    if (err instanceof UpstreamFetchError) {
      return NextResponse.json(
        { error: 'CFBD API error', detail: err.details },
        { status: err.details.status ?? 502 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown error fetching SP+ ratings from CFBD' },
      { status: 502 }
    );
  }

  if (!ratings || ratings.length === 0) {
    return NextResponse.json({
      success: true,
      year,
      status: 'awaiting-ratings',
      teamCount: 0,
    });
  }

  const cachedAt = new Date().toISOString();
  const entry: SpRatingCacheEntry = { ratings, cachedAt };
  await setAppState('sp-ratings', String(year), entry);

  return NextResponse.json({
    success: true,
    year,
    status: 'cached',
    teamCount: ratings.length,
    cachedAt,
  });
}
