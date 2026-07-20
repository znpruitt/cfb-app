import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Pool, type PoolClient } from 'pg';

import { writeJsonFileAtomic } from './atomicFileWrite.ts';

type StoredEntry = {
  value: unknown;
  updatedAt: string;
};

type FileStoreShape = {
  entries?: Record<string, StoredEntry>;
};

export type AppStateRecord<T> = {
  value: T;
  updatedAt: string;
};

export type AppStateStorageStatus = {
  mode: 'postgres' | 'file-fallback' | 'production-misconfigured';
  isProduction: boolean;
  databaseConfigured: boolean;
  filePath: string;
};

export const APP_STATE_PRODUCTION_CONFIG_ERROR =
  'DATABASE_URL is required for shared durable app state in production. Refusing to use local file fallback.';

let pool: Pool | null = null;
let initPromise: Promise<void> | null = null;
let hasLoggedProductionConfigError = false;
// Test-only: when set, `setAppState` throws this (reads unaffected). See
// `__setAppStateWriteFailureForTests`. Always null outside tests.
let __writeFailureForTests: Error | null = null;
// Test-only: when non-null, the write failure applies ONLY to this scope (so a
// test can fail a provider-data commit while status-scope writes still persist).
// Null means the failure applies to every scope. Always null outside tests.
let __writeFailureScopeForTests: string | null = null;
// Test-only: when set, `getAppState` throws this (writes unaffected). See
// `__setAppStateReadFailureForTests`. Always null outside tests.
let __readFailureForTests: Error | null = null;
// Test-only: when set, `withAppStateKeyLock` throws this at acquisition (reads
// and writes unaffected). See `__setAppStateKeyLockFailureForTests`. Always
// null outside tests.
let __keyLockFailureForTests: Error | null = null;
// Test-only: when non-null, the lock failure applies ONLY to this scope.
let __keyLockFailureScopeForTests: string | null = null;
// Test-only: when non-null, the read failure applies ONLY to this scope (so a
// test can fail a `'schedule'` read while `'provider-refresh-status'` reads still
// succeed). Null means the failure applies to every scope. Always null outside tests.
let __readFailureScopeForTests: string | null = null;
// Test-only: when set, the file-fallback transaction COMMIT (the single atomic
// staged-snapshot replacement) throws this instead of applying, leaving the
// prior file intact — so the all-or-nothing rollback of a multi-key staged
// transaction can be exercised. See `__setAppStateFileCommitFailureForTests`.
// Always null outside tests.
let __fileCommitFailureForTests: Error | null = null;

/** Shared test-only write-failure predicate (plain `setAppState` AND the
 * staged file-transaction writes both consult it). Inert in production. */
function shouldFailWriteForTests(scope: string): boolean {
  return Boolean(
    __writeFailureForTests &&
      (__writeFailureScopeForTests === null || __writeFailureScopeForTests === scope)
  );
}

/** Shared test-only read-failure seam (plain `getAppState` AND the staged
 * file-transaction reads both consult it, so a transaction read honors the same
 * injected failure a plain read would). Inert in production. */
function applyReadFailureSeamForTests(scope: string): void {
  if (
    __readFailureForTests &&
    (__readFailureScopeForTests === null || __readFailureScopeForTests === scope)
  ) {
    throw __readFailureForTests;
  }
}

function dataDir(): string {
  return path.join(process.cwd(), 'data');
}

function appStateFilePath(): string {
  // Test-only isolation: `node:test` runs each test file in its own process, but the
  // file fallback would otherwise share a single `data/app-state.json`, causing
  // cross-process read/write races and flaky failures during parallel runs. When the
  // test runner sets APP_STATE_TEST_ISOLATION, give each process its own temp file
  // (keyed by pid) so appState-backed test files cannot clobber each other. This branch
  // is never reached in dev or production, which do not set the flag.
  if (process.env.APP_STATE_TEST_ISOLATION === '1') {
    return path.join(os.tmpdir(), `cfb-app-app-state-test-${process.pid}.json`);
  }
  return path.join(dataDir(), 'app-state.json');
}

function hasDatabaseConfig(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === 'production';
}

function buildCompositeKey(scope: string, key: string): string {
  return `${scope}::${key}`;
}

export function getAppStateStorageStatus(): AppStateStorageStatus {
  const databaseConfigured = hasDatabaseConfig();
  const isProduction = isProductionRuntime();

  return {
    mode: databaseConfigured
      ? 'postgres'
      : isProduction
        ? 'production-misconfigured'
        : 'file-fallback',
    isProduction,
    databaseConfigured,
    filePath: appStateFilePath(),
  };
}

function assertDurableStorageAvailable(): void {
  const status = getAppStateStorageStatus();
  if (status.mode !== 'production-misconfigured') return;

  if (!hasLoggedProductionConfigError) {
    hasLoggedProductionConfigError = true;
    console.error(APP_STATE_PRODUCTION_CONFIG_ERROR, {
      mode: status.mode,
      filePath: status.filePath,
      nodeEnv: process.env.NODE_ENV ?? 'unknown',
    });
  }

  throw new Error(APP_STATE_PRODUCTION_CONFIG_ERROR);
}

async function readFileStore(): Promise<Record<string, StoredEntry>> {
  let raw: string;
  try {
    raw = await fs.readFile(appStateFilePath(), 'utf8');
  } catch (error) {
    // Only a genuinely MISSING file is absence (first run / cleaned store).
    // Every other failure — permissions, I/O — PROPAGATES (PLATFORM-086G2 P2
    // remediation #3): swallowing it made an unreadable store indistinguishable
    // from "nothing stored", so readers reported absence (e.g. odds usage
    // "no snapshot yet") and the next read-modify-write would silently rebuild
    // the store from {}, discarding every other key.
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
  // Malformed JSON is a CORRUPT store, not an empty one — propagate for the
  // same reason as above.
  const parsed = JSON.parse(raw) as FileStoreShape;
  return parsed?.entries ?? {};
}

async function writeFileStore(entries: Record<string, StoredEntry>): Promise<void> {
  await writeJsonFileAtomic(appStateFilePath(), { entries });
}

// ---------------------------------------------------------------------------
// File-fallback write serialization (PLATFORM-086A-SCOPED-STATUS review v2 #3).
//
// The file fallback persists the ENTIRE app-state snapshot with a read → modify
// → temp-write → atomic-rename sequence. Two concurrent writers touching
// DIFFERENT keys can each read the same snapshot, each modify their own key, and
// the last rename wins — silently dropping the other key's update. The
// provider-refresh per-SCOPE lock cannot prevent this: distinct scopes (and
// unrelated app-state writers) bypass each other. So the whole-file
// read-modify-write critical section is serialized here at the shared
// persistence boundary, across ALL keys, keyed by the normalized backing-file
// path (a different backing file may proceed independently).
//
// This applies ONLY to the file fallback — the Postgres path relies on the
// database for concurrency and is never serialized here (Requirement 13). Reads
// never rename (a reader sees either the old or the new file atomically), so
// they are not serialized. The lock is strictly BELOW the provider-status
// per-scope lock and its critical section never calls back into provider-status
// operations, so the two layers cannot invert or deadlock (Requirement 14). The
// chain's stored tail always settles, so one failed write never strands the lock
// (Requirement 15). Mirrors the `withScopeLock` mutex in providerRefreshStatus.ts.
const fileWriteLocks = new Map<string, Promise<unknown>>();
function withFileWriteLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = path.resolve(filePath);
  const prev = fileWriteLocks.get(lockKey) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  fileWriteLocks.set(
    lockKey,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 5_000,
      ssl:
        process.env.PGSSLMODE?.toLowerCase() === 'disable'
          ? undefined
          : { rejectUnauthorized: false },
    });
  }

  return pool;
}

const APP_STATE_TABLE_DDL = `
  create table if not exists app_state (
    scope text not null,
    key text not null,
    value jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (scope, key)
  )
`;

/**
 * True when a pg error is SQLSTATE 25006 (read_only_sql_transaction), raised
 * when DDL/DML is attempted on a read-only connection — e.g. a standby replica
 * or a read-only role an operator points at to inspect production. Exported for
 * tests. Kept narrow (exact code) so genuine failures are never swallowed.
 */
export function isReadOnlyTransactionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '25006'
  );
}

async function appStateTableExists(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ present: boolean }>(
    "select to_regclass('app_state') is not null as present"
  );
  return result.rows[0]?.present === true;
}

async function ensureDatabase(): Promise<void> {
  assertDurableStorageAvailable();
  if (!hasDatabaseConfig()) return;
  if (initPromise) return await initPromise;

  initPromise = (async () => {
    const nextPool = getPool();
    try {
      await nextPool.query(APP_STATE_TABLE_DDL);
    } catch (error) {
      // Read-only connection (e.g. an operator inspecting production against a
      // read replica): the `create table if not exists` DDL fails with 25006.
      // That is fine for READ callers as long as the table already exists —
      // verify and proceed. Any writer still fails on its own INSERT/DELETE, so
      // this degradation never enables an unsafe write.
      if (isReadOnlyTransactionError(error) && (await appStateTableExists(nextPool))) {
        return;
      }
      throw error;
    }
  })();

  try {
    await initPromise;
  } catch (error) {
    initPromise = null;
    throw error;
  }
}

/**
 * Confirms the durable store is writable BEFORE a destructive operation. Runs
 * the table DDL directly (a no-op when the table already exists), so a
 * read-only connection fails fast with 25006 instead of part-way through a
 * delete. Unlike `ensureDatabase`, this NEVER tolerates the read-only error —
 * a caller that intends to write must get a hard failure. Throws when durable
 * storage is unavailable or DATABASE_URL is missing.
 */
export async function assertAppStateWritable(): Promise<void> {
  assertDurableStorageAvailable();
  if (!hasDatabaseConfig()) {
    throw new Error(APP_STATE_PRODUCTION_CONFIG_ERROR);
  }
  await getPool().query(APP_STATE_TABLE_DDL);
}

// ---------------------------------------------------------------------------
// Durable per-key locked transaction (PLATFORM-086H2).
//
// Serializes a durable read→merge→write critical section on ONE app-state
// (scope, key) across ALL instances. In Postgres mode a SINGLE dedicated
// pooled client performs the ENTIRE operation — BEGIN, advisory lock
// (`pg_advisory_xact_lock(hashtextextended(scope/key, 0))`), the caller's
// read, the caller's optional write, COMMIT — so the read and any write are
// transaction-scoped on the lock-owning connection, never on ordinary pool
// helpers. The lock owner therefore never needs a second connection: same-key
// waiters each block on the advisory lock holding only their own client, and
// the pool cannot starve the active owner into deadlock. Different keys
// proceed concurrently subject to pool capacity.
//
// Failure semantics:
//   - acquisition failure (connect/BEGIN/lock) → `AppStateKeyLockAcquireError`
//     (carrying the rollback's own error as `cleanupCause` when cleanup also
//     failed);
//   - a failed `txn.read`/`txn.write` marks the transaction and rethrows to
//     the callback; if the callback settles normally afterwards the
//     transaction is ROLLED BACK (never committed half-aborted);
//   - a callback throw rolls back and rethrows the callback's error;
//   - a ROLLBACK failure throws `AppStateTxnCleanupError`; a COMMIT failure
//     throws `AppStateTxnFinalizeError`. Both carry `writeAttempted` (set
//     BEFORE any mutation SQL is submitted) and `writeAcknowledged` (set only
//     after PostgreSQL confirms the statement). Durability uncertainty after a
//     failed cleanup/finalization is governed by `writeAttempted`, NOT by
//     acknowledgement — a submitted mutation whose acknowledgement was lost or
//     whose query rejected may still have executed server-side, so callers may
//     claim untouched state only when no mutation SQL was submitted at all.
// A client whose transaction state is uncertain is DESTROYED
// (`release(error)`), never returned to the pool as healthy; disposal happens
// exactly once, and the accessor is dead after the transaction completes
// (`read`/`write` then throw), so callback code cannot retain the client past
// finalization.
//
// Multi-key transactions (PLATFORM-086H3A): the accessor also exposes
// `readKey`/`writeKey`/`lockKey` for narrowly scoped SECONDARY (scope, key)
// access within the SAME transaction, so a lock-owning critical section can
// atomically co-commit closely related bookkeeping (e.g. a companion ledger
// row) with its primary write — all touched keys persist together or none do.
//   - Postgres: every secondary read/write/lock runs on the SAME single client
//     inside the one BEGIN/COMMIT boundary. `readKey`/`writeKey` take NO
//     additional advisory lock — the caller must guarantee that every writer of
//     that secondary key already serializes on the PRIMARY key's lock.
//     `lockKey` is the EXPLICIT opt-in for a secondary key that has independent
//     writers: it takes that key's own `pg_advisory_xact_lock` on this client
//     (released at COMMIT/ROLLBACK). Acquisition order is ENFORCED, not left to
//     caller discipline: the auto-acquired primary lock is the first held
//     identity and every `lockKey` must sort strictly above the highest held
//     canonical `(scope, key)` identity, else it is rejected fail-fast with
//     `AppStateTxnLockOrderError` BEFORE any wait/query — so opposite-root
//     transactions can never invert and deadlock. Reacquiring an already-held
//     lock is an idempotent no-op.
//   - File fallback: the transaction is STAGED. One snapshot is loaded at first
//     access; reads serve staged values first (read-your-writes) and untouched
//     keys from the snapshot; writes stage in memory. A successful callback
//     commits ALL staged keys in ONE atomic file replacement under the
//     whole-file write lock — the live file is REREAD inside that lock and only
//     the staged keys are overlaid, so a concurrent writer of an UNRELATED key
//     is never clobbered. A callback throw discards every staged write; a failed
//     serialization/replacement leaves the previous file intact and surfaces a
//     typed `AppStateTxnFinalizeError` (`writeAttempted: false` — the atomic
//     rename proves NOTHING staged became durable). Partial persistence of a
//     multi-key transaction is therefore impossible on either backend.
//
// Accessor lifetime: every accessor method (primary and secondary) fails with
// "already finished" once the callback settles, so retained references cannot
// bypass the transaction after it closes.
//
// Backend guarantee: the file fallback provides the required in-process
// atomicity for the SUPPORTED dev/test fallback ONLY. It does NOT provide
// cross-process filesystem locking; production correctness requires PostgreSQL
// (DATABASE_URL), whose single-client advisory-locked transaction is the
// authoritative boundary. The whole-file `withFileWriteLock` below protects the
// snapshot rename either way.

export class AppStateKeyLockAcquireError extends Error {
  /** Set when the post-failure ROLLBACK also failed (client destroyed). */
  readonly cleanupCause?: unknown;
  constructor(cause: unknown, cleanupCause?: unknown) {
    super('app-state key lock acquisition failed');
    this.name = 'AppStateKeyLockAcquireError';
    this.cause = cause;
    this.cleanupCause = cleanupCause;
  }
}

export class AppStateTxnFinalizeError extends Error {
  /** Mutation SQL was SUBMITTED (set before the query, regardless of result). */
  readonly writeAttempted: boolean;
  /** The mutation query resolved successfully (diagnostic detail only). */
  readonly writeAcknowledged: boolean;
  constructor(cause: unknown, writeAttempted: boolean, writeAcknowledged: boolean) {
    super('app-state key transaction finalization failed');
    this.name = 'AppStateTxnFinalizeError';
    this.cause = cause;
    this.writeAttempted = writeAttempted;
    this.writeAcknowledged = writeAcknowledged;
  }
}

/**
 * ROLLBACK itself failed, so the transaction could not be confirmed cleanly
 * aborted. The uncertain client is destroyed (never returned to the pool as
 * healthy). The durability-uncertainty threshold is `writeAttempted` —
 * mutation SQL that was SUBMITTED may have executed server-side even when its
 * acknowledgement was lost or the query rejected, so callers may claim
 * untouched state ONLY when no mutation SQL was submitted at all
 * (`writeAttempted === false`). `writeAcknowledged` is retained as diagnostic
 * detail, never as the uncertainty threshold. `cause` preserves the ACTUAL
 * initiating failure (first failed statement, callback error, etc.);
 * `cleanupCause` preserves the rollback's own error.
 */
export class AppStateTxnCleanupError extends Error {
  readonly writeAttempted: boolean;
  readonly writeAcknowledged: boolean;
  readonly cleanupCause: unknown;
  constructor(
    cause: unknown,
    cleanupCause: unknown,
    writeAttempted: boolean,
    writeAcknowledged: boolean
  ) {
    super('app-state key transaction cleanup failed');
    this.name = 'AppStateTxnCleanupError';
    this.cause = cause;
    this.cleanupCause = cleanupCause;
    this.writeAttempted = writeAttempted;
    this.writeAcknowledged = writeAcknowledged;
  }
}

/**
 * A `lockKey` acquisition would VIOLATE the monotonic canonical lock order — it
 * requested a lock identity that does not sort strictly ABOVE one this
 * transaction already holds. Rejected FAIL-FAST (before any wait or
 * advisory-lock query), so two transactions rooted at opposite keys can never
 * deadlock (PostgreSQL) or indefinitely wedge the file-fallback chain. Distinct
 * from store unavailability (`AppStateKeyLockAcquireError`), commit/finalization
 * uncertainty (`AppStateTxnFinalizeError`), cleanup failure
 * (`AppStateTxnCleanupError`), and expired-accessor use (`already finished`).
 * A caller MAY catch this rejection (or leave the `lockKey` promise un-awaited)
 * and let the callback keep running — but a `lockKey` is a REQUIRED lock, so the
 * enclosing transaction is now POISONED: it can never commit successfully.
 * Catching or discarding the rejection cannot un-poison it; finalization rolls
 * back / discards staged writes and rejects (with the retained lock failure, or
 * — when the callback ALSO fails — an `AppStateTxnCallbackLockError`).
 */
export class AppStateTxnLockOrderError extends Error {
  /** Canonical serialized identity the caller tried to lock (`["scope","key"]`). */
  readonly attempted: string;
  /** Highest canonical serialized identity already held by this transaction. */
  readonly highestAcquired: string;
  constructor(attempted: string, highestAcquired: string) {
    super(
      `app-state lock-order violation: cannot acquire ${attempted} after ${highestAcquired} ` +
        '— transaction locks must be acquired in ascending canonical (scope, key) order'
    );
    this.name = 'AppStateTxnLockOrderError';
    this.attempted = attempted;
    this.highestAcquired = highestAcquired;
  }
}

/**
 * A `lockKey` (EXCLUSIVE) acquisition was requested for a `(scope, key)` this
 * transaction already holds SHARED (via `lockKeyShared`) — a shared→exclusive
 * UPGRADE. Upgrades are forbidden (PLATFORM-086H3B-ACTIVATION-FENCE-CONCURRENCY):
 * two transactions that each hold the identity shared and then try to upgrade
 * would deadlock, so the request is rejected FAIL-FAST (before any wait/query),
 * exactly like `AppStateTxnLockOrderError`. It is a REQUIRED-lock failure: the
 * enclosing transaction is POISONED and can never commit, whether or not the
 * caller awaited/caught the rejection. Lock IDENTITY and monotonic ordering are
 * unchanged by mode — only the acquired MODE differs (exclusive vs shared). A
 * same-mode reacquisition (shared→shared, exclusive→exclusive) and a downgrade
 * reacquisition (exclusive→shared) are idempotent no-ops, never upgrades.
 */
export class AppStateTxnLockUpgradeError extends Error {
  /** Canonical serialized identity held SHARED that an EXCLUSIVE lock was requested on. */
  readonly identity: string;
  constructor(identity: string) {
    super(
      `app-state lock-mode upgrade forbidden: ${identity} is held SHARED and cannot be ` +
        're-acquired EXCLUSIVE within one transaction'
    );
    this.name = 'AppStateTxnLockUpgradeError';
    this.identity = identity;
  }
}

type LockTuple = { scope: string; key: string };
/** Acquisition mode: `shared` (many concurrent) vs `exclusive` (sole holder). */
type RwLockMode = 'shared' | 'exclusive';
type LockAcquisitionOrder = 'forward' | 'held' | 'backward' | 'upgrade';

/**
 * The FIRST failed `lockKey` acquisition retained for a transaction. A failed
 * acquisition is a REQUIRED-lock failure: it poisons the enclosing transaction
 * (which then may not commit) even if the caller never awaited, caught, or kept
 * the individual `lockKey` promise. Retains the original typed error, the
 * requested identity, and whether it was an ordering rejection or a backend
 * acquisition failure.
 */
export type RetainedLockFailure = {
  error: unknown;
  scope: string;
  key: string;
  kind: 'ordering' | 'upgrade' | 'acquisition';
};

function retainedLockFailure(scope: string, key: string, error: unknown): RetainedLockFailure {
  return {
    error,
    scope,
    key,
    kind:
      error instanceof AppStateTxnLockOrderError
        ? 'ordering'
        : error instanceof AppStateTxnLockUpgradeError
          ? 'upgrade'
          : 'acquisition',
  };
}

/**
 * BOTH the transaction callback and a REQUIRED `lockKey` acquisition failed.
 *
 * A TOTAL, nonthrowing dual representation for EVERY JavaScript throw shape —
 * an ordinary/frozen/non-extensible/typed `Error`, or a primitive/`null`/
 * `undefined`: the callback-thrown value is retained as `cause` (the PRIMARY
 * failure) and the retained lock failure (original typed lock error + scope +
 * key + kind) as `lockFailure`. The callback value is NEVER mutated, so a
 * preexisting unrelated `lockFailure` property on it is preserved untouched
 * inside `cause`. When the callback merely PROPAGATED the lock rejection (the
 * same object), the primitive throws that lock error DIRECTLY instead of
 * wrapping it, so the caller still observes the original typed lock error.
 */
export class AppStateTxnCallbackLockError extends Error {
  /** The callback-thrown value (any shape) — the primary failure. */
  readonly cause: unknown;
  /** The retained required-lock failure (typed error + scope/key/kind). */
  readonly lockFailure: RetainedLockFailure;
  constructor(cause: unknown, lockFailure: RetainedLockFailure) {
    super('app-state transaction callback failed and a required lock acquisition failed');
    this.name = 'AppStateTxnCallbackLockError';
    this.cause = cause;
    this.lockFailure = lockFailure;
  }
}

// Test-only observer fired at the MOMENT the dual error is constructed, so a
// temporal regression can assert backend cleanup already completed (rollback +
// client containment, or every file-lock slot release). Inert (null) outside
// tests; never a runtime configuration surface.
let __onDualErrorConstructForTests: (() => void) | null = null;

/**
 * Combine a callback-thrown value with a required-lock failure into ONE typed,
 * inspectable primary error — TOTAL and NONTHROWING for every throw shape (no
 * mutation of the callback value). Constructed only AFTER backend cleanup
 * completes (rollback + client containment on PostgreSQL; every file-lock slot
 * release on the file fallback). When the callback simply propagated the lock
 * rejection (same object), returns that lock error unchanged so its original
 * class is preserved.
 */
function combineCallbackAndLockFailure(
  callbackError: unknown,
  lockFailure: RetainedLockFailure | null
): unknown {
  if (!lockFailure) return callbackError;
  if (callbackError === lockFailure.error) return callbackError;
  __onDualErrorConstructForTests?.();
  return new AppStateTxnCallbackLockError(callbackError, lockFailure);
}

/**
 * File-fallback DEFERRED dual failure: carried out of the lock-owning `invoke`
 * section so the public `AppStateTxnCallbackLockError` is shaped ONLY after the
 * primary and every secondary file-lock slot have been released. Never escapes
 * `withAppStateKeyTransaction`.
 */
class DeferredFileDualFailure {
  constructor(
    readonly callbackError: unknown,
    readonly lockFailure: RetainedLockFailure
  ) {}
}

/**
 * The canonical, INJECTIVE serialized identity of an app-state lock target —
 * `JSON.stringify([scope, key])`. Distinct `(scope, key)` tuples ALWAYS produce
 * distinct identities (unlike a delimiter-concatenated encoding, where e.g.
 * `('a::b','c')` and `('a','b::c')` collide), and it survives arbitrary
 * delimiter/quote/Unicode characters. Used IDENTICALLY on both backends for
 * held-lock tracking, file lock-chain keys, and the PostgreSQL advisory-lock
 * hash input. Generic app-state infrastructure with no dataset-specific policy.
 *
 * NOTE: this is LOCK identity only. Persisted app-state ROW identity remains
 * `buildCompositeKey` (`${scope}::${key}`) — the durable storage key is
 * unchanged, so this unification never migrates persisted data.
 */
function appStateLockIdentity(scope: string, key: string): string {
  return JSON.stringify([scope, key]);
}

/** Deterministic tuple ordering: compare `scope`, then `key`, lexically. */
function compareLockTuples(a: LockTuple, b: LockTuple): number {
  if (a.scope < b.scope) return -1;
  if (a.scope > b.scope) return 1;
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}

/**
 * Monotonic-acquisition decision for one `lockKey`/`lockKeyShared` request. A lock
 * already held (by injective identity) is idempotent (`held`) when the requested
 * MODE is already satisfied — a held EXCLUSIVE satisfies any request, and a held
 * SHARED satisfies a shared request — but a shared→EXCLUSIVE upgrade is `upgrade`
 * (refused). An UNHELD candidate tuple sorting strictly ABOVE the highest
 * successfully-held tuple is a legal `forward` acquisition (in the requested
 * mode); anything else is `backward`. Mode NEVER affects tuple ordering or
 * identity — only whether an already-held identity is satisfied. Deterministic
 * and timing-independent.
 */
function classifyLockAcquisition(
  candidate: LockTuple,
  candidateId: string,
  mode: RwLockMode,
  highestAcquired: LockTuple,
  heldLocks: ReadonlyMap<string, RwLockMode>
): LockAcquisitionOrder {
  const heldMode = heldLocks.get(candidateId);
  if (heldMode !== undefined) {
    if (heldMode === 'exclusive') return 'held'; // exclusive satisfies shared OR exclusive
    if (mode === 'shared') return 'held'; // shared→shared idempotent
    return 'upgrade'; // shared→exclusive forbidden
  }
  return compareLockTuples(candidate, highestAcquired) > 0 ? 'forward' : 'backward';
}

// ---------------------------------------------------------------------------
// Fair in-process reader/writer lock (file fallback only)
// ---------------------------------------------------------------------------
//
// One RW lock per canonical lock identity. It replaces the file fallback's
// exclusive promise chain so that SHARED holders may proceed concurrently while
// EXCLUSIVE holders (the primary transaction root, `lockKey`, activation
// transitions, repair CAS) remain sole owners. Fairness is FIFO by enqueue order
// with reader COALESCING at the head:
//   - multiple shared holders proceed concurrently;
//   - one exclusive holder excludes all others;
//   - a queued exclusive blocks LATER shared arrivals (no writer starvation);
//   - consecutive shared already AHEAD of a queued exclusive are granted together.
// A lock's map entry is removed once it becomes fully idle (no holders, no
// waiters), so no records leak. PostgreSQL uses `pg_advisory_xact_lock` /
// `pg_advisory_xact_lock_shared` instead — this structure is dev/test only.
type RwWaiter = { mode: RwLockMode; grant: () => void };
type RwLockState = { shared: number; exclusive: boolean; queue: RwWaiter[] };
const fileRwLocks = new Map<string, RwLockState>();

/** Grant as many head waiters as the current holders allow, then GC if idle. */
function rwPump(lockId: string, state: RwLockState): void {
  while (state.queue.length > 0) {
    const head = state.queue[0];
    if (head.mode === 'shared') {
      if (state.exclusive) break; // an exclusive holds — shared must wait
      state.queue.shift();
      state.shared += 1;
      head.grant();
    } else {
      if (state.exclusive || state.shared > 0) break; // exclusive needs sole ownership
      state.queue.shift();
      state.exclusive = true;
      head.grant();
    }
  }
  if (state.shared === 0 && !state.exclusive && state.queue.length === 0) {
    if (fileRwLocks.get(lockId) === state) fileRwLocks.delete(lockId);
  }
}

/**
 * Enqueue a reader/writer acquisition. Returns `granted` (resolves when the lock
 * is genuinely held in `mode`) and a synchronous, idempotent `release`. `release`
 * is safe before OR after grant: before grant it cancels the queued waiter; after
 * grant it drops the hold. Either way it re-pumps so successors proceed and idle
 * entries are cleaned up. The waiter is enqueued SYNCHRONOUSLY, so call order (the
 * per-transaction lock queue guarantees it) is the fair FIFO order.
 */
function rwAcquire(
  lockId: string,
  mode: RwLockMode
): { granted: Promise<void>; release: () => void } {
  let state = fileRwLocks.get(lockId);
  if (!state) {
    state = { shared: 0, exclusive: false, queue: [] };
    fileRwLocks.set(lockId, state);
  }
  const lockState = state;
  let granted = false;
  let released = false;
  let resolveGranted!: () => void;
  const grantedPromise = new Promise<void>((resolve) => (resolveGranted = resolve));
  const waiter: RwWaiter = {
    mode,
    grant: () => {
      granted = true;
      resolveGranted();
    },
  };
  const release = (): void => {
    if (released) return;
    released = true;
    if (granted) {
      if (mode === 'shared') lockState.shared -= 1;
      else lockState.exclusive = false;
    } else {
      const idx = lockState.queue.indexOf(waiter);
      if (idx >= 0) lockState.queue.splice(idx, 1);
    }
    rwPump(lockId, lockState);
  };
  lockState.queue.push(waiter);
  rwPump(lockId, lockState);
  return { granted: grantedPromise, release };
}

/**
 * Transaction-scoped accessor for one PRIMARY (scope, key) — the advisory-lock
 * target — plus narrowly scoped SECONDARY-key access within the SAME
 * transaction (PLATFORM-086H3A).
 *
 * `read`/`write` operate on the primary key. `readKey`/`writeKey` reach a
 * secondary key WITHOUT taking any additional lock (the caller guarantees that
 * key's writers already serialize on the primary lock). `lockKey` (EXCLUSIVE) and
 * `lockKeyShared` (SHARED) are the EXPLICIT secondary locks for a key with
 * independent writers — shared holders across transactions proceed concurrently,
 * an exclusive holder is the sole owner, and a shared→exclusive UPGRADE within one
 * transaction is refused (`AppStateTxnLockUpgradeError`). The
 * automatically-acquired PRIMARY lock is EXCLUSIVE and counts as the transaction's
 * first acquired lock, and every secondary lock is ENFORCED to be monotonic: a
 * request that does not sort strictly above the highest already-held canonical
 * `(scope, key)` identity is rejected fail-fast with `AppStateTxnLockOrderError`
 * (a reacquisition of an already-held lock in a satisfied mode is an idempotent
 * no-op) — so ordering is a guarantee of the primitive, not caller discipline.
 * Lock MODE never affects tuple ordering, advisory-lock identity, or persisted
 * app-state identity. Every method rejects once the transaction callback settles.
 */
export type AppStateKeyTxn = {
  read<T>(): Promise<AppStateRecord<T> | null>;
  write<T>(value: T): Promise<void>;
  readKey<T>(scope: string, key: string): Promise<AppStateRecord<T> | null>;
  writeKey<T>(scope: string, key: string, value: T): Promise<void>;
  /** Acquire an EXCLUSIVE secondary lock (sole owner across transactions). */
  lockKey(scope: string, key: string): Promise<void>;
  /** Acquire a SHARED secondary lock (concurrent with other shared holders). */
  lockKeyShared(scope: string, key: string): Promise<void>;
};

export async function withAppStateKeyTransaction<T>(
  scope: string,
  key: string,
  fn: (txn: AppStateKeyTxn) => Promise<T>
): Promise<T> {
  assertDurableStorageAvailable();
  if (
    __keyLockFailureForTests &&
    (__keyLockFailureScopeForTests === null || __keyLockFailureScopeForTests === scope)
  ) {
    throw new AppStateKeyLockAcquireError(__keyLockFailureForTests);
  }

  if (hasDatabaseConfig()) {
    await ensureDatabase();
    let client: PoolClient;
    try {
      client = await getPool().connect();
    } catch (error) {
      throw new AppStateKeyLockAcquireError(error);
    }

    let finished = false;
    // Mutation possibility is tracked from SUBMISSION, not acknowledgement: a
    // mutation statement that rejected (or lost its acknowledgement to a
    // connection failure) may still have executed server-side.
    let writeAttempted = false;
    let writeAcknowledged = false;
    let txnFailed = false;
    // The ACTUAL first statement failure — never replaced by a placeholder.
    let firstStatementFailure: unknown = null;
    // Lock-order tracking: the auto-acquired PRIMARY lock is the first held
    // identity (always EXCLUSIVE); every secondary lock must sort strictly above
    // the highest SUCCESSFULLY held tuple. `heldLocks` maps injective serialized
    // identity → strongest held MODE (so a shared→exclusive upgrade is detected).
    const heldLocks = new Map<string, RwLockMode>([
      [appStateLockIdentity(scope, key), 'exclusive'],
    ]);
    let highestAcquired: LockTuple = { scope, key };
    // `lockKey` requests are SERIALIZED per transaction: each classifies and
    // acquires (or rejects) fully before the next runs, so overlapping calls
    // acquire in invocation order and never classify against stale state. The
    // FIRST failure is retained to POISON finalization regardless of whether the
    // caller awaited/caught it.
    let lockQueue: Promise<unknown> = Promise.resolve();
    let firstLockFailure: RetainedLockFailure | null = null;
    const currentLockFailure = (): RetainedLockFailure | null => firstLockFailure;
    const drainLocks = (): Promise<void> =>
      lockQueue.then(
        () => undefined,
        () => undefined
      );
    const readRow = async <V>(
      rowScope: string,
      rowKey: string
    ): Promise<AppStateRecord<V> | null> => {
      if (finished) throw new Error('app-state key transaction already finished');
      try {
        const result = await client.query<{ value: V; updated_at: Date | string }>(
          'select value, updated_at from app_state where scope = $1 and key = $2 limit 1',
          [rowScope, rowKey]
        );
        const row = result.rows[0];
        if (!row) return null;
        return { value: row.value, updatedAt: new Date(row.updated_at).toISOString() };
      } catch (error) {
        txnFailed = true;
        firstStatementFailure ??= error;
        throw error;
      }
    };
    const writeRow = async <V>(rowScope: string, rowKey: string, value: V): Promise<void> => {
      if (finished) throw new Error('app-state key transaction already finished');
      writeAttempted = true;
      try {
        await client.query(
          `
            insert into app_state (scope, key, value, updated_at)
            values ($1, $2, $3::jsonb, $4::timestamptz)
            on conflict (scope, key)
            do update set value = excluded.value, updated_at = excluded.updated_at
          `,
          [rowScope, rowKey, JSON.stringify(value), new Date().toISOString()]
        );
        writeAcknowledged = true;
      } catch (error) {
        txnFailed = true;
        firstStatementFailure ??= error;
        throw error;
      }
    };
    const acquireLock = async (
      rowScope: string,
      rowKey: string,
      mode: RwLockMode
    ): Promise<void> => {
      if (finished) throw new Error('app-state key transaction already finished');
      const candidateId = appStateLockIdentity(rowScope, rowKey);
      const order = classifyLockAcquisition(
        { scope: rowScope, key: rowKey },
        candidateId,
        mode,
        highestAcquired,
        heldLocks
      );
      // Idempotent reacquisition (same or weaker mode already held): never re-query.
      if (order === 'held') return;
      // Backward acquisition: reject FAIL-FAST — before mutating lock state or
      // issuing the advisory-lock query — so this client never enters a wait
      // that could deadlock against an opposite-root transaction. The
      // transaction is NOT aborted; a caller may catch this and continue.
      if (order === 'backward') {
        throw new AppStateTxnLockOrderError(
          candidateId,
          appStateLockIdentity(highestAcquired.scope, highestAcquired.key)
        );
      }
      // Shared→exclusive upgrade: reject FAIL-FAST (same poisoning contract) —
      // never issue the exclusive query while already holding the identity shared.
      if (order === 'upgrade') {
        throw new AppStateTxnLockUpgradeError(candidateId);
      }
      try {
        // The SAME transaction-scoped advisory lock a transaction ROOTED at
        // (rowScope, rowKey) would take, on this client — EXCLUSIVE or SHARED per
        // mode, both on the INJECTIVE identity, released at COMMIT/ROLLBACK.
        if (mode === 'shared') {
          await client.query('select pg_advisory_xact_lock_shared(hashtextextended($1, 0))', [
            candidateId,
          ]);
        } else {
          await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
            candidateId,
          ]);
        }
        // State advances ONLY after the lock is genuinely acquired.
        heldLocks.set(candidateId, mode);
        highestAcquired = { scope: rowScope, key: rowKey };
      } catch (error) {
        txnFailed = true;
        firstStatementFailure ??= error;
        throw error;
      }
    };
    // Serialize acquisition in invocation order: request N fully settles (or
    // rejects) before request N+1 classifies, so overlapping/`Promise.all`
    // calls acquire exactly as sequentially-awaited ones would. The internal
    // scheduling tail NEVER rejects (no unhandled-rejection noise) but retains
    // the first failure so finalization can poison the transaction — observing
    // the rejection here does NOT erase it from finalization, and the returned
    // promise still rejects with the original typed error for the caller.
    const enqueueLock = (rowScope: string, rowKey: string, mode: RwLockMode): Promise<void> => {
      const run = lockQueue.then(() => acquireLock(rowScope, rowKey, mode));
      lockQueue = run.then(
        () => undefined,
        (error) => {
          firstLockFailure ??= retainedLockFailure(rowScope, rowKey, error);
          return undefined;
        }
      );
      return run;
    };
    const txn: AppStateKeyTxn = {
      read: <V>() => readRow<V>(scope, key),
      write: <V>(value: V) => writeRow(scope, key, value),
      readKey: readRow,
      writeKey: writeRow,
      lockKey: (lockScope, lockKey) => enqueueLock(lockScope, lockKey, 'exclusive'),
      lockKeyShared: (lockScope, lockKey) => enqueueLock(lockScope, lockKey, 'shared'),
    };

    // Client containment: a client whose transaction state is uncertain —
    // failed COMMIT, failed ROLLBACK, protocol failure — must NEVER re-enter
    // the pool as healthy. `release(error)` destroys the connection (pg
    // removes it from the pool), which also guarantees the server drops any
    // advisory lock still attached to it. Disposal is recorded only AFTER it
    // actually completes: a healthy release that throws falls through to
    // destruction instead of being believed successful, so neither helper ever
    // throws and disposal happens exactly once.
    let disposed = false;
    const releaseDestroy = (cause: unknown): void => {
      if (disposed) return;
      disposed = true;
      try {
        client.release(cause instanceof Error ? cause : new Error(String(cause)));
      } catch {
        // The connection is already gone; nothing healthier to do.
      }
    };
    const releaseHealthy = (): void => {
      if (disposed) return;
      try {
        client.release();
        disposed = true;
      } catch (error) {
        // Healthy disposal did NOT complete — contain the client instead.
        releaseDestroy(error);
      }
    };

    /** Confirmed-clean rollback? Returns the rollback error when NOT. */
    const tryRollback = async (): Promise<{ ok: true } | { ok: false; error: unknown }> => {
      try {
        await client.query('rollback');
        return { ok: true };
      } catch (error) {
        return { ok: false, error };
      }
    };

    try {
      try {
        await client.query('begin');
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          appStateLockIdentity(scope, key),
        ]);
      } catch (error) {
        const cleanup = await tryRollback();
        if (cleanup.ok) {
          releaseHealthy();
          throw new AppStateKeyLockAcquireError(error);
        }
        releaseDestroy(cleanup.error);
        // Both the acquisition failure AND the cleanup failure are retained.
        throw new AppStateKeyLockAcquireError(error, cleanup.error);
      }

      let result: T;
      try {
        result = await fn(txn);
        // Finalization must not race a `lockKey` invoked during the callback
        // that is still queued/in flight — drain BEFORE any commit or client
        // release, so no lock query overlaps COMMIT on this one client. The
        // drain also settles the retained-failure state.
        await drainLocks();
      } catch (error) {
        await drainLocks();
        // CLEANUP FIRST, then shape: roll back and CONTAIN the client (release or
        // destroy) BEFORE constructing the final typed error. Construction is
        // total and nonthrowing, and never runs while this transaction still
        // owns the client.
        const cleanup = await tryRollback();
        if (cleanup.ok) {
          releaseHealthy();
          throw combineCallbackAndLockFailure(error, currentLockFailure());
        }
        // Rollback ALSO failed: destroy the uncertain client, THEN construct the
        // dual error (callback primary, lock secondary) and wrap it with the
        // cleanup uncertainty via the existing typed contract.
        releaseDestroy(cleanup.error);
        const primary = combineCallbackAndLockFailure(error, currentLockFailure());
        throw new AppStateTxnCleanupError(
          primary,
          cleanup.error,
          writeAttempted,
          writeAcknowledged
        );
      }

      // Callback SUCCEEDED, but a required `lockKey` acquisition failed: the
      // transaction is POISONED. Roll back and throw the retained lock failure —
      // the callback's success value must never escape after this rollback.
      const lockFailure = currentLockFailure();
      if (lockFailure) {
        const cleanup = await tryRollback();
        if (cleanup.ok) {
          releaseHealthy();
          throw lockFailure.error;
        }
        releaseDestroy(cleanup.error);
        throw new AppStateTxnCleanupError(
          lockFailure.error,
          cleanup.error,
          writeAttempted,
          writeAcknowledged
        );
      }

      if (txnFailed) {
        // A statement inside the transaction failed (the callback handled the
        // rethrown error itself); the transaction is aborted — never COMMIT it.
        const cleanup = await tryRollback();
        if (cleanup.ok) {
          releaseHealthy();
          return result;
        }
        releaseDestroy(cleanup.error);
        throw new AppStateTxnCleanupError(
          firstStatementFailure ?? new Error('transaction statement failed'),
          cleanup.error,
          writeAttempted,
          writeAcknowledged
        );
      }

      try {
        await client.query('commit');
      } catch (error) {
        releaseDestroy(error);
        throw new AppStateTxnFinalizeError(error, writeAttempted, writeAcknowledged);
      }
      // COMMIT succeeded: the durable result is CONFIRMED. `releaseHealthy`
      // self-contains a release failure (falls through to destruction), so
      // nothing after this point can replace the confirmed result.
      releaseHealthy();
      return result;
    } finally {
      finished = true;
      // Safety net for any path that somehow skipped explicit handling; a
      // client of unknown state is destroyed, never returned as healthy.
      if (!disposed) releaseDestroy(new Error('transaction exited without explicit release'));
    }
  }

  // File fallback (dev/tests only — production requires DATABASE_URL). Same-key
  // callbacks serialize on the in-process chain; the transaction itself is
  // STAGED. One snapshot is loaded at first access, reads serve staged values
  // first (read-your-writes) and untouched keys from the snapshot, and every
  // write stages in memory. A successful callback commits ALL staged keys in
  // ONE atomic replacement under the whole-file write lock (the live file is
  // reread inside that lock and only the staged keys overlaid, so a concurrent
  // writer of an unrelated key is never clobbered). A callback throw discards
  // every staged write; a failed replacement leaves the previous file intact
  // and surfaces a typed finalize failure with `writeAttempted: false`. The
  // accessor honors the SAME lifetime contract as the Postgres branch.
  // Lock-chain identity is the INJECTIVE lock identity; the persisted staged
  // rows keep their `buildCompositeKey` ROW identity (durable key unchanged).
  const primaryLockId = appStateLockIdentity(scope, key);
  let fileFinished = false;
  let snapshot: Record<string, StoredEntry> | null = null;
  const staged = new Map<string, StoredEntry>();
  // Lock-order tracking mirrors the Postgres branch: the primary slot is the
  // first held identity (EXCLUSIVE); every secondary lock must sort strictly above
  // the highest SUCCESSFULLY held tuple. `heldSlots` maps injective serialized
  // identity → strongest held MODE (so a shared→exclusive upgrade is detected).
  const heldSlots = new Map<string, RwLockMode>([[primaryLockId, 'exclusive']]);
  let highestAcquired: LockTuple = { scope, key };
  const heldSlotReleases: Array<() => void> = [];
  // `lockKey` requests are SERIALIZED in invocation order (see the Postgres
  // branch): each fully acquires or rejects before the next classifies. The
  // first failure is retained to POISON finalization regardless of caller
  // awaiting/catching.
  let lockQueue: Promise<unknown> = Promise.resolve();
  let firstLockFailure: RetainedLockFailure | null = null;
  const currentLockFailure = (): RetainedLockFailure | null => firstLockFailure;
  const drainLocks = (): Promise<void> =>
    lockQueue.then(
      () => undefined,
      () => undefined
    );

  const ensureSnapshot = async (): Promise<Record<string, StoredEntry>> => {
    if (snapshot === null) snapshot = await readFileStore();
    return snapshot;
  };
  const readStaged = async <V>(
    rowScope: string,
    rowKey: string
  ): Promise<AppStateRecord<V> | null> => {
    if (fileFinished) throw new Error('app-state key transaction already finished');
    // Honor the same read-failure seam a plain `getAppState` would (parity with
    // the pre-staging file accessor, which read through `getAppState`).
    applyReadFailureSeamForTests(rowScope);
    const ck = buildCompositeKey(rowScope, rowKey);
    const stagedEntry = staged.get(ck);
    if (stagedEntry) return { value: stagedEntry.value as V, updatedAt: stagedEntry.updatedAt };
    const entries = await ensureSnapshot();
    const entry = entries[ck];
    if (!entry) return null;
    return { value: entry.value as V, updatedAt: entry.updatedAt };
  };
  const writeStaged = async <V>(rowScope: string, rowKey: string, value: V): Promise<void> => {
    if (fileFinished) throw new Error('app-state key transaction already finished');
    // Mirror `setAppState`'s scoped write-failure seam so a secondary-write
    // failure rolls the whole staged transaction back at stage time.
    if (shouldFailWriteForTests(rowScope)) throw __writeFailureForTests;
    staged.set(buildCompositeKey(rowScope, rowKey), {
      value,
      updatedAt: new Date().toISOString(),
    });
  };
  const acquireKeySlot = async (
    rowScope: string,
    rowKey: string,
    mode: RwLockMode
  ): Promise<void> => {
    if (fileFinished) throw new Error('app-state key transaction already finished');
    const lockId = appStateLockIdentity(rowScope, rowKey);
    const order = classifyLockAcquisition(
      { scope: rowScope, key: rowKey },
      lockId,
      mode,
      highestAcquired,
      heldSlots
    );
    // Idempotent reacquisition (same or weaker mode already held).
    if (order === 'held') return;
    // Backward acquisition: reject FAIL-FAST — before enqueueing on the RW lock
    // or mutating lock state — so this transaction never awaits a slot that could
    // wedge against an opposite-root transaction. Nothing is staged or persisted.
    if (order === 'backward') {
      throw new AppStateTxnLockOrderError(
        lockId,
        appStateLockIdentity(highestAcquired.scope, highestAcquired.key)
      );
    }
    // Shared→exclusive upgrade: reject FAIL-FAST (same poisoning contract).
    if (order === 'upgrade') {
      throw new AppStateTxnLockUpgradeError(lockId);
    }
    // Acquire the reader/writer lock in the requested mode. The `release` is
    // registered SYNCHRONOUSLY (before the await) so cleanup always frees the
    // slot even if the transaction fails while the grant is still pending; the RW
    // queue enqueues in invocation order (the lock queue serializes these calls).
    const { granted, release } = rwAcquire(lockId, mode);
    heldSlotReleases.push(release);
    await granted;
    // The slot is now ours — advance lock-order state ONLY after acquisition.
    heldSlots.set(lockId, mode);
    highestAcquired = { scope: rowScope, key: rowKey };
    // Refresh this key's snapshot entry (ROW identity) from the live file so the
    // now-serialized read observes the latest committed value.
    const rowId = buildCompositeKey(rowScope, rowKey);
    const live = await readFileStore();
    const entries = await ensureSnapshot();
    if (live[rowId]) entries[rowId] = live[rowId];
    else delete entries[rowId];
  };
  // Serialize acquisition in invocation order (see the Postgres branch); the
  // scheduling tail never rejects but retains the first failure to poison
  // finalization, while the returned promise still rejects for the caller.
  const enqueueLock = (rowScope: string, rowKey: string, mode: RwLockMode): Promise<void> => {
    const run = lockQueue.then(() => acquireKeySlot(rowScope, rowKey, mode));
    lockQueue = run.then(
      () => undefined,
      (error) => {
        firstLockFailure ??= retainedLockFailure(rowScope, rowKey, error);
        return undefined;
      }
    );
    return run;
  };
  const txn: AppStateKeyTxn = {
    read: <V>() => readStaged<V>(scope, key),
    write: <V>(value: V) => writeStaged(scope, key, value),
    readKey: readStaged,
    writeKey: writeStaged,
    lockKey: (lockScope, lockKey) => enqueueLock(lockScope, lockKey, 'exclusive'),
    lockKeyShared: (lockScope, lockKey) => enqueueLock(lockScope, lockKey, 'shared'),
  };
  const invoke = async (): Promise<T> => {
    try {
      const result = await fn(txn);
      // Drain any queued/in-flight `lockKey` BEFORE committing or releasing
      // slots, so finalization never races a pending acquisition and the
      // retained-failure state is settled.
      await drainLocks();
      // A required `lockKey` failed: the transaction is POISONED — DISCARD every
      // staged write and throw the retained lock failure (no callback success
      // value escapes, no staged write commits).
      const lockFailure = currentLockFailure();
      if (lockFailure) throw lockFailure.error;
      if (staged.size > 0) {
        try {
          await withFileWriteLock(appStateFilePath(), async () => {
            if (__fileCommitFailureForTests) throw __fileCommitFailureForTests;
            const current = await readFileStore();
            const merged = { ...current };
            for (const [rowId, entry] of staged) merged[rowId] = entry;
            await writeFileStore(merged);
          });
        } catch (error) {
          // The atomic rename left the prior file intact: nothing staged became
          // durable, so `writeAttempted: false` is the truthful threshold.
          throw new AppStateTxnFinalizeError(error, false, false);
        }
      }
      return result;
    } catch (error) {
      // Drain in-flight acquisitions before releasing slots (the enforced order
      // guarantees this drain cannot itself deadlock). Staged writes are
      // discarded by NOT committing; every SECONDARY slot is released in
      // `finally`; the PRIMARY slot releases when this `invoke` promise settles.
      await drainLocks();
      const lockFailure = currentLockFailure();
      // Callback failed AND a DISTINCT required lock failed → DEFER shaping: the
      // public dual error must be constructed only AFTER the primary slot is
      // released (below), never while `invoke` still owns it. A propagated lock
      // rejection (same object) is thrown directly.
      if (lockFailure && error !== lockFailure.error) {
        throw new DeferredFileDualFailure(error, lockFailure);
      }
      throw error;
    } finally {
      fileFinished = true;
      for (const release of heldSlotReleases) release();
    }
  };
  // Primary lock: EXCLUSIVE, via the same reader/writer lock the secondary locks
  // use, so a transaction ROOTED at an identity and another transaction taking it
  // as a SHARED/EXCLUSIVE secondary contend correctly. Acquire before running the
  // staged transaction; release once it settles. The dual-failure error is shaped
  // ONLY after the primary release (and `invoke`'s finally released the secondary
  // slots), preserving the cleanup-before-shaping contract.
  const primary = rwAcquire(primaryLockId, 'exclusive');
  await primary.granted;
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await invoke() };
  } catch (error) {
    outcome = { ok: false, error };
  } finally {
    primary.release();
  }
  if (outcome.ok) return outcome.value;
  if (outcome.error instanceof DeferredFileDualFailure) {
    // Primary + every secondary slot released → safe to shape the dual error.
    throw combineCallbackAndLockFailure(outcome.error.callbackError, outcome.error.lockFailure);
  }
  throw outcome.error;
}

export async function getAppState<T>(
  scope: string,
  key: string
): Promise<AppStateRecord<T> | null> {
  assertDurableStorageAvailable();
  // Test-only seam: simulate a durable READ failure while writes still succeed,
  // so callers that distinguish "record absent" from "read failed" (e.g.
  // providerRefreshStatus, PLATFORM-086A) can be exercised. Optionally scoped so a
  // test can fail one scope's reads (e.g. `'schedule'`) while status-scope reads
  // still succeed. Never set in production paths.
  applyReadFailureSeamForTests(scope);

  if (hasDatabaseConfig()) {
    await ensureDatabase();
    const result = await getPool().query<{ value: T; updated_at: Date | string }>(
      'select value, updated_at from app_state where scope = $1 and key = $2 limit 1',
      [scope, key]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      value: row.value,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  const entries = await readFileStore();
  const entry = entries[buildCompositeKey(scope, key)];
  if (!entry) return null;
  return {
    value: entry.value as T,
    updatedAt: entry.updatedAt,
  };
}

export async function setAppState<T>(
  scope: string,
  key: string,
  value: T
): Promise<AppStateRecord<T>> {
  assertDurableStorageAvailable();
  const updatedAt = new Date().toISOString();
  // Test-only seam: simulate a durable WRITE failure while reads still succeed,
  // so durable-first commit-order tests (PLATFORM-085A) can assert that a failed
  // persist does not publish process-local "fresh" provider data. Never set in
  // production paths. Optionally scoped so a test can fail one provider-data commit
  // while other scopes still persist.
  const shouldFailWrite = (): boolean => shouldFailWriteForTests(scope);

  if (hasDatabaseConfig()) {
    if (shouldFailWrite()) throw __writeFailureForTests;
    await ensureDatabase();
    await getPool().query(
      `
        insert into app_state (scope, key, value, updated_at)
        values ($1, $2, $3::jsonb, $4::timestamptz)
        on conflict (scope, key)
        do update set value = excluded.value, updated_at = excluded.updated_at
      `,
      [scope, key, JSON.stringify(value), updatedAt]
    );
    return { value, updatedAt };
  }

  // Serialize the whole-file read-modify-write so a concurrent writer touching a
  // different key cannot read the same snapshot and drop this update on rename.
  return await withFileWriteLock(appStateFilePath(), async () => {
    // The simulated write failure throws INSIDE the critical section (mirroring a
    // real durable-write error), so the mutex's release-on-failure is exercised —
    // one failed write must never strand the lock for the next writer.
    if (shouldFailWrite()) throw __writeFailureForTests;
    const entries = await readFileStore();
    entries[buildCompositeKey(scope, key)] = { value, updatedAt };
    await writeFileStore(entries);
    return { value, updatedAt };
  });
}

export async function getAppStateEntries<T>(
  scope: string,
  keyPrefix?: string
): Promise<Array<AppStateRecord<T> & { key: string }>> {
  assertDurableStorageAvailable();

  if (hasDatabaseConfig()) {
    await ensureDatabase();
    const result = keyPrefix
      ? await getPool().query<{ key: string; value: T; updated_at: Date | string }>(
          'select key, value, updated_at from app_state where scope = $1 and key like $2',
          [scope, `${keyPrefix}%`]
        )
      : await getPool().query<{ key: string; value: T; updated_at: Date | string }>(
          'select key, value, updated_at from app_state where scope = $1',
          [scope]
        );
    return result.rows.map((row) => ({
      key: row.key,
      value: row.value,
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  const entries = await readFileStore();
  const prefix = `${scope}::`;
  return Object.entries(entries)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, entry]) => ({
      key: k.slice(prefix.length),
      value: entry.value as T,
      updatedAt: entry.updatedAt,
    }))
    .filter((entry) => !keyPrefix || entry.key.startsWith(keyPrefix));
}

export async function listAppStateKeys(scope: string): Promise<string[]> {
  assertDurableStorageAvailable();

  if (hasDatabaseConfig()) {
    await ensureDatabase();
    const result = await getPool().query<{ key: string }>(
      'select key from app_state where scope = $1',
      [scope]
    );
    return result.rows.map((r) => r.key);
  }

  const entries = await readFileStore();
  const prefix = `${scope}::`;
  return Object.keys(entries)
    .filter((k) => k.startsWith(prefix))
    .map((k) => k.slice(prefix.length));
}

/**
 * Lists the distinct scopes present in durable storage, optionally restricted to
 * those starting with `scopePrefix`. Used by maintenance/cleanup tooling that
 * must discover scopes it does not already know the exact names of (e.g. legacy
 * `aliases:${slug}:${year}` keys for leagues that may no longer be registered).
 */
export async function listAppStateScopes(scopePrefix?: string): Promise<string[]> {
  assertDurableStorageAvailable();

  if (hasDatabaseConfig()) {
    await ensureDatabase();
    const result = scopePrefix
      ? await getPool().query<{ scope: string }>(
          'select distinct scope from app_state where scope like $1',
          [`${scopePrefix}%`]
        )
      : await getPool().query<{ scope: string }>('select distinct scope from app_state');
    return result.rows.map((r) => r.scope);
  }

  const entries = await readFileStore();
  const scopes = new Set<string>();
  for (const composite of Object.keys(entries)) {
    const sepIndex = composite.indexOf('::');
    if (sepIndex < 0) continue;
    const scope = composite.slice(0, sepIndex);
    if (!scopePrefix || scope.startsWith(scopePrefix)) scopes.add(scope);
  }
  return [...scopes];
}

export async function deleteAppState(scope: string, key: string): Promise<void> {
  assertDurableStorageAvailable();

  if (hasDatabaseConfig()) {
    await ensureDatabase();
    await getPool().query('delete from app_state where scope = $1 and key = $2', [scope, key]);
    return;
  }

  // Same whole-file serialization as setAppState — a delete is a read-modify-write
  // of the shared snapshot and must not race another key's write.
  await withFileWriteLock(appStateFilePath(), async () => {
    const entries = await readFileStore();
    delete entries[buildCompositeKey(scope, key)];
    await writeFileStore(entries);
  });
}

export async function __deleteAppStateFileForTests(): Promise<void> {
  if (hasDatabaseConfig()) {
    await ensureDatabase();
    await getPool().query('delete from app_state');
    return;
  }

  await fs.rm(appStateFilePath(), { force: true });
}

/**
 * Test-only: write an UNPARSEABLE app-state file so tests can exercise the real
 * corrupt-store read path (PLATFORM-086G2 P2 remediation #3) — distinct from
 * the throw-injecting read seam, which fires before the file backend runs.
 * File-fallback mode only.
 */
export async function __corruptAppStateFileForTests(): Promise<void> {
  await fs.mkdir(path.dirname(appStateFilePath()), { recursive: true });
  await fs.writeFile(appStateFilePath(), '{not-valid-json', 'utf8');
}

export function __resetAppStateForTests(): void {
  initPromise = null;
  hasLoggedProductionConfigError = false;
  __writeFailureForTests = null;
  __writeFailureScopeForTests = null;
  __readFailureForTests = null;
  __readFailureScopeForTests = null;
  __fileCommitFailureForTests = null;
  __onDualErrorConstructForTests = null;
  __keyLockFailureForTests = null;
  __keyLockFailureScopeForTests = null;
  fileRwLocks.clear();
  if (pool) {
    void pool.end().catch(() => undefined);
  }
  pool = null;
}

/**
 * Test-only: make subsequent `setAppState` calls reject with `error` (reads are
 * unaffected). Pass `null` to clear. Used to exercise durable-write-failure
 * commit ordering (PLATFORM-085A). Cleared automatically by
 * `__resetAppStateForTests`.
 *
 * Optionally scope the failure to a single app-state `scope` so a test can fail
 * one provider-data commit (e.g. `'schedule'`) while other scopes — notably the
 * `'provider-refresh-status'` best-effort writes — still persist. Omit `scope`
 * to fail every write.
 */
export function __setAppStateWriteFailureForTests(
  error: Error | null,
  scope: string | null = null
): void {
  __writeFailureForTests = error;
  __writeFailureScopeForTests = error ? scope : null;
}

/**
 * Test-only: make subsequent `getAppState` calls reject with `error` (writes are
 * unaffected). Pass `null` to clear. Used to exercise callers that must
 * distinguish an absent record from a failed read (PLATFORM-086A provider
 * refresh status). Cleared automatically by `__resetAppStateForTests`.
 *
 * Optionally scope the failure to a single app-state `scope` so a test can fail
 * one scope's reads (e.g. `'schedule'`) while other scopes — notably the
 * `'provider-refresh-status'` reads — still succeed. Omit `scope` to fail every read.
 */
export function __setAppStateReadFailureForTests(
  error: Error | null,
  scope: string | null = null
): void {
  __readFailureForTests = error;
  __readFailureScopeForTests = error ? scope : null;
}

/**
 * Test-only: make the NEXT file-fallback transaction commits (the single atomic
 * staged-snapshot replacement) reject with `error` while leaving the prior file
 * intact — exercising the all-or-nothing rollback of a multi-key staged
 * transaction. Pass `null` to clear. Cleared automatically by
 * `__resetAppStateForTests`. Never set in production paths.
 */
export function __setAppStateFileCommitFailureForTests(error: Error | null): void {
  __fileCommitFailureForTests = error;
}

/**
 * Test-only: register an observer fired at the exact moment the combined
 * callback-plus-lock error (`AppStateTxnCallbackLockError`) is CONSTRUCTED, so a
 * temporal regression can assert backend cleanup already completed (PostgreSQL
 * rollback + client containment, or every file-lock slot release). Pass `null`
 * to clear. Inert (null) outside tests; cleared by `__resetAppStateForTests`.
 */
export function __setBeforeDualErrorConstructForTests(fn: (() => void) | null): void {
  __onDualErrorConstructForTests = fn;
}

/**
 * Test-only: make subsequent `withAppStateKeyLock` calls reject with `error` at
 * acquisition time — before `fn` runs — so callers that must map an unavailable
 * lock to a typed non-destructive outcome (PLATFORM-086H2 durable merge) can be
 * exercised. Reads and writes are unaffected. Pass `null` to clear; optionally
 * scope to one app-state `scope`. Cleared automatically by
 * `__resetAppStateForTests`.
 */
export function __setAppStateKeyLockFailureForTests(
  error: Error | null,
  scope: string | null = null
): void {
  __keyLockFailureForTests = error;
  __keyLockFailureScopeForTests = error ? scope : null;
}

/**
 * Test-only: inject a fake `pg` Pool so the Postgres branch of
 * `withAppStateKeyTransaction` (single-client transaction lifecycle, advisory
 * lock ordering, commit-failure indeterminacy) can be exercised without a live
 * database. Callers must also point DATABASE_URL at a placeholder so
 * `hasDatabaseConfig()` selects the Postgres path, and must clear both via
 * `__resetAppStateForTests` / env restore afterwards. Never set in production.
 */
export function __setAppStatePoolForTests(fake: Pool | null): void {
  pool = fake;
}

/**
 * Test-only: number of retained per-key file-fallback reader/writer locks. Lets
 * tests prove idle locks for historical keys are released (fully-idle entries are
 * GC'd by `rwPump`) rather than retained for the process lifetime.
 */
export function __appStateKeyLockChainCountForTests(): number {
  return fileRwLocks.size;
}
