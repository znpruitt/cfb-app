import { NextResponse } from 'next/server';

import { fetchCfbdUsage } from '@/lib/api/cfbdUsage';
import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import { GAME_STATS_SCOPE, getGameStatsKey } from '@/lib/gameStats/cache';
import { loadCanonicalGameStatsSlate } from '@/lib/gameStats/canonicalSlate';
import type { SeasonRelation } from '@/lib/gameStats/contract';
import { ingestGameStatsPartitionResponse } from '@/lib/gameStats/ingestionCoordinator';
import {
  projectPublicPartition,
  type DurableReadOutcome,
  type PublicProjectionResult,
} from '@/lib/gameStats/publicProjection';
import {
  evaluateManualQuota,
  type CfbdUsageSnapshot,
} from '@/lib/gameStats/quotaPolicy';
import {
  interpretGameStatsRefreshOutcome,
  type GameStatsRefreshInterpretation,
} from '@/lib/gameStats/refreshOutcome';
import { requireAdminRequest } from '@/lib/server/adminAuth';
import { getAppState } from '@/lib/server/appStateStore';
import { weekPartitionScope } from '@/lib/providerRefreshScope';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
} from '@/lib/server/providerRefreshStatus';

export const dynamic = 'force-dynamic';

/**
 * PLATFORM-086H3E3 — the activated game-stats route.
 *
 * EVERY request is admin-only, authenticated BEFORE query validation, store
 * reads, credential checks, or provider access. Ordinary reads are cache-only
 * and provider-free regardless of cache age or absence, and the response is
 * built ONLY through the public projector (allowlisted wire — persisted rows
 * are never spread, internal H2/C2 metadata never leaks). Provider access
 * happens only for an explicit `bypassCache=1` manual refresh, which flows
 * through the ONE ingestion path (`ingestGameStatsPartitionResponse`) and the
 * ONE outcome interpreter, then re-reads the exact durable partition — the
 * response always reflects the durable reread, never the request payload or an
 * assumed merge result. The legacy writer is gone from this route.
 */

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

/** Raw durable read for the projector — the stored value proves nothing. */
async function readDurablePartition(
  year: number,
  week: number,
  seasonType: CfbdSeasonType
): Promise<DurableReadOutcome> {
  try {
    const record = await getAppState<unknown>(
      GAME_STATS_SCOPE,
      getGameStatsKey(year, week, seasonType)
    );
    return { status: 'ok', value: record?.value ?? null };
  } catch {
    return { status: 'read-failed' };
  }
}

/** Map every non-available projection status to a distinct safe response. */
function projectionErrorResponse(projection: Exclude<PublicProjectionResult, { status: 'available' }>) {
  switch (projection.status) {
    case 'absent':
      return NextResponse.json(
        { error: 'no game stats stored for this partition', code: 'game-stats-absent' },
        { status: 404 }
      );
    case 'read-failure':
      return NextResponse.json(
        { error: 'durable game-stats read failed', code: 'game-stats-read-failure' },
        { status: 503 }
      );
    case 'context-unavailable':
      return NextResponse.json(
        {
          error: 'canonical schedule context unavailable',
          code: 'game-stats-context-unavailable',
          reason: projection.reason,
        },
        { status: 503 }
      );
    case 'malformed-envelope':
    case 'partition-mismatch':
    case 'invalid-fetched-at':
    case 'non-array-games':
      return NextResponse.json(
        { error: 'stored game-stats record is not servable', code: `game-stats-${projection.status}` },
        { status: 500 }
      );
  }
}

/** Safe, allowlisted refresh metadata — counts and stable codes only. */
function refreshMeta(
  interpretation: GameStatsRefreshInterpretation,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    outcome: interpretation.kind,
    reason: interpretation.reason,
    ...extra,
  };
}

export async function GET(req: Request) {
  // Admin-first: an unauthenticated malformed request still fails auth first.
  const adminAuthFailure = await requireAdminRequest(req);
  if (adminAuthFailure) return adminAuthFailure;

  const url = new URL(req.url);
  const yearParam = url.searchParams.get('year');
  const weekParam = url.searchParams.get('week');
  const seasonTypeParam = url.searchParams.get('seasonType');
  const bypassCache = parseBooleanQueryParam(url.searchParams.get('bypassCache'));
  const quotaOverride = parseBooleanQueryParam(url.searchParams.get('quotaOverride'));

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const minYear = 2001;
  const maxYear = currentYear + 1;

  let year = seasonYearForToday(now);
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

  // `week` is the CFBD/provider partition week — postseason included; canonical
  // postseason week is never substituted.
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

  // Strict season type: only the two provider partitions exist. Absent defaults
  // to `regular`; any OTHER present value is rejected, never coerced.
  let seasonType: CfbdSeasonType;
  if (seasonTypeParam === null || seasonTypeParam === 'regular') {
    seasonType = 'regular';
  } else if (seasonTypeParam === 'postseason') {
    seasonType = 'postseason';
  } else {
    return NextResponse.json(
      {
        error: "seasonType must be 'regular' or 'postseason'",
        field: 'seasonType',
        value: seasonTypeParam,
      },
      { status: 400 }
    );
  }

  const seasonRelation: SeasonRelation = year < seasonYearForToday(now) ? 'historical' : 'current';

  // === Ordinary read: cache-only, provider-free, projector-only. ===
  if (!bypassCache) {
    const slateResult = await loadCanonicalGameStatsSlate({ year, now });
    const read = await readDurablePartition(year, week, seasonType);
    const projection = projectPublicPartition(slateResult, week, seasonType, read, seasonRelation);
    if (projection.status !== 'available') return projectionErrorResponse(projection);
    return NextResponse.json({
      ...projection.wire,
      meta: { source: 'durable', projection: 'public' },
    });
  }

  // === Authenticated manual refresh. The exact (year, providerWeek,
  // seasonType) scope is known — begin exactly ONE attempt BEFORE credential
  // validation or any usage/provider request. ===
  const gameStatsScope = weekPartitionScope(year, week, seasonType);
  const attempt = await beginProviderRefreshAttempt('game-stats', gameStatsScope, {
    startedAt: new Date().toISOString(),
  });

  // Quota gate (PLATFORM-086H3E2 policy): provider-reported usage is the
  // truth; unknown usage is never fabricated in either direction. A refusal
  // resolves the attempt exactly once as a truthful failure and returns 429 —
  // the explicit `quotaOverride=1` parameter (in addition to `bypassCache=1`)
  // is the only way past it.
  let usageSnapshot: CfbdUsageSnapshot;
  try {
    const usage = await fetchCfbdUsage();
    usageSnapshot = { remainingCalls: usage.remaining, monthlyLimit: usage.limit };
  } catch {
    usageSnapshot = { remainingCalls: null };
  }
  const quota = evaluateManualQuota(usageSnapshot, quotaOverride);
  if (quota.kind === 'refused') {
    await recordProviderRefreshFailure('game-stats', gameStatsScope, {
      attempt,
      error: `manual refresh refused by quota policy: ${quota.reason}`,
      code: `game-stats-quota-${quota.reason}`,
      status: quota.httpStatus,
    });
    return NextResponse.json(
      {
        error: 'manual refresh refused by quota policy',
        code: `game-stats-quota-${quota.reason}`,
        remaining: quota.remaining,
        quotaOverride: false,
      },
      { status: quota.httpStatus }
    );
  }

  // Credential validation AFTER the attempt + quota gate, BEFORE provider access.
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

  try {
    // The observation fence is captured BEFORE provider access.
    const fetchStartedAt = new Date().toISOString();
    const cfbdUrl = buildCfbdGameTeamStatsUrl({ year, week, seasonType });
    const payload = await fetchUpstreamJson<unknown>(cfbdUrl.toString(), {
      cache: 'no-store',
      timeoutMs: 12_000,
      headers: { Authorization: `Bearer ${cfbdApiKey}` },
      retry: CFBD_RETRY_POLICY,
      pacing: CFBD_PACING_POLICY,
    });

    // The ONE ingestion path and the ONE interpreter — no legacy classifier,
    // no direct merge call, no policy re-derivation.
    const result = await ingestGameStatsPartitionResponse({
      year,
      week,
      seasonType,
      fetchStartedAt,
      payload,
    });
    const interpretation = interpretGameStatsRefreshOutcome(result);

    // Resolve the attempt exactly once per the interpreter's verdict. Only a
    // confirmed durable commit advances last-success metadata.
    if (interpretation.advanceLastSuccess) {
      const merge = result.kind === 'merge-result' ? result.merge : null;
      const committedGames = merge
        ? merge.inserted.length + merge.updated.length + merge.refreshed.length
        : 0;
      await recordProviderRefreshSuccess('game-stats', gameStatsScope, {
        attempt,
        committedAt: new Date().toISOString(),
        commitSeq: nextProviderCommitSeq(),
        source: 'cfbd',
        rowsCommitted: committedGames,
        ...(interpretation.partialFailure ? { partialFailure: true } : {}),
      });
    } else if (interpretation.kind === 'no-op') {
      await recordProviderRefreshNoop('game-stats', gameStatsScope, { attempt, source: 'cfbd' });
    } else {
      await recordProviderRefreshFailure('game-stats', gameStatsScope, {
        attempt,
        error: `game-stats refresh failed: ${interpretation.reason}`,
        code: `game-stats-${interpretation.reason}`,
        status: interpretation.httpStatus,
      });
    }

    // Durable REREAD: every response reflects the exact durable partition, not
    // the request payload or an assumed merge result — including after
    // `indeterminate`, where durability is unknown and no success is inferred.
    const read = await readDurablePartition(year, week, seasonType);
    const slateResult = await loadCanonicalGameStatsSlate({ year, now });
    const projection = projectPublicPartition(slateResult, week, seasonType, read, seasonRelation);

    const quotaMeta =
      quota.kind === 'allowed-with-override'
        ? { quotaOverride: true, quotaReason: quota.reason, remaining: quota.remaining }
        : { quotaOverride: false, remaining: quota.remaining };

    if (interpretation.kind === 'failure') {
      return NextResponse.json(
        {
          error: `game-stats refresh failed: ${interpretation.reason}`,
          code: `game-stats-${interpretation.reason}`,
          refresh: refreshMeta(interpretation, quotaMeta),
        },
        { status: interpretation.httpStatus }
      );
    }

    if (projection.status !== 'available') {
      // The refresh itself succeeded or was a no-op, but the durable reread is
      // not servable — report the projection outcome distinctly, never the
      // request payload.
      const errorResponse = projectionErrorResponse(projection);
      const body = (await errorResponse.json()) as Record<string, unknown>;
      return NextResponse.json(
        { ...body, refresh: refreshMeta(interpretation, quotaMeta) },
        { status: errorResponse.status }
      );
    }

    return NextResponse.json({
      ...projection.wire,
      meta: {
        source: 'durable',
        projection: 'public',
        refresh: refreshMeta(interpretation, quotaMeta),
      },
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
