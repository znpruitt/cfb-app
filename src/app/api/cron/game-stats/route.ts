import { NextResponse } from 'next/server';

import { fetchCfbdUsage } from '@/lib/api/cfbdUsage';
import { CFBD_PEAK_LATENCY_TIMEOUT_MS } from '@/lib/api/cfbdRequestPolicy';
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
import {
  reachedMergeVerdict,
  resolveReconciliationRun,
  type ReconciliationReport,
  type ReconciliationRun,
} from '@/lib/gameStats/reconciliationRun';
import { projectPublicPartition } from '@/lib/gameStats/publicProjection';
import { evaluateAutomationQuota, type CfbdUsageSnapshot } from '@/lib/gameStats/quotaPolicy';
import { interpretGameStatsRefreshOutcome } from '@/lib/gameStats/refreshOutcome';
import {
  createCronExecutionState,
  emitGameStatsCronExecutionEvent,
} from '@/lib/gameStats/cronExecutionLog';
import { getAppState } from '@/lib/server/appStateStore';
import { isAutoRefreshAllowed } from '@/lib/server/providerRefreshSettings';
import { weekPartitionScope, weekReconciliationScope } from '@/lib/providerRefreshScope';
import {
  beginProviderRefreshAttempt,
  nextProviderCommitSeq,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
} from '@/lib/server/providerRefreshStatus';
import {
  createSchedulerInvocationId,
  scheduleSchedulerExecutionReceipt,
} from '@/lib/server/schedulerExecutionStatus';

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
 *
 * PLATFORM-110B — bounded correction reconciliation, in the SAME run slot.
 *
 * Satisfaction establishes usability, not an immutable final provider revision,
 * so a partition can sit permanently behind a newer CFBD observation once its
 * kickoff window closes. When — and ONLY when — ordinary polling has no target,
 * this run may instead take one bounded correction pass over a partition whose
 * window closed long ago: `~48h` after its last kickoff, once more at `~7 days`,
 * then never (`reconciliationTarget.ts` carries the measurement that ruled the
 * cadence). Reconciliation is a SECOND CONSUMER of one run slot, never a second
 * job: the at-most-one-CFBD-call-per-run promise, the quota reserve, the attempt
 * bookkeeping, the writer fence, the ingestion coordinator, the outcome
 * interpreter, the scoped status record and the durable reread are all the
 * unchanged ones above. What it adds is a due-time derivation and a durable
 * ledger (`reconciliationLedger.ts`) recording what each pass changed and what
 * failed.
 *
 * The two targets are mutually exclusive BY CONSTRUCTION, not by convention: a
 * partition is reconcilable only once `now >= latestKickoff + 48h`, which proves
 * every game in it is more than 24 hours past kickoff and therefore outside
 * `selectPollingTarget`'s window. Historical seasons are unreachable for exactly
 * the reason polling cannot reach them — the canonical slate is this season's.
 */

// ONE provider request per run — no transport retries. The cron promises at
// most one CFBD /games/teams call per run and the quota floor's 2-call margin
// assumes exactly one usage probe plus one fetch; recovery across runs is the
// polling window's job, never a hidden transport loop.
const RETRY_POLICY = {
  maxAttempts: 1,
  baseDelayMs: 0,
  maxDelayMs: 0,
  jitterRatio: 0,
  retryOnHttpStatuses: [],
} as const;

// PLATFORM-115: the shared 40s ceiling covers the accepted 8-25s latency band
// and remains well inside the polling cadence. The one-attempt quota
// contract is unchanged.

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
  reconciliation?: ReconciliationReport;
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
async function resolvePollingTarget(
  year: number,
  now: Date
): Promise<
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

/**
 * The projected durable REREAD block a TARGET-RESOLVED run report carries.
 * Reuses the canonical slate already resolved for target selection (no second
 * canonical load) and rereads the exact durable partition, so EVERY
 * target-resolved response — quota refusal, missing credential, provider-fetch
 * failure, ingestion/interpretation failure, and every interpreter outcome —
 * reflects the true durable state, never the payload or an assumed merge
 * result. A failed run therefore never reads as lost prior-good evidence. The
 * shape matches the success path exactly: `availability` on success, otherwise
 * the projection status alone (no persisted value ever reaches the report).
 */
async function projectDurableBlock(
  slateResult: CanonicalSlateResult,
  year: number,
  week: number,
  seasonType: CfbdSeasonType
): Promise<Record<string, unknown>> {
  // Fully fail-safe: this block is best-effort observability appended to an
  // ALREADY-decided response, so neither the durable read NOR the projector may
  // escape. A projector throw (e.g. structurally corrupt durable state that the
  // recursive canonicalizer chokes on) must never convert a controlled failure
  // response into an unhandled 500 — it resolves to a distinct `projection-failed`.
  try {
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
    const projection = projectPublicPartition(slateResult, week, seasonType, read, 'current');
    return projection.status === 'available'
      ? { status: 'available', availability: projection.wire.availability }
      : { status: projection.status };
  } catch {
    return { status: 'projection-failed' };
  }
}

export async function GET(req: Request) {
  // PLATFORM-086F1 — one secret-safe structured event per invocation. The start
  // instant, season year, and pessimistic `failure / unexpected-error` tracker
  // are captured at entry (year from the SAME instant so an auth failure still
  // logs its year), and the single `finally` below is the ONLY emission point —
  // guaranteeing at most one event for skips, every outcome, and any throw.
  const startedAtMs = Date.now();
  const now = new Date();
  const year = seasonYearForToday(now);
  const exec = createCronExecutionState(year);
  // PLATFORM-086F2E1 — receipt identity, created ONLY after successful cron
  // authentication (never inferred from the final result/reason). Null means
  // no durable receipt is scheduled for this invocation.
  let receiptInvocationId: string | null = null;

  try {
    // CRON_SECRET first — fail closed with distinct configuration errors.
    const auth = verifyCronSecret(req);
    if (auth !== 'ok') {
      exec.result = 'failure';
      exec.reason =
        auth === 'not-configured' ? 'cron-secret-not-configured' : 'cron-authorization-invalid';
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
    receiptInvocationId = createSchedulerInvocationId();

    // Operator pause — before target selection, so no scoped attempt exists.
    if (!(await isAutoRefreshAllowed('game-stats'))) {
      exec.result = 'skipped';
      exec.reason = 'automation-paused-or-disabled';
      return NextResponse.json(
        skippedResult(year, 'automatic game-stats refresh is paused or disabled')
      );
    }

    // Resolve the exact target BEFORE any credential/usage/provider concern.
    const resolution = await resolvePollingTarget(year, now);
    if (resolution.status === 'context-unavailable') {
      // The underlying free-form reason is intentionally NOT logged (secret-safe).
      exec.result = 'skipped';
      exec.reason = 'canonical-context-unavailable';
      return NextResponse.json(
        skippedResult(year, `canonical context unavailable: ${resolution.reason}`)
      );
    }
    // PLATFORM-110B — reconciliation is considered ONLY once polling has none,
    // which is what keeps the one-fetch-per-run promise and makes the two target
    // sets mutually exclusive within an invocation.
    let reconciliation: ReconciliationRun | null = null;
    if (resolution.target === null) {
      const recon = await resolveReconciliationRun(year, now, resolution.slateResult);
      if (recon.status === 'unavailable') {
        // A store fault, not a data state: suppress the pass, spend nothing, and
        // say so distinctly rather than reporting "nothing was due".
        exec.result = 'skipped';
        exec.reason = 'reconciliation-ledger-unavailable';
        return NextResponse.json(
          skippedResult(year, 'correction-reconciliation ledger is unreadable')
        );
      }
      if (recon.status === 'none') {
        // No exact target → no scoped attempt, no usage check, no provider call.
        exec.result = 'skipped';
        exec.reason = 'no-polling-target';
        return NextResponse.json(skippedResult(year, 'no partition inside the polling window'));
      }
      reconciliation = recon.run;
      exec.mode = 'reconcile';
    }

    // Exactly one of the two is non-null here, and the whole path below is the
    // UNCHANGED one: same attempt token, quota gate, credential check, fetch,
    // ingestion coordinator, interpreter, scoped status record and durable
    // reread. Reconciliation changes WHICH partition is fetched, never how.
    const { week, seasonType } = reconciliation?.target ?? resolution.target!;
    const reconciliationReport: ReconciliationReport | null = reconciliation?.report ?? null;
    // Partition fields are known only now that an exact target is resolved.
    exec.week = week;
    exec.seasonType = seasonType;
    // PLATFORM-110B: a correction pass records under its OWN scope kind. It
    // targets a partition whose window closed weeks ago, so recorded under
    // `week-partition` its attempt would be the dataset's most RECENT and would
    // report game-stats' health from the least current data it touches — a
    // week-1 correction failing in week 10 raising "Game stats refresh failed"
    // for a healthy dataset. `DATASET_ACTIVITY_SCOPE_KINDS` already gates
    // eligibility by kind, and game-stats does not own this one, so the record
    // is written and readable but never `latestScopedActivity`.
    const weekScope = reconciliation
      ? weekReconciliationScope(year, week, seasonType)
      : weekPartitionScope(year, week, seasonType);
    const attempt = await beginProviderRefreshAttempt('game-stats', weekScope, {
      startedAt: new Date().toISOString(),
    });

    // Quota reserve (PLATFORM-086H3E2 policy): provider-reported usage only,
    // checked ONLY once a target exists. Unknown or below-reserve usage resolves
    // the attempt as a truthful failure — never fabricated either direction.
    let usageSnapshot: CfbdUsageSnapshot;
    // The `/info` quota probe is about to run — mark it checked (stays true even
    // if the probe throws or yields untrustworthy usage). This is NOT a billed
    // game-stats provider call, so `providerCallAttempted` stays false here.
    exec.quotaChecked = true;
    try {
      // FRESH usage for the quota gate — a cached snapshot must never let a
      // burst of refreshes reuse pre-spend remaining counts.
      const usage = await fetchCfbdUsage({ fresh: true });
      usageSnapshot = { remainingCalls: usage.remaining, monthlyLimit: usage.limit };
      // Item 127 deliberately does NOT retain this observation. The probe stays —
      // `evaluateAutomationQuota` below is a spend gate and needs a FRESH reading,
      // and the series is observation-only and must never become a gate input.
      // But persisting from here made a second writer of one durable row, and that
      // alone produced lost updates, cross-instance clock skew reading as a quota
      // reset, and out-of-order commits in both directions — four fixes across two
      // review rounds, all defending a hazard that exists only because a second
      // producer exists. `/api/cron/usage-sample` samples every six hours
      // unconditionally, which answers what a day cost; 15-minute resolution
      // inside game windows was resolution no consumer asked for.
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
      exec.result = 'failure';
      exec.reason = `quota-${quota.reason}`;
      return NextResponse.json({
        year,
        week,
        seasonType,
        outcome: 'failure',
        reason: `quota-${quota.reason}`,
        committedGames: 0,
        // No provider request was issued, so no attempt is recorded and the pass
        // stays due — a quota-starved month must never burn a correction pass.
        ...(reconciliationReport ? { reconciliation: reconciliationReport } : {}),
        remaining: quota.remaining,
        durable: await projectDurableBlock(resolution.slateResult, year, week, seasonType),
      } satisfies CronResult & { remaining: number | null; durable: unknown });
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
      exec.result = 'failure';
      exec.reason = 'cfbd-api-key-missing';
      return NextResponse.json(
        {
          year,
          week,
          seasonType,
          outcome: 'failure',
          reason: 'cfbd-api-key-missing',
          committedGames: 0,
          // Same as the quota refusal: nothing was requested, nothing recorded.
          ...(reconciliationReport ? { reconciliation: reconciliationReport } : {}),
          error: 'CFBD_API_KEY not configured',
          durable: await projectDurableBlock(resolution.slateResult, year, week, seasonType),
        } satisfies CronResult & { durable: unknown },
        { status: 500 }
      );
    }

    // PLATFORM-110B — RESERVE BEFORE THE SPEND. The reconciliation attempt is
    // committed durably before the provider request, so a store that cannot
    // record cannot spend. Appending afterwards meant a persistent write failure
    // (or a full season row) recorded nothing, left the pass due, and billed one
    // CFBD call on every subsequent run forever. Placed AFTER the quota and
    // credential gates so a refusal there burns no attempt, and it also enforces
    // the attempt cap inside the ledger transaction, where two overlapping
    // invocations cannot each pass a check made against their own snapshot.
    if (reconciliation && !(await reconciliation.reserve())) {
      const reservation = reconciliationReport?.reservation ?? 'write-failed';
      await recordProviderRefreshFailure('game-stats', weekScope, {
        attempt,
        error: `correction reconciliation could not reserve an attempt: ${reservation}`,
        code: `game-stats-reconciliation-${reservation}`,
        status: 503,
      });
      exec.result = 'failure';
      exec.reason = 'reconciliation-unreserved';
      return NextResponse.json(
        {
          year,
          week,
          seasonType,
          outcome: 'failure',
          reason: 'reconciliation-unreserved',
          committedGames: 0,
          ...(reconciliationReport ? { reconciliation: reconciliationReport } : {}),
          durable: await projectDurableBlock(resolution.slateResult, year, week, seasonType),
        } satisfies CronResult & { durable: unknown },
        { status: 503 }
      );
    }

    // Observation fence before provider access; at most ONE partition fetch. The
    // provider transport and the downstream ingestion/interpretation are fenced
    // into SEPARATE try blocks so their failures classify distinctly — a
    // transport error is `provider-fetch-failed`, a throw from ingestion (with
    // INDETERMINATE durability) is `ingestion-failed` — and BOTH carry the
    // durable reread so the report never mislabels one as the other or reads as
    // lost prior-good evidence.
    const fetchStartedAt = new Date().toISOString();
    let payload: unknown;
    // The billed CFBD `/games/teams` request is about to run.
    exec.providerCallAttempted = true;
    try {
      const cfbdUrl = buildCfbdGameTeamStatsUrl({ year, week, seasonType });
      payload = await fetchUpstreamJson<unknown>(cfbdUrl.toString(), {
        cache: 'no-store',
        timeoutMs: CFBD_PEAK_LATENCY_TIMEOUT_MS,
        headers: { Authorization: `Bearer ${cfbdApiKey}` },
        retry: RETRY_POLICY,
        pacing: PACING_POLICY,
      });
    } catch (error) {
      await recordProviderRefreshFailure('game-stats', weekScope, {
        attempt,
        error: error instanceof Error ? error.message : 'unknown error',
        code: 'game-stats-provider-fetch-failed',
        status: error instanceof UpstreamFetchError ? (error.details.status ?? 502) : 500,
      });
      // Only the stable generic reason is logged — never the thrown message.
      exec.result = 'failure';
      exec.reason = 'provider-fetch-failed';
      // The reserved attempt is settled as a failure that reached NO merge
      // verdict, so the pass stays OPEN and a later run retries it — bounded by
      // the attempt cap rather than left to refetch forever.
      await reconciliation?.settle({
        reachedVerdict: false,
        outcome: 'failure',
        reason: 'provider-fetch-failed',
        corrected: 0,
        refreshed: 0,
        inserted: 0,
        conflicts: 0,
        stale: 0,
        notObserved: 0,
        observedAt: fetchStartedAt,
      });
      return NextResponse.json(
        {
          year,
          week,
          seasonType,
          outcome: 'failure',
          reason: 'provider-fetch-failed',
          committedGames: 0,
          ...(reconciliationReport ? { reconciliation: reconciliationReport } : {}),
          error: error instanceof Error ? error.message : 'unknown error',
          durable: await projectDurableBlock(resolution.slateResult, year, week, seasonType),
        } satisfies CronResult & { durable: unknown },
        { status: 500 }
      );
    }

    try {
      const result = await ingestGameStatsPartitionResponse({
        year,
        week,
        seasonType,
        fetchStartedAt,
        payload,
      });
      const interpretation = interpretGameStatsRefreshOutcome(result);

      // The merge's own counts, read once and never re-derived. `updated` is the
      // games whose stored content actually CHANGED — kept apart from
      // `refreshed` (re-confirmed identical at a newer fence) so a pass that
      // found nothing wrong can never report as a pass that fixed something.
      const mergeResult = result.kind === 'merge-result' ? result.merge : null;
      const correctedGames = mergeResult?.updated.length ?? 0;
      exec.correctedGames = correctedGames;

      let committedGames = 0;
      if (interpretation.advanceLastSuccess) {
        committedGames = mergeResult
          ? mergeResult.inserted.length + mergeResult.updated.length + mergeResult.refreshed.length
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

      // The interpreter's exact kind + reason are preserved (never collapsed);
      // `committedGames` is the confirmed durable-commit count (0 on no-op/
      // failure). `partial` therefore stays a first-class truthful outcome.
      exec.result = interpretation.kind;
      exec.reason = interpretation.reason;
      exec.committedGames = committedGames;

      // Closure is keyed on whether the merge authority actually COMPARED the
      // partition — never on "ingestion returned a typed result", which is also
      // true of an `unavailable` refusal that read nothing. A writer-control
      // transition must not consume the season's corrections.
      await reconciliation?.settle({
        reachedVerdict: reachedMergeVerdict(result),
        outcome: interpretation.kind,
        reason: interpretation.reason,
        corrected: correctedGames,
        refreshed: mergeResult?.refreshed.length ?? 0,
        inserted: mergeResult?.inserted.length ?? 0,
        conflicts: mergeResult?.conflicts.length ?? 0,
        stale: mergeResult?.stale.length ?? 0,
        notObserved: mergeResult?.retainedExisting.length ?? 0,
        observedAt: fetchStartedAt,
      });

      // Durable REREAD — downstream truth is the durable partition, never the
      // payload or an assumed merge result. The run report's availability comes
      // from projecting the reread; no success inference, no same-run retry
      // (indeterminate stays a failure until a later run observes it).
      return NextResponse.json(
        {
          year,
          week,
          seasonType,
          outcome: interpretation.kind,
          reason: interpretation.reason,
          committedGames,
          ...(reconciliationReport ? { reconciliation: reconciliationReport } : {}),
          durable: await projectDurableBlock(resolution.slateResult, year, week, seasonType),
        } satisfies CronResult & { durable: unknown },
        { status: interpretation.kind === 'failure' ? interpretation.httpStatus : 200 }
      );
    } catch (error) {
      // Defensive: H2 funnels every EXPECTED ingestion fault (write failure,
      // conflict, stale, indeterminate commit) into a typed outcome handled on
      // the normal path above. A throw reaching HERE is an unexpected
      // ingestion/interpretation defect with INDETERMINATE durability — never a
      // provider-transport failure. Record it distinctly (never advancing
      // last-success) and reread the durable partition so the report reflects the
      // true prior-good (or partially-applied) state.
      await recordProviderRefreshFailure('game-stats', weekScope, {
        attempt,
        error: error instanceof Error ? error.message : 'unknown error',
        code: 'game-stats-ingestion-failed',
        status: 500,
      });
      // Only the stable generic reason is logged — never the thrown message.
      exec.result = 'failure';
      exec.reason = 'ingestion-failed';
      // The merge never returned a verdict, so this does NOT close the pass — an
      // unexpected ingestion defect must not permanently consume a correction.
      // The attempt cap is what stops it repeating without end.
      await reconciliation?.settle({
        reachedVerdict: false,
        outcome: 'failure',
        reason: 'ingestion-failed',
        corrected: 0,
        refreshed: 0,
        inserted: 0,
        conflicts: 0,
        stale: 0,
        notObserved: 0,
        observedAt: fetchStartedAt,
      });
      return NextResponse.json(
        {
          year,
          week,
          seasonType,
          outcome: 'failure',
          reason: 'ingestion-failed',
          committedGames: 0,
          ...(reconciliationReport ? { reconciliation: reconciliationReport } : {}),
          error: error instanceof Error ? error.message : 'unknown error',
          durable: await projectDurableBlock(resolution.slateResult, year, week, seasonType),
        } satisfies CronResult & { durable: unknown },
        { status: 500 }
      );
    }
  } finally {
    // The ONLY emission point — runs after the return value is built and before
    // it is returned, and on any propagating throw (tracker still `failure /
    // unexpected-error`). Best-effort inside the helper; cannot alter the
    // response or mask a thrown error.
    emitGameStatsCronExecutionEvent(exec, startedAtMs);
    // PLATFORM-086F2E1 — one latest-only durable receipt per AUTHENTICATED
    // invocation, scheduled post-response. Result/reason/provider truth are the
    // tracker's verbatim; best-effort, so it can neither change the response
    // nor mask a propagating throw.
    if (receiptInvocationId !== null) {
      scheduleSchedulerExecutionReceipt({
        job: 'game-stats',
        invocationId: receiptInvocationId,
        startedAtMs,
        result: exec.result,
        reason: exec.reason,
        providerCallAttempted: exec.providerCallAttempted,
        target: {
          kind: 'game-stats',
          year: exec.year,
          week: exec.week,
          seasonType: exec.seasonType,
          mode: exec.mode,
        },
      });
    }
  }
}
