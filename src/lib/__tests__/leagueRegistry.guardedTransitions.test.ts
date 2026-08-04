import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCreatableSeasonYear,
  isStructurallyValidSeasonYear,
  MIN_SEASON_YEAR,
  type League,
} from '../league.ts';
import { beginPreseasonTransition, completePreseasonSetup } from '../leagueRegistry.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../server/appStateStore.ts';

function makeLeague(slug: string, year: number, status: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  };
}

async function seed(...leagues: League[]): Promise<void> {
  await setAppState('leagues', 'registry', leagues);
}

async function readRegistry(): Promise<League[]> {
  return (await getAppState<League[]>('leagues', 'registry'))?.value ?? [];
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(() => {
  __resetAppStateForTests();
});

test('season-year predicates separate creation policy from persisted-record safety', () => {
  const during2026 = Date.parse('2026-08-03T12:00:00.000Z');

  assert.equal(isCreatableSeasonYear(MIN_SEASON_YEAR, during2026), true);
  assert.equal(isCreatableSeasonYear(2027, during2026), true);
  assert.equal(isCreatableSeasonYear(2028, during2026), false);
  assert.equal(isCreatableSeasonYear(2026.5, during2026), false);
  assert.equal(isCreatableSeasonYear(Number.NaN, during2026), false);

  assert.equal(isStructurallyValidSeasonYear(1999), true, 'legacy integer remains operable');
  assert.equal(isStructurallyValidSeasonYear(Number.MAX_SAFE_INTEGER), true);
  assert.equal(isStructurallyValidSeasonYear(Number.MAX_SAFE_INTEGER + 1), false);
});

test('beginPreseasonTransition derives and commits the next year atomically', async () => {
  await seed(makeLeague('alpha', 2025, { state: 'offseason' }));

  assert.deepEqual(await beginPreseasonTransition('alpha'), {
    outcome: 'transitioned',
    year: 2026,
  });

  const stored = (await readRegistry())[0]!;
  assert.equal(stored.year, 2026);
  assert.deepEqual(stored.status, { state: 'preseason', year: 2026 });
});

test('concurrent begin calls increment once and make the stale caller a no-write refusal', async () => {
  await seed(makeLeague('alpha', 2025, { state: 'offseason' }));

  const outcomes = await Promise.all([
    beginPreseasonTransition('alpha'),
    beginPreseasonTransition('alpha'),
  ]);

  assert.deepEqual(outcomes.map((result) => result.outcome).sort(), [
    'not-in-offseason',
    'transitioned',
  ]);
  const stored = (await readRegistry())[0]!;
  assert.equal(stored.year, 2026);
  assert.deepEqual(stored.status, { state: 'preseason', year: 2026 });
});

test('begin refuses an unusable stored year without attempting a write', async () => {
  await seed(makeLeague('alpha', 2025.5, { state: 'offseason' }));
  const before = await readRegistry();

  __setAppStateWriteFailureForTests(new Error('a refusal must not write'), 'leagues');
  try {
    assert.deepEqual(await beginPreseasonTransition('alpha'), {
      outcome: 'unusable-stored-year',
    });
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.deepEqual(await readRegistry(), before);
});

test('begin validates the derived successor under the lock', async () => {
  await seed(makeLeague('alpha', Number.MAX_SAFE_INTEGER, { state: 'offseason' }));
  const before = await readRegistry();

  assert.deepEqual(await beginPreseasonTransition('alpha'), {
    outcome: 'unusable-next-year',
  });
  assert.deepEqual(await readRegistry(), before);

  await seed(makeLeague('alpha', Number.MAX_SAFE_INTEGER - 1, { state: 'offseason' }));
  assert.deepEqual(await beginPreseasonTransition('alpha'), {
    outcome: 'transitioned',
    year: Number.MAX_SAFE_INTEGER,
  });
});

test('begin outside offseason and an unknown slug write nothing', async () => {
  await seed(makeLeague('alpha', 2026, { state: 'preseason', year: 2026 }));
  const before = await readRegistry();

  __setAppStateWriteFailureForTests(new Error('a refusal must not write'), 'leagues');
  try {
    assert.deepEqual(await beginPreseasonTransition('alpha'), {
      outcome: 'not-in-offseason',
    });
    assert.deepEqual(await beginPreseasonTransition('missing'), {
      outcome: 'league-not-found',
    });
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.deepEqual(await readRegistry(), before);
});

test('completePreseasonSetup commits setup and the synchronized year together', async () => {
  await seed(makeLeague('alpha', 2025, { state: 'preseason', year: 2026 }));

  assert.deepEqual(await completePreseasonSetup('alpha', 2026), {
    outcome: 'completed',
    year: 2026,
  });

  const stored = (await readRegistry())[0]!;
  assert.equal(stored.year, 2026);
  assert.deepEqual(stored.status, { state: 'preseason', year: 2026, setupComplete: true });
});

test('completePreseasonSetup refuses a stale year without writing', async () => {
  await seed(makeLeague('alpha', 2026, { state: 'preseason', year: 2026 }));
  const before = await readRegistry();

  __setAppStateWriteFailureForTests(new Error('a refusal must not write'), 'leagues');
  try {
    assert.deepEqual(await completePreseasonSetup('alpha', 2025), {
      outcome: 'year-mismatch',
    });
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.deepEqual(await readRegistry(), before);
});

test('completePreseasonSetup is idempotent and heals only a stale year projection', async () => {
  await seed(
    makeLeague('synced', 2026, { state: 'preseason', year: 2026, setupComplete: true }),
    makeLeague('legacy', 2025, { state: 'preseason', year: 2026, setupComplete: true })
  );

  assert.deepEqual(await completePreseasonSetup('synced', 2026), {
    outcome: 'already-complete',
    year: 2026,
  });
  assert.deepEqual(await completePreseasonSetup('legacy', 2026), {
    outcome: 'already-complete',
    year: 2026,
  });

  const bySlug = Object.fromEntries((await readRegistry()).map((league) => [league.slug, league]));
  assert.equal(bySlug.synced!.year, 2026);
  assert.equal(bySlug.legacy!.year, 2026, 'accepted idempotent call heals the projection');
});

test('guarded transitions on different leagues serialize without dropping either write', async () => {
  await seed(
    makeLeague('alpha', 2025, { state: 'offseason' }),
    makeLeague('bravo', 2026, { state: 'preseason', year: 2026 })
  );

  const [begin, complete] = await Promise.all([
    beginPreseasonTransition('alpha'),
    completePreseasonSetup('bravo', 2026),
  ]);

  assert.equal(begin.outcome, 'transitioned');
  assert.equal(complete.outcome, 'completed');
  const bySlug = Object.fromEntries((await readRegistry()).map((league) => [league.slug, league]));
  assert.deepEqual(bySlug.alpha!.status, { state: 'preseason', year: 2026 });
  assert.deepEqual(bySlug.bravo!.status, {
    state: 'preseason',
    year: 2026,
    setupComplete: true,
  });
});

test('a failed guarded commit leaves status and year fully unchanged', async () => {
  await seed(makeLeague('alpha', 2025, { state: 'offseason' }));
  const before = await readRegistry();

  __setAppStateWriteFailureForTests(new Error('simulated registry outage'), 'leagues');
  try {
    await assert.rejects(() => beginPreseasonTransition('alpha'), /simulated registry outage/);
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.deepEqual(await readRegistry(), before);
});
