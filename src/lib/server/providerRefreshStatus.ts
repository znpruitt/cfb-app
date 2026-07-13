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
  lastSuccessAt: string | null;
  lastError: ProviderRefreshError | null;
  source: string | null;
  rowsCommitted: number | null;
  partialFailure: boolean;
  failedPartitions?: string[];
  durationMs?: number | null;
  usage?: ProviderRefreshUsage;
};

export function emptyProviderRefreshStatus(dataset: ProviderDataset): ProviderRefreshStatus {
  return {
    dataset,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    source: null,
    rowsCommitted: null,
    partialFailure: false,
  };
}

/**
 * Read a dataset's durable refresh status. THROWS on a genuine storage failure
 * (so the admin status API surfaces a broken store as a 500 rather than a
 * misleading "never refreshed"). The best-effort record helpers below wrap their
 * own reads instead of using this.
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

async function readStatusBestEffort(dataset: ProviderDataset): Promise<ProviderRefreshStatus> {
  try {
    return await getProviderRefreshStatus(dataset);
  } catch {
    return emptyProviderRefreshStatus(dataset);
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

/**
 * Mark a refresh attempt as started. Best-effort. Callers should `await` this
 * BEFORE the upstream fetch so an in-flight (or never-completed) attempt is
 * visible as `lastAttemptAt > lastSuccessAt`, and so it can never race a later
 * success/failure write for the same refresh.
 */
export async function beginProviderRefreshAttempt(
  dataset: ProviderDataset,
  attemptStartedAt: string = new Date().toISOString()
): Promise<void> {
  const prior = await readStatusBestEffort(dataset);
  await writeStatusBestEffort(dataset, { ...prior, dataset, lastAttemptAt: attemptStartedAt });
}

export type ProviderRefreshSuccess = {
  attemptStartedAt?: string;
  source?: string | null;
  rowsCommitted?: number | null;
  partialFailure?: boolean;
  failedPartitions?: string[];
  durationMs?: number | null;
  usage?: ProviderRefreshUsage;
};

/**
 * Record a successful refresh. Call ONLY after the provider data has been
 * durably committed. Sets `lastSuccessAt = now`, clears `lastError`, and records
 * source/rows/partial state. A `partialFailure: true` here means the refresh
 * committed but a NON-required partition was absent (the route accepted it) — it
 * is still a success, flagged partial; a route that REJECTED a partial result
 * must call `recordProviderRefreshFailure` instead.
 */
export async function recordProviderRefreshSuccess(
  dataset: ProviderDataset,
  result: ProviderRefreshSuccess = {}
): Promise<void> {
  const prior = await readStatusBestEffort(dataset);
  const now = new Date().toISOString();
  await writeStatusBestEffort(dataset, {
    dataset,
    lastAttemptAt: result.attemptStartedAt ?? prior.lastAttemptAt ?? now,
    lastSuccessAt: now,
    lastError: null,
    source: result.source ?? null,
    rowsCommitted: result.rowsCommitted ?? null,
    partialFailure: result.partialFailure ?? false,
    failedPartitions:
      result.failedPartitions && result.failedPartitions.length > 0
        ? result.failedPartitions
        : undefined,
    durationMs: result.durationMs ?? null,
    usage: result.usage,
  });
}

export type ProviderRefreshFailure = {
  attemptStartedAt?: string;
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
 * A failed attempt must NEVER advance last-success.
 */
export async function recordProviderRefreshFailure(
  dataset: ProviderDataset,
  result: ProviderRefreshFailure
): Promise<void> {
  const prior = await readStatusBestEffort(dataset);
  const now = new Date().toISOString();
  await writeStatusBestEffort(dataset, {
    dataset,
    lastAttemptAt: result.attemptStartedAt ?? now,
    // Preserve prior-good success representation — a failure does not erase it.
    lastSuccessAt: prior.lastSuccessAt,
    source: prior.source,
    rowsCommitted: prior.rowsCommitted,
    lastError: {
      message: result.error,
      ...(result.code ? { code: result.code } : {}),
      ...(typeof result.status === 'number' ? { status: result.status } : {}),
    },
    partialFailure: result.partialFailure ?? prior.partialFailure ?? false,
    failedPartitions:
      result.failedPartitions && result.failedPartitions.length > 0
        ? result.failedPartitions
        : prior.failedPartitions,
    durationMs: result.durationMs ?? null,
    usage: result.usage ?? prior.usage,
  });
}
