import { NextResponse } from 'next/server';

import { fetchCfbdUsage } from '@/lib/api/cfbdUsage';
import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGameTeamStatsUrl, type CfbdSeasonType } from '@/lib/cfbd';
import { GAME_STATS_SCOPE, getGameStatsKey } from '@/lib/gameStats/cache';
import { ingestGameStatsPartitionResponse } from '@/lib/gameStats/ingestionCoordinator';
import {
  loadCanonicalGameStatsSlate,
  type CanonicalSlateResult,
} from '@/lib/gameStats/canonicalSlate';
import {
  listKickoffWindowPartitions,
  pollingPartitionKey,
  selectPollingTarget,
  type PollingTarget,
} from '@/lib/gameStats/pollingTarget';
import { projectPublicPartition } from '@/lib/gameStats/publicProjection';
import {
  evaluateAutomationQuota,
  type CfbdUsageSnapshot,
} from '@/lib/gameStats/quotaPolicy';
import { interpretGameStatsRefreshOutcome } from '@/lib/gameStats/refreshOutcome';
import { getAppState } from '@/lib/server/appStateStore';
import { isAutoRefreshAllowed } from '@/lib/server/providerRefreshSettings';
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
 * PLATFORM-086H3E3 — the activated 15-minute game-stats cron.
 *
 * Bounded kickoff-window polling (PLATFORM-086H3E2 policy, NOT score-gated):
 * the current season's slate is derived cache-only; a partition is a candidate
 * while it holds a stat-applicable game aged [3h, 24h) past kickoff whose
 * evidence is not yet satisfied; at most ONE partition is fetched per run,
 * chosen by earliest unresolved eligible kickoff. If automation is paused,
 * context is unavailable, the quota reserve refuses, or no target exists,
 * there is NO provider call — and with no exact target, no scoped attempt is
 * ever begun. One attempt begins after the target is resolved and BEFORE
 * credential validation or any usage/provider request; a quota refusal
 * resolves it exactly once as a truthful failure. Ingestion flows through the
 * ONE coordinator and the ONE interpreter, then the exact durable partition is
 * reread. No recovery sweeps, claims, leases, backoff, disposition stores, or
 * same-run retries — and no score automation.
 */

const RETRY_POLICY = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 4_000,
  jitterRatio: 0.2,
  retryOnHttpStatuses: [408, 429, 500, 502, 503, 504],
} as const;

const PACING_POLICY = {
  key: 'cfbd',
  minIntervalMs: 150,
} as const;

type CronResult = {
  year: number;
  week: number | null;
  seasonType: CfbdSeasonType | null;
  outcome: string | null;
  reason: string | null;
  committedGames: number;
  skipped?: string;
  error?: string;
};

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

function seasonYearForToday(now = new Date()): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

function skippedResult(year: number, skipped: string): CronResult {
  return {
    year,
    week: null,
    seasonType: null,
    outcome: null,
    reason: null,
    committedGames: 0,
    skipped,
  };
}

/**
 * Resolve the single approved fetch target for this run, cache-only. `null`
 * means no candidate partition exists right now (fully resolved, out of
 * window, or no games) — never an error.
 */
async function resolvePollingTarget(year: number, now: Date): Promise<
  | { status: 'ok'; target: PollingTarget | null; slateResult: CanonicalSlateResult }
  | { status: 'context-unavailable'; reason: string }
> {
  const slateResult = await loadCanonicalGameStatsSlate({ year, now });
  if (slateResult.status === 'unavailable') {
    return { status: 'context-unavailable', reason: slateResult.reason };
  }

  // Phase 1: which partitions even have window games; Phase 2 needs their
  // committed records, read cache-only and validated inside the selector.
  const refs = listKickoffWindowPartitions(slateResult.slate, now);
  const recordsByPartition = new Map<string, unknown>();
  for (const ref of refs) {
    try {
      const record = await getAppState<unknown>(
        GAME_STATS_SCOPE,
        getGameStatsKey(ref.year, ref.week, ref.seasonType)
      );
      recordsByPartition.set(pollingPartitionKey(ref), record?.value ?? null);
    } catch {
      // A failed read resolves nothing — the selector treats the partition as
      // absent, which fails toward polling, bounded by the finite window.
      recordsByPartition.set(pollingPartitionKey(ref), null);
    }
  }

  const target = selectPollingTarget({
    slate: slateResult.slate,
    now,
    seasonRelation: 'current',
    recordsByPartition,
  });
  return { status: 'ok', target, slateResult };
}

export async function GET(req: Request) {
  // CRON_SECRET first — fail closed with distinct configuration errors.
  const auth = verifyCronSecret(req);
  if (auth !== 'ok') {
    return NextResponse.json(
      {
        error:
          auth === 'not-configured'
            ? 'CRON_SECRET is not configured; scheduled game-stats refresh is disabled'
            : 'invalid cron authorization',
      },
      { status: 401 }
    );
  }

  const now = new Date();
  const year = seasonYearForToday(now);

  // Operator pause — before target selection, so no scoped attempt exists.
  if (!(await isAutoRefreshAllowed('game-stats'))) {
    return NextResponse.json(
      skippedResult(year, 'automatic game-stats refresh is paused or disabled')
    );
  }

  // Resolve the exact target BEFORE any credential/usage/provider concern.
  const resolution = await resolvePollingTarget(year, now);
  if (resolution.status === 'context-unavailable') {
    return NextResponse.json(
      skippedResult(year, `canonical context unavailable: ${resolution.reason}`)
    );
  }
  if (resolution.target === null) {
    // No exact target → no scoped attempt, no usage check, no provider call.
    return NextResponse.json(skippedResult(year, 'no partition inside the polling window'));
  }

  const { week, seasonType } = resolution.target;
  const weekScope = weekPartitionScope(year, week, seasonType);
  const attempt = await beginProviderRefreshAttempt('game-stats', weekScope, {
    startedAt: new Date().toISOString(),
  });

  // Quota reserve (PLATFORM-086H3E2 policy): provider-reported usage only,
  // checked ONLY once a target exists. Unknown or below-reserve usage resolves
  // the attempt as a truthful failure — never fabricated either direction.
  let usageSnapshot: CfbdUsageSnapshot;
  try {
    const usage = await fetchCfbdUsage();
    usageSnapshot = { remainingCalls: usage.remaining, monthlyLimit: usage.limit };
  } catch {
    usageSnapshot = { remainingCalls: null };
  }
  const quota = evaluateAutomationQuota(usageSnapshot);
  if (quota.kind === 'refused') {
    await recordProviderRefreshFailure('game-stats', weekScope, {
      attempt,
      error: `scheduled refresh refused by quota policy: ${quota.reason}`,
      code: `game-stats-quota-${quota.reason}`,
    });
    return NextResponse.json({
      year,
      week,
      seasonType,
      outcome: 'failure',
      reason: `quota-${quota.reason}`,
      committedGames: 0,
      remaining: quota.remaining,
    } satisfies CronResult & { remaining: number | null });
  }

  // Credential validation after target + quota, before provider access.
  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    await recordProviderRefreshFailure('game-stats', weekScope, {
      attempt,
      error: 'CFBD_API_KEY not configured',
      code: 'cfbd-api-key-missing',
      status: 500,
    });
    return NextResponse.json(
      { ...skippedResult(year, ''), skipped: undefined, error: 'CFBD_API_KEY not configured' },
      { status: 500 }
    );
  }

  try {
    // Observation fence before provider access; at most ONE partition fetch.
    const fetchStartedAt = new Date().toISOString();
    const cfbdUrl = buildCfbdGameTeamStatsUrl({ year, week, seasonType });
    const payload = await fetchUpstreamJson<unknown>(cfbdUrl.toString(), {
      cache: 'no-store',
      timeoutMs: 12_000,
      headers: { Authorization: `Bearer ${cfbdApiKey}` },
      retry: RETRY_POLICY,
      pacing: PACING_POLICY,
    });

    const result = await ingestGameStatsPartitionResponse({
      year,
      week,
      seasonType,
      fetchStartedAt,
      payload,
    });
    const interpretation = interpretGameStatsRefreshOutcome(result);

    let committedGames = 0;
    if (interpretation.advanceLastSuccess) {
      const merge = result.kind === 'merge-result' ? result.merge : null;
      committedGames = merge
        ? merge.inserted.length + merge.updated.length + merge.refreshed.length
        : 0;
      await recordProviderRefreshSuccess('game-stats', weekScope, {
        attempt,
        committedAt: new Date().toISOString(),
        commitSeq: nextProviderCommitSeq(),
        source: 'cfbd',
        rowsCommitted: committedGames,
        ...(interpretation.partialFailure ? { partialFailure: true } : {}),
      });
    } else if (interpretation.kind === 'no-op') {
      await recordProviderRefreshNoop('game-stats', weekScope, { attempt, source: 'cfbd' });
    } else {
      await recordProviderRefreshFailure('game-stats', weekScope, {
        attempt,
        error: `scheduled game-stats refresh failed: ${interpretation.reason}`,
        code: `game-stats-${interpretation.reason}`,
        status: interpretation.httpStatus,
      });
    }

    // Durable REREAD — downstream truth is the durable partition, never the
    // payload or an assumed merge result. The run report's availability comes
    // from projecting the reread; no success inference, no same-run retry
    // (indeterminate stays a failure until a later run observes it).
    let read: { status: 'ok'; value: unknown } | { status: 'read-failed' };
    try {
      const record = await getAppState<unknown>(
        GAME_STATS_SCOPE,
        getGameStatsKey(year, week, seasonType)
      );
      read = { status: 'ok', value: record?.value ?? null };
    } catch {
      read = { status: 'read-failed' };
    }
    const projection = projectPublicPartition(
      resolution.slateResult,
      week,
      seasonType,
      read,
      'current'
    );

    return NextResponse.json(
      {
        year,
        week,
        seasonType,
        outcome: interpretation.kind,
        reason: interpretation.reason,
        committedGames,
        durable:
          projection.status === 'available'
            ? { status: 'available', availability: projection.wire.availability }
            : { status: projection.status },
      } satisfies CronResult & { durable: unknown },
      { status: interpretation.kind === 'failure' ? interpretation.httpStatus : 200 }
    );
  } catch (error) {
    await recordProviderRefreshFailure('game-stats', weekScope, {
      attempt,
      error: error instanceof Error ? error.message : 'unknown error',
      status: error instanceof UpstreamFetchError ? (error.details.status ?? 502) : 500,
    });
    return NextResponse.json(
      {
        year,
        week,
        seasonType,
        outcome: 'failure',
        reason: 'provider-fetch-failed',
        committedGames: 0,
        error: error instanceof Error ? error.message : 'unknown error',
      } satisfies CronResult,
      { status: 500 }
    );
  }
}
