import { NextResponse } from 'next/server';

import { readLeagueRegistry, type LeagueRegistryReadResult } from '@/lib/leagueRegistry';
import { refreshFullSeasonSchedule } from '@/lib/schedule/fullSeasonScheduleRefresh';
import { seasonYearForToday } from '@/lib/scores/normalizers';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState } from '@/lib/server/appStateStore';
import type { CacheEntry } from '../../schedule/cache';

export const dynamic = 'force-dynamic';

type ProtectedYears =
  | { kind: 'known'; years: Set<number> }
  /** The protected set cannot be computed — the refusal must fire, not relax. */
  | { kind: 'indeterminate'; reason: 'registry-malformed' | 'registry-unreadable' };

/**
 * Years the historical repair must NEVER overwrite: the app's inferred current
 * season, plus every year assigned to a league whose lifecycle is `preseason` or
 * `season`. `force=1` does NOT bypass this — active-season schedule is owned by the
 * schedule route + season-transition cron, and a historical repair must never race
 * or clobber it (PLATFORM-086E1A §4).
 *
 * Returns `indeterminate` when the protected set cannot be established at all, which
 * the caller turns into a refusal (PLATFORM-794).
 */
async function computeProtectedActiveYears(): Promise<ProtectedYears> {
  const protectedYears = new Set<number>([seasonYearForToday()]);

  // PLATFORM-794: read through the TYPED reader, because `getLeagues()` maps an
  // absent registry AND a malformed one to the same `[]`.
  //
  // That collapse silently narrowed this route's safety refusal. A corrupt registry
  // contributed zero protected years, so the refusal that an active-season or
  // preseason year must go through the schedule route stopped covering those years —
  // and the caller saw a normal success, because a narrowed refusal looks exactly
  // like a request that was legitimately allowed. `force=1` never bypassed this
  // guard, and a malformed registry effectively did.
  //
  // UNABLE TO DETERMINE THE SET IS NOT THE SET BEING EMPTY. `missing` is a genuine
  // absence — a registry that has never been written has no active leagues, so the
  // inferred current season alone is the honest protected set. `malformed` means the
  // container holding those leagues is corrupt, so we know nothing about which years
  // are active and must refuse rather than guess. A store failure THROWS out of
  // `readLeagueRegistry` and is caught by the caller as `registry-unreadable`, which
  // is the same fail-closed answer for the same reason.
  //
  // This mirrors the established pattern in `api/cron/season-transition`,
  // `schedule-refresh`, `rankings` and `season-rollover`, each of which resolves a
  // non-`ok` registry into a typed reason rather than an empty list.
  let registry: LeagueRegistryReadResult;
  try {
    registry = await readLeagueRegistry();
  } catch {
    return { kind: 'indeterminate', reason: 'registry-unreadable' };
  }
  if (registry.kind === 'malformed') {
    return { kind: 'indeterminate', reason: 'registry-malformed' };
  }

  const leagues = registry.kind === 'ok' ? registry.leagues : [];
  for (const league of leagues) {
    const status = league.status;
    if (status?.state === 'preseason' || status?.state === 'season') {
      protectedYears.add((status as { year: number }).year);
    }
  }
  return { kind: 'known', years: protectedYears };
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

  // PLATFORM-794: an indeterminate protected set REFUSES. The operator gets a
  // distinct code and a distinct message, because "this year is protected" and "I
  // cannot tell which years are protected" are different facts and collapsing them
  // would hide a corrupt registry behind a routine-looking refusal.
  if (protectedYears.kind === 'indeterminate') {
    return NextResponse.json(
      {
        error:
          'the league registry could not be read as a league list, so the set of active-season years cannot be determined — refusing the historical repair rather than proceeding with an unverified protected set',
        code: protectedYears.reason,
      },
      { status: 503 }
    );
  }

  if (protectedYears.years.has(year)) {
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
