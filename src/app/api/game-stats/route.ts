import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import { readPublicGameStats, toAvailabilitySummary } from '@/lib/gameStats/readAvailability';
import {
  GAME_STATS_RECOVERY_METADATA_FAILURE_CODE,
  runManualGameStatsRefresh,
  type ManualGameStatsRefreshResult,
} from '@/lib/gameStats/refreshOrchestration';
import { buildPublicWeeklyGameStats } from '@/lib/gameStats/publicProjection';
import { requireAdminRequest } from '@/lib/server/adminAuth';

export const dynamic = 'force-dynamic';

// PLATFORM-086H3: this route is a THIN shell over two boundaries — the
// provider-free public read path (`readAvailability.ts`: envelope validation,
// schema-safe projection, committed-coverage availability) and the refresh
// orchestration (`refreshOrchestration.ts`: canonical target validation,
// fenced recovery claim, ingestion, committed-state finalization). It owns
// parameter validation, authorization, the provider transport, and HTTP
// shaping — and imports NO durable mutation, status publication, recovery
// disposition, coverage reducer, or raw durable-row reader (the activation
// guard enforces that ownership).

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
    return handleAuthorizedRefresh({ year, week, seasonType });
  }

  // === Ordinary reads: CACHE-ONLY for every caller ===
  const read = await readPublicGameStats({
    year,
    week,
    seasonType,
    seasonRelation,
    now: Date.now(),
  });
  switch (read.kind) {
    case 'read-failed':
      return NextResponse.json(
        {
          error: 'game stats durable state unavailable',
          code: 'game-stats-durable-read-failed',
          detail: read.detail,
        },
        { status: 500 }
      );
    case 'invalid-envelope':
      return NextResponse.json(
        {
          error: 'game stats durable state is malformed for this partition',
          code: 'game-stats-durable-state-invalid',
          failures: read.failures,
        },
        { status: 500 }
      );
    case 'miss':
      return NextResponse.json(
        { error: 'game stats cache miss: admin refresh required', availability: read.availability },
        { status: 503 }
      );
    case 'served':
      return NextResponse.json({
        ...read.view.record,
        meta: {
          cache: 'hit',
          source: 'cfbd',
          ...(read.stale ? { stale: true } : {}),
          availability: read.availability,
          ...(Object.values(read.view.withheld).some((count) => count > 0)
            ? { withheld: read.view.withheld }
            : {}),
        },
      });
  }
}

function fetchGameTeamStats(target: {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
}): Promise<unknown> {
  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  const cfbdUrl = buildCfbdGameTeamStatsUrl(target);
  return fetchUpstreamJson<unknown>(cfbdUrl.toString(), {
    cache: 'no-store',
    timeoutMs: 12_000,
    headers: { Authorization: `Bearer ${cfbdApiKey}` },
    retry: CFBD_RETRY_POLICY,
    pacing: CFBD_PACING_POLICY,
  });
}

async function handleAuthorizedRefresh(target: {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
}) {
  const { year, week, seasonType } = target;
  let result: ManualGameStatsRefreshResult;
  try {
    result = await runManualGameStatsRefresh({
      year,
      week,
      seasonType,
      now: Date.now(),
      providerConfigured: Boolean(process.env.CFBD_API_KEY?.trim()),
      fetchPayload: fetchGameTeamStats,
    });
  } catch (error) {
    // Claim persistence or unexpected orchestration failure BEFORE or around
    // provider access — reported, never swallowed.
    return NextResponse.json(
      {
        error: 'game-stats refresh orchestration failed',
        code: 'game-stats-refresh-orchestration-failed',
        detail: error instanceof Error ? error.message : 'unknown error',
      },
      { status: 500 }
    );
  }

  switch (result.kind) {
    case 'context-unavailable':
      return NextResponse.json(
        {
          error: 'canonical schedule context unavailable for game-stats refresh',
          code: 'game-stats-schedule-read-failed',
          detail: result.detail,
        },
        { status: 500 }
      );
    case 'no-schedule':
      return NextResponse.json(
        {
          error: `no canonical schedule cached for ${year}; cache the season schedule before refreshing game stats`,
          code: 'game-stats-schedule-unavailable',
        },
        { status: 409 }
      );
    case 'no-canonical-targets':
      return NextResponse.json(
        {
          error: `week ${week} ${seasonType} ${year} has no canonical scheduled game eligible for game stats`,
          code: 'game-stats-no-canonical-targets',
          slate: result.slate,
        },
        { status: 409 }
      );
    case 'config-failure':
      return NextResponse.json(
        {
          error: 'CFBD_API_KEY not configured',
          ...(!result.statusPublication.complete
            ? { statusPublication: result.statusPublication }
            : {}),
        },
        { status: 500 }
      );
    case 'provider-failure': {
      // BOTH causes are retained: the provider failure stays the primary
      // error, and a recovery-disposition finalization failure is surfaced
      // separately with its stable code (its persistence state is uncertain —
      // the backoff bookkeeping may not have been recorded). Game-stat
      // evidence was not changed either way.
      const recoveryFailure =
        result.recovery.outcome === 'failed'
          ? {
              recoveryFailureCode: GAME_STATS_RECOVERY_METADATA_FAILURE_CODE,
              recovery: {
                outcome: result.recovery.outcome,
                // Safe summary only — the raw disposition-store cause is logged
                // by the orchestration layer, never serialized.
                summary: 'recovery-disposition finalization did not persist',
                dispositionPersistence: 'uncertain' as const,
              },
            }
          : { recovery: { outcome: result.recovery.outcome } };
      const providerStatusPublication = !result.statusPublication.complete
        ? { statusPublication: result.statusPublication }
        : {};
      if (result.error instanceof UpstreamFetchError) {
        return NextResponse.json(
          {
            error: 'upstream error',
            detail: result.error.details,
            ...providerStatusPublication,
            ...recoveryFailure,
          },
          { status: result.error.details.status ?? 502 }
        );
      }
      return NextResponse.json(
        {
          error: result.error instanceof Error ? result.error.message : 'unknown error',
          ...providerStatusPublication,
          ...recoveryFailure,
        },
        { status: 502 }
      );
    }
    case 'executed':
      break;
  }

  const { publication } = result;
  const availability = toAvailabilitySummary(publication.coverage);
  // Composite lifecycle surfaced whenever any half failed to durably record.
  const statusPublication = !publication.statusPublication.complete
    ? { statusPublication: publication.statusPublication }
    : {};
  const recovery =
    result.recovery.outcome === 'failed'
      ? {
          recoveryFailureCode: GAME_STATS_RECOVERY_METADATA_FAILURE_CODE,
          recovery: {
            outcome: result.recovery.outcome,
            summary: 'recovery-disposition finalization did not persist',
            dispositionPersistence: 'uncertain' as const,
          },
        }
      : {};

  if (publication.recorded === 'failure') {
    return NextResponse.json(
      {
        error: publication.detail,
        code: publication.code,
        availability,
        attempt: publication.attempt,
        ...statusPublication,
        ...recovery,
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
        ...statusPublication,
        ...recovery,
      },
    });
  }

  // Success / partial success / satisfied no-op: serve the COMMITTED durable
  // partition (reread by the finalize path) through the schema-safe public
  // projection, never process memory and never raw durable rows.
  const committed = publication.committed;
  if (!committed) {
    return NextResponse.json({
      year,
      week,
      seasonType,
      fetchedAt: null,
      games: [],
      meta: {
        cache: 'miss',
        source: 'cfbd',
        availability,
        attempt: publication.attempt,
        ...statusPublication,
        ...recovery,
      },
    });
  }
  const view = buildPublicWeeklyGameStats(committed, { year, week, seasonType });
  return NextResponse.json({
    ...view.record,
    meta: {
      cache: 'miss',
      source: 'cfbd',
      accepted: publication.acceptedGames,
      availability,
      attempt: publication.attempt,
      ...statusPublication,
      ...(Object.values(view.withheld).some((count) => count > 0)
        ? { withheld: view.withheld }
        : {}),
      ...recovery,
    },
  });
}
