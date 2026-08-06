import assert from 'node:assert/strict';
import test from 'node:test';

import { getLeagues, readLeagueRegistry } from '../leagueRegistry.ts';
import type { League } from '../league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  getAppState,
  setAppState,
} from '../server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1R1 — the registry CONTAINER read is classified, so a malformed
// registry is distinguishable from an empty one.
//
// `getLeagues()` maps absent, malformed, and empty alike to `[]`. That collapse
// is why a cron facing a corrupt registry reported a zero-target reason
// asserting no league exists — the falsehood class F2H1T2/T3/T4 each refused to
// ship. These tests pin the distinction AND pin that `getLeagues()` itself is
// unchanged, because 69 modules depend on its current behavior.
// ---------------------------------------------------------------------------

function makeLeague(slug: string, year: number, status?: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2020-01-01T00:00:00.000Z',
    status,
  } as League;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __setAppStateReadFailureForTests(null);
});

test.afterEach(() => {
  __setAppStateReadFailureForTests(null);
});

// CONTRACT PIN — the three closed outcomes.
test('R1: an absent registry record classifies as missing', async () => {
  assert.deepEqual(await readLeagueRegistry(), { kind: 'missing' });
});

test('R1: an array registry classifies as ok and returns the stored leagues', async () => {
  const leagues = [makeLeague('alpha', 2026, { state: 'preseason', year: 2026 })];
  await setAppState('leagues', 'registry', leagues);

  const read = await readLeagueRegistry();
  assert.equal(read.kind, 'ok');
  if (read.kind !== 'ok') return;
  assert.equal(read.leagues.length, 1);
  assert.equal(read.leagues[0]!.slug, 'alpha');
});

// REGRESSION TEST — before R1 every one of these was indistinguishable from an
// empty registry, and a caller could only conclude "no leagues exist".
test('R1 regression: a present non-array registry classifies as malformed, not missing', async () => {
  for (const corrupt of [{ alpha: 1 }, 'not-an-array', 42, true, null]) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await setAppState('leagues', 'registry', corrupt);

    assert.deepEqual(
      await readLeagueRegistry(),
      { kind: 'malformed' },
      `a stored ${JSON.stringify(corrupt)} is corruption, not absence`
    );
  }
});

// CONTRACT PIN — `getLeagues()` behavior is deliberately UNCHANGED. If this
// drifts, 69 consumers change behavior in a slice that did not test them.
test('R1 contract pin: getLeagues() still returns [] for absent AND malformed registries', async () => {
  assert.deepEqual(await getLeagues(), [], 'absent');

  await setAppState('leagues', 'registry', { alpha: 1 });
  assert.deepEqual(await getLeagues(), [], 'malformed');

  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await setAppState('leagues', 'registry', []);
  assert.deepEqual(await getLeagues(), [], 'stored empty array');

  const leagues = [makeLeague('alpha', 2026)];
  await setAppState('leagues', 'registry', leagues);
  assert.equal((await getLeagues()).length, 1, 'a populated registry is unchanged');
});

// REGRESSION TEST — unavailability must stay distinct from corruption. A store
// failure THROWS; it must never be laundered into `malformed` or `missing`,
// which would tell a caller the data is bad when the store is merely down.
test('R1 regression: a store read failure propagates instead of classifying', async () => {
  __setAppStateReadFailureForTests(new Error('registry store down'), 'leagues');
  try {
    await assert.rejects(() => readLeagueRegistry(), /registry store down/);
    await assert.rejects(() => getLeagues(), /registry store down/);
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});

// REGRESSION TEST — the reader is read-only. A malformed registry must survive
// byte-for-byte: every registry MUTATOR coerces a non-array to `[]`, so a reader
// that "helpfully" normalized would be the one path that destroys the evidence
// an operator needs to diagnose the corruption.
test('R1 regression: classifying a malformed registry writes nothing and leaks no value', async () => {
  const corrupt = { alpha: 1, nested: { passwordHash: 'HASH-CANARY' } };
  await setAppState('leagues', 'registry', corrupt);
  const before = await getAppState<unknown>('leagues', 'registry');

  const read = await readLeagueRegistry();
  assert.deepEqual(read, { kind: 'malformed' });
  // POSITIVE CONTROL: the observer can see the stored value at all — proven by
  // reading it back non-empty — so "unchanged" below is a real observation.
  assert.ok(before !== null && before.value !== undefined, 'the corrupt value was readable');

  const after = await getAppState<unknown>('leagues', 'registry');
  assert.deepEqual(after, before, 'the malformed registry is byte-for-byte unchanged');
  assert.ok(
    !JSON.stringify(read).includes('HASH-CANARY'),
    'the malformed value never rides out on the result'
  );
});
