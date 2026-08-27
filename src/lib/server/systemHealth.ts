/**
 * PLATFORM-086F2F — the single server-side System Health view model.
 *
 * It composes six INDEPENDENT fact domains for a validated season year:
 * scheduler DELIVERY, scheduler EXECUTION outcome, canonical DATA health,
 * automation GATES, quota, and storage — then derives a deterministic,
 * prioritized issue list from them. The two axes stay separate: seven scheduler
 * jobs (delivery) and six provider datasets (data), which are NOT one-to-one.
 *
 * Every external boundary is behind an injectable loader; the default loaders
 * use the real read-only authorities. A failure in one loader degrades only its
 * own fact to `unavailable` and never fails the whole model or leaks a raw error.
 * The build performs exactly one deliberate CFBD usage observation (ordinary
 * 600 s cache, not `fresh`), makes no internal HTTP call, and writes nothing.
 * F2G owns the UI that renders this model.
 */

import { getAppStateStorageStatus, type AppStateStorageStatus } from './appStateStore.ts';
import {
  getProviderCacheStates,
  unknownProviderCacheStates,
  type ProviderCacheAvailability,
  type ProviderCacheStates,
} from './providerCacheState.ts';
import {
  getProviderDataDiagnostics,
  unknownProviderDataExpectations,
  type ProviderDataDiagnosticsResult,
  type ProviderDataExpectations,
} from './providerDataDiagnostics.ts';
import {
  readProviderRefreshHealth,
  unavailableProviderRefreshSnapshot,
  type CanonicalRefreshFact,
  type LatestScopedActivityFact,
  type ProviderRefreshHealthSnapshot,
} from './providerRefreshHealth.ts';
import {
  getProviderRefreshSettings,
  type ProviderRefreshSettings,
} from './providerRefreshSettings.ts';
import {
  readSchedulerDeliveryHealth,
  schedulerDeliveryPolicies,
  type SchedulerDeliveryHealthRow,
  type SchedulerDeliveryHealthSnapshot,
} from './schedulerDeliveryHealth.ts';
import { readLatestKnownOddsUsageState, type OddsUsageReadState } from './oddsUsageStore.ts';
import { fetchCfbdUsage, type CfbdUsage } from '../api/cfbdUsage.ts';
import { cfbdCanonicalLimitForTier, normalizeProviderQuota } from '../api/providerQuota.ts';
import {
  evaluateRankingsAutomationQuota,
  RANKINGS_AUTOMATION_MIN_REMAINING,
} from '../rankings/quotaPolicy.ts';
import { estimateOddsRequestCost, oddsAutomationMinRemaining } from '../odds/quotaPolicy.ts';
import { ODDS_DEFAULT_BOOKMAKERS, ODDS_DEFAULT_MARKETS } from '@/app/api/odds/routeInternals';
import { PROVIDER_DATASETS, type ProviderDataset } from '../providerDatasets.ts';
import type { ProviderRefreshScope } from '../providerRefreshScope.ts';
import {
  deriveSystemHealthIssues,
  summarizeSystemHealthIssues,
  type AutomationHealth,
  type CfbdQuotaFact,
  type DiagnosticsFact,
  type OddsQuotaFact,
  type SafeDiagnostic,
  type StorageHealthFact,
  type SystemHealthIssue,
  type SystemHealthOverallState,
  type SystemHealthQuota,
} from './systemHealthIssues.ts';
import {
  deriveDatasetFreshness,
  deriveSystemHealthPanels,
  type DatasetFreshness,
  type SystemHealthPanel,
} from './systemHealthPanels.ts';

// The canonical automatic Odds request cost (3) and its reserve threshold (53).
const ODDS_REQUEST_COST = estimateOddsRequestCost(ODDS_DEFAULT_MARKETS, ODDS_DEFAULT_BOOKMAKERS);
const ODDS_AUTOMATION_THRESHOLD = oddsAutomationMinRemaining(ODDS_REQUEST_COST);

/** One provider dataset's combined, sanitized health facts. */
export type ProviderDatasetHealthRow = {
  dataset: ProviderDataset;
  canonicalScope: ProviderRefreshScope;
  canonicalScopeKey: string;
  canonicalStatus: CanonicalRefreshFact;
  latestScopedActivity: LatestScopedActivityFact;
  cacheState: ProviderCacheAvailability;
  /** Server-derived freshness stoplight (cache + diagnostics), separate from refresh outcome. */
  freshness: DatasetFreshness;
  /** Per-dataset diagnostics WITHOUT their human message (code/severity/repair only). */
  diagnostics: SafeDiagnostic[];
};

export type SystemHealthViewModel = {
  generatedAt: string;
  year: number;
  overallState: SystemHealthOverallState;
  issueCounts: { critical: number; warning: number; info: number };
  /** Section-level "stoplight" status panels, server-derived (fixed order). */
  panels: SystemHealthPanel[];
  automation: AutomationHealth;
  /** Delivery axis — exactly seven scheduler jobs. */
  schedulerJobs: SchedulerDeliveryHealthRow[];
  /** Data axis — exactly six provider datasets. */
  datasets: ProviderDatasetHealthRow[];
  quota: SystemHealthQuota;
  storage: StorageHealthFact;
  issues: SystemHealthIssue[];
};

/** Every external read boundary, injectable for tests. Defaults are the real authorities. */
export type SystemHealthLoaders = {
  storage: () => AppStateStorageStatus | Promise<AppStateStorageStatus>;
  schedulerDelivery: (nowMs: number) => Promise<SchedulerDeliveryHealthSnapshot>;
  automationSettings: () => Promise<ProviderRefreshSettings>;
  providerRefresh: (year: number) => Promise<ProviderRefreshHealthSnapshot>;
  cacheStates: (year: number) => Promise<ProviderCacheStates>;
  diagnostics: (year: number, nowMs: number) => Promise<ProviderDataDiagnosticsResult>;
  cfbdUsage: () => Promise<CfbdUsage>;
  oddsUsage: () => Promise<OddsUsageReadState>;
};

const defaultLoaders: SystemHealthLoaders = {
  storage: () => getAppStateStorageStatus(),
  schedulerDelivery: (nowMs) => readSchedulerDeliveryHealth({ nowMs }),
  automationSettings: () => getProviderRefreshSettings(),
  providerRefresh: (year) => readProviderRefreshHealth({ year }),
  cacheStates: (year) => getProviderCacheStates(year),
  diagnostics: (year, nowMs) => getProviderDataDiagnostics(year, { now: nowMs }),
  // Ordinary 600 s framework cache (NOT `fresh`): at most one deliberate CFBD
  // usage observation per build, shared with the cached /info observation.
  cfbdUsage: () => fetchCfbdUsage(),
  // Durable snapshot read-through so a stale process memo cannot misreport headroom.
  oddsUsage: () => readLatestKnownOddsUsageState({ forceRefresh: true }),
};

type Settled<T> = { ok: true; value: T } | { ok: false };

/**
 * Per-loader bound so no single stalled boundary (e.g. an unresponsive CFBD
 * `/info`, or a hung durable read) can block the whole page render — a timeout
 * degrades that fact to `unavailable` while the other domains still render.
 */
const LOADER_TIMEOUT_MS = 8000;

async function settle<T>(fn: () => T | Promise<T>): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      Promise.resolve().then(fn),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('loader-timeout')), LOADER_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, value };
  } catch {
    // The raw error (message/stack) is intentionally discarded — a failed or
    // timed-out subsystem degrades to its own explicit `unavailable` fact.
    return { ok: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function validateYear(year: number): number {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new RangeError(`buildSystemHealthViewModel: invalid season year ${String(year)}`);
  }
  return year;
}

function toStorageFact(settled: Settled<AppStateStorageStatus>): StorageHealthFact {
  if (!settled.ok) return { state: 'unavailable' };
  const { mode, isProduction, databaseConfigured } = settled.value;
  // `filePath` is deliberately dropped — a filesystem path is never serialized.
  return { state: 'available', mode, isProduction, databaseConfigured };
}

function toAutomation(settled: Settled<ProviderRefreshSettings>): AutomationHealth {
  if (!settled.ok) return { state: 'unavailable' };
  const settings = settled.value;
  const datasets = {} as Record<ProviderDataset, { enabled: boolean }>;
  for (const dataset of PROVIDER_DATASETS) {
    datasets[dataset] = { enabled: settings.datasets[dataset]?.enabled === true };
  }
  return { state: 'available', globalPause: settings.globalPause === true, datasets };
}

function toDiagnosticsFact(settled: Settled<ProviderDataDiagnosticsResult>): DiagnosticsFact {
  if (!settled.ok) return { state: 'unavailable' };
  const diagnostics: SafeDiagnostic[] = settled.value.diagnostics.map((diag) => ({
    dataset: diag.dataset,
    code: diag.code,
    severity: diag.severity,
    repair: diag.repair,
    gameRefs: diag.gameRefs,
    affectedGameCount: diag.affectedGameCount,
  }));
  return { state: 'available', diagnostics };
}

function toCfbdQuota(settled: Settled<CfbdUsage>): CfbdQuotaFact {
  if (!settled.ok) return { state: 'unavailable' };
  const usage = settled.value;
  const normalized = normalizeProviderQuota({
    used: usage.used,
    remaining: usage.remaining,
    limit: usage.limit,
    patronLevel: usage.patronLevel,
    canonicalLimit:
      usage.patronLevel !== null ? cfbdCanonicalLimitForTier(usage.patronLevel) : null,
    source: 'live provider observation',
  });
  const reserve = RANKINGS_AUTOMATION_MIN_REMAINING;
  // Classify headroom from the ACTUAL automation gate (`evaluateAutomationQuota`
  // via the rankings reserve), not from `normalizeProviderQuota` — the two apply
  // different trust rules (e.g. a valid integer `remainingCalls` with no
  // `patronLevel` is usable to the gate but discarded by normalization; a
  // fractional count can survive normalization but the gate rejects it). This
  // makes the dashboard agree with whether automation will actually run. The
  // normalized triple is still used for DISPLAY values only.
  const decision = evaluateRankingsAutomationQuota({
    remainingCalls: usage.remaining,
    monthlyLimit: usage.limit,
  });
  const classification: 'ok' | 'untrustworthy' | 'reserve-reached' =
    decision.kind === 'allowed'
      ? 'ok'
      : decision.reason === 'below-reserve'
        ? 'reserve-reached'
        : 'untrustworthy';
  return {
    state: 'available',
    used: normalized.used,
    remaining: normalized.remaining,
    limit: normalized.limit,
    consistent: normalized.consistent,
    reserve,
    classification,
  };
}

function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * A strict canonical-ISO validator: `Date.parse` is lenient (it accepts trailing
 * junk such as an embedded path), so require the exact `toISOString()` round-trip
 * before exposing a durable timestamp.
 */
function canonicalIsoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString() === value ? value : null;
}

function toOddsQuota(settled: Settled<OddsUsageReadState>): OddsQuotaFact {
  if (!settled.ok) return { state: 'unavailable' };
  const read = settled.value;
  if (read.state === 'unavailable') return { state: 'unavailable' };
  if (read.state === 'absent') return { state: 'absent' };
  const { used, remaining, limit, capturedAt } = read.snapshot;
  // The durable snapshot is a raw read: a malformed/legacy value (a string field,
  // or an impossible balance) must never be serialized into the model or
  // classified `ok`. Require safe nonnegative integer counts, each bounded by the
  // limit, AND a total that does not OVER-count the limit (used + remaining >
  // limit is impossible). A total BELOW the limit is allowed — clamped
  // near-exhaustion estimates legitimately under-count. Anything else →
  // unavailable read.
  if (
    !isSafeCount(used) ||
    !isSafeCount(remaining) ||
    !isSafeCount(limit) ||
    remaining > limit ||
    used > limit ||
    used + remaining > limit
  ) {
    return { state: 'unavailable' };
  }
  const classification: 'ok' | 'reserve-reached' =
    remaining < ODDS_AUTOMATION_THRESHOLD ? 'reserve-reached' : 'ok';
  return {
    state: 'available',
    used,
    remaining,
    limit,
    threshold: ODDS_AUTOMATION_THRESHOLD,
    capturedAt: canonicalIsoOrNull(capturedAt),
    classification,
  };
}

function unavailableDelivery(nowMs: number): SchedulerDeliveryHealthSnapshot {
  const generatedAt = new Date(nowMs).toISOString();
  return {
    generatedAt,
    jobs: schedulerDeliveryPolicies().map((policy) => ({
      job: policy.job,
      source: policy.source,
      cron: policy.cron,
      cadenceLabel: policy.cadenceLabel,
      graceMs: policy.graceMs,
      requiredStartedAt: generatedAt,
      deliveryState: 'unavailable',
      receipt: null,
    })),
  };
}

/**
 * Build the System Health view model for an explicit, validated season year.
 * Never derives the year from leagues or the wall-clock. One `nowMs` drives the
 * whole build. Independent loaders run concurrently; each failure degrades only
 * its own fact.
 */
export async function buildSystemHealthViewModel(params: {
  year: number;
  nowMs?: number;
  loaders?: Partial<SystemHealthLoaders>;
}): Promise<SystemHealthViewModel> {
  const year = validateYear(params.year);
  const nowMs = params.nowMs ?? Date.now();
  const loaders: SystemHealthLoaders = { ...defaultLoaders, ...params.loaders };

  const [storageR, deliveryR, settingsR, refreshR, cacheR, diagR, cfbdR, oddsR] = await Promise.all(
    [
      settle(() => loaders.storage()),
      settle(() => loaders.schedulerDelivery(nowMs)),
      settle(() => loaders.automationSettings()),
      settle(() => loaders.providerRefresh(year)),
      settle(() => loaders.cacheStates(year)),
      settle(() => loaders.diagnostics(year, nowMs)),
      settle(() => loaders.cfbdUsage()),
      settle(() => loaders.oddsUsage()),
    ]
  );

  const storage = toStorageFact(storageR);
  const schedulerDelivery = deliveryR.ok ? deliveryR.value : unavailableDelivery(nowMs);
  const automation = toAutomation(settingsR);
  const providerRefresh = refreshR.ok ? refreshR.value : unavailableProviderRefreshSnapshot(year);
  const cacheStates = cacheR.ok ? cacheR.value : unknownProviderCacheStates();
  const diagnostics = toDiagnosticsFact(diagR);
  const quota: SystemHealthQuota = { cfbd: toCfbdQuota(cfbdR), odds: toOddsQuota(oddsR) };

  const issues = deriveSystemHealthIssues({
    nowMs,
    storage,
    schedulerDelivery,
    automation,
    providerRefresh,
    cacheStates,
    diagnostics,
    quota,
  });
  const { overallState, issueCounts } = summarizeSystemHealthIssues(issues);
  const generatedAt = new Date(nowMs).toISOString();

  // Datasets (with server-derived freshness) are computed BEFORE the panels so
  // the provider-data panel can fold per-dataset freshness into its status.
  const diagnosticsAvailable = diagnostics.state === 'available';
  // PLATFORM-090 — the canonical expectation the diagnostics authority derived.
  // A failed diagnostics pass yields all-`unknown`, so expected absence is never
  // asserted from an input that could not be read.
  const expectations: ProviderDataExpectations = diagR.ok
    ? diagR.value.expectations
    : unknownProviderDataExpectations();
  const datasets: ProviderDatasetHealthRow[] = providerRefresh.rows.map((row) => {
    const datasetDiagnostics = diagnosticsAvailable
      ? diagnostics.diagnostics.filter((diag) => diag.dataset === row.dataset)
      : [];
    return {
      dataset: row.dataset,
      canonicalScope: row.canonicalScope,
      canonicalScopeKey: row.canonicalScopeKey,
      canonicalStatus: row.canonicalStatus,
      latestScopedActivity: row.latestScopedActivity,
      cacheState: cacheStates[row.dataset],
      freshness: deriveDatasetFreshness({
        dataset: row.dataset,
        cacheState: cacheStates[row.dataset],
        diagnosticsAvailable,
        diagnostics: datasetDiagnostics,
        expectation: expectations[row.dataset],
      }),
      diagnostics: datasetDiagnostics,
    };
  });

  const panels = deriveSystemHealthPanels({
    generatedAt,
    issues,
    automation,
    quota,
    storage,
    datasetFreshness: datasets.map((d) => d.freshness),
  });

  return {
    generatedAt,
    year,
    overallState,
    issueCounts,
    panels,
    automation,
    schedulerJobs: schedulerDelivery.jobs,
    datasets,
    quota,
    storage,
    issues,
  };
}
