import { NextResponse } from 'next/server';

import { getLeagues } from '@/lib/leagueRegistry';
import { refreshFullSeasonSchedule } from '@/lib/schedule/fullSeasonScheduleRefresh';
import { seasonYearForToday } from '@/lib/scores/normalizers';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState } from '@/lib/server/appStateStore';
import type { CacheEntry } from '../../schedule/cache';

export const dynamic = 'force-dynamic';

/**
 * Years the historical repair must NEVER overwrite: the app's inferred current
 * season, plus every year assigned to a league whose lifecycle is `preseason` or
 * `season`. `force=1` does NOT bypass this — active-season schedule is owned by the
 * schedule route + season-transition cron, and a historical repair must never race
 * or clobber it (PLATFORM-086E1A §4).
 */
async function computeProtectedActiveYears(): Promise<Set<number>> {
  const protectedYears = new Set<number>([seasonYearForToday()]);
  const leagues = await getLeagues();
  for (const league of leagues) {
    const status = league.status;
    if (status?.state === 'preseason' || status?.state === 'season') {
      protectedYears.add((status as { year: number }).year);
    }
  }
  return protectedYears;
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

  // Active-season protection — enforced regardless of `force`.
  const protectedYears = await computeProtectedActiveYears();
  if (protectedYears.has(year)) {
    return NextResponse.json(
      {
        error: `year ${year} is an active season (inferred current year or a preseason/season league year) — refresh it via the schedule route, not the historical repair`,
        field: 'year',
      },
      { status: 400 }
    );
  }

  const cacheKey = `${year}-all-all`;

  // Without `force`, an already-cached historical year is a no-provider-call
  // short-circuit (avoid re-spending a fetch on data we already hold).
  if (!force) {
    let existing: Awaited<ReturnType<typeof getAppState<CacheEntry>>>;
    try {
      existing = await getAppState<CacheEntry>('schedule', cacheKey);
    } catch {
      return NextResponse.json(
        { error: 'schedule cache read failed', code: 'schedule-cache-read-failed' },
        { status: 503 }
      );
    }
    if (existing?.value) {
      return NextResponse.json({ alreadyCached: true, year });
    }
  }

  // Allowed historical year — drive the SHARED full-season authority so it gets the
  // same completeness, schema-drift, empty-replacement, lease, transaction,
  // observation-order, and provider-status protection as every other full-year
  // writer (PLATFORM-086E1A §4).
  const result = await refreshFullSeasonSchedule({ year });

  if (result.status === 'in-progress') {
    return NextResponse.json(
      { error: 'schedule refresh already in progress for this year', code: result.reason },
      { status: 409 }
    );
  }
  if (result.status === 'failure') {
    return NextResponse.json(
      { error: 'historical schedule repair failed', code: result.reason },
      { status: result.httpStatus }
    );
  }

  return NextResponse.json({
    success: true,
    year,
    gameCount: result.items.length,
    cachedAt: result.committedAt ?? result.observedAt ?? new Date().toISOString(),
  });
}
