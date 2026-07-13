/**
 * Durable per-dataset provider-refresh status (PLATFORM-086A).
 *
 * Records — truthfully — the last refresh ATTEMPT, last SUCCESS, last ERROR,
 * source, rows committed, and partial-failure state for each provider-backed
 * dataset, so operators can answer "when did this last succeed / is the served
 * data stale / did the last attempt fail" without reading logs.
 *
 * Truthfulness invariants (the whole point of this module):
 *   - A failed attempt NEVER advances `lastSuccessAt`; it preserves the prior
 *     success timestamp and the prior source/rows (the prior-good representation
 *     that is still being served).
 *   - Success is recorded only AFTER the caller has durably committed provider
 *     data (see PLATFORM-085A durable-first ordering), so status can never claim
 *     success before the data is durable.
 *   - Every record helper is BEST-EFFORT: it swallows its own storage errors and
 *     never throws into the provider path, so a status-write failure can never
 *     corrupt or roll back the provider-data commit that already happened.
 *
 * Concurrency (PLATFORM-086A remediation): every refresh gets a unique attempt
 * token from `beginProviderRefreshAttempt`. The token is passed back on resolve,
 * so an OLDER attempt that finishes after a NEWER one began cannot restore its
 * own attempt identity or clear the newer attempt's error — only the LATEST
 * attempt owns the latest-attempt/error state. A successful commit still updates
 * last-success metadata when it is the newest commit, independent of which
 * attempt is latest. Read-modify-write per dataset is serialized in-process by a
 * keyed lock so same-process overlap is deterministic; cross-instance ordering
 * is best-effort (the app-state store has no compare-and-set — see the module
 * note at the bottom).
 *
 * Read-failure handling: a genuine durable READ failure is distinct from an
 * absent record. On a read failure the attempt/failure helpers SKIP their write
 * rather than synthesize an empty record that would erase unknown prior-good
 * state; an absent record still initializes normally.
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

export type ProviderRefreshStatus = {
  dataset: ProviderDataset;
  lastAttemptAt: string | null;
  /** Unique token of the latest attempt to have written this record. */
  lastAttemptId: string | null;
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

/**
 * Mark a refresh attempt as started and return its token. Callers should `await`
 * this BEFORE the upstream fetch and pass the returned attempt to the matching
 * success/failure record so overlapping attempts resolve deterministically.
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
    });
  });
  return { attemptId, startedAt };
}

export type ProviderRefreshSuccess = {
  attempt?: ProviderRefreshAttempt;
  source?: string | null;
  rowsCommitted?: number | null;
  partialFailure?: boolean;
  failedPartitions?: string[];
  durationMs?: number | null;
  usage?: ProviderRefreshUsage;
};

/**
 * Record a successful refresh. Call ONLY after the provider data has been
 * durably committed. Last-success metadata is updated when this is the newest
 * commit; the latest-attempt/error state is only cleared when this attempt IS
 * the latest attempt (an older attempt resolving late does not clear a newer
 * attempt's error). A `partialFailure: true` here means the refresh committed
 * but a NON-required partition was absent (the route accepted it) — still a
 * success, flagged partial; a route that REJECTED a partial result must call
 * `recordProviderRefreshFailure` instead.
 */
export async function recordProviderRefreshSuccess(
  dataset: ProviderDataset,
  result: ProviderRefreshSuccess = {}
): Promise<void> {
  const now = new Date().toISOString();
  await withDatasetLock(dataset, async () => {
    const prior = await readPriorStatus(dataset);
    if (!prior.readOk) {
      logReadFailureSkip(dataset, 'success');
      return;
    }
    const status = prior.status;
    const isLatestAttempt = result.attempt
      ? status.lastAttemptId === result.attempt.attemptId
      : true;
    const priorSuccessMs = status.lastSuccessAt ? Date.parse(status.lastSuccessAt) : -Infinity;
    // Only the newest durable commit advances last-success metadata.
    const advancesSuccess = Date.parse(now) >= priorSuccessMs;

    const next: ProviderRefreshStatus = { ...status, dataset };
    if (advancesSuccess) {
      next.lastSuccessAt = now;
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
    if (isLatestAttempt) {
      // This attempt owns the latest-attempt/error state → clear the error.
      next.lastError = null;
      next.lastAttemptAt = result.attempt?.startedAt ?? status.lastAttemptAt;
      next.lastAttemptId = result.attempt?.attemptId ?? status.lastAttemptId;
    }
    await writeStatusBestEffort(dataset, next);
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
 * `rowsCommitted` (the prior-good data still being served) and sets `lastError`.
 * An OLDER attempt's failure is dropped when a NEWER attempt is already the
 * latest — it must never overwrite the newer attempt's result. A failed attempt
 * NEVER advances last-success.
 */
export async function recordProviderRefreshFailure(
  dataset: ProviderDataset,
  result: ProviderRefreshFailure
): Promise<void> {
  await withDatasetLock(dataset, async () => {
    const prior = await readPriorStatus(dataset);
    if (!prior.readOk) {
      // Cannot read prior-good state → skip rather than risk nulling it.
      logReadFailureSkip(dataset, 'failure');
      return;
    }
    const status = prior.status;
    const isLatestAttempt = result.attempt
      ? status.lastAttemptId === result.attempt.attemptId
      : true;
    if (!isLatestAttempt) {
      // A stale attempt failing late must not overwrite a newer attempt's state.
      return;
    }
    await writeStatusBestEffort(dataset, {
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
// metadata (never a source of canonical data) and is the strongest guarantee the
// current store supports; a store-side atomic update would be required to close
// the cross-instance window.
