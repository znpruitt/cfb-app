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

import { getAppState, withAppStateKeyTransaction } from './appStateStore.ts';
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
  /**
   * Typed provider-attempt diagnostic summary persisted WITH the latest
   * attempt resolution (PLATFORM-086H3) — degradation taxonomy counts the
   * admin diagnostics can inspect without the transient HTTP response.
   * Owned by the latest attempt; never describes the committed dataset.
   */
  lastAttemptDiagnostics?: unknown;
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
  /**
   * Whether the begin marker itself persisted (typed, never thrown). Carried
   * so downstream publication can report the COMPLETE status lifecycle —
   * begin and terminal are separate durable facts, never collapsed.
   */
  persistence: ProviderStatusMutationResult;
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

/**
 * Typed persistence result of one status mutation (PLATFORM-086H3). Status
 * writes never throw into the provider path, but callers must be able to see
 * — and surface — whether the ledger actually recorded the outcome:
 *   - `persisted`     — the transactional write committed;
 *   - `idempotent`    — an equal-revision duplicate/retry (nothing to change);
 *   - `skipped-older` — a stale writer (older revision / non-latest attempt)
 *                       whose write was correctly withheld;
 *   - `skipped`       — misrouted token or unreadable prior state;
 *   - `failed`        — the durable status transaction failed.
 */
export type ProviderStatusMutationResult =
  | 'persisted'
  | 'idempotent'
  | 'skipped-older'
  | 'skipped'
  | 'failed';

/**
 * Run one ATOMIC read→merge→write status mutation inside the per-scope
 * durable transaction. `mutate` receives the transactionally CURRENT status
 * (normalized over the empty shape; a mislabeled row is treated as absent)
 * and returns the replacement plus the typed result — or a no-write typed
 * result. Every status writer (begin/success/no-op/failure) flows through
 * here: no generic read-then-write pair remains, so a stale writer on
 * another instance can never regress newer committed metadata.
 */
async function mutateStatusTransactionally(
  dataset: ProviderDataset,
  scope: ProviderRefreshScope,
  op: string,
  mutate: (
    status: ProviderRefreshStatus
  ) =>
    | { write: ProviderRefreshStatus; result: ProviderStatusMutationResult }
    | ProviderStatusMutationResult
): Promise<ProviderStatusMutationResult> {
  const scopeKey = providerRefreshScopeKey(dataset, scope);
  return withScopeLock(scopeKey, async () => {
    try {
      return await withAppStateKeyTransaction<ProviderStatusMutationResult>(
        PROVIDER_REFRESH_STATUS_SCOPE,
        scopeKey,
        async (txn) => {
          let stored: ProviderRefreshStatus | null;
          try {
            stored = (await txn.read<ProviderRefreshStatus>())?.value ?? null;
          } catch {
            logReadFailureSkip(dataset, scopeKey, op);
            return 'skipped';
          }
          const empty = emptyProviderRefreshStatus(dataset, scope);
          const status: ProviderRefreshStatus =
            stored && (typeof stored.scopeKey !== 'string' || stored.scopeKey === scopeKey)
              ? { ...empty, ...stored, dataset, scope, scopeKey }
              : empty;
          const outcome = mutate(status);
          if (typeof outcome === 'string') return outcome;
          await txn.write(outcome.write);
          return outcome.result;
        }
      );
    } catch (error) {
      console.error('providerRefreshStatus: failed to persist status transactionally', {
        dataset,
        scopeKey,
        op,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'failed';
    }
  });
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

/**
 * Whether `attempt` may own this record's attempt-chronology fields. The
 * recorded-id match is the ordinary case: an attempt whose BEGIN marker
 * persisted owns the record only while its id is still the latest recorded —
 * a stale attempt whose id was superseded is dropped, EVEN when it shares the
 * newer attempt's `startedAt` millisecond (strict id equality, never a `>=`
 * timestamp tie).
 *
 * The ONE relaxation (PLATFORM-086H3): a terminal write whose own BEGIN marker
 * never persisted (`attempt.persistence === 'failed'`) has no recorded id to
 * match, yet must still be able to record its outcome truthfully. Such an
 * attempt may own the record only when nothing STRICTLY NEWER has begun since
 * (`startedAt` strictly greater than the stored attempt time, or no stored
 * attempt at all), preserving cross-instance protection against a genuinely
 * stale attempt overwriting a newer one. An unparseable `startedAt` never
 * takes ownership.
 */
function isLatest(status: ProviderRefreshStatus, attempt?: ProviderRefreshAttempt): boolean {
  if (!attempt) return true;
  if (status.lastAttemptId === attempt.attemptId) return true;
  // Only a begin-failed attempt may claim ownership without an id match.
  if (attempt.persistence !== 'failed') return false;
  const attemptMs = Date.parse(attempt.startedAt);
  if (!Number.isFinite(attemptMs)) return false;
  const storedMs = status.lastAttemptAt ? Date.parse(status.lastAttemptAt) : Number.NaN;
  if (!Number.isFinite(storedMs)) return true;
  // STRICTLY newer — an equal-millisecond stale attempt never wins a tie.
  return attemptMs > storedMs;
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
  const persistence = await mutateStatusTransactionally(dataset, scope, 'begin', (status) => ({
    // Begin owns ONLY the attempt-chronology fields: the transactionally
    // current success metadata (lastSuccessAt/Revision, source, rows,
    // partial/full, diagnostics of a committed attempt) rides through
    // untouched, so a begin racing a newer success can never regress it.
    write: {
      ...status,
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
    },
    result: 'persisted',
  }));
  return { attemptId, startedAt, dataset, scopeKey, persistence };
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
  /** Typed provider-attempt diagnostic summary (persisted with the attempt). */
  diagnostics?: unknown;
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
): Promise<ProviderStatusMutationResult> {
  const resolvedAt = new Date().toISOString();
  const committedAt = result.committedAt ?? resolvedAt;
  const scopeKey = providerRefreshScopeKey(dataset, scope);
  if (isMisroutedAttempt(result.attempt, dataset, scopeKey, 'success')) return 'skipped';
  // PLATFORM-086H3: read, revision comparison, and write run inside ONE
  // per-scope durable transaction (the shared mutator) — two publishers on
  // different instances (or across restarts) cannot interleave a stale read
  // between each other's writes.
  return mutateStatusTransactionally(dataset, scope, 'success', (status) => {
    // Ordering authority. A DURABLE revision (when supplied) is the sole
    // comparator: newer wins; equal is an idempotent duplicate/retry; a
    // stored record without a comparable revision (legacy row, malformed
    // value, pre-revision status) yields to the first revision-carrying
    // commit — malformed legacy status never defeats newer committed
    // evidence. Datasets without revisions keep the legacy committedAt +
    // per-process-seq ordering (diagnostic tie-break only).
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
    let duplicate = false;
    if (incomingRevision !== null) {
      advancesSuccess = storedRevision === null || incomingRevision > storedRevision;
      duplicate = storedRevision !== null && incomingRevision === storedRevision;
    } else {
      const priorSuccessMs = status.lastSuccessAt ? Date.parse(status.lastSuccessAt) : -Infinity;
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

    const latest = isLatest(status, result.attempt);
    if (!advancesSuccess && !latest) {
      // Nothing this stale writer owns: neither the success chronology (an
      // older commit) nor the attempt chronology (a superseded attempt).
      return duplicate ? 'idempotent' : 'skipped-older';
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
    if (latest) {
      // Attempt CHRONOLOGY is deliberately separate from committed-success
      // ordering: this attempt owns the latest-attempt/outcome/error state
      // even when an older commit did not advance last-success.
      next.lastError = null;
      next.lastAttemptAt = result.attempt?.startedAt ?? status.lastAttemptAt;
      next.lastAttemptId = result.attempt?.attemptId ?? status.lastAttemptId;
      next.latestAttemptOutcome = result.partialFailure ? 'partial' : 'succeeded';
      next.latestAttemptResolvedAt = resolvedAt;
      if (result.diagnostics !== undefined) next.lastAttemptDiagnostics = result.diagnostics;
    }
    return {
      write: next,
      result: advancesSuccess ? 'persisted' : duplicate ? 'idempotent' : 'persisted',
    };
  });
}

export type ProviderRefreshNoop = {
  attempt?: ProviderRefreshAttempt;
  /** Where the (empty but valid) response came from, for display. */
  source?: string | null;
  durationMs?: number | null;
  /** Typed provider-attempt diagnostic summary (persisted with the attempt). */
  diagnostics?: unknown;
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
): Promise<ProviderStatusMutationResult> {
  const resolvedAt = new Date().toISOString();
  const scopeKey = providerRefreshScopeKey(dataset, scope);
  if (isMisroutedAttempt(result.attempt, dataset, scopeKey, 'noop')) return 'skipped';
  return mutateStatusTransactionally(dataset, scope, 'noop', (status) => {
    if (!isLatest(status, result.attempt)) {
      // A stale attempt resolving late must not overwrite a newer attempt's state.
      return 'skipped-older';
    }
    return {
      write: {
        ...status,
        dataset,
        scope,
        scopeKey,
        lastAttemptAt: result.attempt?.startedAt ?? status.lastAttemptAt,
        lastAttemptId: result.attempt?.attemptId ?? status.lastAttemptId,
        // A clean no-op resolution clears the latest error but preserves the
        // TRANSACTIONALLY CURRENT prior-good success metadata untouched
        // (lastSuccessAt/lastSuccessRevision/source/rowsCommitted — a no-op
        // racing a newer success cannot regress it).
        lastError: null,
        latestAttemptOutcome: 'no-op',
        latestAttemptResolvedAt: resolvedAt,
        durationMs: result.durationMs ?? null,
        ...(result.diagnostics !== undefined ? { lastAttemptDiagnostics: result.diagnostics } : {}),
      },
      result: 'persisted',
    };
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
  /** Typed provider-attempt diagnostic summary (persisted with the attempt). */
  diagnostics?: unknown;
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
): Promise<ProviderStatusMutationResult> {
  const resolvedAt = new Date().toISOString();
  const scopeKey = providerRefreshScopeKey(dataset, scope);
  if (isMisroutedAttempt(result.attempt, dataset, scopeKey, 'failure')) return 'skipped';
  return mutateStatusTransactionally(dataset, scope, 'failure', (status) => {
    if (!isLatest(status, result.attempt)) {
      // A stale attempt failing late must not overwrite a newer attempt's state.
      return 'skipped-older';
    }
    return {
      write: {
        ...status,
        dataset,
        scope,
        scopeKey,
        lastAttemptAt: result.attempt?.startedAt ?? status.lastAttemptAt,
        lastAttemptId: result.attempt?.attemptId ?? status.lastAttemptId,
        // Preserve the TRANSACTIONALLY CURRENT prior-good success metadata —
        // a failure racing a newer success cannot regress lastSuccessAt/
        // lastSuccessRevision/source/rowsCommitted.
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
        ...(result.diagnostics !== undefined ? { lastAttemptDiagnostics: result.diagnostics } : {}),
      },
      result: 'persisted',
    };
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
