/**
 * Durable per-dataset provider-refresh status (PLATFORM-086A).
 *
 * Records — truthfully — the last refresh ATTEMPT, its explicit OUTCOME, the last
 * SUCCESS (by durable commit time), last ERROR, source, rows committed, and
 * partial-failure state for each provider-backed dataset, so operators can answer
 * "is a refresh in progress / did the last attempt succeed, fail, or complete
 * with no applicable data / is the served data stale" without reading logs.
 *
 * Truthfulness invariants (the whole point of this module):
 *   - A failed attempt NEVER advances `lastSuccessAt`; it preserves the prior
 *     success timestamp and the prior source/rows (the prior-good representation
 *     that is still being served).
 *   - Success is recorded only AFTER the caller has durably committed provider
 *     data (see PLATFORM-085A durable-first ordering), so status can never claim
 *     success before the data is durable.
 *   - `lastSuccessAt` is the DURABLE COMMIT time the caller passes as
 *     `committedAt` (captured immediately after `setAppState` resolves), NOT the
 *     time this status helper happened to run. Post-commit work (e.g. standings
 *     invalidation) can delay the status call arbitrarily; ordering successes by
 *     commit time keeps an older commit from overwriting a newer one's metadata
 *     just because it recorded status later (PLATFORM-086A rereview finding #3).
 *   - The LATEST attempt's outcome is explicit (`latestAttemptOutcome`): an
 *     in-progress attempt is never inferred to be a success or failure from the
 *     historical `lastSuccessAt`/`lastError` fields (rereview finding #8). Begin
 *     marks `in-progress`; success/failure/no-op resolve it — but only when the
 *     resolving attempt IS still the latest attempt.
 *   - Every record helper is BEST-EFFORT: it swallows its own storage errors and
 *     never throws into the provider path, so a status-write failure can never
 *     corrupt or roll back the provider-data commit that already happened.
 *
 * Concurrency (PLATFORM-086A): every refresh gets a unique attempt token from
 * `beginProviderRefreshAttempt`. The token is passed back on resolve, so an OLDER
 * attempt that finishes after a NEWER one began cannot restore its own attempt
 * identity, clear the newer attempt's error, or replace the newer attempt's
 * outcome — only the LATEST attempt owns the latest-attempt/outcome/error state.
 * A successful commit still updates last-success metadata when its `committedAt`
 * is the newest commit, independent of which attempt is latest. Read-modify-write
 * per dataset is serialized in-process by a keyed lock so same-process overlap is
 * deterministic; cross-instance ordering is best-effort (the app-state store has
 * no compare-and-set — see the module note at the bottom).
 *
 * Read-failure handling: a genuine durable READ failure is distinct from an
 * absent record. On a read failure the record helpers SKIP their write rather
 * than synthesize an empty record that would erase unknown prior-good state; an
 * absent record still initializes normally.
 *
 * Storage: app-state scope `provider-refresh-status`, one key per dataset.
 */

import { getAppState, setAppState } from './appStateStore.ts';
import type { ProviderDataset } from '../providerDatasets.ts';

export const PROVIDER_REFRESH_STATUS_SCOPE = 'provider-refresh-status';

export type ProviderRefreshUsage = {
  used?: number;
  remaining?: number;
  limit?: number;
  lastCost?: number;
};

export type ProviderRefreshError = {
  message: string;
  code?: string;
  status?: number;
};

/**
 * Explicit terminal (or in-flight) state of the LATEST attempt. Distinguishing
 * these is the point of rereview finding #8 — the panel must not infer the newest
 * attempt's result from historical success/error fields.
 *   - `in-progress` — begun, not yet resolved (may be interrupted if it never is)
 *   - `succeeded`   — durably committed provider data
 *   - `partial`     — committed, but a non-required partition was absent/failed
 *   - `failed`      — the attempt failed (prior-good data is still served)
 *   - `no-op`       — the provider responded, validated, and had no applicable
 *                     data (e.g. postseason not yet published); NOT a failure and
 *                     NOT a new durable commit
 */
export type ProviderAttemptOutcome = 'in-progress' | 'succeeded' | 'partial' | 'failed' | 'no-op';

export type ProviderRefreshStatus = {
  dataset: ProviderDataset;
  /** When the latest attempt STARTED. */
  lastAttemptAt: string | null;
  /** Unique token of the latest attempt to have written this record. */
  lastAttemptId: string | null;
  /** Explicit outcome of the latest attempt (null only for pre-086A records). */
  latestAttemptOutcome: ProviderAttemptOutcome | null;
  /** When the latest attempt RESOLVED (null while in-progress). */
  latestAttemptResolvedAt: string | null;
  /** Durable COMMIT time of the last successful refresh (ordering key). */
  lastSuccessAt: string | null;
  lastError: ProviderRefreshError | null;
  source: string | null;
  rowsCommitted: number | null;
  partialFailure: boolean;
  failedPartitions?: string[];
  durationMs?: number | null;
  usage?: ProviderRefreshUsage;
};

/** Handle returned by `beginProviderRefreshAttempt`; pass it back on resolve. */
export type ProviderRefreshAttempt = {
  attemptId: string;
  startedAt: string;
};

export function emptyProviderRefreshStatus(dataset: ProviderDataset): ProviderRefreshStatus {
  return {
    dataset,
    lastAttemptAt: null,
    lastAttemptId: null,
    latestAttemptOutcome: null,
    latestAttemptResolvedAt: null,
    lastSuccessAt: null,
    lastError: null,
    source: null,
    rowsCommitted: null,
    partialFailure: false,
  };
}

// Monotonic per-process counter keeps attempt tokens unique within a process
// without Math.random. Cross-instance uniqueness relies on the timestamp prefix
// (collisions are astronomically unlikely and, if they happened, only affect
// the concurrent-attempt comparison for a single status record).
let attemptCounter = 0;
function generateAttemptId(): string {
  attemptCounter += 1;
  return `${Date.now()}-${attemptCounter}`;
}

/**
 * Read a dataset's durable refresh status. THROWS on a genuine storage failure
 * (so the admin status API surfaces a broken store as a 500 rather than a
 * misleading "never refreshed"). The best-effort record helpers below distinguish
 * this throw (read failure) from an absent record via `readPriorStatus`.
 */
export async function getProviderRefreshStatus(
  dataset: ProviderDataset
): Promise<ProviderRefreshStatus> {
  const record = await getAppState<ProviderRefreshStatus>(PROVIDER_REFRESH_STATUS_SCOPE, dataset);
  if (!record?.value) return emptyProviderRefreshStatus(dataset);
  // Merge over the empty shape so older/partial records gain any new fields and
  // the dataset key is always authoritative.
  return { ...emptyProviderRefreshStatus(dataset), ...record.value, dataset };
}

type PriorStatusRead = { readOk: true; status: ProviderRefreshStatus } | { readOk: false };

async function readPriorStatus(dataset: ProviderDataset): Promise<PriorStatusRead> {
  try {
    // getProviderRefreshStatus returns the empty shape for an ABSENT record and
    // throws only on a genuine store failure — that is the distinction we need.
    return { readOk: true, status: await getProviderRefreshStatus(dataset) };
  } catch {
    return { readOk: false };
  }
}

async function writeStatusBestEffort(
  dataset: ProviderDataset,
  next: ProviderRefreshStatus
): Promise<void> {
  try {
    await setAppState(PROVIDER_REFRESH_STATUS_SCOPE, dataset, next);
  } catch (error) {
    // Best-effort: a status-write failure must never propagate into the provider
    // path (the provider-data commit already succeeded or already failed on its
    // own terms). Log for diagnosis and move on.
    console.error('providerRefreshStatus: failed to persist status', {
      dataset,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function logReadFailureSkip(dataset: ProviderDataset, op: string): void {
  console.error('providerRefreshStatus: prior status unreadable — skipping write', {
    dataset,
    op,
  });
}

// Per-dataset in-process serialization of read-modify-write, so overlapping
// same-process updates never interleave between their read and write. Returns a
// promise that resolves with `fn`'s result; the chain never rejects.
const datasetLocks = new Map<ProviderDataset, Promise<unknown>>();
function withDatasetLock<T>(dataset: ProviderDataset, fn: () => Promise<T>): Promise<T> {
  const prev = datasetLocks.get(dataset) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  datasetLocks.set(
    dataset,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

/** Whether `attempt` is the latest attempt to have written this record. */
function isLatest(status: ProviderRefreshStatus, attempt?: ProviderRefreshAttempt): boolean {
  return attempt ? status.lastAttemptId === attempt.attemptId : true;
}

/**
 * Mark a refresh attempt as started and return its token. Callers should `await`
 * this BEFORE the upstream fetch (and BEFORE credential validation, so a
 * missing-key early return still resolves a recorded attempt) and pass the
 * returned attempt to the matching success/failure/no-op record so overlapping
 * attempts resolve deterministically. Begin marks the latest attempt
 * `in-progress` and preserves historical success/error (which belong to prior
 * attempts, not this one).
 */
export async function beginProviderRefreshAttempt(
  dataset: ProviderDataset,
  opts: { startedAt?: string; attemptId?: string } = {}
): Promise<ProviderRefreshAttempt> {
  const startedAt = opts.startedAt ?? new Date().toISOString();
  const attemptId = opts.attemptId ?? generateAttemptId();
  await withDatasetLock(dataset, async () => {
    const prior = await readPriorStatus(dataset);
    if (!prior.readOk) {
      // Read failed — do not synthesize an empty record that would erase unknown
      // prior-good state.
      logReadFailureSkip(dataset, 'begin');
      return;
    }
    await writeStatusBestEffort(dataset, {
      ...prior.status,
      dataset,
      lastAttemptAt: startedAt,
      lastAttemptId: attemptId,
      // This attempt is now the latest and has no result yet. Historical
      // lastSuccessAt / lastError are preserved but no longer describe THIS
      // attempt (finding #8).
      latestAttemptOutcome: 'in-progress',
      latestAttemptResolvedAt: null,
    });
  });
  return { attemptId, startedAt };
}

export type ProviderRefreshSuccess = {
  attempt?: ProviderRefreshAttempt;
  /**
   * Durable commit time — capture immediately after the `setAppState` that
   * persisted the provider data. Defaults to now if omitted (only correct when
   * the status call directly follows the commit with no intervening await).
   */
  committedAt?: string;
  source?: string | null;
  rowsCommitted?: number | null;
  partialFailure?: boolean;
  failedPartitions?: string[];
  durationMs?: number | null;
  usage?: ProviderRefreshUsage;
};

/**
 * Record a successful refresh. Call ONLY after the provider data has been
 * durably committed. Last-success metadata advances only when this commit
 * (`committedAt`) is the newest durable commit; the latest-attempt/outcome/error
 * state is only set when this attempt IS the latest attempt (an older attempt
 * resolving late does not clear a newer attempt's error/outcome). A
 * `partialFailure: true` here means the refresh committed but a NON-required
 * partition was absent (the route accepted it) — still a success, flagged
 * partial; a route that REJECTED a partial result must call
 * `recordProviderRefreshFailure` instead.
 */
export async function recordProviderRefreshSuccess(
  dataset: ProviderDataset,
  result: ProviderRefreshSuccess = {}
): Promise<void> {
  const resolvedAt = new Date().toISOString();
  const committedAt = result.committedAt ?? resolvedAt;
  await withDatasetLock(dataset, async () => {
    const prior = await readPriorStatus(dataset);
    if (!prior.readOk) {
      logReadFailureSkip(dataset, 'success');
      return;
    }
    const status = prior.status;
    const priorSuccessMs = status.lastSuccessAt ? Date.parse(status.lastSuccessAt) : -Infinity;
    // Order by DURABLE COMMIT time, not status-call time: only the newest commit
    // advances last-success metadata (finding #3). Ties resolve to the later
    // recorder (`>=`), which is deterministic given in-process lock ordering.
    const advancesSuccess = Date.parse(committedAt) >= priorSuccessMs;

    const next: ProviderRefreshStatus = { ...status, dataset };
    if (advancesSuccess) {
      next.lastSuccessAt = committedAt;
      next.source = result.source ?? null;
      next.rowsCommitted = result.rowsCommitted ?? null;
      next.partialFailure = result.partialFailure ?? false;
      next.failedPartitions =
        result.failedPartitions && result.failedPartitions.length > 0
          ? result.failedPartitions
          : undefined;
      next.durationMs = result.durationMs ?? null;
      next.usage = result.usage;
    }
    if (isLatest(status, result.attempt)) {
      // This attempt owns the latest-attempt/outcome/error state.
      next.lastError = null;
      next.lastAttemptAt = result.attempt?.startedAt ?? status.lastAttemptAt;
      next.lastAttemptId = result.attempt?.attemptId ?? status.lastAttemptId;
      next.latestAttemptOutcome = result.partialFailure ? 'partial' : 'succeeded';
      next.latestAttemptResolvedAt = resolvedAt;
    }
    await writeStatusBestEffort(dataset, next);
  });
}

export type ProviderRefreshNoop = {
  attempt?: ProviderRefreshAttempt;
  /** Where the (empty but valid) response came from, for display. */
  source?: string | null;
  durationMs?: number | null;
};

/**
 * Record a valid NO-OP resolution: the provider request succeeded and validated
 * but had no applicable data (e.g. a season-wide postseason score request before
 * bowls are published). This is NOT a failure — it must not raise a provider
 * error — and NOT a new durable commit — it must not advance `lastSuccessAt` or
 * overwrite the prior-good source/rows. It only resolves the LATEST attempt as
 * `no-op` and clears any stale error (the latest attempt did not fail). A stale
 * (non-latest) attempt resolving as no-op is dropped.
 */
export async function recordProviderRefreshNoop(
  dataset: ProviderDataset,
  result: ProviderRefreshNoop = {}
): Promise<void> {
  const resolvedAt = new Date().toISOString();
  await withDatasetLock(dataset, async () => {
    const prior = await readPriorStatus(dataset);
    if (!prior.readOk) {
      logReadFailureSkip(dataset, 'noop');
      return;
    }
    const status = prior.status;
    if (!isLatest(status, result.attempt)) {
      // A stale attempt resolving late must not overwrite a newer attempt's state.
      return;
    }
    await writeStatusBestEffort(dataset, {
      ...status,
      dataset,
      lastAttemptAt: result.attempt?.startedAt ?? status.lastAttemptAt,
      lastAttemptId: result.attempt?.attemptId ?? status.lastAttemptId,
      // A clean no-op resolution clears the latest error but preserves the
      // prior-good success (lastSuccessAt/source/rowsCommitted untouched).
      lastError: null,
      latestAttemptOutcome: 'no-op',
      latestAttemptResolvedAt: resolvedAt,
      durationMs: result.durationMs ?? null,
    });
  });
}

export type ProviderRefreshFailure = {
  attempt?: ProviderRefreshAttempt;
  error: string;
  code?: string;
  status?: number;
  partialFailure?: boolean;
  failedPartitions?: string[];
  durationMs?: number | null;
  usage?: ProviderRefreshUsage;
};

/**
 * Record a failed refresh. Preserves the prior `lastSuccessAt`, `source`, and
 * `rowsCommitted` (the prior-good data still being served) and sets `lastError`
 * plus the latest-attempt outcome `failed`. An OLDER attempt's failure is dropped
 * when a NEWER attempt is already the latest — it must never overwrite the newer
 * attempt's result. A failed attempt NEVER advances last-success.
 */
export async function recordProviderRefreshFailure(
  dataset: ProviderDataset,
  result: ProviderRefreshFailure
): Promise<void> {
  const resolvedAt = new Date().toISOString();
  await withDatasetLock(dataset, async () => {
    const prior = await readPriorStatus(dataset);
    if (!prior.readOk) {
      // Cannot read prior-good state → skip rather than risk nulling it.
      logReadFailureSkip(dataset, 'failure');
      return;
    }
    const status = prior.status;
    if (!isLatest(status, result.attempt)) {
      // A stale attempt failing late must not overwrite a newer attempt's state.
      return;
    }
    await writeStatusBestEffort(dataset, {
      ...status,
      dataset,
      lastAttemptAt: result.attempt?.startedAt ?? status.lastAttemptAt,
      lastAttemptId: result.attempt?.attemptId ?? status.lastAttemptId,
      // Preserve prior-good success representation — a failure does not erase it.
      lastSuccessAt: status.lastSuccessAt,
      source: status.source,
      rowsCommitted: status.rowsCommitted,
      lastError: {
        message: result.error,
        ...(result.code ? { code: result.code } : {}),
        ...(typeof result.status === 'number' ? { status: result.status } : {}),
      },
      latestAttemptOutcome: 'failed',
      latestAttemptResolvedAt: resolvedAt,
      partialFailure: result.partialFailure ?? status.partialFailure ?? false,
      failedPartitions:
        result.failedPartitions && result.failedPartitions.length > 0
          ? result.failedPartitions
          : status.failedPartitions,
      durationMs: result.durationMs ?? null,
      usage: result.usage ?? status.usage,
    });
  });
}

// Cross-instance concurrency limitation (honest note): the app-state store has
// no compare-and-set primitive, so the attempt-token comparison + per-dataset
// lock only guarantee deterministic ordering WITHIN a single process. Two server
// instances writing this record for overlapping attempts of the same dataset can
// still last-writer-win across instances. This is acceptable for observability
// metadata (never a source of canonical data): canonical provider data remains
// durable-first and authoritative, and explicit commit timestamps + attempt IDs
// already remove the WITHIN-process ordering and unresolved-attempt hazards. A
// store-side atomic update would be required to fully close the cross-instance
// window.
