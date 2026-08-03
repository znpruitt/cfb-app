/**
 * PLATFORM-086F2G — server-side derivation of the six "stoplight" section panels
 * from the already-derived System Health facts + issues. This is HEALTH POLICY
 * and therefore lives on the server (deterministically tested), NOT in React —
 * the UI only maps a panel's `status` to a visual treatment.
 *
 * Panels never invent new truth: each panel's status is derived from the model's
 * issues (whose codes/severity already encode the F2F distinctions) plus the
 * automation/quota/storage facts. The two axes stay separate (a scheduler panel
 * and a provider-data panel), and delivery-vs-execution / freshness-vs-cadence
 * distinctions are preserved because they are already encoded in the issues.
 */

import type {
  AutomationHealth,
  StorageHealthFact,
  SystemHealthIssue,
  SystemHealthOverallState,
  SystemHealthQuota,
} from './systemHealthIssues.ts';
import type { DiagnosticSeverity } from './providerDataDiagnostics.ts';
import type { ProviderCacheAvailability } from './providerCacheState.ts';
import type { ProviderDataset } from '../providerDatasets.ts';

export type PanelStatus = 'green' | 'yellow' | 'red' | 'gray';

export type SystemHealthPanelKey =
  | 'overall'
  | 'scheduler'
  | 'provider-data'
  | 'automation'
  | 'quota'
  | 'storage';

export type SystemHealthPanel = {
  key: SystemHealthPanelKey;
  title: string;
  status: PanelStatus;
  /** Accessible state label (never color alone): Healthy / Attention needed / Action required / Paused / Unknown / Awaiting activity. */
  stateLabel: string;
  /** At most one concise sentence. */
  detail: string;
  /** Most relevant ISO timestamp, or null when none is useful. */
  timestamp: string | null;
  /** A short prefix word for the timestamp ("Checked" / "Snapshot"), or null. */
  timestampPrefix: string | null;
};

export type SystemHealthPanelsInput = {
  generatedAt: string;
  overallState: SystemHealthOverallState;
  issues: SystemHealthIssue[];
  automation: AutomationHealth;
  quota: SystemHealthQuota;
  storage: StorageHealthFact;
};

const SCHEDULER_CODES = new Set<string>([
  'scheduler-delivery-missing',
  'scheduler-delivery-late',
  'scheduler-receipt-invalid',
  'scheduler-delivery-unavailable',
  'scheduler-execution-failed',
  'scheduler-execution-partial',
]);
const AUTOMATION_CODES = new Set<string>([
  'automation-global-pause-active',
  'automation-dataset-disabled',
  'automation-settings-unavailable',
]);
const QUOTA_CODES = new Set<string>([
  'cfbd-quota-unavailable',
  'cfbd-quota-untrustworthy',
  'cfbd-automation-reserve-reached',
  'odds-quota-snapshot-absent',
  'odds-quota-unavailable',
  'odds-automation-reserve-reached',
]);
const STORAGE_CODES = new Set<string>(['storage-production-misconfigured']);

function isUnavailability(code: string): boolean {
  return code.endsWith('-unavailable');
}

/** The governing (most-severe-first, since issues are pre-sorted) issue for a code set. */
function governing(issues: SystemHealthIssue[], predicate: (code: string) => boolean) {
  return issues.find((i) => predicate(i.code)) ?? null;
}

function severityStatus(issues: SystemHealthIssue[]): 'red' | 'yellow' | 'info-only' | 'none' {
  if (issues.some((i) => i.severity === 'critical')) return 'red';
  if (issues.some((i) => i.severity === 'warning')) return 'yellow';
  if (issues.length > 0) return 'info-only';
  return 'none';
}

function overallPanel(input: SystemHealthPanelsInput): SystemHealthPanel {
  const status: PanelStatus =
    input.overallState === 'critical'
      ? 'red'
      : input.overallState === 'degraded'
        ? 'yellow'
        : 'green';
  const stateLabel =
    status === 'red' ? 'Action required' : status === 'yellow' ? 'Attention needed' : 'Healthy';
  const detail =
    status === 'red'
      ? 'One or more systems require action.'
      : status === 'yellow'
        ? 'One or more systems need attention.'
        : 'All systems are operating normally.';
  return {
    key: 'overall',
    title: 'Overall system',
    status,
    stateLabel,
    detail,
    timestamp: input.generatedAt,
    timestampPrefix: 'Checked',
  };
}

function schedulerPanel(input: SystemHealthPanelsInput): SystemHealthPanel {
  const scoped = input.issues.filter((i) => SCHEDULER_CODES.has(i.code));
  const sev = severityStatus(scoped);
  const gov = governing(input.issues, (c) => SCHEDULER_CODES.has(c));
  const status: PanelStatus = sev === 'red' ? 'red' : sev === 'yellow' ? 'yellow' : 'green';
  const stateLabel =
    status === 'red'
      ? 'Action required'
      : status === 'yellow'
        ? gov && isUnavailability(gov.code)
          ? 'Unknown'
          : 'Attention needed'
        : 'Healthy';
  return {
    key: 'scheduler',
    title: 'Scheduler delivery',
    status,
    stateLabel,
    detail: gov ? gov.title : 'Scheduled deliveries are arriving on time.',
    timestamp: input.generatedAt,
    timestampPrefix: 'Checked',
  };
}

function providerDataPanel(input: SystemHealthPanelsInput): SystemHealthPanel {
  const isProvider = (c: string) =>
    !SCHEDULER_CODES.has(c) &&
    !AUTOMATION_CODES.has(c) &&
    !QUOTA_CODES.has(c) &&
    !STORAGE_CODES.has(c);
  const scoped = input.issues.filter((i) => isProvider(i.code));
  const sev = severityStatus(scoped);
  const gov = governing(input.issues, isProvider);
  const status: PanelStatus = sev === 'red' ? 'red' : sev === 'yellow' ? 'yellow' : 'green';
  const stateLabel =
    status === 'red'
      ? 'Action required'
      : status === 'yellow'
        ? gov && isUnavailability(gov.code)
          ? 'Unknown'
          : 'Attention needed'
        : 'Healthy';
  return {
    key: 'provider-data',
    title: 'Provider data',
    status,
    stateLabel,
    detail: gov ? gov.title : 'Canonical provider data is present and current.',
    timestamp: null,
    timestampPrefix: null,
  };
}

function automationPanel(input: SystemHealthPanelsInput): SystemHealthPanel {
  if (input.automation.state === 'unavailable') {
    return {
      key: 'automation',
      title: 'Automation',
      status: 'yellow',
      stateLabel: 'Unknown',
      detail: 'Automation settings are unavailable.',
      timestamp: null,
      timestampPrefix: null,
    };
  }
  const gate = input.issues.filter((i) => AUTOMATION_CODES.has(i.code));
  if (gate.length > 0) {
    // Global pause / disabled datasets are intentional operator state → gray.
    return {
      key: 'automation',
      title: 'Automation',
      status: 'gray',
      stateLabel: 'Paused',
      detail: gate[0].title,
      timestamp: null,
      timestampPrefix: null,
    };
  }
  return {
    key: 'automation',
    title: 'Automation',
    status: 'green',
    stateLabel: 'Healthy',
    detail: 'Automatic refresh is running.',
    timestamp: null,
    timestampPrefix: null,
  };
}

function quotaPanel(input: SystemHealthPanelsInput): SystemHealthPanel {
  const scoped = input.issues.filter((i) => QUOTA_CODES.has(i.code));
  const sev = severityStatus(scoped);
  const gov = governing(input.issues, (c) => QUOTA_CODES.has(c));
  const status: PanelStatus =
    sev === 'red' ? 'red' : sev === 'yellow' ? 'yellow' : sev === 'info-only' ? 'gray' : 'green';
  const stateLabel =
    status === 'red'
      ? 'Action required'
      : status === 'yellow'
        ? gov && isUnavailability(gov.code)
          ? 'Unknown'
          : 'Attention needed'
        : status === 'gray'
          ? 'Awaiting activity'
          : 'Healthy';
  const oddsCapturedAt =
    input.quota.odds.state === 'available' ? input.quota.odds.capturedAt : null;
  return {
    key: 'quota',
    title: 'Provider quota',
    status,
    stateLabel,
    detail: gov ? gov.title : 'Provider quota is sufficient.',
    timestamp: oddsCapturedAt,
    timestampPrefix: oddsCapturedAt ? 'Odds snapshot' : null,
  };
}

function storagePanel(input: SystemHealthPanelsInput): SystemHealthPanel {
  if (input.storage.state === 'unavailable') {
    return {
      key: 'storage',
      title: 'Durable storage',
      status: 'yellow',
      stateLabel: 'Unknown',
      detail: 'Storage status is unavailable.',
      timestamp: null,
      timestampPrefix: null,
    };
  }
  if (input.storage.mode === 'production-misconfigured') {
    return {
      key: 'storage',
      title: 'Durable storage',
      status: 'red',
      stateLabel: 'Action required',
      detail: 'Production storage is misconfigured.',
      timestamp: null,
      timestampPrefix: null,
    };
  }
  return {
    key: 'storage',
    title: 'Durable storage',
    status: 'green',
    stateLabel: 'Healthy',
    detail: 'Durable storage is operational.',
    timestamp: null,
    timestampPrefix: null,
  };
}

/**
 * Per-dataset FRESHNESS stoplight — derived from cache availability + canonical
 * data diagnostics ONLY (server-side health policy). It is deliberately SEPARATE
 * from the latest refresh OUTCOME and the automation gate, which the row renders
 * as their own facts. Conferences is availability-only (no freshness expectation).
 */
export type DatasetFreshness = { status: PanelStatus; label: string };

export function deriveDatasetFreshness(input: {
  dataset: ProviderDataset;
  cacheState: ProviderCacheAvailability;
  diagnostics: ReadonlyArray<{ severity: DiagnosticSeverity }>;
}): DatasetFreshness {
  const { dataset, cacheState, diagnostics } = input;
  if (diagnostics.some((d) => d.severity === 'error')) return { status: 'red', label: 'Missing' };
  if (diagnostics.some((d) => d.severity === 'warning'))
    return { status: 'yellow', label: 'Stale' };
  if (cacheState === 'available') {
    return { status: 'green', label: dataset === 'conferences' ? 'Available' : 'Current' };
  }
  if (cacheState === 'absent') return { status: 'yellow', label: 'No cached data' };
  // cacheState 'unknown' (e.g. the cache read failed) with no diagnostics.
  return { status: 'gray', label: 'Unknown' };
}

/** Derive the six stoplight panels in fixed order. Pure + deterministic. */
export function deriveSystemHealthPanels(input: SystemHealthPanelsInput): SystemHealthPanel[] {
  return [
    overallPanel(input),
    schedulerPanel(input),
    providerDataPanel(input),
    automationPanel(input),
    quotaPanel(input),
    storagePanel(input),
  ];
}
