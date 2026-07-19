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
// Test-only: number of matching writes still ALLOWED before the armed failure
// fires (so a test can let an early write in a multi-write flow commit — e.g. a
// recovery claim — and fail a later one — e.g. its release). Always 0 outside tests.
let __writeFailureRemainingSuccessesForTests = 0;
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
// Test-only: number of matching reads still ALLOWED before the armed read
// failure fires (so a test can let an early read in a multi-read flow succeed —
// e.g. recovery planning — and fail a later one — e.g. the post-claim
// authoritative reread). Always 0 outside tests.
let __readFailureRemainingSuccessesForTests = 0;
// Test-only: when set, the file-fallback transaction COMMIT (the single atomic
// staged-snapshot replacement) throws this instead of applying, leaving the
// prior file intact. See `__setAppStateFileCommitFailureForTests`.
let __fileCommitFailureForTests: Error | null = null;

/** Shared test-only read-failure seam (plain reads AND transaction reads). */
function applyReadFailureSeamForTests(scope: string): void {
  if (
    __readFailureForTests &&
    (__readFailureScopeForTests === null || __readFailureScopeForTests === scope)
  ) {
    if (__readFailureRemainingSuccessesForTests > 0) {
      __readFailureRemainingSuccessesForTests -= 1;
    } else {
      throw __readFailureForTests;
    }
  }
}

/** Shared test-only write-failure seam (plain writes AND transaction writes). */
function shouldFailWriteForTests(scope: string): boolean {
  if (!__writeFailureForTests) return false;
  if (__writeFailureScopeForTests !== null && __writeFailureScopeForTests !== scope) {
    return false;
  }
  if (__writeFailureRemainingSuccessesForTests > 0) {
    __writeFailureRemainingSuccessesForTests -= 1;
    return false;
  }
  return true;
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
// The file fallback (dev/tests only — production requires DATABASE_URL) has no
// cross-process authority, so it serializes with a per-(scope,key) in-process
// promise chain (cleaned up when the tail settles); the durable transaction is
// the production correctness boundary, and the whole-file `withFileWriteLock`
// below it still protects the snapshot rename either way.

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
 * Transaction-scoped accessor for one PRIMARY (scope, key) — the advisory
 * lock target — plus narrowly scoped secondary-key access within the SAME
 * transaction (PLATFORM-086H3). `readKey`/`writeKey` let a lock-owning
 * critical section atomically co-commit closely related bookkeeping (e.g.
 * the game-stats revision ledger) with its primary write: both persist or
 * neither does. By default secondary keys take NO additional lock — callers
 * must ensure every writer of a secondary key already serializes on the
 * primary key's lock (true for the 1:1 partition↔ledger pairing).
 *
 * `lockKey` additionally acquires the SAME per-key mutual exclusion another
 * transaction rooted at that key would hold (Postgres: a second
 * `pg_advisory_xact_lock` on this client, released at transaction end; file
 * fallback: the target key's in-process chain slot, held until the
 * transaction settles) — used when a secondary key has INDEPENDENT writers
 * (e.g. the one-time revision-ledger bootstrap consulting refresh-status
 * history). Lock-ordering discipline: the ONLY multi-lock path is
 * partition → status (merge bootstrap); status, recovery, and ledger
 * transactions never acquire a second key, so the lock graph is acyclic and
 * no reverse-order acquisition exists. This remains the smallest extension
 * over the one-key API, not a general multi-key transaction system.
 */
export type AppStateKeyTxn = {
  read<T>(): Promise<AppStateRecord<T> | null>;
  write<T>(value: T): Promise<void>;
  readKey<T>(scope: string, key: string): Promise<AppStateRecord<T> | null>;
  writeKey<T>(scope: string, key: string, value: T): Promise<void>;
  lockKey(scope: string, key: string): Promise<void>;
};

const keyLockChains = new Map<string, Promise<unknown>>();

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
    const lockRow = async (rowScope: string, rowKey: string): Promise<void> => {
      if (finished) throw new Error('app-state key transaction already finished');
      try {
        // Same lock a transaction ROOTED at (rowScope, rowKey) would take, on
        // this client, released automatically at transaction end. Acquired
        // only on the acyclic partition → status path (see AppStateKeyTxn).
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [
          `${rowScope}/${rowKey}`,
        ]);
      } catch (error) {
        txnFailed = true;
        firstStatementFailure ??= error;
        throw error;
      }
    };
    const txn: AppStateKeyTxn = {
      read: <V>() => readRow<V>(scope, key),
      write: <V>(value: V) => writeRow(scope, key, value),
      readKey: readRow,
      writeKey: writeRow,
      lockKey: lockRow,
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
          `${scope}/${key}`,
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
      } catch (error) {
        const cleanup = await tryRollback();
        if (cleanup.ok) {
          releaseHealthy();
          throw error;
        }
        releaseDestroy(cleanup.error);
        throw new AppStateTxnCleanupError(error, cleanup.error, writeAttempted, writeAcknowledged);
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

  // File fallback (dev/tests only — production requires DATABASE_URL; the
  // Postgres branch above is the production correctness boundary). Same-key
  // callbacks serialize on the in-process chain; the transaction itself is
  // STAGED (PLATFORM-086H3): one snapshot is loaded at first access, reads
  // serve staged values first (read-your-writes) and untouched keys from the
  // snapshot, and every write stages in memory. A successful callback commits
  // ALL staged keys in ONE atomic file replacement under the whole-file write
  // lock — the live file is reread inside that critical section and only the
  // staged keys are overlaid, so concurrent writers of unrelated keys are
  // never clobbered, and every key this transaction touched either commits
  // together or not at all. A failed callback discards every staged write. A
  // failed replacement leaves the previous file intact (temp-write + atomic
  // rename), so it surfaces as a typed finalize failure with `writeAttempted:
  // false` — the atomic-rename contract proves nothing staged became durable,
  // which is exactly the documented may-claim-untouched-state threshold. The
  // accessor honors the SAME lifetime contract as the Postgres branch: once
  // the callback settles, retained accessor calls fail instead of bypassing
  // the per-key chain.
  const lockKey = buildCompositeKey(scope, key);
  let fileFinished = false;
  let snapshot: Record<string, StoredEntry> | null = null;
  const staged = new Map<string, StoredEntry>();
  const heldSlots = new Set<string>([lockKey]);
  const heldSlotReleases: Array<() => void> = [];

  const ensureSnapshot = async (): Promise<Record<string, StoredEntry>> => {
    if (snapshot === null) snapshot = await readFileStore();
    return snapshot;
  };
  const readStaged = async <V>(
    rowScope: string,
    rowKey: string
  ): Promise<AppStateRecord<V> | null> => {
    if (fileFinished) throw new Error('app-state key transaction already finished');
    applyReadFailureSeamForTests(rowScope);
    const ck = buildCompositeKey(rowScope, rowKey);
    const stagedEntry = staged.get(ck);
    if (stagedEntry) {
      return { value: stagedEntry.value as V, updatedAt: stagedEntry.updatedAt };
    }
    const entries = await ensureSnapshot();
    const entry = entries[ck];
    if (!entry) return null;
    return { value: entry.value as V, updatedAt: entry.updatedAt };
  };
  const writeStaged = async <V>(rowScope: string, rowKey: string, value: V): Promise<void> => {
    if (fileFinished) throw new Error('app-state key transaction already finished');
    if (shouldFailWriteForTests(rowScope)) throw __writeFailureForTests;
    staged.set(buildCompositeKey(rowScope, rowKey), {
      value,
      updatedAt: new Date().toISOString(),
    });
  };
  const acquireKeySlot = async (rowScope: string, rowKey: string): Promise<void> => {
    if (fileFinished) throw new Error('app-state key transaction already finished');
    const ck = buildCompositeKey(rowScope, rowKey);
    if (heldSlots.has(ck)) return;
    heldSlots.add(ck);
    // Join the target key's chain: transactions rooted at that key queue
    // behind this slot until THIS transaction settles. Acyclic by the
    // documented ordering discipline (only partition → status acquires here).
    const prevTail = keyLockChains.get(ck) ?? Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const slotTail = prevTail
      .then(
        () => held,
        () => held
      )
      .then(
        () => undefined,
        () => undefined
      );
    keyLockChains.set(ck, slotTail);
    void slotTail.then(() => {
      if (keyLockChains.get(ck) === slotTail) keyLockChains.delete(ck);
    });
    heldSlotReleases.push(release);
    await prevTail.then(
      () => undefined,
      () => undefined
    );
    // The slot is ours: refresh this key's snapshot entry from the live file
    // so the now-serialized read observes the latest committed value.
    const live = await readFileStore();
    const entries = await ensureSnapshot();
    if (live[ck]) entries[ck] = live[ck];
    else delete entries[ck];
  };

  const txn: AppStateKeyTxn = {
    read: <V>() => readStaged<V>(scope, key),
    write: <V>(value: V) => writeStaged(scope, key, value),
    readKey: readStaged,
    writeKey: writeStaged,
    lockKey: acquireKeySlot,
  };
  const invoke = async (): Promise<T> => {
    try {
      const result = await fn(txn);
      if (staged.size > 0) {
        try {
          await withFileWriteLock(appStateFilePath(), async () => {
            if (__fileCommitFailureForTests) throw __fileCommitFailureForTests;
            const current = await readFileStore();
            const merged = { ...current };
            for (const [ck, entry] of staged) merged[ck] = entry;
            await writeFileStore(merged);
          });
        } catch (error) {
          // Nothing staged became durable (atomic rename left the prior file):
          // writeAttempted=false is the truthful untouched-state threshold.
          throw new AppStateTxnFinalizeError(error, false, false);
        }
      }
      return result;
    } finally {
      fileFinished = true;
      for (const release of heldSlotReleases) release();
    }
  };
  const prev = keyLockChains.get(lockKey) ?? Promise.resolve();
  const run = prev.then(invoke, invoke);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  keyLockChains.set(lockKey, tail);
  void tail.then(() => {
    // Drop the settled chain — but only when no successor queued behind it.
    if (keyLockChains.get(lockKey) === tail) keyLockChains.delete(lockKey);
  });
  return run;
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
  __writeFailureRemainingSuccessesForTests = 0;
  __readFailureForTests = null;
  __readFailureScopeForTests = null;
  __readFailureRemainingSuccessesForTests = 0;
  __fileCommitFailureForTests = null;
  __keyLockFailureForTests = null;
  __keyLockFailureScopeForTests = null;
  keyLockChains.clear();
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
 *
 * `options.afterWrites` lets that many MATCHING writes succeed before the
 * failure fires — e.g. commit a recovery claim (first write) and fail its later
 * release, exercising dual-failure post-claim paths deterministically.
 */
export function __setAppStateWriteFailureForTests(
  error: Error | null,
  scope: string | null = null,
  options?: { afterWrites?: number }
): void {
  __writeFailureForTests = error;
  __writeFailureScopeForTests = error ? scope : null;
  __writeFailureRemainingSuccessesForTests = error ? (options?.afterWrites ?? 0) : 0;
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
 *
 * `options.afterReads` lets that many MATCHING reads succeed before the failure
 * fires — e.g. let recovery planning read the schedule (first read) and fail
 * the post-claim authoritative reread (second), exercising dual-failure
 * post-claim paths deterministically.
 */
export function __setAppStateReadFailureForTests(
  error: Error | null,
  scope: string | null = null,
  options?: { afterReads?: number }
): void {
  __readFailureForTests = error;
  __readFailureScopeForTests = error ? scope : null;
  __readFailureRemainingSuccessesForTests = error ? (options?.afterReads ?? 0) : 0;
}

/**
 * Test-only: make the NEXT file-fallback transaction commits (the single
 * atomic staged-snapshot replacement) reject with `error` while leaving the
 * prior file intact — exercising the all-or-nothing rollback of multi-key
 * staged transactions. Pass `null` to clear. Cleared automatically by
 * `__resetAppStateForTests`.
 */
export function __setAppStateFileCommitFailureForTests(error: Error | null): void {
  __fileCommitFailureForTests = error;
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
 * Test-only: number of retained per-key file-fallback lock chains. Lets tests
 * prove settled chains for historical keys are released rather than retained
 * for the process lifetime.
 */
export function __appStateKeyLockChainCountForTests(): number {
  return keyLockChains.size;
}
