import assert from 'node:assert/strict';
import test from 'node:test';

import { getLeagues, updateLeague, updateLeagueStatus } from '../leagueRegistry.ts';
import type { League } from '../league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2B — `updateLeagueStatus` is the single lifecycle-year mutation
// authority: season/preseason synchronize the top-level `league.year` to
// `status.year` in ONE registry write; offseason retains the last season year;
// generic `updateLeague` cannot mutate lifecycle fields; and a failed write can
// never leave the two year fields partially synchronized.
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
    makeLeague('alpha', 2024, { state: 'season', year: 2024 }),
  ]);

  const updated = await updateLeagueStatus('alpha', { state: 'season', year: 2026 });

  assert.equal(updated?.year, 2026);
  const stored = (await readRegistry())[0]!;
  assert.deepEqual(stored.status, { state: 'season', year: 2026 });
  assert.equal(stored.year, 2026, 'top-level year synchronized in the same record');
});

test('updateLeagueStatus(preseason) synchronizes status and top-level year', async () => {
  await setAppState('leagues', 'registry', [makeLeague('alpha', 2025, { state: 'offseason' })]);

  await updateLeagueStatus('alpha', { state: 'preseason', year: 2026 });

  const stored = (await readRegistry())[0]!;
  assert.deepEqual(stored.status, { state: 'preseason', year: 2026 });
  assert.equal(stored.year, 2026);
});

test('updateLeagueStatus(preseason, setupComplete) needs no separate year write', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2025, { state: 'preseason', year: 2026 }),
  ]);

  await updateLeagueStatus('alpha', { state: 'preseason', year: 2026, setupComplete: true });

  const stored = (await readRegistry())[0]!;
  assert.deepEqual(stored.status, { state: 'preseason', year: 2026, setupComplete: true });
  assert.equal(stored.year, 2026);
});

test('updateLeagueStatus(offseason) changes only status and retains the last season year', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2025, { state: 'season', year: 2025 }),
  ]);

  await updateLeagueStatus('alpha', { state: 'offseason' });

  const stored = (await readRegistry())[0]!;
  assert.deepEqual(stored.status, { state: 'offseason' });
  assert.equal(stored.year, 2025, 'archived-season year retained');
});

test('a failed registry write leaves status.year and league.year fully unchanged (never partial)', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2024, { state: 'season', year: 2024 }),
  ]);
  const before = await readRegistry();

  __setAppStateWriteFailureForTests(new Error('simulated registry outage'), 'leagues');
  try {
    await assert.rejects(
      () => updateLeagueStatus('alpha', { state: 'season', year: 2026 }),
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
  await setAppState('leagues', 'registry', [makeLeague('alpha', 2024, { state: 'offseason' })]);
  await updateLeagueStatus('alpha', { state: 'season', year: 2027 });
  const leagues = await getLeagues();
  assert.equal(leagues[0]!.year, 2027);
  assert.deepEqual(leagues[0]!.status, { state: 'season', year: 2027 });
});
