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

/**
 * PLATFORM-086F2H3B2 — production league records an automation job REFUSED for a
 * structurally unusable lifecycle year. Separate from the scheduler codes on
 * purpose: those describe how a RUN went, this describes stored data that is
 * wrong regardless of how any run went.
 */
export type LifecycleIntegrityIssueCode = 'lifecycle-data-unusable';

/** Canonical-data subsystem-level codes (distinct from per-branch ProviderDiagnosticCode). */
export type CanonicalDataIssueCode = 'data-diagnostics-unavailable';

export type SystemHealthIssueCode =
  | StorageIssueCode
  | SchedulerIssueCode
  | ProviderAttemptIssueCode
  | AutomationIssueCode
  | QuotaIssueCode
  | CanonicalDataIssueCode
  | LifecycleIntegrityIssueCode
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
      /** Validated ISO observation time of the durable snapshot, or null. */
      capturedAt: string | null;
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

/**
 * A duration an operator can act on, at the granularity that changes the decision.
 *
 * "Late" spans four orders of magnitude here — a live-scores run can miss its slot
 * by ninety seconds, and a preview store can be three days behind — and the only
 * question being asked is "minutes or days". So the largest two units are enough
 * and the smallest is a minute; seconds add noise to a judgement nobody makes on
 * seconds.
 */
function formatLateness(ms: number): string {
  // Thresholded on the RAW span, not on the rounded minute count: rounding first
  // turned 30 seconds into "1m", so the sub-minute case could never be reached
  // and a job that missed its slot by half a minute was reported in the same
  // units as one that missed it by an hour.
  if (ms < 60_000) return 'under a minute';
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/**
 * An ABSOLUTE UTC instant, because the reader is comparing two of these and a
 * relative rendering defeats that.
 *
 * The System Health page renders `Required slot` and `Completed` as relative
 * moments in two different sections, so working out how late a job actually was
 * meant diffing "7m ago" against "Friday" by eye — which is how a three-day gap
 * read as routine. Everything in this app schedules in UTC (`vercel.json` crons,
 * the QStash schedules, and every cadence label), so UTC is also the unit the
 * schedules are written in.
 */
function utcInstant(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'an unreadable time';
  return new Date(ms)
    .toISOString()
    .replace('T', ' ')
    .replace(/:\d{2}\.\d{3}Z$/, ' UTC');
}

function schedulerDeliveryIssues(
  snapshot: SchedulerDeliveryHealthSnapshot,
  nowMs: number
): SystemHealthIssue[] {
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
          // HOW LONG is the whole question here too — "no recent invocation" is
          // the same sentence for a job that missed one slot and one that has
          // been silent for a week.
          explanation: `No recent authenticated ${row.job} invocation (${row.cadenceLabel}) is recorded; one was due by ${utcInstant(row.requiredStartedAt)}, ${formatLateness(nowMs - Date.parse(row.requiredStartedAt))} ago. This cannot distinguish a scheduler (${row.source}) failure from a best-effort receipt-write failure.`,
        });
        break;
      case 'late': {
        // WHEN IT WAS DUE, WHEN IT ARRIVED, AND BY HOW MUCH. All three facts are
        // on `row` and none of them used to reach the reader: the warning said
        // only "later than its schedule allows", and reconstructing the gap meant
        // diffing `Required slot` against `Completed` by eye, in two different
        // sections, in two different relative formats. A three-day gap and a
        // ninety-second one read identically.
        const arrived = row.receipt ? utcInstant(row.receipt.startedAt) : 'never';
        const lateBy = row.receipt
          ? formatLateness(Date.parse(row.receipt.startedAt) - Date.parse(row.requiredStartedAt))
          : null;
        issues.push({
          ...base,
          code: 'scheduler-delivery-late',
          severity: 'warning',
          title: `${row.job} delivered later than scheduled`,
          explanation: `The last authenticated ${row.job} invocation (${row.cadenceLabel}) was due by ${utcInstant(row.requiredStartedAt)} and arrived ${arrived}${lateBy ? ` — ${lateBy} late` : ''}. This cannot distinguish a scheduler (${row.source}) delay from a delayed receipt write.`,
        });
        break;
      }
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
    // PLATFORM-086F2H4 — a LIFECYCLE job's execution fault offers NO repair.
    // It previously pointed at Season Management, which was already recorded as
    // questionable (that page could not repair a lifecycle fault) and is now
    // retired outright. `SystemHealthRepair` documents null as "never a fake
    // link", and this matches what F2H3B2 established for
    // `lifecycle-data-unusable`: there is no supported operation that repairs a
    // production lifecycle record, so naming a destination would be a claim.
    const lifecycle = LIFECYCLE_JOBS.has(row.job);
    const repair = lifecycle ? null : repairFor('data-maintenance');
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

/**
 * PLATFORM-086F2H3B2 — ONE issue when any scheduler receipt reports production
 * league records refused for an unusable lifecycle year. Closes deferral (q),
 * carried since PLATFORM-086F2H1R3.
 *
 * NOT derived from `result`. The count lives on the receipt TARGET, and R3's
 * ruling is that a valid target can succeed while another production record is
 * refused — so a run whose aggregate is `success`, `no-op`, or `skipped` can
 * still be carrying refusals. Gating on `result` would hide exactly the case
 * this issue exists to surface.
 *
 * NO NUMBER reaches the operator, and that is a data constraint rather than a
 * style choice. Each count is per JOB and per RUN, counts RECORDS, and the same
 * corrupt league is counted independently by up to four jobs (season-transition
 * while it is preseason; schedule-refresh, rankings, and season-rollover while
 * it is in season). Summing multiplies one league into several; a maximum
 * compares runs that happened at different times; and a deduplicated league
 * count is not derivable at all, because a receipt carries counts and never a
 * slug. Naming the reporting JOBS is the most specific true thing available.
 *
 * A receipt that is absent or unparsed contributes nothing. `receipt` is null
 * for `missing` / `invalid` / `unavailable` delivery, and a run with no readable
 * receipt cannot report a count — inferring one would be fabrication.
 *
 * CLEARING: when no parsed receipt reports a positive count. A STALE receipt
 * therefore holds the warning up until its job runs again. That is correct — the
 * stored record stays corrupt until it is repaired, and the last thing any job
 * observed is still the best evidence available — but it is deliberate, not an
 * oversight.
 *
 * `repair` is null. There is no supported operation that writes a lifecycle
 * status or year onto a PRODUCTION record: `updateLeague` throws on `year`/
 * `status`, `PATCH /api/admin/leagues/[slug]` answers 409 for both,
 * the settings Season Year input is read-only, and `resetTestLeagueLifecycle`
 * takes no slug and reaches only the demo league. Recovery is PLATFORM-087's and
 * is unscheduled. There is also nowhere left to link even if a claim were
 * wanted: PLATFORM-086F2H4 retired `/admin/season` outright, and the repair
 * surface it backed went with it — the "never a fake link" case
 * `SystemHealthRepair` documents.
 */
function lifecycleIntegrityIssues(snapshot: SchedulerDeliveryHealthSnapshot): SystemHealthIssue[] {
  const reportingJobs = snapshot.jobs
    .filter((row) => {
      const target = row.receipt?.target;
      // `SchedulerExecutionTarget` is a union and only the four lifecycle-bearing
      // variants carry the count, so the field is narrowed rather than cast. The
      // `in` test is deliberately structural, not a kind allowlist: the field
      // means the same thing wherever it appears, so a job that starts reporting
      // refusals is counted without this list having to be maintained in a
      // second place.
      return (
        target !== undefined &&
        'invalidLifecycleTargets' in target &&
        target.invalidLifecycleTargets > 0
      );
    })
    .map((row) => row.job);

  if (reportingJobs.length === 0) return [];

  return [
    {
      code: 'lifecycle-data-unusable',
      severity: 'warning',
      // Warning, not critical: valid targets keep processing, and a wholly
      // refused run already raises `scheduler-execution-failed`. This is
      // ADDITIVE to that — the two answer different questions and both may
      // appear on one dashboard.
      subject: { axis: 'global', id: 'lifecycle-integrity' },
      title: 'Production lifecycle data is unusable',
      explanation:
        'Automatic processing refused production lifecycle data. Some processing may be ' +
        `incomplete. Reported by: ${reportingJobs.join(', ')}.`,
      repair: null,
    },
  ];
}

function failedAttemptIssue(
  dataset: ProviderDataset,
  cacheState: ProviderCacheStates[ProviderDataset]
): SystemHealthIssue {
  // Critical only when the cache is PROVEN absent; available/unknown → warning.
  const critical = cacheState === 'absent';
  return {
    code: 'provider-refresh-failed',
    severity: critical ? 'critical' : 'warning',
    subject: { axis: 'dataset', id: dataset },
    title: `${datasetLabel(dataset)} refresh failed`,
    explanation: critical
      ? 'The latest refresh attempt failed and no cached data is available to serve.'
      : 'The latest refresh attempt failed; prior-good cached data may still be serving.',
    repair: repairFor('data-maintenance'),
  };
}

function partialAttemptIssue(dataset: ProviderDataset): SystemHealthIssue {
  return {
    code: 'provider-refresh-partial',
    severity: 'warning',
    subject: { axis: 'dataset', id: dataset },
    title: `${datasetLabel(dataset)} refresh was partial`,
    explanation: 'The latest refresh attempt committed only some partitions.',
    repair: repairFor('data-maintenance'),
  };
}

function attemptFaultIssue(
  dataset: ProviderDataset,
  status: SafeProviderRefreshStatus,
  cacheState: ProviderCacheStates[ProviderDataset],
  nowMs: number
): SystemHealthIssue | null {
  const label = datasetLabel(dataset);
  switch (status.latestAttemptOutcome) {
    case 'failed':
      return failedAttemptIssue(dataset, cacheState);
    case 'partial':
      return partialAttemptIssue(dataset);
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
    case null:
      // Legacy pre-`latestAttemptOutcome` record: infer the fault from the
      // preserved fields it still encodes (mirrors the admin panel's fallback),
      // so an old failed/partial refresh is never silently read as healthy.
      if (status.hasError) return failedAttemptIssue(dataset, cacheState);
      if (status.partialFailure) return partialAttemptIssue(dataset);
      return null;
    default:
      return null; // succeeded / no-op → no fault
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
      // The cache probe describes the dataset's CANONICAL target only. A fault
      // on a NONCANONICAL scoped activity (a filtered Odds target, one scores
      // week) has no matching cache signal, so its availability is `unknown`
      // rather than the canonical cache's — never manufacturing (or clearing) a
      // critical "no cached data" claim from an unrelated cache (AGENTS.md scoped
      // -status invariant).
      const cacheState =
        status.scopeKey === row.canonicalScopeKey ? cacheStates[row.dataset] : 'unknown';
      const issue = attemptFaultIssue(row.dataset, status, cacheState, nowMs);
      if (issue) issues.push(issue);
    }
    // A merely-absent canonical status or latest activity is NOT an issue.
  }
  return issues;
}

function canonicalDataIssues(diagnostics: DiagnosticsFact): SystemHealthIssue[] {
  if (diagnostics.state === 'unavailable') {
    // A failed diagnostics pass must be VISIBLE (parity with the scheduler- and
    // provider-status subsystem-unavailable globals) — never silently collapsed
    // into "no data issues", which would read as healthy.
    return [
      {
        code: 'data-diagnostics-unavailable',
        severity: 'warning',
        subject: { axis: 'global', id: 'data-diagnostics' },
        title: 'Canonical data diagnostics are unavailable',
        explanation:
          'The canonical data diagnostics pass could not be completed, so data-health issues cannot be evaluated.',
        repair: null,
      },
    ];
  }
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
    if (automation.datasets[dataset].enabled) continue;
    const descriptor = getProviderDatasetDescriptor(dataset);
    // Only a dataset whose toggle an ACTIVE job actually consumes has a real
    // "disabled" effect — surfacing it for a dataset no job consumes (e.g.
    // Conferences) would imply a runtime effect that does not exist.
    if (!descriptor.autoRefreshSettingConsumed) continue;
    issues.push({
      code: 'automation-dataset-disabled',
      severity: 'info',
      subject: { axis: 'dataset', id: dataset },
      title: `${datasetLabel(dataset)} automatic refresh is disabled`,
      // A lifecycle-critical dataset's toggle pauses only ORDINARY maintenance;
      // the lifecycle-critical operations stay exempt, so say so rather than
      // claiming all of its automation is stopped.
      explanation: descriptor.lifecycleCritical
        ? 'Ordinary automatic refresh for this dataset is turned off by an operator setting; lifecycle-critical operations remain exempt.'
        : 'Automatic refresh for this dataset is turned off by an operator setting.',
      repair: null,
    });
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
    ...schedulerDeliveryIssues(inputs.schedulerDelivery, inputs.nowMs),
    ...schedulerExecutionIssues(inputs.schedulerDelivery),
    ...providerAttemptIssues(inputs.providerRefresh, inputs.cacheStates, inputs.nowMs),
    ...canonicalDataIssues(inputs.diagnostics),
    ...lifecycleIntegrityIssues(inputs.schedulerDelivery),
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
