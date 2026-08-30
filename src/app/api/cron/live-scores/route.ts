import { NextResponse } from 'next/server';

import { fetchCfbdUsage } from '@/lib/api/cfbdUsage';
import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';
import { buildCfbdGamesUrl, buildCfbdScoreboardUrl } from '@/lib/cfbd';
import { evaluateAutomationQuota, type CfbdUsageSnapshot } from '@/lib/gameStats/quotaPolicy';
import { loadLiveScoreContext, type LiveScoreContext } from '@/lib/liveScores/canonicalContext';
import {
  createLiveScoresCronExecutionState,
  emitLiveScoresCronExecutionEvent,
  type LiveScoresCronExecutionReason,
  type LiveScoresCronExecutionResult,
  type LiveScoresCronExecutionState,
} from '@/lib/liveScores/cronExecutionLog';
import { parseFinalReconciliation } from '@/lib/liveScores/finalReconciliation';
import {
  partitionKey,
  selectPollingPlan,
  type PartitionRef,
  type PollingPlan,
} from '@/lib/liveScores/pollingTarget';
import { matchScoreboardRows } from '@/lib/liveScores/scoreboardMatch';
import { normalizeScoreboardPayload } from '@/lib/liveScores/scoreboardPayload';
import { mergeScoresIntoPartition } from '@/lib/liveScores/scoreMerge';
import { weekPartitionScope, type ProviderRefreshScope } from '@/lib/providerRefreshScope';
import { seasonYearForToday } from '@/lib/scores/normalizers';
import { getLeagues } from '@/lib/leagueRegistry';
import { invalidateStandings } from '@/lib/selectors/leagueStandings';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
  type ProviderRefreshAttempt,
} from '@/lib/server/providerRefreshStatus';
import { isAutoRefreshAllowed } from '@/lib/server/providerRefreshSettings';
import {
  createSchedulerInvocationId,
  scheduleSchedulerExecutionReceipt,
} from '@/lib/server/schedulerExecutionStatus';

export const dynamic = 'force-dynamic';

/**
 * PLATFORM-086B1 — schedule-armed live-score polling engine (DORMANT).
 *
 * Production-capable but unscheduled: after this ships NO scheduler invokes it.
 * PLATFORM-086B2 activates the QStash schedule + cache-only browser refresh.
 *
 * One invocation resolves a cache-only canonical context, selects a single
 * deterministic polling plan, and performs AT MOST ONE billed provider request
 * (a global `/scoreboard` OR one partition `/games`) plus one `/info` quota
 * probe. The schedule is the sole game-identity authority; `/scoreboard` only
 * enriches schedule-owned games. Every begun scoped attempt is resolved exactly
 * once, standings invalidate once per run only on a durable change, and the
 * single `finally` emits exactly one secret-safe runtime event.
 */

// ONE provider request per run — no transport retries (recovery across runs is
// the polling window's job).
const RETRY_POLICY = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitterRatio: 0,
  retryOnHttpStatuses: [],
} as const;

// PLATFORM-115: opening-slate CFBD latency was measured in the 8-25s band,
// with one request still running beyond 30s. Forty seconds clears that band
// and the observed outlier while remaining well inside the three-minute poll
// cadence. RETRY_POLICY stays at one attempt, so the billed-call ceiling does
// not change.
const CFBD_REQUEST_TIMEOUT_MS = 40_000;

const PACING_POLICY = { key: 'cfbd', minIntervalMs: 150 } as const;

/** Reasons whose HTTP status is 500 (provider/durable/payload faults). */
const HTTP_500_REASONS = new Set<LiveScoresCronExecutionReason>([
  'cfbd-api-key-missing',
  'provider-fetch-failed',
  'durable-commit-failed',
  'scoreboard-invalid-payload',
  'scoreboard-schema-drift',
  'scoreboard-empty-unexpected',
  'final-reconciliation-invalid-payload',
  'final-reconciliation-empty-unexpected',
]);

type PartitionAttempt = {
  partition: PartitionRef;
  scope: ProviderRefreshScope;
  attempt: ProviderRefreshAttempt;
};

function verifyCronSecret(req: Request): 'ok' | 'not-configured' | 'invalid' {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret) return 'not-configured';
  const authHeader = req.headers.get('authorization') ?? '';
  return authHeader === `Bearer ${cronSecret}` ? 'ok' : 'invalid';
}

function jsonResponse(exec: LiveScoresCronExecutionState) {
  const status = HTTP_500_REASONS.has(exec.reason) ? 500 : 200;
  return NextResponse.json(
    {
      result: exec.result,
      reason: exec.reason,
      year: exec.year,
      mode: exec.mode,
      targetGames: exec.targetGames,
      targetPartitions: exec.targetPartitions,
      committedGames: exec.committedGames,
    },
    { status }
  );
}

function skip(exec: LiveScoresCronExecutionState, reason: LiveScoresCronExecutionReason) {
  exec.result = 'skipped';
  exec.reason = reason;
  return jsonResponse(exec);
}

function finalize(
  exec: LiveScoresCronExecutionState,
  result: LiveScoresCronExecutionResult,
  reason: LiveScoresCronExecutionReason,
  committedGames: number
) {
  exec.result = result;
  exec.reason = reason;
  exec.committedGames = committedGames;
  return jsonResponse(exec);
}

/** Resolve EVERY begun attempt as a truthful failure (quota/credential/fetch). */
async function failAllAttempts(
  attempts: PartitionAttempt[],
  error: string,
  code: string
): Promise<void> {
  await Promise.all(
    attempts.map((pa) =>
      recordProviderRefreshFailure('scores', pa.scope, { attempt: pa.attempt, error, code })
    )
  );
}

/**
 * Invalidate canonical standings for every league at `year`. Scores are
 * season-scoped, not league-scoped, so we walk the registry. Failures are
 * swallowed so a registry read error does not roll back a successful write.
 */
async function invalidateStandingsForYear(year: number): Promise<void> {
  try {
    const leagues = await getLeagues();
    for (const league of leagues) invalidateStandings(league.slug, year);
  } catch {
    // Non-fatal — scores already persisted; canonical refreshes on next turnover.
  }
}

export async function GET(req: Request) {
  const startedAtMs = Date.now();
  const now = new Date();
  const year = seasonYearForToday(now);
  const exec = createLiveScoresCronExecutionState(year);
  // PLATFORM-086F2E1 — receipt identity, created ONLY after successful cron
  // authentication (never inferred from the final result/reason). Null means
  // no durable receipt is scheduled for this invocation.
  let receiptInvocationId: string | null = null;

  try {
    // CRON_SECRET first — fail closed with distinct configuration errors. No
    // context/provider/status work happens on an auth failure.
    const auth = verifyCronSecret(req);
    if (auth !== 'ok') {
      exec.result = 'failure';
      exec.reason =
        auth === 'not-configured' ? 'cron-secret-not-configured' : 'cron-authorization-invalid';
      return NextResponse.json(
        {
          error:
            auth === 'not-configured'
              ? 'CRON_SECRET is not configured; scheduled live-score polling is disabled'
              : 'invalid cron authorization',
        },
        { status: 401 }
      );
    }
    receiptInvocationId = createSchedulerInvocationId();

    // Operator pause — before target selection, so no scoped attempt exists.
    if (!(await isAutoRefreshAllowed('scores'))) {
      return skip(exec, 'automation-paused-or-disabled');
    }

    // Cache-only canonical context. A read/build failure is unavailable context,
    // never absent data.
    const contextResult = await loadLiveScoreContext({ year, now });
    if (contextResult.status === 'unavailable') {
      return skip(exec, 'canonical-context-unavailable');
    }

    // Deterministic target selection (pure). No exact target → no scoped attempt,
    // no usage check, no provider call.
    const plan = selectPollingPlan(contextResult.context, now);
    if (plan.mode === 'none') {
      return skip(exec, 'no-polling-target');
    }

    exec.mode = plan.mode;
    const partitions: PartitionRef[] =
      plan.mode === 'scoreboard' ? plan.partitions : [plan.partition];
    exec.targetPartitions = partitions.length;
    exec.targetGames = plan.mode === 'scoreboard' ? plan.targets.length : plan.pendingGames.length;

    // Begin one exact scoped attempt per targeted partition BEFORE any quota,
    // credential, or provider work.
    const partitionAttempts: PartitionAttempt[] = await Promise.all(
      partitions.map(async (partition) => {
        const scope = weekPartitionScope(partition.year, partition.week, partition.seasonType);
        const attempt = await beginProviderRefreshAttempt('scores', scope, {
          startedAt: new Date().toISOString(),
        });
        return { partition, scope, attempt };
      })
    );

    // Quota reserve — FRESH usage, checked ONLY once a target exists. Fail closed
    // on unknown or below-reserve usage.
    exec.quotaChecked = true;
    let usageSnapshot: CfbdUsageSnapshot;
    try {
      const usage = await fetchCfbdUsage({ fresh: true });
      usageSnapshot = { remainingCalls: usage.remaining, monthlyLimit: usage.limit };
    } catch {
      usageSnapshot = { remainingCalls: null };
    }
    const quota = evaluateAutomationQuota(usageSnapshot);
    if (quota.kind === 'refused') {
      await failAllAttempts(
        partitionAttempts,
        `scheduled live-score refresh refused by quota policy: ${quota.reason}`,
        `scores-quota-${quota.reason}`
      );
      return finalize(exec, 'failure', `quota-${quota.reason}`, 0);
    }

    // Credential validation after target + quota, before provider access.
    const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
    if (!cfbdApiKey) {
      await failAllAttempts(
        partitionAttempts,
        'CFBD_API_KEY not configured',
        'cfbd-api-key-missing'
      );
      return finalize(exec, 'failure', 'cfbd-api-key-missing', 0);
    }

    // The billed provider request is about to run (exactly one).
    exec.providerCallAttempted = true;
    return plan.mode === 'scoreboard'
      ? await runScoreboard({
          plan,
          context: contextResult.context,
          partitionAttempts,
          cfbdApiKey,
          year,
          now,
          exec,
        })
      : await runFinalReconciliation({
          plan,
          context: contextResult.context,
          partitionAttempts,
          cfbdApiKey,
          year,
          now,
          exec,
        });
  } finally {
    // The ONLY emission point — best-effort; cannot alter the response or mask a
    // throw. On an unexpected throw `exec` still holds `failure / unexpected-error`.
    emitLiveScoresCronExecutionEvent(exec, startedAtMs);
    // PLATFORM-086F2E1 — one latest-only durable receipt per AUTHENTICATED
    // invocation, scheduled post-response. Result/reason/provider truth are the
    // tracker's verbatim; best-effort, so it can neither change the response
    // nor mask a propagating throw.
    if (receiptInvocationId !== null) {
      scheduleSchedulerExecutionReceipt({
        job: 'live-scores',
        invocationId: receiptInvocationId,
        startedAtMs,
        result: exec.result,
        reason: exec.reason,
        providerCallAttempted: exec.providerCallAttempted,
        target: {
          kind: 'live-scores',
          year: exec.year,
          mode: exec.mode,
          targetGames: exec.targetGames,
          targetPartitions: exec.targetPartitions,
        },
      });
    }
  }
}

async function runScoreboard(args: {
  plan: Extract<PollingPlan, { mode: 'scoreboard' }>;
  context: LiveScoreContext;
  partitionAttempts: PartitionAttempt[];
  cfbdApiKey: string;
  year: number;
  now: Date;
  exec: LiveScoresCronExecutionState;
}) {
  const { plan, context, partitionAttempts, cfbdApiKey, year, now, exec } = args;

  let payload: unknown;
  try {
    const url = buildCfbdScoreboardUrl({ classification: 'fbs' });
    payload = await fetchUpstreamJson<unknown>(url.toString(), {
      cache: 'no-store',
      timeoutMs: CFBD_REQUEST_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${cfbdApiKey}` },
      retry: RETRY_POLICY,
      pacing: PACING_POLICY,
    });
  } catch (error) {
    await failAllAttempts(
      partitionAttempts,
      error instanceof UpstreamFetchError ? error.details.message : 'scoreboard fetch failed',
      'scores-scoreboard-provider-fetch-failed'
    );
    return finalize(exec, 'failure', 'provider-fetch-failed', 0);
  }

  const normalization = normalizeScoreboardPayload(payload);
  if (normalization.topLevel === 'non-array') {
    await failAllAttempts(
      partitionAttempts,
      'scoreboard returned a non-array payload',
      'scores-scoreboard-invalid-payload'
    );
    return finalize(exec, 'failure', 'scoreboard-invalid-payload', 0);
  }
  if (normalization.rawCount === 0) {
    await failAllAttempts(
      partitionAttempts,
      'scoreboard returned empty while targets exist',
      'scores-scoreboard-empty-unexpected'
    );
    return finalize(exec, 'failure', 'scoreboard-empty-unexpected', 0);
  }
  if (normalization.rows.length === 0) {
    await failAllAttempts(
      partitionAttempts,
      'scoreboard rows failed to normalize (schema drift)',
      'scores-scoreboard-schema-drift'
    );
    return finalize(exec, 'failure', 'scoreboard-schema-drift', 0);
  }

  const matchResult = matchScoreboardRows(plan.targets, normalization.rows, context.resolver);
  if (matchResult.matchedCount === 0) {
    await failAllAttempts(
      partitionAttempts,
      'no scoreboard rows matched a targeted game',
      'scores-scoreboard-no-target-matches'
    );
    return finalize(exec, 'failure', 'scoreboard-no-target-matches', 0);
  }

  // Group matched rows by partition; merge each in its own transaction.
  const matchesByPartition = new Map<string, typeof matchResult.matched>();
  for (const match of matchResult.matched) {
    const key = partitionKey({
      year,
      week: match.game.canonical.providerWeek,
      seasonType: match.game.canonical.seasonType,
    });
    const bucket = matchesByPartition.get(key);
    if (bucket) bucket.push(match);
    else matchesByPartition.set(key, [match]);
  }

  let totalCommitted = 0;
  let anyDurableFailure = false;
  for (const pa of partitionAttempts) {
    const key = partitionKey(pa.partition);
    const partitionMatches = matchesByPartition.get(key) ?? [];
    const expectedInPartition = plan.targets.filter(
      (t) =>
        t.canonical.providerWeek === pa.partition.week &&
        t.canonical.seasonType === pa.partition.seasonType
    ).length;
    const missingTargets = partitionMatches.length < expectedInPartition;

    if (partitionMatches.length === 0) {
      await recordProviderRefreshFailure('scores', pa.scope, {
        attempt: pa.attempt,
        error: 'no matched scoreboard rows for this partition',
        code: 'scores-scoreboard-targets-missing',
      });
      continue;
    }

    let committed: number;
    try {
      const result = await mergeScoresIntoPartition({
        year,
        week: pa.partition.week,
        seasonType: pa.partition.seasonType,
        updates: partitionMatches.map((m) => ({
          pack: m.pack,
          provisionalFinal: m.provisionalFinal,
          baseline: m.game.cachedScore,
          baselineAt: m.game.cachedScoreAt,
        })),
        now: now.getTime(),
      });
      committed = result.committed;
    } catch (error) {
      anyDurableFailure = true;
      await recordProviderRefreshFailure('scores', pa.scope, {
        attempt: pa.attempt,
        error: error instanceof Error ? error.message : 'durable score merge failed',
        code: 'scores-durable-commit-failed',
        status: 500,
      });
      continue;
    }

    totalCommitted += committed;
    if (committed > 0) {
      await recordProviderRefreshSuccess('scores', pa.scope, {
        attempt: pa.attempt,
        committedAt: new Date().toISOString(),
        commitSeq: nextProviderCommitSeq(),
        source: 'cfbd',
        rowsCommitted: committed,
        ...(missingTargets ? { partialFailure: true } : {}),
      });
    } else if (missingTargets) {
      await recordProviderRefreshFailure('scores', pa.scope, {
        attempt: pa.attempt,
        error: 'some targeted games were missing from the scoreboard response',
        code: 'scores-scoreboard-targets-missing',
      });
    } else {
      await recordProviderRefreshNoop('scores', pa.scope, { attempt: pa.attempt, source: 'cfbd' });
    }
  }

  // Invalidate standings once, only when a durable score/status change occurred.
  if (totalCommitted > 0) await invalidateStandingsForYear(year);

  // Overall run classification (secret-safe event).
  if (anyDurableFailure) {
    return finalize(
      exec,
      totalCommitted > 0 ? 'partial' : 'failure',
      'durable-commit-failed',
      totalCommitted
    );
  }
  const allMatched = matchResult.matchedCount === matchResult.expectedCount;
  if (allMatched) {
    return totalCommitted > 0
      ? finalize(exec, 'success', 'scoreboard-written-clean', totalCommitted)
      : finalize(exec, 'no-op', 'scoreboard-unchanged-clean', 0);
  }
  return totalCommitted > 0
    ? finalize(exec, 'partial', 'scoreboard-written-partial', totalCommitted)
    : finalize(exec, 'failure', 'scoreboard-targets-missing', 0);
}

async function runFinalReconciliation(args: {
  plan: Extract<PollingPlan, { mode: 'final-reconciliation' }>;
  context: LiveScoreContext;
  partitionAttempts: PartitionAttempt[];
  cfbdApiKey: string;
  year: number;
  now: Date;
  exec: LiveScoresCronExecutionState;
}) {
  const { plan, context, partitionAttempts, cfbdApiKey, year, now, exec } = args;
  const pa = partitionAttempts[0]!;
  const { partition } = plan;

  let payload: unknown;
  try {
    const url = buildCfbdGamesUrl({ year, seasonType: partition.seasonType, week: partition.week });
    payload = await fetchUpstreamJson<unknown>(url.toString(), {
      cache: 'no-store',
      timeoutMs: CFBD_REQUEST_TIMEOUT_MS,
      headers: { Authorization: `Bearer ${cfbdApiKey}` },
      retry: RETRY_POLICY,
      pacing: PACING_POLICY,
    });
  } catch (error) {
    await recordProviderRefreshFailure('scores', pa.scope, {
      attempt: pa.attempt,
      error: error instanceof UpstreamFetchError ? error.details.message : 'games fetch failed',
      code: 'scores-final-reconciliation-provider-fetch-failed',
      status: error instanceof UpstreamFetchError ? (error.details.status ?? 502) : 500,
    });
    return finalize(exec, 'failure', 'provider-fetch-failed', 0);
  }

  // Parsing is fenced so an unexpected throw (e.g. a malformed provider row the
  // shared normalizer cannot digest) still resolves the begun attempt rather than
  // leaving it stranded in-progress.
  let parse: ReturnType<typeof parseFinalReconciliation>;
  try {
    parse = parseFinalReconciliation({
      payload,
      pendingGames: plan.pendingGames,
      resolver: context.resolver,
    });
  } catch (error) {
    await recordProviderRefreshFailure('scores', pa.scope, {
      attempt: pa.attempt,
      error: error instanceof Error ? error.message : 'games payload parse failed',
      code: 'scores-final-reconciliation-invalid-payload',
      status: 500,
    });
    return finalize(exec, 'failure', 'final-reconciliation-invalid-payload', 0);
  }
  // A non-array payload AND a nonempty array that normalizes to zero usable rows
  // (schema drift) are both unusable payloads that preserve prior-good state.
  if (parse.kind === 'invalid-payload' || parse.kind === 'schema-drift') {
    await recordProviderRefreshFailure('scores', pa.scope, {
      attempt: pa.attempt,
      error:
        parse.kind === 'schema-drift'
          ? 'games returned rows but none normalized to a usable game (schema drift)'
          : 'games returned a non-array payload',
      code: 'scores-final-reconciliation-invalid-payload',
    });
    return finalize(exec, 'failure', 'final-reconciliation-invalid-payload', 0);
  }
  if (parse.kind === 'empty-unexpected') {
    await recordProviderRefreshFailure('scores', pa.scope, {
      attempt: pa.attempt,
      error: 'games returned empty while confirmation targets exist',
      code: 'scores-final-reconciliation-empty-unexpected',
    });
    return finalize(exec, 'failure', 'final-reconciliation-empty-unexpected', 0);
  }

  let mergeResult;
  try {
    mergeResult = await mergeScoresIntoPartition({
      year,
      week: partition.week,
      seasonType: partition.seasonType,
      updates: parse.updates,
      confirmFinalIds: parse.confirmedIds,
      now: now.getTime(),
    });
  } catch (error) {
    await recordProviderRefreshFailure('scores', pa.scope, {
      attempt: pa.attempt,
      error: error instanceof Error ? error.message : 'durable final merge failed',
      code: 'scores-durable-commit-failed',
      status: 500,
    });
    return finalize(exec, 'failure', 'durable-commit-failed', 0);
  }

  // Capture ordering metadata immediately after the durable commit and BEFORE the
  // slower standings invalidation, so two overlapping commits cannot invert their
  // last-success ordering (an older commit's slow invalidation must not stamp it
  // with a later commitSeq than a newer commit).
  const committedAt = new Date().toISOString();
  const commitSeq = nextProviderCommitSeq();
  if (mergeResult.committed > 0) await invalidateStandingsForYear(year);

  const { confirmedIds, pendingTargetCount } = parse;
  // A write-free run committed nothing durably (e.g. a concurrent op cleared the
  // pending id and corrected the score between context load and this merge) —
  // resolve it as a no-op, never a success that advances last-success with no commit.
  if (mergeResult.wrote && confirmedIds.length === pendingTargetCount) {
    await recordProviderRefreshSuccess('scores', pa.scope, {
      attempt: pa.attempt,
      committedAt,
      commitSeq,
      source: 'cfbd',
      rowsCommitted: mergeResult.committed,
    });
    return finalize(exec, 'success', 'final-reconciliation-confirmed', mergeResult.committed);
  }
  if (mergeResult.wrote && confirmedIds.length > 0) {
    await recordProviderRefreshSuccess('scores', pa.scope, {
      attempt: pa.attempt,
      committedAt,
      commitSeq,
      source: 'cfbd',
      rowsCommitted: mergeResult.committed,
      partialFailure: true,
    });
    return finalize(exec, 'partial', 'final-reconciliation-partial', mergeResult.committed);
  }
  await recordProviderRefreshNoop('scores', pa.scope, { attempt: pa.attempt, source: 'cfbd' });
  return finalize(exec, 'no-op', 'final-reconciliation-not-confirmed', 0);
}
