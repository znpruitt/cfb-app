/**
 * Shared fixtures for the PLATFORM-086F2F System Health tests. Pure builders —
 * no I/O, no clock read. Every default is a "healthy" fact that individual tests
 * override to exercise one domain at a time.
 */

import type { ProviderCacheStates } from '../providerCacheState.ts';
import type {
  ProviderDataExpectation,
  ProviderDataExpectations,
} from '../providerDataDiagnostics.ts';
import type {
  CanonicalRefreshFact,
  LatestScopedActivityFact,
  ProviderRefreshHealthRow,
  ProviderRefreshHealthSnapshot,
  SafeProviderRefreshStatus,
} from '../providerRefreshHealth.ts';
import type {
  SchedulerDeliveryHealthRow,
  SchedulerDeliveryHealthSnapshot,
} from '../schedulerDeliveryHealth.ts';
import { requiredStartedAtForJob, schedulerDeliveryPolicy } from '../schedulerDeliveryHealth.ts';
import {
  buildSchedulerExecutionReceipt,
  EXTERNAL_SCHEDULER_JOBS,
  rankingsYearsTarget,
  scheduleYearsTarget,
  schedulerSourceForJob,
  seasonRolloverYearsTarget,
  seasonTransitionYearsTarget,
  type ExternalSchedulerJob,
  type SchedulerExecutionReceipt,
  type SchedulerExecutionReceiptInput,
  type SchedulerExecutionResult,
  type SchedulerExecutionTarget,
} from '../schedulerExecutionStatus.ts';
import { defaultOddsCacheKey } from '../../../app/api/odds/routeInternals.ts';
import { PROVIDER_DATASETS, type ProviderDataset } from '../../providerDatasets.ts';
import {
  globalScope,
  oddsTargetScope,
  providerRefreshScopeKey,
  yearScope,
  type ProviderRefreshScope,
} from '../../providerRefreshScope.ts';
import type { ProviderAttemptOutcome } from '../providerRefreshStatus.ts';
import type {
  AutomationHealth,
  DiagnosticsFact,
  SafeDiagnostic,
  StorageHealthFact,
  SystemHealthIssueInputs,
  SystemHealthQuota,
} from '../systemHealthIssues.ts';

export const YEAR = 2026;
export const NOW = Date.parse('2026-10-15T12:00:00.000Z');

// -- Scheduler receipts + delivery rows ---------------------------------------

function targetFor(job: ExternalSchedulerJob, refusals = 0): SchedulerExecutionTarget {
  switch (job) {
    case 'live-scores':
      return { kind: 'live-scores', year: YEAR, mode: null, targetGames: 0, targetPartitions: 0 };
    case 'game-stats':
      return { kind: 'game-stats', year: YEAR, week: null, seasonType: null };
    case 'odds':
      return { kind: 'odds', year: YEAR, cadence: null, eligibleGames: 0 };
    case 'schedule-refresh':
      return scheduleYearsTarget(
        [
          {
            year: YEAR,
            operation: null,
            scoreRepairs: 0,
            scoreDifferenceCount: 0,
            scoreSweepFailedPartitions: [],
            scoreSweepCannotTellCount: 0,
            kickoffsChanged: 0,
          },
        ],
        refusals
      );
    case 'rankings':
      return rankingsYearsTarget([{ year: YEAR, publicationWindow: null }], refusals);
    case 'season-transition':
      return seasonTransitionYearsTarget(
        [{ year: YEAR, targetLeagues: 1, probed: true, transitionedLeagues: 0 }],
        refusals
      );
    case 'season-rollover':
      return seasonRolloverYearsTarget(
        [{ year: YEAR, targetLeagues: 1, rolledOverLeagues: 0 }],
        refusals
      );
  }
}

const REASON_FOR: Record<ExternalSchedulerJob, SchedulerExecutionReceiptInput['reason']> = {
  'live-scores': 'no-polling-target',
  'game-stats': 'no-polling-target',
  odds: 'automation-paused-or-disabled',
  'schedule-refresh': 'no-maintenance-target',
  rankings: 'no-ranking-target',
  'season-transition': 'no-preseason-leagues',
  'season-rollover': 'no-season-leagues',
};

/** A valid receipt for `job` with the given result (started shortly before NOW). */
export function receiptFor(
  job: ExternalSchedulerJob,
  result: SchedulerExecutionResult,
  startedAtMs: number = NOW - 60_000
): SchedulerExecutionReceipt {
  return buildReceipt(job, result, startedAtMs, 0);
}

/**
 * PLATFORM-086F2H3B2 — a receipt whose TARGET reports refused production
 * lifecycle records. Only the four lifecycle-bearing jobs carry the field;
 * asking for refusals on any other job throws rather than silently producing a
 * receipt that cannot express them, so a test cannot assert against a fixture
 * that never carried the fact.
 */
export function receiptWithRefusals(
  job: ExternalSchedulerJob,
  result: SchedulerExecutionResult,
  refusals: number,
  startedAtMs: number = NOW - 60_000
): SchedulerExecutionReceipt {
  const receipt = buildReceipt(job, result, startedAtMs, refusals);
  if (!('invalidLifecycleTargets' in receipt.target)) {
    throw new Error(`${job} has no lifecycle-target count to report`);
  }
  return receipt;
}

function buildReceipt(
  job: ExternalSchedulerJob,
  result: SchedulerExecutionResult,
  startedAtMs: number,
  refusals: number
): SchedulerExecutionReceipt {
  const receipt = buildSchedulerExecutionReceipt({
    job,
    invocationId: `id-${job}-${startedAtMs}`,
    startedAtMs,
    completedAtMs: startedAtMs + 1000,
    result,
    reason: REASON_FOR[job],
    providerCallAttempted: false,
    target: targetFor(job, refusals),
  });
  if (!receipt) throw new Error(`fixture receipt failed to build for ${job}`);
  return receipt;
}

/**
 * A receipt old enough to be LATE for this job, by the job's own policy.
 *
 * "Late" is not a fixed offset: it means the last run predates
 * `previousSlot(now - graceMs)`, and grace runs from six minutes to twenty-four
 * hours across the seven jobs. A test that picks its own offset is guessing at a
 * per-job number and will be wrong for most of them — which is how a 30-second-old
 * `live-scores` receipt came to be labelled late in a fixture when production
 * calls it on-time.
 */
export function lateReceiptFor(
  job: ExternalSchedulerJob,
  result: SchedulerExecutionResult = 'success'
): SchedulerExecutionReceipt {
  // One minute before the slot it needed to reach.
  return receiptFor(job, result, requiredStartedAtForJob(job, NOW) - 60_000);
}

/**
 * A delivery row whose `deliveryState` CANNOT contradict its own timestamps.
 *
 * `deliveryState` is DERIVED in production (`schedulerDeliveryHealth`):
 * `startedAt >= requiredStartedAt` is on-time, earlier is late. A test that hand-
 * labels a row is asserting an answer instead of producing one, and if the label
 * disagrees with the timestamps the row is a shape the classifier can never emit —
 * so the test exercises the branch with impossible inputs and cannot fail.
 *
 * That is not hypothetical. A late warning shipped computing its gap as
 * `arrived - due`, which is negative for every real late row; the fixture had the
 * timestamps reversed in exactly the same way, the two errors cancelled, and 48
 * tests passed while the page told operators a four-day silence was "under a
 * minute late". The fixture agreed with the bug.
 *
 * So the label is CHECKED here. Pass `requiredStartedAt` when the ordering is the
 * point of the test; the default keeps every existing caller working.
 */
export function deliveryRow(
  job: ExternalSchedulerJob,
  deliveryState: SchedulerDeliveryHealthRow['deliveryState'],
  receipt: SchedulerExecutionReceipt | null,
  requiredStartedAt?: string
): SchedulerDeliveryHealthRow {
  // DERIVED THROUGH PRODUCTION'S OWN FUNCTION, never approximated here.
  //
  // `requiredStartedAtForJob` is `previousSlot(now - graceMs)` — the same call
  // `readSchedulerDeliveryHealth` makes. Grace ranges from six minutes
  // (live-scores) to twenty-four hours (schedule-refresh), so ANY hand-written
  // offset is wrong per job and wrong by a different amount each time.
  //
  // Two previous attempts got this wrong in opposite directions. `NOW` against a
  // receipt at `NOW - 60s` made every `on-time` fixture a shape the classifier
  // calls late. `startedAt + 60s` then certified a 30-second-old `live-scores`
  // receipt as LATE, when six minutes of grace makes it on-time — the guard
  // blessing a state production cannot emit, which is the failure the guard
  // exists to prevent. Deriving removes the judgement call entirely.
  const derived = new Date(requiredStartedAtForJob(job, NOW)).toISOString();

  const row: SchedulerDeliveryHealthRow = {
    job,
    source: schedulerSourceForJob(job),
    cron: schedulerDeliveryPolicy(job).cron,
    cadenceLabel: 'test cadence',
    graceMs: schedulerDeliveryPolicy(job).graceMs,
    requiredStartedAt: requiredStartedAt ?? derived,
    deliveryState,
    receipt,
  };
  assertRowIsClassifiable(row);
  return row;
}

/**
 * Refuse a row whose `deliveryState` the real classifier would not produce from
 * its own fields. Exported because a test that SPREADS a row and overrides a
 * timestamp bypasses the check in `deliveryRow` — call this after any such edit.
 */
export function assertRowIsClassifiable(row: SchedulerDeliveryHealthRow): void {
  const fail = (why: string): never => {
    throw new Error(
      `${row.job}: ${why}. The classifier can never emit this row, so a test using it proves nothing.`
    );
  };

  if (row.deliveryState === 'missing' || row.deliveryState === 'unavailable') {
    if (row.receipt !== null) fail(`'${row.deliveryState}' must carry no receipt`);
    return;
  }
  // `buildDeliveryRow` nulls the receipt whenever the parse fails, so an INVALID
  // row with a receipt attached is unreachable — and accepted, it emits both
  // `scheduler-receipt-invalid` and an execution issue, a pair no real snapshot
  // produces. Previously this branch returned before checking anything.
  if (row.deliveryState === 'invalid') {
    if (row.receipt !== null) fail(`'invalid' must carry no receipt`);
    return;
  }
  if (row.receipt === null) fail(`'${row.deliveryState}' requires a receipt`);

  const started = Date.parse(row.receipt!.startedAt);
  const required = Date.parse(row.requiredStartedAt);
  // NaN comparisons are FALSE, so an unparseable instant silently classified as
  // `late` and slipped through the ordering check entirely.
  if (!Number.isFinite(started))
    fail(`receipt startedAt '${row.receipt!.startedAt}' is unparseable`);
  if (!Number.isFinite(required)) {
    fail(`requiredStartedAt '${row.requiredStartedAt}' is unparseable`);
  }
  // The required slot is `previousSlot(now - grace)` in production, so it can
  // never be in the future. A future slot let a row be labelled `late` while its
  // run was seconds old — rendering "under a minute ago" against a deadline that
  // has not arrived, which is the reading this whole change exists to prevent.
  if (required > NOW) fail(`requiredStartedAt ${row.requiredStartedAt} is after now`);

  const wouldBe = started >= required ? 'on-time' : 'late';
  if (wouldBe !== row.deliveryState) {
    fail(
      `labelled '${row.deliveryState}' but startedAt ${row.receipt!.startedAt} vs ` +
        `requiredStartedAt ${row.requiredStartedAt} classifies '${wouldBe}'`
    );
  }
}

/**
 * THE CHOKE POINT. Every row reaching `deriveSystemHealthIssues` passes through
 * here, so validating at this boundary catches an incoherent row however it was
 * produced — built by hand, spread and overridden inline, or hoisted into a
 * variable and overridden later.
 *
 * Checking only inside `deliveryRow` was not enough: the helper has already
 * returned by the time a caller spreads its result and replaces a timestamp, and
 * that spread is exactly how the shipped defect's fixture was written. A source
 * scan for the bypass was tried and removed — it matched syntax rather than
 * meaning, missed the hoisted form, and AGENTS.md is explicit that proof
 * machinery is a last resort when an invariant cannot be observed behaviorally.
 * This one can.
 */
export function deliverySnapshot(
  rows: SchedulerDeliveryHealthRow[]
): SchedulerDeliveryHealthSnapshot {
  rows.forEach(assertRowIsClassifiable);
  return { generatedAt: new Date(NOW).toISOString(), jobs: rows };
}

/** Seven on-time rows, each with a successful receipt → no delivery/execution fault. */
export function healthyDelivery(): SchedulerDeliveryHealthSnapshot {
  return deliverySnapshot(
    EXTERNAL_SCHEDULER_JOBS.map((job) => deliveryRow(job, 'on-time', receiptFor(job, 'success')))
  );
}

/** Seven unavailable rows, no receipts (a single scope-read failure). */
export function unavailableDelivery(): SchedulerDeliveryHealthSnapshot {
  return deliverySnapshot(
    EXTERNAL_SCHEDULER_JOBS.map((job) => deliveryRow(job, 'unavailable', null))
  );
}

// -- Provider-refresh snapshot ------------------------------------------------

export function canonicalScopeFor(
  dataset: ProviderDataset,
  year: number = YEAR
): ProviderRefreshScope {
  if (dataset === 'conferences') return globalScope();
  if (dataset === 'odds') return oddsTargetScope(year, 'canonical', defaultOddsCacheKey(year));
  return yearScope(year);
}

export function safeStatus(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope,
  overrides: Partial<SafeProviderRefreshStatus> = {}
): SafeProviderRefreshStatus {
  return {
    dataset,
    scope,
    scopeKey: providerRefreshScopeKey(dataset, scope),
    lastAttemptAt: null,
    latestAttemptOutcome: null,
    latestAttemptResolvedAt: null,
    lastSuccessAt: null,
    rowsCommitted: null,
    partialFailure: false,
    failedPartitions: [],
    durationMs: null,
    hasError: false,
    errorCode: null,
    errorStatus: null,
    ...overrides,
  };
}

export type RefreshOverride = {
  canonical?: CanonicalRefreshFact;
  latest?: LatestScopedActivityFact;
};

/** Six canonical-order rows, all absent by default; override per dataset. */
export function refreshSnapshot(
  overrides: Partial<Record<ProviderDataset, RefreshOverride>> = {},
  year: number = YEAR
): ProviderRefreshHealthSnapshot {
  const rows: ProviderRefreshHealthRow[] = PROVIDER_DATASETS.map((dataset) => {
    const scope = canonicalScopeFor(dataset, year);
    const o = overrides[dataset];
    return {
      dataset,
      canonicalScope: scope,
      canonicalScopeKey: providerRefreshScopeKey(dataset, scope),
      canonicalStatus: o?.canonical ?? { state: 'absent' },
      latestScopedActivity: o?.latest ?? { state: 'absent' },
    };
  });
  return { subsystem: 'available', rows };
}

/** A canonical-scope status with a specific attempt outcome. */
export function canonicalOutcome(
  dataset: ProviderDataset,
  outcome: ProviderAttemptOutcome,
  overrides: Partial<SafeProviderRefreshStatus> = {}
): CanonicalRefreshFact {
  const scope = canonicalScopeFor(dataset);
  return {
    state: 'available',
    status: safeStatus(dataset, scope, { latestAttemptOutcome: outcome, ...overrides }),
  };
}

// -- Other facts --------------------------------------------------------------

export function healthyStorage(): StorageHealthFact {
  return { state: 'available', mode: 'postgres', isProduction: true, databaseConfigured: true };
}

export function healthyAutomation(): AutomationHealth {
  const datasets = {} as Record<ProviderDataset, { enabled: boolean }>;
  for (const dataset of PROVIDER_DATASETS) datasets[dataset] = { enabled: true };
  return { state: 'available', globalPause: false, datasets };
}

export function allCache(availability: ProviderCacheStates[ProviderDataset]): ProviderCacheStates {
  const states = {} as ProviderCacheStates;
  for (const dataset of PROVIDER_DATASETS) states[dataset] = availability;
  return states;
}

/**
 * PLATFORM-090 — a per-dataset expectation map. The default is `expected` for
 * every dataset (the ordinary in-season case, and the pre-090 behavior), with an
 * optional override for the one dataset a test is exercising.
 */
export function allExpectations(
  base: ProviderDataExpectation = 'expected',
  overrides: Partial<ProviderDataExpectations> = {}
): ProviderDataExpectations {
  const expectations = {} as ProviderDataExpectations;
  for (const dataset of PROVIDER_DATASETS) expectations[dataset] = base;
  return { ...expectations, ...overrides };
}

export function emptyDiagnostics(): DiagnosticsFact {
  return { state: 'available', diagnostics: [] };
}

export function diagnosticsOf(diagnostics: SafeDiagnostic[]): DiagnosticsFact {
  return { state: 'available', diagnostics };
}

export function healthyQuota(): SystemHealthQuota {
  return {
    cfbd: {
      state: 'available',
      used: 100,
      remaining: 4900,
      limit: 5000,
      consistent: true,
      reserve: 1007,
      classification: 'ok',
    },
    odds: {
      state: 'available',
      used: 100,
      remaining: 400,
      limit: 500,
      threshold: 53,
      capturedAt: new Date(NOW).toISOString(),
      classification: 'ok',
    },
  };
}

/** A fully-healthy issue-derivation input; override any fact per test. */
export function baseInputs(
  overrides: Partial<SystemHealthIssueInputs> = {}
): SystemHealthIssueInputs {
  return {
    nowMs: NOW,
    storage: healthyStorage(),
    schedulerDelivery: healthyDelivery(),
    automation: healthyAutomation(),
    providerRefresh: refreshSnapshot(),
    cacheStates: allCache('available'),
    diagnostics: emptyDiagnostics(),
    quota: healthyQuota(),
    ...overrides,
  };
}
