/**
 * Shared fixtures for the PLATFORM-086F2F System Health tests. Pure builders —
 * no I/O, no clock read. Every default is a "healthy" fact that individual tests
 * override to exercise one domain at a time.
 */

import type { ProviderCacheStates } from '../providerCacheState.ts';
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

function targetFor(job: ExternalSchedulerJob): SchedulerExecutionTarget {
  switch (job) {
    case 'live-scores':
      return { kind: 'live-scores', year: YEAR, mode: null, targetGames: 0, targetPartitions: 0 };
    case 'game-stats':
      return { kind: 'game-stats', year: YEAR, week: null, seasonType: null };
    case 'odds':
      return { kind: 'odds', year: YEAR, cadence: null, eligibleGames: 0 };
    case 'schedule-refresh':
      return scheduleYearsTarget([{ year: YEAR, operation: null }]);
    case 'rankings':
      return rankingsYearsTarget([{ year: YEAR, publicationWindow: null }]);
    case 'season-transition':
      return seasonTransitionYearsTarget(
        [{ year: YEAR, targetLeagues: 1, probed: true, transitionedLeagues: 0 }],
        0
      );
    case 'season-rollover':
      return seasonRolloverYearsTarget([{ year: YEAR, targetLeagues: 1, rolledOverLeagues: 0 }]);
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
  const receipt = buildSchedulerExecutionReceipt({
    job,
    invocationId: `id-${job}-${startedAtMs}`,
    startedAtMs,
    completedAtMs: startedAtMs + 1000,
    result,
    reason: REASON_FOR[job],
    providerCallAttempted: false,
    target: targetFor(job),
  });
  if (!receipt) throw new Error(`fixture receipt failed to build for ${job}`);
  return receipt;
}

export function deliveryRow(
  job: ExternalSchedulerJob,
  deliveryState: SchedulerDeliveryHealthRow['deliveryState'],
  receipt: SchedulerExecutionReceipt | null
): SchedulerDeliveryHealthRow {
  return {
    job,
    source: schedulerSourceForJob(job),
    cron: '* * * * *',
    cadenceLabel: 'test cadence',
    graceMs: 0,
    requiredStartedAt: new Date(NOW).toISOString(),
    deliveryState,
    receipt,
  };
}

export function deliverySnapshot(
  rows: SchedulerDeliveryHealthRow[]
): SchedulerDeliveryHealthSnapshot {
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
