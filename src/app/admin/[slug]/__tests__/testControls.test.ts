import assert from 'node:assert/strict';
import test from 'node:test';

// `runWithRevalidateContext` installs the global AsyncLocalStorage before the
// Next storage module loads, so the server actions' `revalidatePath` runs under
// the bare node:test runner. Imported rather than re-implemented — the store
// shape is a Next internal, and one copy is enough to maintain.
import { runWithRevalidateContext } from '../../../api/draft/[slug]/[year]/__tests__/_setup/revalidateContext';

import { resetTestLeague, setTestLeagueStatus } from '../actions';
import { TEST_LEAGUE_SLUG, type League } from '../../../../lib/league.ts';
import { TEST_LEAGUE_RESET_YEAR } from '../../../../lib/leagueRegistry.ts';
import { draftScope } from '../../../../lib/draft.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import type { ScheduleProbeState } from '../../../../lib/scheduleProbe.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1T1 — the demo-league sandbox controls.
//
// Two properties are load-bearing:
//   1. The lifecycle year is derived by the AUTHORITY under the registry lock,
//      and the action clears state for the year the authority returned — never
//      a locally recomputed one, and never before the commit is confirmed.
//   2. A demo reset touches demo-SCOPED state only. It previously deleted
//      `schedule-probe/<year>`, which is keyed by year alone and shared with
//      every production league.
// ---------------------------------------------------------------------------

function makeLeague(slug: string, year: number, status?: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...(status !== undefined ? { status } : {}),
  };
}

async function seed(...leagues: League[]): Promise<void> {
  await setAppState('leagues', 'registry', leagues);
}

async function readRegistry(): Promise<League[]> {
  const record = await getAppState<League[]>('leagues', 'registry');
  return record?.value ?? [];
}

async function readLeague(slug: string): Promise<League | undefined> {
  return (await readRegistry()).find((l) => l.slug === slug);
}

/** Seed the demo-scoped records the controls are expected to clear. */
async function seedDemoScopes(year: number): Promise<void> {
  await setAppState(`preseason-owners:${TEST_LEAGUE_SLUG}`, String(year), ['Alice', 'Bob']);
  await setAppState(`owners:${TEST_LEAGUE_SLUG}:${year}`, 'csv', 'team,owner\nTexas,Alice');
  await setAppState(draftScope(TEST_LEAGUE_SLUG), String(year), { phase: 'complete' });
}

async function demoScopesPresent(year: number): Promise<boolean[]> {
  return [
    (await getAppState(`preseason-owners:${TEST_LEAGUE_SLUG}`, String(year))) !== null,
    (await getAppState(`owners:${TEST_LEAGUE_SLUG}:${year}`, 'csv')) !== null,
    (await getAppState(draftScope(TEST_LEAGUE_SLUG), String(year))) !== null,
  ];
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(() => {
  __resetAppStateForTests();
});

// Risk: cleanup targets a year the action computed itself, diverging from the
// year the authority actually installed.
test('preseason cleanup targets the year the AUTHORITY resolved', async () => {
  // Deliberately desynchronized: `league.year` (2019) is NOT the authoritative
  // year. The old action derived from `league.year` for offseason/missing
  // records; the authority derives from `status.year`. Only 2026 may be cleared.
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2019, { state: 'season', year: 2025 }));
  await seedDemoScopes(2026);
  await seedDemoScopes(2020); // the year a stale local derivation would target

  await runWithRevalidateContext(() => setTestLeagueStatus('preseason'));

  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, {
    state: 'preseason',
    year: 2026,
  });
  assert.deepEqual(await demoScopesPresent(2026), [false, false, false], 'resolved year cleared');
  assert.deepEqual(
    await demoScopesPresent(2020),
    [true, true, true],
    'no other year is touched by a locally recomputed value'
  );
});

// Risk: state is cleared for a lifecycle write that never landed.
test('a refused lifecycle write clears nothing', async () => {
  // An unusable stored year refuses inside the transaction.
  await seed(makeLeague(TEST_LEAGUE_SLUG, 1800, { state: 'season', year: 1800 }));
  await seedDemoScopes(1801);
  await seedDemoScopes(2026);
  const before = await readRegistry();

  await assert.rejects(
    () => runWithRevalidateContext(() => setTestLeagueStatus('preseason')),
    /Unable to set test league status/
  );

  assert.deepEqual(await readRegistry(), before, 'the registry is untouched');
  assert.deepEqual(await demoScopesPresent(1801), [true, true, true], 'no cleanup on refusal');
  assert.deepEqual(await demoScopesPresent(2026), [true, true, true]);
});

test('an absent demo league clears nothing and reports not found', async () => {
  await seed(makeLeague('alpha', 2025, { state: 'season', year: 2025 }));
  await seedDemoScopes(2026);

  await assert.rejects(
    () => runWithRevalidateContext(() => setTestLeagueStatus('preseason')),
    /Test league not found/
  );
  await assert.rejects(
    () => runWithRevalidateContext(() => resetTestLeague()),
    /Test league not found/
  );

  assert.deepEqual(await demoScopesPresent(2026), [true, true, true]);
  assert.equal((await readRegistry()).length, 1, 'no league was created');
});

// Risk: THE REGRESSION — a demo reset disarms the schedule probe that
// production leagues depend on, re-handing that year between crons.
test('reset preserves the shared schedule probe byte-for-byte', async () => {
  const probeYear = TEST_LEAGUE_RESET_YEAR + 1;
  const probe: ScheduleProbeState = {
    year: probeYear,
    baseCachedAt: '2026-01-01T00:00:00.000Z',
    firstGameDate: '2026-08-29T00:00:00.000Z',
  };
  await seed(
    makeLeague(TEST_LEAGUE_SLUG, 2031, { state: 'preseason', year: 2031 }),
    makeLeague('alpha', probeYear, { state: 'preseason', year: probeYear })
  );
  await setAppState('schedule-probe', String(probeYear), probe);

  await runWithRevalidateContext(() => resetTestLeague());

  const stored = await getAppState<ScheduleProbeState>('schedule-probe', String(probeYear));
  assert.ok(stored, 'the shared probe still exists');
  assert.deepEqual(
    stored.value,
    probe,
    'a demo reset must never disarm the probe production leagues depend on'
  );
  assert.deepEqual((await readLeague('alpha'))?.status, {
    state: 'preseason',
    year: probeYear,
  });
});

// Risk: the cleanup year and the reset year drift apart silently.
test('reset cleanup follows TEST_LEAGUE_RESET_YEAR rather than a literal', async () => {
  // Derived from the exported constant, so the assertion moves with it. A
  // hardcoded cleanup year passes only while the constant equals today's value;
  // once the reset season is bumped, the action would clear the CURRENT demo
  // season instead of the next preseason — wiping live owners/draft state and
  // orphaning the real next-preseason records.
  const nextPreseason = TEST_LEAGUE_RESET_YEAR + 1;
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2031, { state: 'preseason', year: 2031 }));
  await seedDemoScopes(nextPreseason);
  await seedDemoScopes(TEST_LEAGUE_RESET_YEAR);

  await runWithRevalidateContext(() => resetTestLeague());

  const stored = await readLeague(TEST_LEAGUE_SLUG);
  assert.deepEqual(stored?.status, { state: 'season', year: TEST_LEAGUE_RESET_YEAR });
  assert.equal(stored?.year, TEST_LEAGUE_RESET_YEAR, 'projection synchronized');
  assert.deepEqual(
    await demoScopesPresent(nextPreseason),
    [false, false, false],
    `the season after ${TEST_LEAGUE_RESET_YEAR} is cleared`
  );
  assert.deepEqual(
    await demoScopesPresent(TEST_LEAGUE_RESET_YEAR),
    [true, true, true],
    'the season the reset just installed is NOT cleared'
  );
});

// Risk: a production league is mutated through the demo control surface.
test('no production league can be mutated through the test-control API', async () => {
  await seed(
    makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }),
    makeLeague('alpha', 2025, { state: 'season', year: 2025 }),
    makeLeague('bravo', 2026, { state: 'preseason', year: 2026 })
  );

  await runWithRevalidateContext(() => setTestLeagueStatus('preseason'));
  await runWithRevalidateContext(() => setTestLeagueStatus('season'));
  await runWithRevalidateContext(() => setTestLeagueStatus('offseason'));
  await runWithRevalidateContext(() => resetTestLeague());

  assert.deepEqual((await readLeague('alpha'))?.status, { state: 'season', year: 2025 });
  assert.equal((await readLeague('alpha'))?.year, 2025);
  assert.deepEqual((await readLeague('bravo'))?.status, { state: 'preseason', year: 2026 });
  assert.equal((await readLeague('bravo'))?.year, 2026);
});

// Risk: the migration changes what the operator's dry-run cycle does.
test('the three sandbox transitions still compose into a full dry-run cycle', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }));

  await runWithRevalidateContext(() => setTestLeagueStatus('preseason'));
  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, {
    state: 'preseason',
    year: 2026,
  });

  // Re-requesting preseason must not double-increment.
  await runWithRevalidateContext(() => setTestLeagueStatus('preseason'));
  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, {
    state: 'preseason',
    year: 2026,
  });

  await runWithRevalidateContext(() => setTestLeagueStatus('season'));
  assert.deepEqual(
    (await readLeague(TEST_LEAGUE_SLUG))?.status,
    { state: 'season', year: 2026 },
    'the preseason increment is preserved into season'
  );

  await runWithRevalidateContext(() => setTestLeagueStatus('offseason'));
  const offseason = await readLeague(TEST_LEAGUE_SLUG);
  assert.deepEqual(offseason?.status, { state: 'offseason' });
  assert.equal(offseason?.year, 2026, 'the archived season year is retained');
});

// Risk: dropping the preseason condition would make every transition wipe the
// current year's owners/draft — destructive on a plain 'Set: Season' click, and
// invisible without this test.
test('season and offseason transitions delete no demo state', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'preseason', year: 2026 }));
  await seedDemoScopes(2026);
  await seedDemoScopes(2025);

  await runWithRevalidateContext(() => setTestLeagueStatus('season'));
  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, { state: 'season', year: 2026 });
  assert.deepEqual(await demoScopesPresent(2026), [true, true, true], 'season deletes nothing');
  assert.deepEqual(await demoScopesPresent(2025), [true, true, true]);

  await runWithRevalidateContext(() => setTestLeagueStatus('offseason'));
  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, { state: 'offseason' });
  assert.deepEqual(await demoScopesPresent(2026), [true, true, true], 'offseason deletes nothing');
  assert.deepEqual(await demoScopesPresent(2025), [true, true, true]);
});
