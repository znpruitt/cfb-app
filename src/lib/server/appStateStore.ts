import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Pool } from 'pg';

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
// Test-only: when non-null, the read failure applies ONLY to this scope (so a
// test can fail a `'schedule'` read while `'provider-refresh-status'` reads still
// succeed). Null means the failure applies to every scope. Always null outside tests.
let __readFailureScopeForTests: string | null = null;

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
  try {
    const raw = await fs.readFile(appStateFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as FileStoreShape;
    return parsed.entries ?? {};
  } catch {
    return {};
  }
}

async function writeFileStore(entries: Record<string, StoredEntry>): Promise<void> {
  await writeJsonFileAtomic(appStateFilePath(), { entries });
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
  if (
    __readFailureForTests &&
    (__readFailureScopeForTests === null || __readFailureScopeForTests === scope)
  ) {
    throw __readFailureForTests;
  }

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
  // Test-only seam: simulate a durable WRITE failure while reads still succeed,
  // so durable-first commit-order tests (PLATFORM-085A) can assert that a failed
  // persist does not publish process-local "fresh" provider data. Never set in
  // production paths.
  if (
    __writeFailureForTests &&
    (__writeFailureScopeForTests === null || __writeFailureScopeForTests === scope)
  ) {
    throw __writeFailureForTests;
  }
  const updatedAt = new Date().toISOString();

  if (hasDatabaseConfig()) {
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

  const entries = await readFileStore();
  entries[buildCompositeKey(scope, key)] = { value, updatedAt };
  await writeFileStore(entries);
  return { value, updatedAt };
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

  const entries = await readFileStore();
  delete entries[buildCompositeKey(scope, key)];
  await writeFileStore(entries);
}

export async function __deleteAppStateFileForTests(): Promise<void> {
  if (hasDatabaseConfig()) {
    await ensureDatabase();
    await getPool().query('delete from app_state');
    return;
  }

  await fs.rm(appStateFilePath(), { force: true });
}

export function __resetAppStateForTests(): void {
  initPromise = null;
  hasLoggedProductionConfigError = false;
  __writeFailureForTests = null;
  __writeFailureScopeForTests = null;
  __readFailureForTests = null;
  __readFailureScopeForTests = null;
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
