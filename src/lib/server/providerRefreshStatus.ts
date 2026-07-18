/**
 * Durable, target-SCOPED provider-refresh status (PLATFORM-086A-SCOPED).
 *
 * Records — truthfully — the last refresh ATTEMPT, its explicit OUTCOME, the last
 * SUCCESS (by durable commit time), last ERROR, source, rows committed, and
 * partial-failure state for each provider-backed dataset, so operators can answer
 * "is a refresh in progress / did the last attempt succeed, fail, or complete
 * with no applicable data / is the served data stale" without reading logs.
 *
 * The record identity is a CANONICAL TARGET SCOPE (see `providerRefreshScope.ts`),
 * NOT just the dataset. A refresh for one year, season partition, week, or Odds
 * query variant records against only that target and can never establish success
 * or freshness for a different year or a broader target it did not refresh. The
 * durable storage key IS the scope key, and every record is self-describing
 * (`scope` + `scopeKey` are persisted and re-asserted on read).
 *
 * Truthfulness invariants (the whole point of this module):
 *   - A failed attempt NEVER advances `lastSuccessAt`; it preserves the prior
 *     success timestamp and the prior source/rows (the prior-good representation
 *     that is still being served) FOR THAT SCOPE.
 *   - Success is recorded only AFTER the caller has durably committed provider
 *     data (see PLATFORM-085A durable-first ordering), so status can never claim
 *     success before the data is durable.
 *   - `lastSuccessAt` is the DURABLE COMMIT time the caller passes as
 *     `committedAt` (captured immediately after `setAppState` resolves), NOT the
 *     time this status helper happened to run. Ordering successes by commit time
 *     keeps an older commit from overwriting a newer one's metadata just because
 *     it recorded status later (PLATFORM-086A rereview finding #3).
 *   - The LATEST attempt's outcome is explicit (`latestAttemptOutcome`): an
 *     in-progress attempt is never inferred to be a success or failure from the
 *     historical `lastSuccessAt`/`lastError` fields (rereview finding #8). Begin
 *     marks `in-progress`; success/failure/no-op resolve it — but only when the
 *     resolving attempt IS still the latest attempt FOR THAT SCOPE.
 *   - Every record helper is BEST-EFFORT: it swallows its own storage errors and
 *     never throws into the provider path, so a status-write failure can never
 *     corrupt or roll back the provider-data commit that already happened.
 *
 * Concurrency (PLATFORM-086A): every refresh gets a unique attempt token from
 * `beginProviderRefreshAttempt`, bound to its dataset + scope. The token is passed
 * back on resolve, so an OLDER attempt that finishes after a NEWER one began (for
 * the SAME scope) cannot restore its own attempt identity, clear the newer
 * attempt's error, or replace the newer attempt's outcome. A completion for one
 * scope can never overwrite a different scope, because each scope is a distinct
 * durable key with its own record and its own in-process lock. Read-modify-write
 * per scope is serialized in-process by a keyed lock so same-process overlap is
 * deterministic; cross-instance ordering is best-effort (the app-state store has
 * no compare-and-set — see the module note at the bottom).
 *
 * Read-failure handling: a genuine durable READ failure is distinct from an
 * absent record. On a read failure the record helpers SKIP their write rather
 * than synthesize an empty record that would erase unknown prior-good state; an
 * absent record still initializes normally.
 *
 * Storage: app-state scope `provider-refresh-status`, one key per canonical target
 * scope (`providerRefreshScopeKey(dataset, scope)`). Legacy pre-scoped records key
 * on the bare dataset string (the `legacy-unscoped` scope), so they remain
 * addressable for deep diagnostics without a migration.
 */

import { randomUUID } from 'node:crypto';

import { getAppState, setAppState, withAppStateKeyTransaction } from './appStateStore.ts';
import type { ProviderDataset } from '../providerDatasets.ts';
import {
  legacyUnscopedScope,
  providerRefreshScopeKey,
  type ProviderRefreshScope,
} from '../providerRefreshScope.ts';

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
  /** The canonical target this record belongs to (self-describing). */
  scope: ProviderRefreshScope;
  /** The durable status key derived from `dataset` + `scope` (must match storage). */
  scopeKey: string;
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
  /**
   * Per-process commit sequence of the last success — a LEGACY tie-breaker for
   * datasets that do not yet supply a durable revision. Only meaningful WITHIN
   * the process that wrote it; undefined for cross-process or pre-rereview
   * records. Game-stats ordering uses `lastSuccessRevision` instead.
   */
  lastSuccessSeq?: number;
  /**
   * DURABLE commit revision of the last success (PLATFORM-086H3): allocated
   * transactionally with the evidence write, monotonic per scope, and
   * globally comparable across processes, instances, and restarts. When an
   * incoming success carries a revision, ordering uses IT exclusively — an
   * older revision can never overwrite a newer one, an equal revision is an
   * idempotent duplicate, and a stored record without a valid revision
   * (legacy or malformed) yields to the first revision-carrying commit.
   */
  lastSuccessRevision?: number;
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
  /** Dataset the attempt was begun for (self-describing binding). */
  dataset: ProviderDataset;
  /** Scope key the attempt was begun for (self-describing binding). */
  scopeKey: string;
};

export function emptyProviderRefreshStatus(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope
): ProviderRefreshStatus {
  return {
    dataset,
    scope,
    scopeKey: providerRefreshScopeKey(dataset, scope),
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

// A process-INDEPENDENT token: two serverless instances beginning a refresh in
// the same millisecond must not collide (a timestamp+per-process-counter scheme
// would, letting an older resolver masquerade as the newer attempt and clobber
// its outcome — rereview finding #5). `randomUUID` is cryptographically unique
// across processes.
function generateAttemptId(): string {
  return randomUUID();
}

// Monotonic per-process commit sequence: a tie-breaker for two successful commits
// that share the same millisecond `committedAt`. Captured by the caller at commit
// time (right after `setAppState`) via `nextProviderCommitSeq()`, so within a
// process the TRUE commit order is preserved regardless of which attempt records
// status first (rereview finding #6). Cross-process it is not comparable, which is
// acceptable — cross-instance status ordering is already best-effort.
let commitSeqCounter = 0;
export function nextProviderCommitSeq(): number {
  commitSeqCounter += 1;
  return commitSeqCounter;
}

/**
 * Read a dataset's durable refresh status FOR A CANONICAL SCOPE. THROWS on a
 * genuine storage failure (so the admin status API surfaces a broken store as a
 * 500 rather than a misleading "never refreshed"). The best-effort record helpers
 * below distinguish this throw (read failure) from an absent record via
 * `readPriorStatus`.
 *
 * A stored record whose persisted `scopeKey` disagrees with the key it was read
 * under is MALFORMED and is treated as absent (empty) rather than presented as
 * authoritative (requirement 4). The returned record's `dataset`/`scope`/`scopeKey`
 * are always the requested identity.
 */
export async function getProviderRefreshStatus(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope
): Promise<ProviderRefreshStatus> {
  const scopeKey = providerRefreshScopeKey(dataset, scope);
  const record = await getAppState<ProviderRefreshStatus>(PROVIDER_REFRESH_STATUS_SCOPE, scopeKey);
  const empty = emptyProviderRefreshStatus(dataset, scope);
  if (!record?.value) return empty;
  const stored = record.value;
  // Self-describing agreement: a record that stored a different scope key than the
  // one it lives under is corrupt/mislabeled and must not be presented as truth.
  // (Legacy pre-scoped records have no stored scopeKey and are exempt — they are
  // only ever read under the legacy-unscoped key, which equals the bare dataset.)
  if (typeof stored.scopeKey === 'string' && stored.scopeKey !== scopeKey) {
    return empty;
  }
  // Merge over the empty shape so older/partial records gain any new fields; the
  // requested dataset/scope/scopeKey are always authoritative.
  return { ...empty, ...stored, dataset, scope, scopeKey };
}

type PriorStatusRead = { readOk: true; status: ProviderRefreshStatus } | { readOk: false };

async function readPriorStatus(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope
): Promise<PriorStatusRead> {
  try {
    // getProviderRefreshStatus returns the empty shape for an ABSENT record and
    // throws only on a genuine store failure — that is the distinction we need.
    return { readOk: true, status: await getProviderRefreshStatus(dataset, scope) };
  } catch {
    return { readOk: false };
  }
}

async function writeStatusBestEffort(scopeKey: string, next: ProviderRefreshStatus): Promise<void> {
  try {
    await setAppState(PROVIDER_REFRESH_STATUS_SCOPE, scopeKey, next);
  } catch (error) {
    // Best-effort: a status-write failure must never propagate into the provider
    // path (the provider-data commit already succeeded or already failed on its
    // own terms). Log for diagnosis and move on.
    console.error('providerRefreshStatus: failed to persist status', {
      dataset: next.dataset,
      scopeKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function logReadFailureSkip(dataset: ProviderDataset, scopeKey: string, op: string): void {
  console.error('providerRefreshStatus: prior status unreadable — skipping write', {
    dataset,
    scopeKey,
    op,
  });
}

// Per-SCOPE in-process serialization of read-modify-write, so overlapping
// same-process updates never interleave between their read and write. Keyed by
// the durable scope key so two different targets (e.g. 2025 vs 2026 schedule)
// never contend, and two attempts on the SAME target serialize deterministically.
// Returns a promise that resolves with `fn`'s result; the chain never rejects.
const scopeLocks = new Map<string, Promise<unknown>>();
function withScopeLock<T>(scopeKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = scopeLocks.get(scopeKey) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  scopeLocks.set(
    scopeKey,
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
 * A completion token may resolve ONLY the exact dataset + scope it was begun for
 * (review remediation finding 4). When the passed attempt was opened for a
 * different dataset or scope than the resolver is mutating, the call is a
 * misrouted completion: it must NOT write into either scope (it would falsely
 * advance the resolver's scope while leaving the token's own scope `in-progress`).
 * Returns `true` to signal "reject — skip the write." It logs a diagnostic and
 * never throws into the provider path; the caller that lost/misrouted the token is
 * responsible for correct resolution (this helper does not synthesize a failure
 * for the token's own scope).
 */
function isMisroutedAttempt(
  attempt: ProviderRefreshAttempt | undefined,
  dataset: ProviderDataset,
  scopeKey: string,
  op: string
): boolean {
  if (!attempt) return false;
  if (attempt.dataset === dataset && attempt.scopeKey === scopeKey) return false;
  console.error('providerRefreshStatus: rejected misrouted completion token', {
    op,
    begunDataset: attempt.dataset,
    begunScopeKey: attempt.scopeKey,
    resolveDataset: dataset,
    resolveScopeKey: scopeKey,
  });
  return true;
}

/**
 * Mark a refresh attempt as started for a canonical target scope and return its
 * token. Callers should `await` this BEFORE the upstream fetch (and BEFORE
 * credential validation, so a missing-key early return still resolves a recorded
 * attempt) and pass the returned attempt to the matching success/failure/no-op
 * record WITH THE SAME SCOPE so overlapping attempts resolve deterministically.
 * Begin marks the latest attempt `in-progress` and preserves historical
 * success/error (which belong to prior attempts of this same scope, not this one).
 */
export async function beginProviderRefreshAttempt(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope,
  opts: { startedAt?: string; attemptId?: string } = {}
): Promise<ProviderRefreshAttempt> {
  const startedAt = opts.startedAt ?? new Date().toISOString();
  const attemptId = opts.attemptId ?? generateAttemptId();
  const scopeKey = providerRefreshScopeKey(dataset, scope);
  await withScopeLock(scopeKey, async () => {
    const prior = await readPriorStatus(dataset, scope);
    if (!prior.readOk) {
      // Read failed — do not synthesize an empty record that would erase unknown
      // prior-good state.
      logReadFailureSkip(dataset, scopeKey, 'begin');
      return;
    }
    await writeStatusBestEffort(scopeKey, {
      ...prior.status,
      dataset,
      scope,
      scopeKey,
      lastAttemptAt: startedAt,
      lastAttemptId: attemptId,
      // This attempt is now the latest and has no result yet. Historical
      // lastSuccessAt / lastError are preserved but no longer describe THIS
      // attempt (finding #8).
      latestAttemptOutcome: 'in-progress',
      latestAttemptResolvedAt: null,
    });
  });
  return { attemptId, startedAt, dataset, scopeKey };
}

export type ProviderRefreshSuccess = {
  attempt?: ProviderRefreshAttempt;
  /**
   * Durable commit time — capture immediately after the `setAppState` that
   * persisted the provider data. Defaults to now if omitted (only correct when
   * the status call directly follows the commit with no intervening await).
   */
  committedAt?: string;
  /**
   * Per-process monotonic commit sequence from `nextProviderCommitSeq()`, captured
   * at commit time alongside `committedAt`. LEGACY tie-breaker for datasets
   * without a durable revision; ignored when `commitRevision` is present.
   */
  commitSeq?: number;
  /**
   * DURABLE commit revision allocated transactionally with the evidence
   * write (the game-stats merge authority's partition revision). When
   * present, it is the SOLE ordering authority for last-success metadata.
   */
  commitRevision?: number;
  source?: string | null;
  rowsCommitted?: number | null;
  partialFailure?: boolean;
  failedPartitions?: string[];
  durationMs?: number | null;
  usage?: ProviderRefreshUsage;
};

/**
 * Record a successful refresh for a canonical target scope. Call ONLY after the
 * provider data has been durably committed. Last-success metadata advances only
 * when this commit (`committedAt`) is the newest durable commit FOR THIS SCOPE;
 * the latest-attempt/outcome/error state is only set when this attempt IS the
 * latest attempt for this scope (an older attempt resolving late does not clear a
 * newer attempt's error/outcome). A `partialFailure: true` here means the refresh
 * committed but a NON-required partition was absent (the route accepted it) —
 * still a success, flagged partial; a route that REJECTED a partial result must
 * call `recordProviderRefreshFailure` instead.
 */
export async function recordProviderRefreshSuccess(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope,
  result: ProviderRefreshSuccess = {}
): Promise<void> {
  const resolvedAt = new Date().toISOString();
  const committedAt = result.committedAt ?? resolvedAt;
  const scopeKey = providerRefreshScopeKey(dataset, scope);
  if (isMisroutedAttempt(result.attempt, dataset, scopeKey, 'success')) return;
  // PLATFORM-086H3: the success compare-and-write is ATOMIC in durable state —
  // read, revision comparison, and write run inside ONE per-scope transaction
  // (`withAppStateKeyTransaction`), so two publishers on different instances
  // (or across restarts) cannot interleave a stale read between each other's
  // writes. The in-process scope lock remains as cheap same-process
  // serialization; it is no longer the correctness boundary. A transaction
  // failure is best-effort logged like every status write — status must never
  // break the provider path whose durable commit already resolved.
  await withScopeLock(scopeKey, async () => {
    try {
      await withAppStateKeyTransaction(PROVIDER_REFRESH_STATUS_SCOPE, scopeKey, async (txn) => {
        let stored: ProviderRefreshStatus | null;
        try {
          stored = (await txn.read<ProviderRefreshStatus>())?.value ?? null;
        } catch {
          logReadFailureSkip(dataset, scopeKey, 'success');
          return;
        }
        const empty = emptyProviderRefreshStatus(dataset, scope);
        const status: ProviderRefreshStatus =
          stored && (typeof stored.scopeKey !== 'string' || stored.scopeKey === scopeKey)
            ? { ...empty, ...stored, dataset, scope, scopeKey }
            : empty;

        // Ordering authority. A DURABLE revision (when supplied) is the sole
        // comparator: newer wins; equal is an idempotent duplicate/retry;
        // a stored record without a comparable revision (legacy row, malformed
        // value, pre-revision status) yields to the first revision-carrying
        // commit — malformed legacy status never defeats newer committed
        // evidence. Datasets without revisions keep the legacy committedAt +
        // per-process-seq ordering.
        const incomingRevision =
          typeof result.commitRevision === 'number' &&
          Number.isSafeInteger(result.commitRevision) &&
          result.commitRevision > 0
            ? result.commitRevision
            : null;
        const storedRevision =
          typeof status.lastSuccessRevision === 'number' &&
          Number.isSafeInteger(status.lastSuccessRevision) &&
          status.lastSuccessRevision > 0
            ? status.lastSuccessRevision
            : null;
        let advancesSuccess: boolean;
        if (incomingRevision !== null) {
          advancesSuccess = storedRevision === null || incomingRevision > storedRevision;
        } else {
          const priorSuccessMs = status.lastSuccessAt
            ? Date.parse(status.lastSuccessAt)
            : -Infinity;
          const committedMs = Date.parse(committedAt);
          const seq = result.commitSeq;
          const priorSeq = status.lastSuccessSeq;
          advancesSuccess =
            committedMs > priorSuccessMs ||
            (committedMs === priorSuccessMs &&
              seq !== undefined &&
              priorSeq !== undefined &&
              seq > priorSeq);
        }

        const next: ProviderRefreshStatus = { ...status, dataset, scope, scopeKey };
        if (advancesSuccess) {
          next.lastSuccessAt = committedAt;
          next.lastSuccessSeq = result.commitSeq;
          if (incomingRevision !== null) next.lastSuccessRevision = incomingRevision;
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
          // Attempt CHRONOLOGY is deliberately separate from committed-success
          // ordering: this attempt owns the latest-attempt/outcome/error state
          // even when an older commit did not advance last-success.
          next.lastError = null;
          next.lastAttemptAt = result.attempt?.startedAt ?? status.lastAttemptAt;
          next.lastAttemptId = result.attempt?.attemptId ?? status.lastAttemptId;
          next.latestAttemptOutcome = result.partialFailure ? 'partial' : 'succeeded';
          next.latestAttemptResolvedAt = resolvedAt;
        }
        await txn.write(next);
      });
    } catch (error) {
      console.error('providerRefreshStatus: failed to persist status transactionally', {
        dataset,
        scopeKey,
        op: 'success',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

export type ProviderRefreshNoop = {
  attempt?: ProviderRefreshAttempt;
  /** Where the (empty but valid) response came from, for display. */
  source?: string | null;
  durationMs?: number | null;
};

/**
 * Record a valid NO-OP resolution for a canonical target scope: the provider
 * request succeeded and validated but had no applicable data (e.g. a season-wide
 * postseason score request before bowls are published). This is NOT a failure —
 * it must not raise a provider error — and NOT a new durable commit — it must not
 * advance `lastSuccessAt` or overwrite the prior-good source/rows. It only
 * resolves the LATEST attempt of this scope as `no-op` and clears any stale error
 * (the latest attempt did not fail). A stale (non-latest) attempt resolving as
 * no-op is dropped.
 */
export async function recordProviderRefreshNoop(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope,
  result: ProviderRefreshNoop = {}
): Promise<void> {
  const resolvedAt = new Date().toISOString();
  const scopeKey = providerRefreshScopeKey(dataset, scope);
  if (isMisroutedAttempt(result.attempt, dataset, scopeKey, 'noop')) return;
  await withScopeLock(scopeKey, async () => {
    const prior = await readPriorStatus(dataset, scope);
    if (!prior.readOk) {
      logReadFailureSkip(dataset, scopeKey, 'noop');
      return;
    }
    const status = prior.status;
    if (!isLatest(status, result.attempt)) {
      // A stale attempt resolving late must not overwrite a newer attempt's state.
      return;
    }
    await writeStatusBestEffort(scopeKey, {
      ...status,
      dataset,
      scope,
      scopeKey,
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
 * Record a failed refresh for a canonical target scope. Preserves the prior
 * `lastSuccessAt`, `source`, and `rowsCommitted` (the prior-good data still being
 * served) and sets `lastError` plus the latest-attempt outcome `failed`. An OLDER
 * attempt's failure is dropped when a NEWER attempt of this scope is already the
 * latest — it must never overwrite the newer attempt's result. A failed attempt
 * NEVER advances last-success.
 */
export async function recordProviderRefreshFailure(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope,
  result: ProviderRefreshFailure
): Promise<void> {
  const resolvedAt = new Date().toISOString();
  const scopeKey = providerRefreshScopeKey(dataset, scope);
  if (isMisroutedAttempt(result.attempt, dataset, scopeKey, 'failure')) return;
  await withScopeLock(scopeKey, async () => {
    const prior = await readPriorStatus(dataset, scope);
    if (!prior.readOk) {
      // Cannot read prior-good state → skip rather than risk nulling it.
      logReadFailureSkip(dataset, scopeKey, 'failure');
      return;
    }
    const status = prior.status;
    if (!isLatest(status, result.attempt)) {
      // A stale attempt failing late must not overwrite a newer attempt's state.
      return;
    }
    await writeStatusBestEffort(scopeKey, {
      ...status,
      dataset,
      scope,
      scopeKey,
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

/**
 * Read a dataset's LEGACY unscoped record (the pre-scoped record keyed only by the
 * bare dataset string). Exposed for deep diagnostics ONLY — a legacy record is
 * never selected-year truth, never clears a scoped error, and is never evidence a
 * scoped cache is available (requirement 9). Returns the empty shape when absent.
 */
export async function getLegacyProviderRefreshStatus(
  dataset: ProviderDataset
): Promise<ProviderRefreshStatus> {
  return getProviderRefreshStatus(dataset, legacyUnscopedScope());
}

// Cross-instance concurrency limitation (honest note): the app-state store has
// no compare-and-set primitive, so the attempt-token comparison + per-scope lock
// only guarantee deterministic ordering WITHIN a single process. Two server
// instances writing the same scope's record for overlapping attempts can still
// last-writer-win across instances. This is acceptable for observability metadata
// (never a source of canonical data): canonical provider data remains durable-first
// and authoritative, and explicit commit timestamps + attempt IDs already remove
// the WITHIN-process ordering and unresolved-attempt hazards. A store-side atomic
// update would be required to fully close the cross-instance window.
