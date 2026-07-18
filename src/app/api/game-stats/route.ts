import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import { getCachedGameStats } from '@/lib/gameStats/cache';
import { loadGameStatsIdentityResolver } from '@/lib/gameStats/identityContext';
import {
  deriveSlateExpectation,
  ingestGameStatsObservations,
  type GameStatsSlateExpectation,
} from '@/lib/gameStats/ingestion';
import {
  evaluateGameStatsPartitionCoverage,
  type GameStatsPartitionCoverage,
} from '@/lib/gameStats/partitionCoverage';
import { recordGameStatsRecoveryAttempt } from '@/lib/gameStats/recoveryDisposition';
import {
  finalizeGameStatsRefresh,
  type GameStatsRefreshPublication,
} from '@/lib/gameStats/refreshPublication';
import { toPublicWeeklyGameStats } from '@/lib/gameStats/publicProjection';
import type { DurableMergeResult } from '@/lib/gameStats/durableMerge';
import type { WeeklyGameStats } from '@/lib/gameStats/types';
import { loadCachedScheduleItems } from '@/lib/server/canonicalScheduleCache';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { weekPartitionScope } from '@/lib/providerRefreshScope';
import {
  beginProviderRefreshAttempt,
  recordProviderRefreshFailure,
} from '@/lib/server/providerRefreshStatus';

export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

function parseNonNegativeInt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return parseInt(raw, 10);
}

function parseBooleanQueryParam(raw: string | null): boolean {
  if (!raw) return false;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function seasonYearForToday(now = new Date()): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

/**
 * Structural sanity of a durable weekly record. A record that exists but is
 * not shaped like a weekly partition is CORRUPT durable state — served as a
 * real failure, never reinterpreted as a cache miss or an empty week.
 */
function isStructurallyValidRecord(record: WeeklyGameStats): boolean {
  return record !== null && typeof record === 'object' && Array.isArray(record.games);
}

/** Public availability summary derived from committed-state coverage. */
type AvailabilitySummary = {
  state: GameStatsPartitionCoverage['state'] | 'coverage-unavailable';
  satisfied?: number;
  expected?: number;
  recoverable?: number;
  manualOnly?: number;
  blocked?: number;
  absent?: number;
  pending?: number;
  deferredPlaceholders?: number;
};

function toAvailabilitySummary(coverage: GameStatsPartitionCoverage | null): AvailabilitySummary {
  if (!coverage) return { state: 'coverage-unavailable' };
  return {
    state: coverage.state,
    satisfied: coverage.satisfied.length,
    expected: coverage.expected.length,
    recoverable: coverage.recoverable.length,
    manualOnly: coverage.manualOnly.length,
    blocked: coverage.blocked.length,
    absent: coverage.absent.length,
    pending: coverage.pending.length,
    deferredPlaceholders: coverage.deferredPlaceholders,
  };
}

function durableSummary(merge: DurableMergeResult) {
  return {
    outcome: merge.outcome,
    inserted: merge.inserted.length,
    updated: merge.updated.length,
    refreshed: merge.refreshed.length,
    unchanged: merge.unchanged.length,
    stale: merge.stale.length,
    conflicts: merge.conflicts.length,
    retainedExisting: merge.retainedExisting.length,
    skippedNonPersistable: merge.skippedNonPersistable,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const yearParam = url.searchParams.get('year');
  const weekParam = url.searchParams.get('week');
  const seasonTypeParam = url.searchParams.get('seasonType');
  const bypassCache = parseBooleanQueryParam(url.searchParams.get('bypassCache'));

  const currentYear = new Date().getUTCFullYear();
  const minYear = 2001;
  const maxYear = currentYear + 1;

  let year = seasonYearForToday();
  if (yearParam != null) {
    const parsedYear = parseNonNegativeInt(yearParam);
    if (parsedYear == null || parsedYear < minYear || parsedYear > maxYear) {
      return NextResponse.json(
        {
          error: `year must be an integer between ${minYear} and ${maxYear}`,
          field: 'year',
          value: yearParam,
        },
        { status: 400 }
      );
    }
    year = parsedYear;
  }

  const week = weekParam == null ? null : parseNonNegativeInt(weekParam);
  if (weekParam != null && week === null) {
    return NextResponse.json(
      { error: 'week must be a non-negative integer', field: 'week' },
      { status: 400 }
    );
  }

  if (week === null) {
    return NextResponse.json(
      { error: 'week parameter is required for game stats', field: 'week' },
      { status: 400 }
    );
  }

  // Strict season-type validation: an absent parameter defaults to `regular`,
  // but a PROVIDED value outside the canonical pair is rejected — never
  // silently coerced onto the regular partition.
  if (
    seasonTypeParam != null &&
    seasonTypeParam !== 'regular' &&
    seasonTypeParam !== 'postseason'
  ) {
    return NextResponse.json(
      {
        error: "seasonType must be 'regular' or 'postseason'",
        field: 'seasonType',
        value: seasonTypeParam,
      },
      { status: 400 }
    );
  }
  const seasonType: CfbdSeasonType = seasonTypeParam === 'postseason' ? 'postseason' : 'regular';
  const seasonRelation =
    year >= seasonYearForToday() ? ('current' as const) : ('historical' as const);

  // Bypass (refresh) requires existing administrative authorization; parameter
  // validation above already failed before any provider access.
  if (bypassCache) {
    const adminAuthFailure = await requireAdminRequest(req);
    if (adminAuthFailure) return adminAuthFailure;
  }

  // Canonical-schedule expectation context (cache-only). Ordinary reads use it
  // for truthful availability; the authorized refresh REQUIRES it before any
  // provider access. A read failure is reported as unavailable context, never
  // as an empty registry or absent coverage.
  let expectation: GameStatsSlateExpectation | null = null;
  let identityResolver: Awaited<ReturnType<typeof loadGameStatsIdentityResolver>> | null = null;
  let expectationError: string | null = null;
  try {
    const [scheduleItems, resolver] = await Promise.all([
      loadCachedScheduleItems(year),
      loadGameStatsIdentityResolver(),
    ]);
    identityResolver = resolver;
    expectation = deriveSlateExpectation({
      scheduleItems,
      resolver,
      year,
      week,
      seasonType,
      now: Date.now(),
    });
  } catch (error) {
    expectationError = error instanceof Error ? error.message : 'unknown error';
  }

  // === Ordinary reads: CACHE-ONLY for every caller (PLATFORM-086H3) ===
  // They never trigger a provider call; provider access happens exclusively
  // through the explicit admin-authorized bypass below. Availability derives
  // from schedule-relative COMMITTED-state coverage; public output flows
  // through the projection that strips v2 persistence metadata (legacy rows
  // pass through byte-equivalent).
  if (!bypassCache) {
    let cached: WeeklyGameStats | null;
    try {
      cached = await getCachedGameStats(year, week, seasonType);
    } catch (error) {
      // A failed durable READ is not absence: corrupt or unavailable storage
      // is reported as a real failure, never as an empty week or a cache miss.
      return NextResponse.json(
        {
          error: 'game stats durable state unavailable',
          code: 'game-stats-durable-read-failed',
          detail: error instanceof Error ? error.message : 'unknown error',
        },
        { status: 500 }
      );
    }

    // Structural sanity BEFORE any coverage evaluation: a malformed partition
    // is a real failure, never classified or served.
    if (cached && !isStructurallyValidRecord(cached)) {
      return NextResponse.json(
        {
          error: 'game stats durable state is malformed for this partition',
          code: 'game-stats-durable-state-invalid',
        },
        { status: 500 }
      );
    }

    const coverage =
      expectation !== null
        ? evaluateGameStatsPartitionCoverage(expectation, cached, { seasonRelation })
        : null;
    const availability = toAvailabilitySummary(coverage);

    if (cached) {
      const age = Date.now() - new Date(cached.fetchedAt).getTime();
      const stale = !(age < CACHE_TTL_MS);
      return NextResponse.json({
        ...toPublicWeeklyGameStats(cached),
        meta: {
          cache: 'hit',
          source: 'cfbd',
          ...(stale ? { stale: true } : {}),
          availability,
        },
      });
    }

    return NextResponse.json(
      { error: 'game stats cache miss: admin refresh required', availability },
      { status: 503 }
    );
  }

  // === Authorized refresh (admin-only, explicit) ===

  // Canonical target validation BEFORE the provider fetch: statistics only
  // ever attach to games the schedule already defines with identified,
  // classification-eligible participants — and an unavailable or empty
  // context fails the refresh before quota is spent.
  if (expectation === null || identityResolver === null) {
    return NextResponse.json(
      {
        error: 'canonical schedule context unavailable for game-stats refresh',
        code: 'game-stats-schedule-read-failed',
        detail: expectationError ?? 'unknown error',
      },
      { status: 500 }
    );
  }
  if (!expectation.scheduleAvailable) {
    return NextResponse.json(
      {
        error: `no canonical schedule cached for ${year}; cache the season schedule before refreshing game stats`,
        code: 'game-stats-schedule-unavailable',
      },
      { status: 409 }
    );
  }
  if (expectation.games.size === 0) {
    // The requested partition defines no canonically-identified,
    // classification-eligible, provider-addressable (or pending) target: a
    // year with unrelated schedule rows is insufficient. Refuse before any
    // provider access, with the typed slate composition for the operator.
    return NextResponse.json(
      {
        error: `week ${week} ${seasonType} ${year} has no canonical scheduled game eligible for game stats`,
        code: 'game-stats-no-canonical-targets',
        slate: {
          deferredPlaceholders: expectation.deferredPlaceholders,
          excludedByClassification: expectation.excludedByClassification,
          disrupted: expectation.disrupted,
        },
      },
      { status: 409 }
    );
  }

  // Provider-refresh observability (PLATFORM-086A): record the manual refresh
  // attempt before credential validation and the fetch, so a missing-key early
  // return still resolves a recorded failed attempt. Success is recorded only
  // after the durable merge authority confirms a committed outcome AND the
  // committed partition has been reread and coverage-evaluated.
  const gameStatsScope = weekPartitionScope(year, week, seasonType);
  const attempt = await beginProviderRefreshAttempt('game-stats', gameStatsScope, {
    startedAt: new Date().toISOString(),
  });

  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    await recordProviderRefreshFailure('game-stats', gameStatsScope, {
      attempt,
      error: 'CFBD_API_KEY not configured',
      code: 'cfbd-api-key-missing',
      status: 500,
    });
    return NextResponse.json({ error: 'CFBD_API_KEY not configured' }, { status: 500 });
  }

  const recordDisposition = async (publication: GameStatsRefreshPublication): Promise<void> => {
    try {
      await recordGameStatsRecoveryAttempt({
        year,
        week,
        seasonType,
        reason: publication.dispositionReason,
        meaningfulChange: publication.meaningfulChange,
        now: Date.now(),
      });
    } catch (error) {
      console.error('game-stats recovery disposition write failed', {
        year,
        week,
        seasonType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  try {
    // Observation fence: when THIS provider fetch started.
    const fetchStartedAt = new Date().toISOString();
    const cfbdUrl = buildCfbdGameTeamStatsUrl({ year, week, seasonType });
    const rawGames = await fetchUpstreamJson<unknown>(cfbdUrl.toString(), {
      cache: 'no-store',
      timeoutMs: 12_000,
      headers: { Authorization: `Bearer ${cfbdApiKey}` },
      retry: CFBD_RETRY_POLICY,
      pacing: CFBD_PACING_POLICY,
    });

    const ingestion = await ingestGameStatsObservations({
      year,
      week,
      seasonType,
      fetchStartedAt,
      payload: rawGames,
      expectation,
      resolver: identityResolver,
    });

    // Committed-state finalization: durable merge → confirmed commit →
    // durable reread → coverage evaluation → refresh-status publication —
    // strictly in that order — then the HTTP response below.
    const publication = await finalizeGameStatsRefresh({
      ingestion,
      expectation,
      seasonRelation,
      scope: gameStatsScope,
      attempt,
      contextLabel: `week ${week} ${seasonType}`,
    });
    await recordDisposition(publication);

    const availability = toAvailabilitySummary(publication.coverage);
    const durable = ingestion.kind === 'merged' ? durableSummary(ingestion.merge) : undefined;

    if (publication.recorded === 'failure') {
      return NextResponse.json(
        {
          error: publication.detail,
          code: publication.code,
          ...(durable ? { durable } : {}),
          availability,
        },
        { status: publication.httpStatus }
      );
    }

    if (publication.recorded === 'noop' && publication.reread === 'skipped') {
      // Valid EXPECTED-empty provider response: nothing is expected yet.
      return NextResponse.json({
        year,
        week,
        seasonType,
        fetchedAt: null,
        games: [],
        meta: {
          cache: 'miss',
          source: 'cfbd',
          noApplicableData: true,
          emptyContext: 'expected',
          availability,
        },
      });
    }

    // Success / partial success / satisfied no-op: serve the COMMITTED
    // durable partition (reread by the finalize path), never process memory.
    const committed = publication.committed;
    if (!committed) {
      return NextResponse.json({
        year,
        week,
        seasonType,
        fetchedAt: null,
        games: [],
        meta: { cache: 'miss', source: 'cfbd', ...(durable ? { durable } : {}), availability },
      });
    }
    return NextResponse.json({
      ...toPublicWeeklyGameStats(committed),
      meta: { cache: 'miss', source: 'cfbd', ...(durable ? { durable } : {}), availability },
    });
  } catch (error) {
    await recordProviderRefreshFailure('game-stats', gameStatsScope, {
      attempt,
      error: error instanceof Error ? error.message : 'unknown error',
      status: error instanceof UpstreamFetchError ? (error.details.status ?? 502) : 502,
    });
    if (error instanceof UpstreamFetchError) {
      return NextResponse.json(
        { error: 'upstream error', detail: error.details },
        { status: error.details.status ?? 502 }
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'unknown error' },
      { status: 502 }
    );
  }
}
