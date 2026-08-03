import assert from 'node:assert/strict';
import test from 'node:test';

import {
  completeSeasonRollover,
  getLeagues,
  updateLeague,
  updateLeagueStatus,
} from '../leagueRegistry.ts';
import type { League } from '../league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — the lifecycle-year mutation authority: season/preseason
// synchronize the top-level `league.year` to `status.year` in ONE registry
// write; offseason retains the last season year; generic `updateLeague` cannot
// mutate lifecycle fields; and a failed write can never leave the two year
// fields partially synchronized.
//
// PLATFORM-086F2H1 (review) restricted `updateLeagueStatus` to the `test` league
// at RUNTIME, so the tests below that exercise it directly now use that slug.
// The assertions are unchanged — the projection semantics under test are
// slug-independent, and the guarded operations cover the same projection for
// production leagues in `leagueRegistry.guardedTransitions.test.ts`.
// ---------------------------------------------------------------------------

function makeLeague(slug: string, year: number, status?: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    ...(status !== undefined ? { status } : {}),
  };
}

async function readRegistry(): Promise<League[]> {
  const record = await getAppState<League[]>('leagues', 'registry');
  return record?.value ?? [];
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(async () => {
  __resetAppStateForTests();
});

test('updateLeagueStatus(season) synchronizes status and top-level year in one stored record', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('test', 2024, { state: 'season', year: 2024 }),
  ]);

  const updated = await updateLeagueStatus('test', { state: 'season', year: 2026 });

  assert.equal(updated?.year, 2026);
  const stored = (await readRegistry())[0]!;
  assert.deepEqual(stored.status, { state: 'season', year: 2026 });
  assert.equal(stored.year, 2026, 'top-level year synchronized in the same record');
});

test('updateLeagueStatus(preseason) synchronizes status and top-level year', async () => {
  await setAppState('leagues', 'registry', [makeLeague('test', 2025, { state: 'offseason' })]);

  await updateLeagueStatus('test', { state: 'preseason', year: 2026 });

  const stored = (await readRegistry())[0]!;
  assert.deepEqual(stored.status, { state: 'preseason', year: 2026 });
  assert.equal(stored.year, 2026);
});

test('updateLeagueStatus(preseason, setupComplete) needs no separate year write', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('test', 2025, { state: 'preseason', year: 2026 }),
  ]);

  await updateLeagueStatus('test', { state: 'preseason', year: 2026, setupComplete: true });

  const stored = (await readRegistry())[0]!;
  assert.deepEqual(stored.status, { state: 'preseason', year: 2026, setupComplete: true });
  assert.equal(stored.year, 2026);
});

test('updateLeagueStatus(offseason) changes only status and retains the last season year', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('test', 2025, { state: 'season', year: 2025 }),
  ]);

  await updateLeagueStatus('test', { state: 'offseason' });

  const stored = (await readRegistry())[0]!;
  assert.deepEqual(stored.status, { state: 'offseason' });
  assert.equal(stored.year, 2025, 'archived-season year retained');
});

test('a failed registry write leaves status.year and league.year fully unchanged (never partial)', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('test', 2024, { state: 'season', year: 2024 }),
  ]);
  const before = await readRegistry();

  __setAppStateWriteFailureForTests(new Error('simulated registry outage'), 'leagues');
  try {
    await assert.rejects(
      () => updateLeagueStatus('test', { state: 'season', year: 2026 }),
      /simulated registry outage/
    );
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  const after = await readRegistry();
  assert.deepEqual(after, before, 'no partial synchronization persisted');
  assert.equal(after[0]!.year, 2024);
  assert.deepEqual(after[0]!.status, { state: 'season', year: 2024 });
});

test('generic updateLeague rejects lifecycle fields and writes nothing', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2024, { state: 'season', year: 2024 }),
  ]);
  const before = await readRegistry();

  await assert.rejects(
    () => updateLeague('alpha', { year: 2030 } as never),
    /cannot mutate lifecycle fields/
  );
  await assert.rejects(
    () => updateLeague('alpha', { status: { state: 'offseason' } } as never),
    /cannot mutate lifecycle fields/
  );

  assert.deepEqual(await readRegistry(), before);
});

test('generic updateLeague still supports configuration fields', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2024, { state: 'season', year: 2024 }),
  ]);

  const updated = await updateLeague('alpha', { displayName: 'Renamed', foundedYear: 2001 });

  assert.equal(updated?.displayName, 'Renamed');
  const stored = (await readRegistry())[0]!;
  assert.equal(stored.displayName, 'Renamed');
  assert.equal(stored.foundedYear, 2001);
  assert.equal(stored.year, 2024, 'lifecycle fields untouched');
  assert.deepEqual(stored.status, { state: 'season', year: 2024 });
});

test('getLeagues reflects the single-write synchronization', async () => {
  await setAppState('leagues', 'registry', [makeLeague('test', 2024, { state: 'offseason' })]);
  await updateLeagueStatus('test', { state: 'season', year: 2027 });
  const leagues = await getLeagues();
  assert.equal(leagues[0]!.year, 2027);
  assert.deepEqual(leagues[0]!.status, { state: 'season', year: 2027 });
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2B Codex-review remediations.
// ---------------------------------------------------------------------------

test('entering offseason heals a desynchronized top-level year from the outgoing status.year', async () => {
  await setAppState('leagues', 'registry', [
    // Legacy-desynchronized record: top-level year lags far behind the
    // authoritative status.year.
    makeLeague('test', 2010, { state: 'season', year: 2023 }),
  ]);

  await updateLeagueStatus('test', { state: 'offseason' });

  const stored = (await readRegistry())[0]!;
  assert.deepEqual(stored.status, { state: 'offseason' });
  assert.equal(stored.year, 2023, 'archived year comes from status.year, not the stale projection');
});

test('concurrent registry mutations are serialized — neither update is dropped', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('test', 2023, { state: 'season', year: 2023 }),
    makeLeague('bravo', 2024, { state: 'season', year: 2024 }),
  ]);

  // Two independent per-slug lifecycle writes racing on the ONE whole-array
  // registry record. Without the registry-key transaction both could read the
  // same snapshot and the last write would restore the other league's stale
  // state. One side uses the test-league unguarded path and the other a guarded
  // production transition — the serialization under test is a property of the
  // registry key, not of either caller.
  await Promise.all([
    updateLeagueStatus('test', { state: 'offseason' }),
    completeSeasonRollover('bravo', 2024),
  ]);

  const bySlug = Object.fromEntries((await readRegistry()).map((l) => [l.slug, l]));
  assert.deepEqual(bySlug.test!.status, { state: 'offseason' }, 'test-league update persisted');
  assert.deepEqual(bySlug.bravo!.status, { state: 'offseason' }, 'bravo update persisted');
  assert.equal(bySlug.bravo!.year, 2024);
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1 (review) — the test-league restriction is enforced at
// RUNTIME, not only by the source-scan guard.
// ---------------------------------------------------------------------------

test('updateLeagueStatus rejects a non-test slug before touching the registry', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2024, { state: 'season', year: 2024 }),
  ]);
  const before = await readRegistry();

  await assert.rejects(
    () => updateLeagueStatus('alpha', { state: 'offseason' }),
    /restricted to the 'test' league/
  );

  assert.deepEqual(await readRegistry(), before, 'zero registry mutation');
});

test('the rejection happens before any transaction is opened', async () => {
  // A store poisoned to fail on read AND write proves the guard runs first: a
  // rejection that had opened a transaction would surface the store error
  // instead of the restriction message.
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2024, { state: 'season', year: 2024 }),
  ]);
  __setAppStateReadFailureForTests(new Error('registry read must not happen'), 'leagues');
  __setAppStateWriteFailureForTests(new Error('registry write must not happen'), 'leagues');
  try {
    await assert.rejects(
      () => updateLeagueStatus('alpha', { state: 'offseason' }),
      /restricted to the 'test' league/
    );
  } finally {
    __setAppStateReadFailureForTests(null);
    __setAppStateWriteFailureForTests(null);
  }
});

test('updateLeagueStatus rejects an unknown non-test slug too (no existence probe)', async () => {
  await setAppState('leagues', 'registry', []);

  await assert.rejects(
    () => updateLeagueStatus('ghost', { state: 'offseason' }),
    /restricted to the 'test' league/
  );
});

test('the designated test league still transitions successfully', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('test', 2025, { state: 'season', year: 2025 }),
  ]);

  const updated = await updateLeagueStatus('test', { state: 'preseason', year: 2026 });

  assert.deepEqual(updated?.status, { state: 'preseason', year: 2026 });
  const stored = (await readRegistry())[0]!;
  assert.deepEqual(stored.status, { state: 'preseason', year: 2026 });
  assert.equal(stored.year, 2026, 'the projection still synchronizes for the test league');
});

test('completeSeasonRollover transitions only a league still in the exact season year', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2023, { state: 'season', year: 2023 }),
  ]);

  const transition = await completeSeasonRollover('alpha', 2023);
  assert.equal(transition.outcome, 'transitioned');

  const stored = (await readRegistry())[0]!;
  assert.deepEqual(stored.status, { state: 'offseason' });
  assert.equal(stored.year, 2023);
});

test('completeSeasonRollover refuses a league that moved on (stale rollover request)', async () => {
  await setAppState('leagues', 'registry', [
    // Another actor already rolled this league over and began the next preseason.
    makeLeague('alpha', 2024, { state: 'preseason', year: 2024 }),
    makeLeague('bravo', 2024, { state: 'season', year: 2024 }),
  ]);
  const before = await readRegistry();

  const wrongState = await completeSeasonRollover('alpha', 2023);
  assert.equal(wrongState.outcome, 'not-in-target-season', 'preseason league refused');
  const wrongYear = await completeSeasonRollover('bravo', 2023);
  assert.equal(wrongYear.outcome, 'not-in-target-season', 'different season year refused');
  const missing = await completeSeasonRollover('ghost', 2023);
  assert.equal(missing.outcome, 'not-in-target-season', 'unknown league refused');

  assert.deepEqual(await readRegistry(), before, 'refusals write nothing');
});
