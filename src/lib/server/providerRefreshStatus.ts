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
import { toCommitStamp, type CommitStamp } from '../gameStats/revisionStamp.ts';
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
   * Per-process commit sequence of the last success — a tie-breaker for two
   * commits sharing the same millisecond `lastSuccessAt` (rereview finding #6).
   * Only meaningful WITHIN the process that wrote it; undefined for cross-process
   * or pre-rereview records.
   */
  lastSuccessSeq?: number;
  lastError: ProviderRefreshError | null;
  source: string | null;
  rowsCommitted: number | null;
  partialFailure: boolean;
  failedPartitions?: string[];
  durationMs?: number | null;
  usage?: ProviderRefreshUsage;
  /**
   * Durable per-scope ATTEMPT ordinal (PLATFORM-086H3B game-stats chronology).
   * A monotonic per-scope counter allocated by `beginGameStatsRefreshAttempt`,
   * SEPARATE from committed-evidence chronology: it orders attempts so a stale
   * terminal (lower ordinal) can never overwrite a newer attempt's diagnostics.
   * Only the game-stats lifecycle sets it; unrelated datasets leave it undefined.
   */
  lastAttemptOrdinal?: number;
  /**
   * Lineage-aware COMMITTED-evidence stamp (PLATFORM-086H3B game-stats
   * chronology). The `{ lineage, revision }` of the last durably-committed
   * revisioned success, SEPARATE from `lastAttemptOrdinal` (attempt chronology).
   * Committed evidence advances ONLY through a valid same-lineage stamp; a lower
   * revision is skipped, an equal revision is idempotent only when committed
   * metadata agrees, and a foreign lineage is a typed conflict. Only the
   * game-stats lifecycle sets it; unrelated datasets leave it undefined.
   */
  lastCommittedStamp?: CommitStamp;
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
   * at commit time alongside `committedAt`. Breaks ties between two commits that
   * share the same millisecond `committedAt` so the TRUE commit order wins over
   * status-record order within a process (rereview finding #6).
   */
  commitSeq?: number;
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
  await withScopeLock(scopeKey, async () => {
    const prior = await readPriorStatus(dataset, scope);
    if (!prior.readOk) {
      logReadFailureSkip(dataset, scopeKey, 'success');
      return;
    }
    const status = prior.status;
    const priorSuccessMs = status.lastSuccessAt ? Date.parse(status.lastSuccessAt) : -Infinity;
    const committedMs = Date.parse(committedAt);
    // Order by DURABLE COMMIT time, not status-call time: only the newest commit
    // advances last-success metadata (finding #3). When two commits share the same
    // millisecond `committedAt`, break the tie by the per-process commit sequence
    // so the TRUE commit order wins regardless of which attempt records status
    // first (finding #6) — a strict `>` on the timestamp alone would otherwise
    // reopen the ordering bug for same-ms commits. Cross-process ties (no shared
    // seq) fall back to first-writer-wins, which is best-effort by design.
    const seq = result.commitSeq;
    const priorSeq = status.lastSuccessSeq;
    const advancesSuccess =
      committedMs > priorSuccessMs ||
      (committedMs === priorSuccessMs &&
        seq !== undefined &&
        priorSeq !== undefined &&
        seq > priorSeq);

    const next: ProviderRefreshStatus = { ...status, dataset, scope, scopeKey };
    if (advancesSuccess) {
      next.lastSuccessAt = committedAt;
      next.lastSuccessSeq = seq;
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
    await writeStatusBestEffort(scopeKey, next);
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
//
// (The game-stats chronology below closes the WITHIN-process window further with
// a durable per-scope attempt ordinal + a transactional read-modify-write.)

// ===========================================================================
// PLATFORM-086H3B — game-stats refresh-status chronology (DORMANT)
// ===========================================================================
//
// A game-stats-SPECIFIC chronology layered beside the generic best-effort
// helpers above. The generic helpers (used by scores/odds/schedule/conferences)
// are UNCHANGED — this section adds new dormant functions so unrelated datasets
// keep their exact behavior (no transactional-write conversion, no regression).
//
// Two chronologies, deliberately SEPARATE (frozen contract §7 / requirement 10):
//   - ATTEMPT chronology: each begin allocates a durable per-scope ordinal and a
//     unique token. A terminal owns the attempt fields only while it is still
//     the latest attempt, so a stale terminal never overwrites newer diagnostics.
//   - COMMITTED-EVIDENCE chronology: `lastCommittedStamp` advances ONLY through a
//     valid SAME-lineage commit stamp — a lower revision is skipped, an equal
//     revision is idempotent only when committed metadata agrees, a divergent
//     equal revision is a typed conflict, and a foreign lineage is rejected
//     (repair pre-writes the stamp to establish a lineage transition).
//
// Every writer is a transactional read-modify-write returning a typed
// persistence result, and the composite `{ begin, terminal, complete }` never
// claims status was recorded when persistence failed. DORMANT: no route/cron/
// recovery caller — the dormant-boundary guard forbids these symbols in
// production; C/D/E wire them.

const GAME_STATS_DATASET: ProviderDataset = 'game-stats';

/**
 * Typed persistence result of one game-stats status mutation. Status writes
 * never throw into a caller path, but the caller must be able to SEE whether the
 * ledger recorded the outcome:
 *   - `persisted`     — the transactional write committed;
 *   - `idempotent`    — an equal-revision duplicate whose metadata agreed
 *                       (nothing to change);
 *   - `skipped-older` — a stale writer (lower committed revision AND non-latest
 *                       attempt) correctly withheld;
 *   - `skipped`       — a misrouted token or an unreadable prior state;
 *   - `conflict`      — a divergent equal revision or a foreign lineage
 *                       (committed evidence NOT advanced; durable state
 *                       preserved for inspection/repair);
 *   - `failed`        — the durable status transaction failed.
 */
export type ProviderStatusMutationResult =
  | 'persisted'
  | 'idempotent'
  | 'skipped-older'
  | 'skipped'
  | 'conflict'
  | 'failed';

function durablyRecorded(result: ProviderStatusMutationResult): boolean {
  return result === 'persisted' || result === 'idempotent';
}

/** Handle returned by `beginGameStatsRefreshAttempt`; pass it back on resolve. */
export type GameStatsRefreshAttempt = {
  attemptId: string;
  /** Durable per-scope attempt ordinal (attempt chronology). */
  ordinal: number;
  startedAt: string;
  /** Scope key the attempt was begun for (self-describing binding). */
  scopeKey: string;
  /** Whether the begin marker itself persisted (typed, never thrown). */
  persistence: ProviderStatusMutationResult;
};

/**
 * Composite status-lifecycle publication (frozen contract §7 / requirement 11).
 * The BEGIN marker and the TERMINAL record are SEPARATE durable facts; `complete`
 * is true only when BOTH were durably recorded, so a caller can never claim
 * status was recorded when persistence failed.
 */
export type GameStatsStatusPublication = {
  begin: ProviderStatusMutationResult;
  terminal: ProviderStatusMutationResult;
  complete: boolean;
};

export function composeGameStatsStatusPublication(
  begin: ProviderStatusMutationResult,
  terminal: ProviderStatusMutationResult
): GameStatsStatusPublication {
  return { begin, terminal, complete: durablyRecorded(begin) && durablyRecorded(terminal) };
}

/**
 * Run ONE atomic read-modify-write of the game-stats status row inside the
 * per-scope durable transaction. `mutate` receives the transactionally CURRENT
 * status (normalized over the empty shape; a mislabeled row is treated as
 * absent) and returns the replacement plus a typed result, or a no-write typed
 * result. Never throws into the caller — a store failure resolves `failed`.
 */
async function mutateGameStatsStatusTransactionally(
  scope: ProviderRefreshScope,
  op: string,
  mutate: (
    status: ProviderRefreshStatus
  ) =>
    | { write: ProviderRefreshStatus; result: ProviderStatusMutationResult }
    | ProviderStatusMutationResult
): Promise<ProviderStatusMutationResult> {
  const scopeKey = providerRefreshScopeKey(GAME_STATS_DATASET, scope);
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
            logReadFailureSkip(GAME_STATS_DATASET, scopeKey, op);
            return 'skipped';
          }
          const empty = emptyProviderRefreshStatus(GAME_STATS_DATASET, scope);
          const status: ProviderRefreshStatus =
            stored && (typeof stored.scopeKey !== 'string' || stored.scopeKey === scopeKey)
              ? { ...empty, ...stored, dataset: GAME_STATS_DATASET, scope, scopeKey }
              : empty;
          const outcome = mutate(status);
          if (typeof outcome === 'string') return outcome;
          await txn.write(outcome.write);
          return outcome.result;
        }
      );
    } catch (error) {
      console.error('providerRefreshStatus: game-stats status transaction failed', {
        scopeKey,
        op,
        error: error instanceof Error ? error.message : String(error),
      });
      return 'failed';
    }
  });
}

/** A game-stats completion token may resolve ONLY the scope it was begun for. */
function isMisroutedGameStatsAttempt(
  attempt: GameStatsRefreshAttempt | undefined,
  scopeKey: string,
  op: string
): boolean {
  if (!attempt) return false;
  if (attempt.scopeKey === scopeKey) return false;
  console.error('providerRefreshStatus: rejected misrouted game-stats completion token', {
    op,
    begunScopeKey: attempt.scopeKey,
    resolveScopeKey: scopeKey,
  });
  return true;
}

function validOrdinal(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * Whether `attempt` may own this record's ATTEMPT-chronology fields. The ordinary
 * case is an exact token match (its begin persisted and it is still the latest).
 * The ONE relaxation: a terminal whose own begin never persisted
 * (`persistence === 'failed'`) has no recorded token to match, yet may still
 * record its outcome truthfully — but only when its ordinal is STRICTLY greater
 * than the stored ordinal, so a genuinely stale attempt never overwrites a newer
 * one's diagnostics.
 */
function isLatestGameStatsAttempt(
  status: ProviderRefreshStatus,
  attempt?: GameStatsRefreshAttempt
): boolean {
  if (!attempt) return true;
  if (status.lastAttemptId === attempt.attemptId) return true;
  if (attempt.persistence !== 'failed') return false;
  const storedOrdinal = validOrdinal(status.lastAttemptOrdinal) ?? 0;
  return attempt.ordinal > storedOrdinal;
}

/** Whether an equal-revision success carries the SAME committed metadata. */
function committedMetadataAgrees(
  status: ProviderRefreshStatus,
  result: { source?: string | null; rowsCommitted?: number | null; partialFailure?: boolean }
): boolean {
  return (
    (status.source ?? null) === (result.source ?? null) &&
    (status.rowsCommitted ?? null) === (result.rowsCommitted ?? null) &&
    (status.partialFailure ?? false) === (result.partialFailure ?? false)
  );
}

/**
 * Begin a game-stats refresh attempt: allocate a durable per-scope ORDINAL and a
 * unique token, mark the latest attempt `in-progress`, and preserve all
 * committed-evidence metadata (a begin racing a newer success never regresses
 * it). The returned handle carries the ordinal + token + begin persistence.
 */
export async function beginGameStatsRefreshAttempt(
  scope: ProviderRefreshScope,
  opts: { startedAt?: string; attemptId?: string } = {}
): Promise<GameStatsRefreshAttempt> {
  const startedAt = opts.startedAt ?? new Date().toISOString();
  const attemptId = opts.attemptId ?? generateAttemptId();
  const scopeKey = providerRefreshScopeKey(GAME_STATS_DATASET, scope);
  let ordinal = 1;
  const persistence = await mutateGameStatsStatusTransactionally(scope, 'begin', (status) => {
    ordinal = (validOrdinal(status.lastAttemptOrdinal) ?? 0) + 1;
    return {
      write: {
        ...status,
        dataset: GAME_STATS_DATASET,
        scope,
        scopeKey,
        lastAttemptAt: startedAt,
        lastAttemptId: attemptId,
        lastAttemptOrdinal: ordinal,
        latestAttemptOutcome: 'in-progress',
        latestAttemptResolvedAt: null,
      },
      result: 'persisted',
    };
  });
  return { attemptId, ordinal, startedAt, scopeKey, persistence };
}

export type GameStatsRefreshSuccess = {
  attempt?: GameStatsRefreshAttempt;
  /**
   * The revisioned merge authority's commit stamp, captured immediately after
   * COMMIT. It is the SOLE committed-evidence ordering authority.
   */
  commitStamp?: CommitStamp;
  /** Durable commit time (defaults to now). */
  committedAt?: string;
  source?: string | null;
  rowsCommitted?: number | null;
  partialFailure?: boolean;
  failedPartitions?: string[];
  durationMs?: number | null;
  usage?: ProviderRefreshUsage;
};

/**
 * Record a game-stats success. Committed-evidence chronology advances only via a
 * valid same-lineage stamp; attempt chronology is owned separately by the latest
 * attempt. The two are independent — an older commit can update the attempt
 * outcome without advancing committed evidence, and vice versa.
 */
export async function recordGameStatsRefreshSuccess(
  scope: ProviderRefreshScope,
  result: GameStatsRefreshSuccess = {}
): Promise<ProviderStatusMutationResult> {
  const resolvedAt = new Date().toISOString();
  const committedAt = result.committedAt ?? resolvedAt;
  const scopeKey = providerRefreshScopeKey(GAME_STATS_DATASET, scope);
  if (isMisroutedGameStatsAttempt(result.attempt, scopeKey, 'success')) return 'skipped';
  return mutateGameStatsStatusTransactionally(scope, 'success', (status) => {
    const incoming = result.commitStamp ?? null;
    const stored = toCommitStamp(status.lastCommittedStamp);
    // Committed-evidence decision (frozen contract §7).
    let committed: 'advance' | 'idempotent' | 'conflict' | 'skipped' | 'none';
    if (!incoming) committed = 'none';
    else if (!stored) committed = 'advance';
    else if (incoming.lineage !== stored.lineage) committed = 'conflict';
    else if (incoming.revision > stored.revision) committed = 'advance';
    else if (incoming.revision === stored.revision)
      committed = committedMetadataAgrees(status, result) ? 'idempotent' : 'conflict';
    else committed = 'skipped';

    if (committed === 'conflict') return 'conflict'; // durable state untouched

    const owns = isLatestGameStatsAttempt(status, result.attempt);
    if (committed !== 'advance' && !owns) {
      return committed === 'idempotent' ? 'idempotent' : 'skipped-older';
    }

    const next: ProviderRefreshStatus = {
      ...status,
      dataset: GAME_STATS_DATASET,
      scope,
      scopeKey,
    };
    if (committed === 'advance') {
      next.lastCommittedStamp = incoming!;
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
    if (owns) {
      next.lastError = null;
      next.lastAttemptAt = result.attempt?.startedAt ?? status.lastAttemptAt;
      next.lastAttemptId = result.attempt?.attemptId ?? status.lastAttemptId;
      next.lastAttemptOrdinal = result.attempt?.ordinal ?? status.lastAttemptOrdinal;
      next.latestAttemptOutcome = result.partialFailure ? 'partial' : 'succeeded';
      next.latestAttemptResolvedAt = resolvedAt;
    }
    return { write: next, result: 'persisted' };
  });
}

export type GameStatsRefreshNoop = {
  attempt?: GameStatsRefreshAttempt;
  source?: string | null;
  durationMs?: number | null;
};

/**
 * Record a valid game-stats NO-OP: the latest attempt resolved with no new
 * durable commit. Never advances committed evidence; clears the latest error;
 * preserves the prior-good committed stamp/source/rows. A stale attempt is
 * dropped.
 */
export async function recordGameStatsRefreshNoop(
  scope: ProviderRefreshScope,
  result: GameStatsRefreshNoop = {}
): Promise<ProviderStatusMutationResult> {
  const resolvedAt = new Date().toISOString();
  const scopeKey = providerRefreshScopeKey(GAME_STATS_DATASET, scope);
  if (isMisroutedGameStatsAttempt(result.attempt, scopeKey, 'noop')) return 'skipped';
  return mutateGameStatsStatusTransactionally(scope, 'noop', (status) => {
    if (!isLatestGameStatsAttempt(status, result.attempt)) return 'skipped-older';
    return {
      write: {
        ...status,
        dataset: GAME_STATS_DATASET,
        scope,
        scopeKey,
        lastAttemptAt: result.attempt?.startedAt ?? status.lastAttemptAt,
        lastAttemptId: result.attempt?.attemptId ?? status.lastAttemptId,
        lastAttemptOrdinal: result.attempt?.ordinal ?? status.lastAttemptOrdinal,
        lastError: null,
        latestAttemptOutcome: 'no-op',
        latestAttemptResolvedAt: resolvedAt,
        durationMs: result.durationMs ?? null,
      },
      result: 'persisted',
    };
  });
}

export type GameStatsRefreshFailure = {
  attempt?: GameStatsRefreshAttempt;
  error: string;
  code?: string;
  status?: number;
  partialFailure?: boolean;
  failedPartitions?: string[];
  durationMs?: number | null;
  usage?: ProviderRefreshUsage;
};

/**
 * Record a game-stats failure. Preserves the prior-good committed stamp/source/
 * rows (a failure never advances or erases committed evidence) and sets the
 * latest-attempt outcome `failed`. A stale attempt is dropped.
 */
export async function recordGameStatsRefreshFailure(
  scope: ProviderRefreshScope,
  result: GameStatsRefreshFailure
): Promise<ProviderStatusMutationResult> {
  const resolvedAt = new Date().toISOString();
  const scopeKey = providerRefreshScopeKey(GAME_STATS_DATASET, scope);
  if (isMisroutedGameStatsAttempt(result.attempt, scopeKey, 'failure')) return 'skipped';
  return mutateGameStatsStatusTransactionally(scope, 'failure', (status) => {
    if (!isLatestGameStatsAttempt(status, result.attempt)) return 'skipped-older';
    return {
      write: {
        ...status,
        dataset: GAME_STATS_DATASET,
        scope,
        scopeKey,
        lastAttemptAt: result.attempt?.startedAt ?? status.lastAttemptAt,
        lastAttemptId: result.attempt?.attemptId ?? status.lastAttemptId,
        lastAttemptOrdinal: result.attempt?.ordinal ?? status.lastAttemptOrdinal,
        // Preserve the transactionally-current committed evidence.
        lastSuccessAt: status.lastSuccessAt,
        lastCommittedStamp: status.lastCommittedStamp,
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
      },
      result: 'persisted',
    };
  });
}
