import assert from 'node:assert/strict';
import test from 'node:test';

import { getPreseasonOwners, savePreseasonOwners } from '../preseasonOwnerStore.ts';
import { __deleteAppStateFileForTests, __resetAppStateForTests } from '../server/appStateStore.ts';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

// Assigning `undefined` to a `process.env` key stores the string "undefined"
// (which reads as configured); delete instead when the original was unset.
function restoreDatabaseUrl(): void {
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete MUTABLE_ENV.DATABASE_URL;
  } else {
    MUTABLE_ENV.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
}

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  restoreDatabaseUrl();
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  restoreDatabaseUrl();
});

/**
 * Force the app-state store to throw on read the way a transient database
 * failure would: `NODE_ENV=production` without `DATABASE_URL` makes every
 * `getAppState` call throw `APP_STATE_PRODUCTION_CONFIG_ERROR` before it touches
 * any backend. Used to prove a read failure propagates rather than being
 * swallowed to `null` (which the canonical standings selector would then cache
 * as a valid "no preseason owners" state).
 */
function forceStoreReadFailure(): void {
  MUTABLE_ENV.NODE_ENV = 'production';
  delete MUTABLE_ENV.DATABASE_URL;
  __resetAppStateForTests();
}

// ---------------------------------------------------------------------------
// PLATFORM-084A — cache valid absence, never cache uncertainty.
// A missing preseason-owners record is a genuine, cacheable absence (`null`);
// a store-read FAILURE must NOT be reported as "no preseason owners".
// ---------------------------------------------------------------------------

test('getPreseasonOwners returns null for an unwritten league+year (valid absence)', async () => {
  assert.equal(await getPreseasonOwners('tsc', 2025), null);
});

test('getPreseasonOwners round-trips a stored owner list', async () => {
  await savePreseasonOwners('tsc', 2025, ['Alice', 'Bob']);
  assert.deepEqual(await getPreseasonOwners('tsc', 2025), ['Alice', 'Bob']);
});

test('getPreseasonOwners is year-scoped (no cross-year bleed)', async () => {
  await savePreseasonOwners('tsc', 2025, ['Alice']);
  assert.equal(await getPreseasonOwners('tsc', 2026), null);
});

test('a store read failure propagates and is not swallowed to null', async () => {
  forceStoreReadFailure();
  await assert.rejects(() => getPreseasonOwners('tsc', 2025));
});

test('after a failed read, a subsequent successful read returns the stored owners', async () => {
  forceStoreReadFailure();
  await assert.rejects(() => getPreseasonOwners('tsc', 2025));

  // Store recovers: nothing bogus was cached, so the real owners are returned.
  MUTABLE_ENV.NODE_ENV = 'development';
  restoreDatabaseUrl();
  __resetAppStateForTests();
  await savePreseasonOwners('tsc', 2025, ['Alice', 'Bob']);

  assert.deepEqual(await getPreseasonOwners('tsc', 2025), ['Alice', 'Bob']);
});
