/**
 * PLATFORM-086F2F — safe, cache-only reader over the durable
 * `provider-refresh-status` scope for the System Health model.
 *
 * It answers TWO named facts per provider dataset, kept deliberately separate:
 *
 *   1. `canonicalStatus`     — the refresh status of the dataset's ONE canonical
 *                              selected-year target (the record the served UI
 *                              actually depends on).
 *   2. `latestScopedActivity`— the most recent refresh ATTEMPT across every
 *                              eligible scoped target for the selected year
 *                              (which may be a narrower season/week/filtered
 *                              partition, and may or may not be the canonical
 *                              record).
 *
 * The two are never merged: a stale/absent canonical year rollup alongside a
 * recent successful week-partition attempt must remain individually visible.
 *
 * Every accepted record is rebuilt field-by-field from a validated shape — the
 * durable object is NEVER raw-cast, and the sanitized projection deliberately
 * omits `lastError.message` and the free-form `source` string so no raw provider
 * text, credential, or path can escape into the model. A single malformed record
 * is isolated: it can make its OWN canonical fact `invalid`, but it can never
 * contaminate a valid sibling or the latest-activity selection. A failed scope
 * read degrades the whole subsystem to `unavailable` WITHOUT fabricating empty
 * "no history" facts.
 *
 * This module performs no provider call, no durable write, and no internal HTTP.
 */

import { getAppStateEntries } from './appStateStore.ts';
import {
  PROVIDER_REFRESH_STATUS_SCOPE,
  type ProviderAttemptOutcome,
} from './providerRefreshStatus.ts';
import { defaultOddsCacheKey } from '@/app/api/odds/routeInternals';
import { PROVIDER_DATASETS, isProviderDataset, type ProviderDataset } from '../providerDatasets.ts';
import {
  globalScope,
  oddsTargetScope,
  providerRefreshScopeKey,
  yearScope,
  type ProviderRefreshScope,
} from '../providerRefreshScope.ts';

/** The closed attempt-outcome vocabulary, mirrored for defensive validation. */
const ATTEMPT_OUTCOMES: readonly ProviderAttemptOutcome[] = [
  'in-progress',
  'succeeded',
  'partial',
  'failed',
  'no-op',
];

/** Bound the sanitized `failedPartitions` array and each label's length. */
const MAX_FAILED_PARTITIONS = 64;
const MAX_PARTITION_LABEL_LEN = 64;
/** A conservatively bounded, punctuation-limited stable error code shape. */
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * A safely rebuilt, sanitized subset of a durable provider-refresh-status
 * record. Field-by-field from a validated object — never a raw cast. Free-form
 * `source` and `lastError.message` are intentionally excluded; only a validated
 * stable error `code`/`status` survives.
 */
export type SafeProviderRefreshStatus = {
  dataset: ProviderDataset;
  scope: ProviderRefreshScope;
  scopeKey: string;
  lastAttemptAt: string | null;
  latestAttemptOutcome: ProviderAttemptOutcome | null;
  latestAttemptResolvedAt: string | null;
  lastSuccessAt: string | null;
  rowsCommitted: number | null;
  partialFailure: boolean;
  failedPartitions: string[];
  durationMs: number | null;
  errorCode: string | null;
  errorStatus: number | null;
};

/** The canonical-target fact: present-and-valid, present-but-malformed, absent, or subsystem-down. */
export type CanonicalRefreshFact =
  | { state: 'available'; status: SafeProviderRefreshStatus }
  | { state: 'invalid' }
  | { state: 'absent' }
  | { state: 'unavailable' };

/** The latest eligible scoped-activity fact for the selected year. */
export type LatestScopedActivityFact =
  | { state: 'available'; status: SafeProviderRefreshStatus }
  | { state: 'absent' }
  | { state: 'unavailable' };

export type ProviderRefreshHealthRow = {
  dataset: ProviderDataset;
  canonicalScope: ProviderRefreshScope;
  canonicalScopeKey: string;
  canonicalStatus: CanonicalRefreshFact;
  latestScopedActivity: LatestScopedActivityFact;
};

export type ProviderRefreshHealthSnapshot = {
  /** `unavailable` iff the single scope read threw — every row's facts are then `unavailable`. */
  subsystem: 'available' | 'unavailable';
  /** Exactly six rows in canonical `PROVIDER_DATASETS` order. */
  rows: ProviderRefreshHealthRow[];
};

/** Injectable durable read seam (defaults to the real app-state store). */
export type ProviderRefreshStatusLoader = (
  scope: string
) => Promise<Array<{ key: string; value: unknown; updatedAt: string }>>;

// -- Safe primitive validators -------------------------------------------------

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function nullableIso(value: unknown): string | null {
  return isIsoTimestamp(value) ? value : null;
}

function nullableNonNegNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeFailedPartitions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > MAX_PARTITION_LABEL_LEN) continue;
    out.push(trimmed);
    if (out.length >= MAX_FAILED_PARTITIONS) break;
  }
  return out;
}

function validErrorCode(value: unknown): string | null {
  return typeof value === 'string' && ERROR_CODE_PATTERN.test(value) ? value : null;
}

function validErrorStatus(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : null;
}

/**
 * Defensively parse an unknown value into a `ProviderRefreshScope`, validating
 * every kind's own fields. Returns null for any unrecognized/malformed shape.
 */
function parseScope(value: unknown): ProviderRefreshScope | null {
  if (!isPlainObject(value)) return null;
  const kind = value.kind;
  const isYear = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
  const isSeasonType = (v: unknown): v is 'regular' | 'postseason' =>
    v === 'regular' || v === 'postseason';
  switch (kind) {
    case 'global':
      return { kind: 'global' };
    case 'legacy-unscoped':
      return { kind: 'legacy-unscoped' };
    case 'venue-catalog':
      return { kind: 'venue-catalog' };
    case 'year':
      return isYear(value.year) ? { kind: 'year', year: value.year } : null;
    case 'schedule-media':
      return isYear(value.year) ? { kind: 'schedule-media', year: value.year } : null;
    case 'season-partition':
      return isYear(value.year) && isSeasonType(value.seasonType)
        ? { kind: 'season-partition', year: value.year, seasonType: value.seasonType }
        : null;
    case 'week-partition':
      return isYear(value.year) &&
        typeof value.week === 'number' &&
        Number.isInteger(value.week) &&
        isSeasonType(value.seasonType)
        ? {
            kind: 'week-partition',
            year: value.year,
            week: value.week,
            seasonType: value.seasonType,
          }
        : null;
    case 'odds-target':
      return isYear(value.year) &&
        (value.variant === 'canonical' || value.variant === 'filtered') &&
        typeof value.cacheKey === 'string' &&
        value.cacheKey.length > 0 &&
        value.cacheKey.length <= 256
        ? {
            kind: 'odds-target',
            year: value.year,
            variant: value.variant,
            cacheKey: value.cacheKey,
          }
        : null;
    default:
      return null;
  }
}

/**
 * Validate + rebuild a durable record field-by-field. The durable KEY, the
 * record's own `scopeKey`, and the centralized authority's key for the parsed
 * (dataset, scope) must all agree — otherwise the record is rejected. Returns
 * null for any malformed record (which the caller isolates as `invalid`).
 */
function rebuildStatus(key: string, value: unknown): SafeProviderRefreshStatus | null {
  if (!isPlainObject(value)) return null;
  if (!isProviderDataset(value.dataset)) return null;
  const dataset = value.dataset;
  const scope = parseScope(value.scope);
  if (!scope) return null;
  if (typeof value.scopeKey !== 'string') return null;
  // Centralized scope-key authority: the parsed scope must produce exactly this
  // record's scopeKey AND the durable key it was stored under.
  const authoritativeKey = providerRefreshScopeKey(dataset, scope);
  if (authoritativeKey !== value.scopeKey || authoritativeKey !== key) return null;

  const outcome =
    value.latestAttemptOutcome == null
      ? null
      : ATTEMPT_OUTCOMES.includes(value.latestAttemptOutcome as ProviderAttemptOutcome)
        ? (value.latestAttemptOutcome as ProviderAttemptOutcome)
        : undefined;
  // A present-but-out-of-vocabulary outcome is malformed, not "unknown".
  if (outcome === undefined) return null;

  const error = isPlainObject(value.lastError) ? value.lastError : null;

  return {
    dataset,
    scope,
    scopeKey: authoritativeKey,
    lastAttemptAt: nullableIso(value.lastAttemptAt),
    latestAttemptOutcome: outcome,
    latestAttemptResolvedAt: nullableIso(value.latestAttemptResolvedAt),
    lastSuccessAt: nullableIso(value.lastSuccessAt),
    rowsCommitted: nullableNonNegNumber(value.rowsCommitted),
    partialFailure: value.partialFailure === true,
    failedPartitions: sanitizeFailedPartitions(value.failedPartitions),
    durationMs: nullableNonNegNumber(value.durationMs),
    errorCode: error ? validErrorCode(error.code) : null,
    errorStatus: error ? validErrorStatus(error.status) : null,
  };
}

/** The dataset's ONE canonical selected-year target scope. */
function canonicalScopeFor(dataset: ProviderDataset, year: number): ProviderRefreshScope {
  if (dataset === 'conferences') return globalScope();
  if (dataset === 'odds') return oddsTargetScope(year, 'canonical', defaultOddsCacheKey(year));
  return yearScope(year);
}

/**
 * Whether a parsed record's scope is eligible to be `latestScopedActivity` for
 * `dataset` in `year`. Year-bearing scopes count only for the selected year;
 * `global` counts only for Conferences; `venue-catalog` counts only for
 * Schedule. `legacy-unscoped` and every other year are excluded.
 */
function isEligibleActivity(
  dataset: ProviderDataset,
  year: number,
  scope: ProviderRefreshScope
): boolean {
  switch (scope.kind) {
    case 'year':
    case 'season-partition':
    case 'week-partition':
    case 'odds-target':
    case 'schedule-media':
      return scope.year === year;
    case 'global':
      return dataset === 'conferences';
    case 'venue-catalog':
      return dataset === 'schedule';
    case 'legacy-unscoped':
      return false;
    default:
      return false;
  }
}

/**
 * Select the latest eligible activity by valid `lastAttemptAt`, breaking ties
 * deterministically on `scopeKey` (lexicographically greatest wins). Records
 * without a valid `lastAttemptAt` are not selectable.
 */
function selectLatestActivity(
  candidates: SafeProviderRefreshStatus[]
): SafeProviderRefreshStatus | null {
  let best: SafeProviderRefreshStatus | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (candidate.lastAttemptAt == null) continue;
    const ms = Date.parse(candidate.lastAttemptAt);
    if (!Number.isFinite(ms)) continue;
    if (best == null || ms > bestMs || (ms === bestMs && candidate.scopeKey > best.scopeKey)) {
      best = candidate;
      bestMs = ms;
    }
  }
  return best;
}

/** Six unavailable rows (canonical scope still derivable) for a failed scope read. */
function unavailableRows(year: number): ProviderRefreshHealthRow[] {
  return PROVIDER_DATASETS.map((dataset) => {
    const canonicalScope = canonicalScopeFor(dataset, year);
    return {
      dataset,
      canonicalScope,
      canonicalScopeKey: providerRefreshScopeKey(dataset, canonicalScope),
      canonicalStatus: { state: 'unavailable' as const },
      latestScopedActivity: { state: 'unavailable' as const },
    };
  });
}

/**
 * The `subsystem: 'unavailable'` snapshot (still six canonical-order rows) used
 * both by a failed scope read here and by the orchestrator when its injected
 * loader throws.
 */
export function unavailableProviderRefreshSnapshot(year: number): ProviderRefreshHealthSnapshot {
  return { subsystem: 'unavailable', rows: unavailableRows(year) };
}

/**
 * Read the `provider-refresh-status` scope ONCE and derive the six dataset rows.
 * Never throws: a failed scope read returns a `subsystem: 'unavailable'`
 * snapshot with six unavailable rows.
 */
export async function readProviderRefreshHealth(params: {
  year: number;
  loadEntries?: ProviderRefreshStatusLoader;
}): Promise<ProviderRefreshHealthSnapshot> {
  const { year } = params;
  const load = params.loadEntries ?? ((scope) => getAppStateEntries<unknown>(scope));

  let entries: Array<{ key: string; value: unknown }>;
  try {
    entries = await load(PROVIDER_REFRESH_STATUS_SCOPE);
  } catch {
    return unavailableProviderRefreshSnapshot(year);
  }

  // Partition raw entries by durable key so a canonical lookup can tell
  // present-but-malformed (`invalid`) apart from genuinely absent.
  const rawKeys = new Set<string>();
  const parsed: SafeProviderRefreshStatus[] = [];
  const parsedByKey = new Map<string, SafeProviderRefreshStatus>();
  for (const entry of entries) {
    if (typeof entry?.key !== 'string') continue;
    rawKeys.add(entry.key);
    const status = rebuildStatus(entry.key, entry.value);
    if (status) {
      parsed.push(status);
      parsedByKey.set(status.scopeKey, status);
    }
  }

  const rows = PROVIDER_DATASETS.map((dataset): ProviderRefreshHealthRow => {
    const canonicalScope = canonicalScopeFor(dataset, year);
    const canonicalScopeKey = providerRefreshScopeKey(dataset, canonicalScope);

    const canonicalParsed = parsedByKey.get(canonicalScopeKey);
    let canonicalStatus: CanonicalRefreshFact;
    if (canonicalParsed) {
      canonicalStatus = { state: 'available', status: canonicalParsed };
    } else if (rawKeys.has(canonicalScopeKey)) {
      canonicalStatus = { state: 'invalid' };
    } else {
      canonicalStatus = { state: 'absent' };
    }

    const eligible = parsed.filter(
      (status) => status.dataset === dataset && isEligibleActivity(dataset, year, status.scope)
    );
    const latest = selectLatestActivity(eligible);
    const latestScopedActivity: LatestScopedActivityFact = latest
      ? { state: 'available', status: latest }
      : { state: 'absent' };

    return { dataset, canonicalScope, canonicalScopeKey, canonicalStatus, latestScopedActivity };
  });

  return { subsystem: 'available', rows };
}
