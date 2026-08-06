import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCreatableSeasonYear,
  isStructurallyValidSeasonYear,
  MIN_SEASON_YEAR,
  type League,
} from '../league.ts';
import {
  beginPreseasonTransition,
  completePreseasonSetup,
  completeSeasonRollover,
} from '../leagueRegistry.ts';
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

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1R4 — `completeSeasonRollover` validates structurally, on its
// own, inside the serialized registry transaction.
//
// Both callers now refuse unusable years during target selection, but this is
// the LAST writer before durable state and is reachable directly, so a
// selector-only fix would leave it exposed. What it would otherwise persist is
// uniquely bad: the written status is `{ state: 'offseason' }`, which carries
// no year, so the top-level `league.year` written here becomes the ONLY
// surviving record of the season — and that is the field
// `resolveOperationalSeasonYear` reads for offseason leagues (F2H1T5).
// ---------------------------------------------------------------------------

// REGRESSION TEST — a direct call with an unusable year refuses and writes
// nothing. Table-driven over the same shapes the selector refuses.
test('R4 regression: completeSeasonRollover refuses an unusable requested year and writes nothing', async () => {
  for (const [label, year] of [
    ['missing', undefined],
    ['string', '2024'],
    ['fractional', 2024.5],
    ['unsafe integer', 2 ** 53],
    ['pre-football', 1800],
    ['null', null],
  ] as Array<[string, unknown]>) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    const seeded = [makeLeague('alpha', 2024, { state: 'season', year: 2024 })];
    await setAppState('leagues', 'registry', seeded);

    const transition = await completeSeasonRollover('alpha', year as number);

    assert.equal(transition.outcome, 'unusable-target-year', label);
    const after = await getAppState<League[]>('leagues', 'registry');
    assert.deepEqual(after?.value, seeded, `${label}: the registry is byte-for-byte unchanged`);
  }
});

// REGRESSION TEST — the STORED year is validated INDEPENDENTLY, and validity is
// decided BEFORE the exact-year comparison.
//
// The requested year here is perfectly VALID and DIFFERENT from the stored one,
// so the requested-year check cannot fire. That is what makes this reach the
// stored-year branch. Ordering validity after the comparison makes that branch
// dead code, and a corrupt record then falls into the mismatch branch and
// reports `not-in-target-season` — telling an operator another actor moved the
// league, when the truth is data corruption needing repair. Two different
// remedies (retry vs. fix the record), which is the conflation this slice
// exists to remove.
test('R4 regression: a corrupt STORED year refuses as unusable, not as a stale target', async () => {
  const seeded = [
    makeLeague('alpha', 2024, { state: 'season', year: 2024.5 } as unknown as League['status']),
  ];
  await setAppState('leagues', 'registry', seeded);

  // A VALID requested year that does not equal the corrupt stored one.
  const transition = await completeSeasonRollover('alpha', 2024);

  assert.equal(
    transition.outcome,
    'unusable-target-year',
    'the stored corruption decides, not the year mismatch'
  );
  const after = await getAppState<League[]>('leagues', 'registry');
  assert.deepEqual(after?.value, seeded, 'nothing was written');
});

// REGRESSION TEST — the echoed-corrupt-year case still refuses too. Kept
// separate from the case above because it is caught by the REQUESTED-year
// check, not the stored one; conflating them is what made the original test
// pass without ever entering the branch it claimed to cover.
test('R4 regression: an echoed corrupt year refuses via the requested-year check', async () => {
  const seeded = [
    makeLeague('alpha', 2024, { state: 'season', year: 2024.5 } as unknown as League['status']),
  ];
  await setAppState('leagues', 'registry', seeded);

  const transition = await completeSeasonRollover('alpha', 2024.5);

  assert.equal(transition.outcome, 'unusable-target-year');
  const after = await getAppState<League[]>('leagues', 'registry');
  assert.deepEqual(after?.value, seeded, 'nothing was written');
});

// CONTRACT PIN — the pre-R4 behavior is otherwise unchanged: a usable year
// still transitions, and a genuine target mismatch is still
// `not-in-target-season`, NOT the new outcome. Without this the new refusal
// could swallow the existing guard.
test('R4 contract pin: a usable year still transitions; a mismatch is still not-in-target-season', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', 2024, { state: 'season', year: 2024 }),
  ]);

  const mismatch = await completeSeasonRollover('alpha', 2023);
  assert.equal(mismatch.outcome, 'not-in-target-season', 'a real mismatch keeps its own outcome');

  const ok = await completeSeasonRollover('alpha', 2024);
  assert.equal(ok.outcome, 'transitioned');
  const after = await getAppState<League[]>('leagues', 'registry');
  assert.equal(after?.value?.[0]?.status?.state, 'offseason');
  assert.equal(after?.value?.[0]?.year, 2024, 'the surviving top-level year is the usable one');
});
