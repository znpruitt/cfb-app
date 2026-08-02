/**
 * PLATFORM-086F2F — pure, deterministic derivation of the System Health issue
 * list from already-resolved facts. No I/O, no clock read, no provider call.
 *
 * The six fact domains stay independent here exactly as they are in the model:
 * scheduler DELIVERY (did an authenticated invocation arrive on time) is never
 * conflated with scheduler EXECUTION outcome, provider ATTEMPT outcome, canonical
 * DATA health, automation GATES, quota, or storage. A closed provider gate never
 * demotes a missing/late delivery; informational gate context never degrades the
 * overall state.
 *
 * Every issue carries a stable code, a safe STATIC explanation (never a copied
 * diagnostic message or thrown-error string), and a nullable, truthful repair
 * destination.
 */

import type { ProviderCacheStates } from './providerCacheState.ts';
import type {
  DiagnosticSeverity,
  ProviderDiagnosticCode,
  ProviderDiagnosticRepairSurface,
} from './providerDataDiagnostics.ts';
import type { ProviderRefreshHealthSnapshot } from './providerRefreshHealth.ts';
import { INTERRUPTED_ATTEMPT_AFTER_MS } from '../providerRefreshConstants.ts';
import type { SafeProviderRefreshStatus } from './providerRefreshHealth.ts';
import type { SchedulerDeliveryHealthSnapshot } from './schedulerDeliveryHealth.ts';
import { EXTERNAL_SCHEDULER_JOBS, type ExternalSchedulerJob } from './schedulerExecutionStatus.ts';
import {
  getProviderDatasetDescriptor,
  PROVIDER_DATASETS,
  type ProviderDataset,
} from '../providerDatasets.ts';

// -- Public issue contract -----------------------------------------------------

export type SystemHealthIssueSeverity = 'critical' | 'warning' | 'info';
export type SystemHealthIssueAxis = 'global' | 'job' | 'dataset';

/** A closed, nullable repair destination — never a fake link back to Diagnostics. */
export type SystemHealthRepair =
  | { surface: 'data-maintenance'; href: '/admin/data/cache'; label: string }
  | { surface: 'season-management'; href: '/admin/season'; label: string }
  | { surface: 'team-identity'; href: '/admin/aliases'; label: string }
  | null;

export type SchedulerIssueCode =
  | 'scheduler-delivery-missing'
  | 'scheduler-delivery-late'
  | 'scheduler-receipt-invalid'
  | 'scheduler-delivery-unavailable'
  | 'scheduler-execution-failed'
  | 'scheduler-execution-partial';

export type ProviderAttemptIssueCode =
  | 'provider-refresh-failed'
  | 'provider-refresh-partial'
  | 'provider-refresh-interrupted'
  | 'provider-status-invalid'
  | 'provider-status-unavailable';

export type AutomationIssueCode =
  | 'automation-global-pause-active'
  | 'automation-dataset-disabled'
  | 'automation-settings-unavailable';

export type QuotaIssueCode =
  | 'cfbd-quota-unavailable'
  | 'cfbd-quota-untrustworthy'
  | 'cfbd-automation-reserve-reached'
  | 'odds-quota-snapshot-absent'
  | 'odds-quota-unavailable'
  | 'odds-automation-reserve-reached';

export type StorageIssueCode = 'storage-production-misconfigured';

export type SystemHealthIssueCode =
  | StorageIssueCode
  | SchedulerIssueCode
  | ProviderAttemptIssueCode
  | AutomationIssueCode
  | QuotaIssueCode
  | ProviderDiagnosticCode;

export type SystemHealthIssue = {
  code: SystemHealthIssueCode;
  severity: SystemHealthIssueSeverity;
  subject: { axis: SystemHealthIssueAxis; id: string };
  title: string;
  explanation: string;
  repair: SystemHealthRepair;
};

export type SystemHealthOverallState = 'healthy' | 'degraded' | 'critical';

// -- Fact-input contracts (resolved by the orchestrator, injectable in tests) --

export type AutomationHealth =
  | {
      state: 'available';
      globalPause: boolean;
      datasets: Record<ProviderDataset, { enabled: boolean }>;
    }
  | { state: 'unavailable' };

/** A sanitized diagnostic: the pure derivation never sees the human message. */
export type SafeDiagnostic = {
  dataset: ProviderDataset;
  code: ProviderDiagnosticCode;
  severity: DiagnosticSeverity;
  repair: ProviderDiagnosticRepairSurface | null;
};

export type DiagnosticsFact =
  | { state: 'available'; diagnostics: SafeDiagnostic[] }
  | { state: 'unavailable' };

export type CfbdQuotaFact =
  | { state: 'unavailable' }
  | {
      state: 'available';
      used: number | null;
      remaining: number | null;
      limit: number | null;
      consistent: boolean;
      reserve: number;
      classification: 'ok' | 'untrustworthy' | 'reserve-reached';
    };

export type OddsQuotaFact =
  | { state: 'unavailable' }
  | { state: 'absent' }
  | {
      state: 'available';
      used: number;
      remaining: number;
      limit: number;
      threshold: number;
      classification: 'ok' | 'reserve-reached';
    };

export type SystemHealthQuota = { cfbd: CfbdQuotaFact; odds: OddsQuotaFact };

/**
 * Storage FACT — configuration mode plus read evidence, WITHOUT the filesystem
 * path (which must never be serialized). `postgres` proves configuration, not
 * database liveness, so it is never rendered as a positive "healthy database".
 */
export type StorageHealthFact =
  | {
      state: 'available';
      mode: 'postgres' | 'file-fallback' | 'production-misconfigured';
      isProduction: boolean;
      databaseConfigured: boolean;
    }
  | { state: 'unavailable' };

export type SystemHealthIssueInputs = {
  nowMs: number;
  storage: StorageHealthFact;
  schedulerDelivery: SchedulerDeliveryHealthSnapshot;
  automation: AutomationHealth;
  providerRefresh: ProviderRefreshHealthSnapshot;
  cacheStates: ProviderCacheStates;
  diagnostics: DiagnosticsFact;
  quota: SystemHealthQuota;
};

// -- Repair materialization ----------------------------------------------------

const LIFECYCLE_JOBS: ReadonlySet<ExternalSchedulerJob> = new Set([
  'season-transition',
  'season-rollover',
]);

function repairFor(surface: ProviderDiagnosticRepairSurface | null): SystemHealthRepair {
  switch (surface) {
    case 'data-maintenance':
      return { surface, href: '/admin/data/cache', label: 'Open Data Maintenance & Recovery' };
    case 'season-management':
      return { surface, href: '/admin/season', label: 'Open Season Management' };
    case 'team-identity':
      return { surface, href: '/admin/aliases', label: 'Open Team Identity' };
    default:
      return null;
  }
}

function datasetLabel(dataset: ProviderDataset): string {
  return getProviderDatasetDescriptor(dataset).label;
}

/** Static per-code explanation for a canonical-data diagnostic (never the message). */
const DIAGNOSTIC_EXPLANATION: Record<ProviderDiagnosticCode, string> = {
  'schedule-cache-missing': 'No current-season schedule is cached for the selected year.',
  'schedule-refresh-partial':
    'The last schedule refresh completed only partially; some partitions are uncertain.',
  'schedule-cache-stale': 'The cached schedule is older than the weekly refresh policy allows.',
  'schedule-diagnostics-unavailable': 'Schedule diagnostics could not be evaluated.',
  'scores-terminal-coverage-missing': 'Completed slates have no cached terminal scores.',
  'scores-terminal-coverage-partial': 'Some completed slates are missing cached terminal scores.',
  'scores-diagnostics-unavailable': 'Score diagnostics could not be evaluated.',
  'game-stats-context-unavailable': 'The canonical game-stats context could not be loaded.',
  'game-stats-latest-slate-missing':
    'The latest completed slate has no verified game-stat evidence.',
  'game-stats-older-slate-missing':
    'Older completed slates are missing verified game-stat evidence.',
  'game-stats-evidence-partial':
    'Some completed slates have only partially verified game-stat evidence.',
  'game-stats-duplicate-conflict':
    'Stored game-stat evidence has duplicate/conflict records that need recovery.',
  'game-stats-identity-mismatch':
    'Stored game-stat evidence references participants that fail identity resolution.',
  'game-stats-participant-validation-unavailable':
    'Game-stat participant validation is unavailable; a full-year schedule refresh is required.',
  'game-stats-record-unservable': 'Stored game-stat records are malformed or unreadable.',
  'game-stats-diagnostics-unavailable': 'Game-stats diagnostics could not be evaluated.',
  'rankings-cache-missing': 'No rankings are cached for the selected year.',
  'rankings-cache-stale': 'The cached rankings are older than the weekly refresh policy allows.',
  'rankings-diagnostics-unavailable': 'Rankings diagnostics could not be evaluated.',
  'odds-cache-missing': 'No canonical odds snapshot is cached for the selected year.',
  'odds-cache-stale': 'The canonical odds snapshot is older than its freshness policy allows.',
  'odds-diagnostics-unavailable': 'Odds diagnostics could not be evaluated.',
};

function diagnosticSeverityToIssue(severity: DiagnosticSeverity): SystemHealthIssueSeverity {
  return severity === 'error' ? 'critical' : severity === 'warning' ? 'warning' : 'info';
}

// -- Per-domain issue builders -------------------------------------------------

function storageIssues(storage: StorageHealthFact): SystemHealthIssue[] {
  // A `postgres` mode proves CONFIGURATION, not database liveness — never emit a
  // "storage healthy" issue from mode alone. Only the misconfigured mode is a fault.
  if (storage.state !== 'available' || storage.mode !== 'production-misconfigured') return [];
  return [
    {
      code: 'storage-production-misconfigured',
      severity: 'critical',
      subject: { axis: 'global', id: 'storage' },
      title: 'Durable storage is misconfigured for production',
      explanation:
        'This production deployment has no configured durable database, so app-state cannot persist reliably. Configure the production database connection.',
      repair: null,
    },
  ];
}

function schedulerDeliveryIssues(snapshot: SchedulerDeliveryHealthSnapshot): SystemHealthIssue[] {
  const jobs = snapshot.jobs;
  const allUnavailable =
    jobs.length > 0 && jobs.every((row) => row.deliveryState === 'unavailable');
  if (allUnavailable) {
    // One scope-read failure → ONE global issue, never seven duplicates.
    return [
      {
        code: 'scheduler-delivery-unavailable',
        severity: 'warning',
        subject: { axis: 'global', id: 'scheduler' },
        title: 'Scheduler delivery status is unavailable',
        explanation:
          'The scheduler receipt store could not be read, so no job’s delivery timeliness can be confirmed.',
        repair: null,
      },
    ];
  }

  const issues: SystemHealthIssue[] = [];
  for (const row of jobs) {
    const base = { subject: { axis: 'job' as const, id: row.job }, repair: null };
    switch (row.deliveryState) {
      case 'missing':
        issues.push({
          ...base,
          code: 'scheduler-delivery-missing',
          severity: 'warning',
          title: `${row.job} has not delivered on schedule`,
          explanation: `No recent authenticated ${row.job} invocation (${row.cadenceLabel}) is recorded. This cannot distinguish a scheduler (${row.source}) failure from a best-effort receipt-write failure.`,
        });
        break;
      case 'late':
        issues.push({
          ...base,
          code: 'scheduler-delivery-late',
          severity: 'warning',
          title: `${row.job} delivered later than scheduled`,
          explanation: `The last authenticated ${row.job} invocation (${row.cadenceLabel}) arrived later than its schedule allows. This cannot distinguish a scheduler (${row.source}) delay from a delayed receipt write.`,
        });
        break;
      case 'invalid':
        issues.push({
          ...base,
          code: 'scheduler-receipt-invalid',
          severity: 'warning',
          title: `${row.job} execution receipt is malformed`,
          explanation: `The most recent ${row.job} execution receipt could not be parsed, so its delivery timeliness cannot be confirmed.`,
        });
        break;
      case 'unavailable':
        // Defensive: the reader marks delivery unavailable all-or-none, so this
        // per-job path is unreachable when only some rows are unavailable.
        issues.push({
          ...base,
          code: 'scheduler-delivery-unavailable',
          severity: 'warning',
          title: `${row.job} delivery status is unavailable`,
          explanation: `The ${row.job} execution receipt could not be read.`,
        });
        break;
      case 'on-time':
        break;
    }
  }
  return issues;
}

function schedulerExecutionIssues(snapshot: SchedulerDeliveryHealthSnapshot): SystemHealthIssue[] {
  // Execution outcome is inspected from the safely-parsed receipt INDEPENDENTLY
  // of delivery timeliness: a late-but-successful run raises no execution fault,
  // and an on-time failed run raises one.
  const issues: SystemHealthIssue[] = [];
  for (const row of snapshot.jobs) {
    const receipt = row.receipt;
    if (!receipt) continue;
    const lifecycle = LIFECYCLE_JOBS.has(row.job);
    const repair = lifecycle ? repairFor('season-management') : repairFor('data-maintenance');
    if (receipt.result === 'failure') {
      issues.push({
        code: 'scheduler-execution-failed',
        severity: 'warning',
        subject: { axis: 'job', id: row.job },
        title: `${row.job} execution failed`,
        explanation: `The most recent ${row.job} invocation reported a failed execution result.`,
        repair,
      });
    } else if (receipt.result === 'partial') {
      issues.push({
        code: 'scheduler-execution-partial',
        severity: 'warning',
        subject: { axis: 'job', id: row.job },
        title: `${row.job} execution was partial`,
        explanation: `The most recent ${row.job} invocation reported a partial execution result.`,
        repair,
      });
    }
    // success / no-op / skipped / in-progress → no fault issue.
  }
  return issues;
}

function attemptFaultIssue(
  dataset: ProviderDataset,
  status: SafeProviderRefreshStatus,
  cacheState: ProviderCacheStates[ProviderDataset],
  nowMs: number
): SystemHealthIssue | null {
  const label = datasetLabel(dataset);
  switch (status.latestAttemptOutcome) {
    case 'failed': {
      // Critical only when the cache is PROVEN absent; available/unknown → warning.
      const critical = cacheState === 'absent';
      return {
        code: 'provider-refresh-failed',
        severity: critical ? 'critical' : 'warning',
        subject: { axis: 'dataset', id: dataset },
        title: `${label} refresh failed`,
        explanation: critical
          ? 'The latest refresh attempt failed and no cached data is available to serve.'
          : 'The latest refresh attempt failed; prior-good cached data may still be serving.',
        repair: repairFor('data-maintenance'),
      };
    }
    case 'partial':
      return {
        code: 'provider-refresh-partial',
        severity: 'warning',
        subject: { axis: 'dataset', id: dataset },
        title: `${label} refresh was partial`,
        explanation: 'The latest refresh attempt committed only some partitions.',
        repair: repairFor('data-maintenance'),
      };
    case 'in-progress': {
      if (status.lastAttemptAt) {
        const startedMs = Date.parse(status.lastAttemptAt);
        if (Number.isFinite(startedMs) && nowMs - startedMs > INTERRUPTED_ATTEMPT_AFTER_MS) {
          return {
            code: 'provider-refresh-interrupted',
            severity: 'warning',
            subject: { axis: 'dataset', id: dataset },
            title: `${label} refresh appears interrupted`,
            explanation:
              'A refresh attempt began but never resolved within the interrupted-attempt threshold.',
            repair: repairFor('data-maintenance'),
          };
        }
      }
      return null; // still in progress, not yet interrupted
    }
    default:
      return null; // succeeded / no-op / null → no fault
  }
}

function providerAttemptIssues(
  snapshot: ProviderRefreshHealthSnapshot,
  cacheStates: ProviderCacheStates,
  nowMs: number
): SystemHealthIssue[] {
  if (snapshot.subsystem === 'unavailable') {
    // One scope-read failure → ONE global issue; do not fabricate empty history.
    return [
      {
        code: 'provider-status-unavailable',
        severity: 'warning',
        subject: { axis: 'global', id: 'provider-status' },
        title: 'Provider refresh status is unavailable',
        explanation:
          'The provider refresh status store could not be read, so no dataset’s latest attempt outcome can be confirmed.',
        repair: null,
      },
    ];
  }

  const issues: SystemHealthIssue[] = [];
  for (const row of snapshot.rows) {
    if (row.canonicalStatus.state === 'invalid') {
      issues.push({
        code: 'provider-status-invalid',
        severity: 'warning',
        subject: { axis: 'dataset', id: row.dataset },
        title: `${datasetLabel(row.dataset)} refresh status is malformed`,
        explanation:
          'The stored refresh status for this dataset’s canonical target could not be parsed.',
        repair: null,
      });
    }

    // Evaluate canonical status and latest scoped activity independently, but
    // dedupe when they resolve to the SAME scope (same record, one fault).
    const evaluated = new Set<string>();
    const facts: SafeProviderRefreshStatus[] = [];
    if (row.canonicalStatus.state === 'available') facts.push(row.canonicalStatus.status);
    if (row.latestScopedActivity.state === 'available') facts.push(row.latestScopedActivity.status);
    for (const status of facts) {
      if (evaluated.has(status.scopeKey)) continue;
      evaluated.add(status.scopeKey);
      const issue = attemptFaultIssue(row.dataset, status, cacheStates[row.dataset], nowMs);
      if (issue) issues.push(issue);
    }
    // A merely-absent canonical status or latest activity is NOT an issue.
  }
  return issues;
}

function canonicalDataIssues(diagnostics: DiagnosticsFact): SystemHealthIssue[] {
  if (diagnostics.state !== 'available') return [];
  return diagnostics.diagnostics.map((diag) => ({
    code: diag.code,
    severity: diagnosticSeverityToIssue(diag.severity),
    subject: { axis: 'dataset', id: diag.dataset },
    title: `${datasetLabel(diag.dataset)}: ${diag.code}`,
    explanation: DIAGNOSTIC_EXPLANATION[diag.code],
    repair: repairFor(diag.repair),
  }));
}

function automationIssues(automation: AutomationHealth): SystemHealthIssue[] {
  if (automation.state === 'unavailable') {
    // A read failure is a fault (never default the gates to open/enabled).
    return [
      {
        code: 'automation-settings-unavailable',
        severity: 'warning',
        subject: { axis: 'global', id: 'automation' },
        title: 'Automation settings are unavailable',
        explanation:
          'The provider automation settings could not be read; pause/enable state is unknown and is not assumed to be open.',
        repair: null,
      },
    ];
  }

  const issues: SystemHealthIssue[] = [];
  // Gate state is INFORMATIONAL context only — never a fault, never degrading.
  if (automation.globalPause) {
    issues.push({
      code: 'automation-global-pause-active',
      severity: 'info',
      subject: { axis: 'global', id: 'automation' },
      title: 'Automatic refresh is globally paused',
      explanation:
        'Global automatic provider refresh is paused. Scheduler invocations still arrive and record skipped receipts.',
      repair: null,
    });
  }
  for (const dataset of PROVIDER_DATASETS) {
    if (!automation.datasets[dataset].enabled) {
      issues.push({
        code: 'automation-dataset-disabled',
        severity: 'info',
        subject: { axis: 'dataset', id: dataset },
        title: `${datasetLabel(dataset)} automatic refresh is disabled`,
        explanation: 'Automatic refresh for this dataset is turned off by an operator setting.',
        repair: null,
      });
    }
  }
  return issues;
}

function quotaIssues(quota: SystemHealthQuota): SystemHealthIssue[] {
  const issues: SystemHealthIssue[] = [];

  // CFBD — headroom against the largest active automation requirement (1,007).
  if (quota.cfbd.state === 'unavailable') {
    issues.push({
      code: 'cfbd-quota-unavailable',
      severity: 'warning',
      subject: { axis: 'global', id: 'cfbd-quota' },
      title: 'CFBD quota is unavailable',
      explanation: 'The CFBD usage observation could not be read.',
      repair: null,
    });
  } else if (quota.cfbd.classification === 'untrustworthy') {
    issues.push({
      code: 'cfbd-quota-untrustworthy',
      severity: 'warning',
      subject: { axis: 'global', id: 'cfbd-quota' },
      title: 'CFBD quota is untrustworthy',
      explanation:
        'The CFBD usage observation did not include a trustworthy remaining-calls value.',
      repair: null,
    });
  } else if (quota.cfbd.classification === 'reserve-reached') {
    issues.push({
      code: 'cfbd-automation-reserve-reached',
      severity: 'warning',
      subject: { axis: 'global', id: 'cfbd-quota' },
      title: 'CFBD automation reserve reached',
      explanation:
        'CFBD remaining calls are at or below the automation reserve; automatic CFBD refreshes will be withheld.',
      repair: null,
    });
  }

  // Odds — headroom against the canonical automatic request threshold (53).
  if (quota.odds.state === 'unavailable') {
    issues.push({
      code: 'odds-quota-unavailable',
      severity: 'warning',
      subject: { axis: 'global', id: 'odds-quota' },
      title: 'Odds quota is unavailable',
      explanation: 'The durable Odds usage snapshot could not be read.',
      repair: null,
    });
  } else if (quota.odds.state === 'absent') {
    issues.push({
      code: 'odds-quota-snapshot-absent',
      severity: 'info',
      subject: { axis: 'global', id: 'odds-quota' },
      title: 'No Odds usage snapshot yet',
      explanation: 'No durable Odds usage snapshot has been recorded yet.',
      repair: null,
    });
  } else if (quota.odds.classification === 'reserve-reached') {
    issues.push({
      code: 'odds-automation-reserve-reached',
      severity: 'warning',
      subject: { axis: 'global', id: 'odds-quota' },
      title: 'Odds automation reserve reached',
      explanation:
        'Odds remaining credits are below the automatic request threshold; automatic Odds refreshes will be withheld.',
      repair: null,
    });
  }

  return issues;
}

// -- Deterministic aggregation -------------------------------------------------

function severityRank(severity: SystemHealthIssueSeverity): number {
  return severity === 'critical' ? 0 : severity === 'warning' ? 1 : 2;
}

function axisRank(axis: SystemHealthIssueAxis): number {
  return axis === 'global' ? 0 : axis === 'job' ? 1 : 2;
}

function canonicalIndex(issue: SystemHealthIssue): number {
  if (issue.subject.axis === 'job') {
    const i = EXTERNAL_SCHEDULER_JOBS.indexOf(issue.subject.id as ExternalSchedulerJob);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  }
  if (issue.subject.axis === 'dataset') {
    const i = PROVIDER_DATASETS.indexOf(issue.subject.id as ProviderDataset);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  }
  return 0;
}

function compareIssues(a: SystemHealthIssue, b: SystemHealthIssue): number {
  return (
    severityRank(a.severity) - severityRank(b.severity) ||
    axisRank(a.subject.axis) - axisRank(b.subject.axis) ||
    canonicalIndex(a) - canonicalIndex(b) ||
    a.subject.id.localeCompare(b.subject.id) ||
    a.code.localeCompare(b.code)
  );
}

/**
 * Derive the complete, deterministically ordered, de-duplicated issue list from
 * the resolved facts. Order: severity → axis → canonical job/dataset order →
 * subject id → code. Only IDENTICAL issue identities (code + axis + id) are
 * deduplicated; distinct facts are never combined.
 */
export function deriveSystemHealthIssues(inputs: SystemHealthIssueInputs): SystemHealthIssue[] {
  const all: SystemHealthIssue[] = [
    ...storageIssues(inputs.storage),
    ...schedulerDeliveryIssues(inputs.schedulerDelivery),
    ...schedulerExecutionIssues(inputs.schedulerDelivery),
    ...providerAttemptIssues(inputs.providerRefresh, inputs.cacheStates, inputs.nowMs),
    ...canonicalDataIssues(inputs.diagnostics),
    ...automationIssues(inputs.automation),
    ...quotaIssues(inputs.quota),
  ];

  all.sort(compareIssues);

  const seen = new Set<string>();
  const deduped: SystemHealthIssue[] = [];
  for (const issue of all) {
    const identity = `${issue.code}|${issue.subject.axis}|${issue.subject.id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    deduped.push(issue);
  }
  return deduped;
}

export type SystemHealthIssueSummary = {
  overallState: SystemHealthOverallState;
  issueCounts: { critical: number; warning: number; info: number };
};

/** Summarize issues into overall state + counts. Info-only stays `healthy`. */
export function summarizeSystemHealthIssues(issues: SystemHealthIssue[]): SystemHealthIssueSummary {
  const issueCounts = { critical: 0, warning: 0, info: 0 };
  for (const issue of issues) issueCounts[issue.severity] += 1;
  const overallState: SystemHealthOverallState =
    issueCounts.critical > 0 ? 'critical' : issueCounts.warning > 0 ? 'degraded' : 'healthy';
  return { overallState, issueCounts };
}
