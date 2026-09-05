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
  SystemHealthQuota,
} from './systemHealthIssues.ts';
import type {
  DiagnosticSeverity,
  ProviderDataExpectation,
  ProviderDiagnosticCode,
} from './providerDataDiagnostics.ts';
import type { PartitionScopedHealth } from './partitionScopedRefreshHealth.ts';
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
  issues: SystemHealthIssue[];
  automation: AutomationHealth;
  quota: SystemHealthQuota;
  storage: StorageHealthFact;
  /** Per-dataset freshness (folded into the provider-data panel so a
   *  yellow/red/unknown dataset row can never sit under a green panel). */
  datasetFreshness: DatasetFreshness[];
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

/**
 * PLATFORM-086F2H3B2 — codes owned by NO stoplight tile.
 *
 * `providerDataPanel`'s predicate is RESIDUAL — anything not claimed by the
 * scheduler, automation, quota, or storage sets falls into Provider data — so a
 * new code silently lands there unless it is claimed here. That produced two
 * false statements on the dashboard: an otherwise-healthy system rendered
 * "Provider data · Attention needed · Production lifecycle data is unusable"
 * (a league-registry fault attributed to provider data, breaking the axis
 * separation F2G exists to keep), and, because `governing` takes the first match
 * in the globally-sorted list and `compareIssues` ranks the `global` axis ahead
 * of `dataset`, it also DISPLACED a genuine provider fault from that tile's one
 * detail line.
 *
 * Lifecycle integrity is neither a delivery fact, a provider fact, a gate, a
 * quota, nor storage — there is no tile whose subject it is. Rather than
 * misfile it or invent a sixth tile, it is claimed here, kept out of every
 * section, and folded into OVERALL so the dashboard cannot report "all systems
 * operating normally" while it is open. The consequence is deliberate: the five
 * section tiles stay green while Overall shows attention needed, and the issue
 * itself carries the detail in the Actionable Issues list below.
 */
const UNTILED_CODES = new Set<string>(['lifecycle-data-unusable']);

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

const STATUS_RANK: Record<PanelStatus, number> = { green: 0, gray: 1, yellow: 2, red: 3 };

function worseStatus(a: PanelStatus, b: PanelStatus): PanelStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

function overallPanel(
  input: SystemHealthPanelsInput,
  sections: SystemHealthPanel[]
): SystemHealthPanel {
  // Holistic verdict: the WORST section status (so Overall can never say "all
  // normal" above a yellow/red tile — including provider-data yellow from
  // freshness alone). Intentional gray (paused/awaiting) does NOT degrade.
  const sectionStatus = sections.reduce<PanelStatus>(
    (worst, p) => worseStatus(worst, p.status === 'gray' ? 'green' : p.status),
    'green'
  );
  // PLATFORM-086F2H3B2 — issues owned by no section tile are rolled up HERE, or
  // Overall would say "all systems are operating normally" above an open
  // warning. The tiles are a map of subsystems; Overall is the verdict, and a
  // fault with no subsystem still belongs in the verdict.
  const untiled = severityStatus(input.issues.filter((i) => UNTILED_CODES.has(i.code)));
  const status = worseStatus(
    sectionStatus,
    untiled === 'red' ? 'red' : untiled === 'yellow' ? 'yellow' : 'green'
  );
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
    !STORAGE_CODES.has(c) &&
    !UNTILED_CODES.has(c);
  const scoped = input.issues.filter((i) => isProvider(i.code));
  const sev = severityStatus(scoped);
  const gov = governing(input.issues, isProvider);
  const issueStatus: PanelStatus = sev === 'red' ? 'red' : sev === 'yellow' ? 'yellow' : 'green';
  // Fold in per-dataset freshness so a dataset row that is stale/missing/unknown
  // (even without a warning-level issue — e.g. an absent cache) can never sit
  // under a green "all present" panel. An unknown (gray) freshness warrants
  // attention at the panel level, so it contributes yellow — but an INTENTIONAL
  // gray does not (PLATFORM-090). A dataset whose canonical lifecycle says its
  // data should not exist yet is a healthy state with no operator action, so it
  // is non-degrading here exactly as a paused section is in Overall.
  const freshnessStatus = input.datasetFreshness.reduce<PanelStatus>(
    (worst, f) =>
      worseStatus(worst, f.status === 'gray' ? (f.intentional ? 'green' : 'yellow') : f.status),
    'green'
  );
  const status = worseStatus(issueStatus, freshnessStatus);
  const stateLabel =
    status === 'red'
      ? 'Action required'
      : status === 'yellow'
        ? gov && isUnavailability(gov.code)
          ? 'Unknown'
          : 'Attention needed'
        : 'Healthy';
  // PLATFORM-090 review — a non-degrading awaiting row makes the panel green,
  // but the panel must not then claim every dataset is PRESENT: its cache is
  // provably absent, which is exactly the contradiction (green tile above a
  // "no data" row) this file's UNTILED_CODES note exists to prevent. Green has
  // two truthful readings now, so it needs two sentences.
  const awaiting = input.datasetFreshness.some((f) => f.status === 'gray' && f.intentional);
  const detail = gov
    ? gov.title
    : status === 'green'
      ? awaiting
        ? 'Canonical provider data is current, apart from data not expected yet.'
        : 'Canonical provider data is present and current.'
      : 'One or more datasets are missing, stale, or unverifiable.';
  return {
    key: 'provider-data',
    title: 'Provider data',
    status,
    stateLabel,
    detail,
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
  // A global pause and a single disabled dataset are different intentional
  // states — never conflate one dataset's toggle with pausing everything.
  if (input.automation.globalPause) {
    return {
      key: 'automation',
      title: 'Automation',
      status: 'gray',
      stateLabel: 'Paused',
      detail: 'Global automatic refresh is paused.',
      timestamp: null,
      timestampPrefix: null,
    };
  }
  const disabled = input.issues.filter((i) => i.code === 'automation-dataset-disabled');
  if (disabled.length > 0) {
    return {
      key: 'automation',
      title: 'Automation',
      status: 'gray',
      stateLabel: 'Partially disabled',
      detail: `${disabled.length} dataset${disabled.length === 1 ? '' : 's'} ${
        disabled.length === 1 ? 'has' : 'have'
      } automatic refresh disabled; the rest remain enabled.`,
      timestamp: null,
      timestampPrefix: null,
    };
  }
  return {
    key: 'automation',
    title: 'Automation',
    status: 'green',
    stateLabel: 'Enabled',
    // The gates only prove automation is ENABLED — scheduler execution is a
    // separate axis (its own panel), so never claim refreshes are "running".
    detail: 'Automatic refresh is enabled.',
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
  // Mode proves CONFIGURATION, not database liveness (no liveness probe here), so
  // report configuration-only wording — never "operational"/"healthy database".
  return {
    key: 'storage',
    title: 'Durable storage',
    status: 'green',
    stateLabel: 'Configured',
    detail:
      input.storage.mode === 'postgres'
        ? 'Durable storage is configured (Postgres).'
        : 'Durable storage is using the file fallback.',
    timestamp: null,
    timestampPrefix: null,
  };
}

/**
 * Per-dataset FRESHNESS stoplight — derived from cache availability + canonical
 * data diagnostics ONLY (server-side health policy). It is deliberately SEPARATE
 * from the latest refresh OUTCOME and the automation gate, which the row renders
 * as their own facts. Conferences is availability-only (no freshness expectation).
 *
 * The label reflects the diagnostic CODE, not merely severity: a `*-cache-stale`
 * warning is "Stale", but an unavailable-evidence warning is "Unknown" and other
 * defects (identity mismatch, duplicate conflict, unservable records) read
 * "Attention" rather than being mislabeled "Stale". When the diagnostics
 * subsystem itself is unavailable, freshness is genuinely unknowable → "Unknown".
 */
export type DatasetFreshness = {
  status: PanelStatus;
  label: string;
  /**
   * PLATFORM-090 — true only for a gray that is a DELIBERATE lifecycle state
   * (canonical semantics say this data should not exist yet), never for a gray
   * meaning "could not be assessed". Only a gray status can be intentional; the
   * rollups fold an unknown gray in as yellow and leave an intentional one
   * non-degrading, so the two must stay distinguishable.
   */
  intentional: boolean;
};

/** A fresh object per call — rows must never alias one another's freshness. */
function unknownFreshness(): DatasetFreshness {
  return { status: 'gray', label: 'Unknown', intentional: false };
}

export function deriveDatasetFreshness(input: {
  dataset: ProviderDataset;
  cacheState: ProviderCacheAvailability;
  /** False when the whole diagnostics pass failed — freshness cannot be assessed. */
  diagnosticsAvailable: boolean;
  diagnostics: ReadonlyArray<{ severity: DiagnosticSeverity; code: ProviderDiagnosticCode }>;
  /**
   * PLATFORM-090 — whether canonical semantics expect this dataset's data to
   * exist yet. Supplied by the diagnostics authority; it ONLY ever softens the
   * absent-cache branch, and never suppresses a diagnostic-derived state.
   */
  expectation: ProviderDataExpectation;
  /**
   * Item 88 — for datasets whose refresh is recorded per PARTITION (scores,
   * game-stats) this answers "was a refresh due, and did it happen". Absent for
   * every other dataset, which keeps its existing behaviour exactly.
   *
   * Consulted BEFORE the cache branch, because cache presence cannot answer the
   * question this row is asked. Scores stay cached through a total polling
   * outage, so `cacheState === 'available'` returned green while live scoring was
   * dead — the row could not go bad at all. That is the defect, not a wording
   * problem.
   */
  partitionHealth?: PartitionScopedHealth | null;
}): DatasetFreshness {
  const { dataset, cacheState, diagnosticsAvailable, diagnostics, expectation } = input;
  if (!diagnosticsAvailable) return unknownFreshness();
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { status: 'red', label: 'Missing', intentional: false };
  }
  const warnings = diagnostics.filter((d) => d.severity === 'warning');
  if (warnings.length > 0) {
    if (warnings.some((d) => d.code.endsWith('-cache-stale'))) {
      return { status: 'yellow', label: 'Stale', intentional: false };
    }
    if (warnings.some((d) => d.code.endsWith('-unavailable'))) {
      return unknownFreshness();
    }
    return { status: 'yellow', label: 'Attention', intentional: false };
  }
  // Item 88, before the cache branch — see `partitionHealth` above.
  const partitionHealth = input.partitionHealth ?? null;
  if (partitionHealth) {
    switch (partitionHealth.state) {
      case 'stalled':
        // A refresh WAS due and no activity followed. Never green, however much
        // data is cached: the cache is what the last successful poll left behind.
        return { status: 'yellow', label: 'Refresh overdue', intentional: false };
      case 'indeterminate':
        // The scheduler itself is not reporting, so nothing here can be asserted.
        return unknownFreshness();
      case 'quiet':
        // No games are in the window, so no refresh was due. GREEN, not neutral —
        // correctly determining nothing is due IS the healthy state, and for most
        // of the year it is this row's normal one (owner ruling).
        //
        // ONLY when data is actually cached. With an absent cache this falls
        // through to PLATFORM-090's expectation branch, which answers a DIFFERENT
        // question: "should this dataset have data by now?" A game-stats cache can
        // be absent AND expected — games were played, stats should exist — while
        // the cron has no polling target because the window has closed. Claiming
        // "nothing was due" there would silence a real warning, which an existing
        // PLATFORM-090 test caught this doing.
        if (cacheState === 'available') {
          return { status: 'green', label: 'Idle — no games in window', intentional: true };
        }
        break;
      case 'active':
        break;
    }
  }

  if (cacheState === 'available') {
    return {
      status: 'green',
      label: dataset === 'conferences' ? 'Available' : 'Current',
      intentional: false,
    };
  }
  if (cacheState === 'absent') {
    // An absence the canonical lifecycle says is EXPECTED is neutral, not a
    // warning — there is no operator action, and green would falsely claim
    // present evidence. Anything else (expected data, or an expectation that
    // could not be determined) keeps the actionable warning.
    //
    // The label is "None expected" rather than the "Awaiting games" wording this
    // originally shipped with (review round 5): the same state is reached when
    // the canonical authority says nothing WILL be produced — a slate whose
    // every game is canceled/postponed — and "awaiting" asserts a future arrival
    // that never comes. "None expected" is true of both branches and still
    // communicates that the absence is expected rather than merely unknown.
    return expectation === 'not-yet-expected'
      ? { status: 'gray', label: 'None expected', intentional: true }
      : { status: 'yellow', label: 'No cached data', intentional: false };
  }
  // cacheState 'unknown' (e.g. the cache read failed) with no diagnostics. An
  // unreadable store is never reported as an expected absence.
  return unknownFreshness();
}

/** Derive the six stoplight panels in fixed order. Pure + deterministic. */
export function deriveSystemHealthPanels(input: SystemHealthPanelsInput): SystemHealthPanel[] {
  // Sections first; Overall is a holistic rollup of them (never contradicts a tile).
  const scheduler = schedulerPanel(input);
  const providerData = providerDataPanel(input);
  const automation = automationPanel(input);
  const quota = quotaPanel(input);
  const storage = storagePanel(input);
  const overall = overallPanel(input, [scheduler, providerData, automation, quota, storage]);
  return [overall, scheduler, providerData, automation, quota, storage];
}
