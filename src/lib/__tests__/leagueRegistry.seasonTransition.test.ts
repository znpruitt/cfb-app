import assert from 'node:assert/strict';
import test from 'node:test';

import { completeSeasonTransition, type SeasonTransitionOutcome } from '../leagueRegistry.ts';
import type { League } from '../league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1B — the guarded preseason→season authority the daily cron
// consumes.
//
// The cron reads its target snapshot once and then performs lengthy provider
// and probe work, so by write time a target may have been rolled over, moved to
// another preseason year, transitioned by an overlapping delivery, or deleted.
// Every disposition is re-decided INSIDE the serialized registry transaction and
// returned as a closed scalar outcome.
// ---------------------------------------------------------------------------

const YEAR = 2026;

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

async function seed(...leagues: League[]): Promise<void> {
  await setAppState('leagues', 'registry', leagues);
}

async function readLeague(slug: string): Promise<League> {
  const league = (await readRegistry()).find((l) => l.slug === slug);
  assert.ok(league, `league '${slug}' present`);
  return league;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(() => {
  __setAppStateWriteFailureForTests(null);
  __resetAppStateForTests();
});

// 1 + 2 — exact-year transition, atomic status/year projection.
test('transitions a preseason league at the exact target year and projects the year', async () => {
  await seed(makeLeague('alpha', 2025, { state: 'preseason', year: YEAR }));

  assert.deepEqual(await completeSeasonTransition('alpha', YEAR), {
    outcome: 'transitioned',
    year: YEAR,
  });

  const stored = await readLeague('alpha');
  assert.deepEqual(stored.status, { state: 'season', year: YEAR });
  assert.equal(stored.year, YEAR, 'the compatibility projection commits in the same write');
});

// 3 — exact-year mismatch refuses, byte-identical registry.
test('a different lifecycle year is refused and the registry is byte-identical', async () => {
  await seed(
    makeLeague('alpha', 2027, { state: 'preseason', year: 2027 }),
    makeLeague('bravo', 2025, { state: 'preseason', year: 2025 })
  );
  const before = await readRegistry();

  for (const slug of ['alpha', 'bravo']) {
    assert.deepEqual(await completeSeasonTransition(slug, YEAR), {
      outcome: 'not-in-target-preseason',
    });
  }

  assert.deepEqual(await readRegistry(), before, 'no write of any kind');
});

// 4 — wrong state refuses.
test('any non-preseason state is refused without writing', async () => {
  await seed(
    makeLeague('alpha', 2025, { state: 'offseason' }),
    makeLeague('bravo', YEAR),
    makeLeague('charlie', 2025, {} as League['status'])
  );
  const before = await readRegistry();

  for (const slug of ['alpha', 'bravo', 'charlie']) {
    assert.deepEqual(
      await completeSeasonTransition(slug, YEAR),
      { outcome: 'not-in-target-preseason' },
      slug
    );
  }

  assert.deepEqual(await readRegistry(), before);
});

// 5 — a deleted target is its own neutral outcome.
test('a league removed after target selection is league-removed, not a refusal', async () => {
  await seed(makeLeague('alpha', 2025, { state: 'preseason', year: YEAR }));

  assert.deepEqual(await completeSeasonTransition('ghost', YEAR), { outcome: 'league-removed' });

  assert.equal((await readRegistry()).length, 1, 'nothing was created');
});

// 6 — benign idempotent redelivery.
test('a healing write is reported as healed, so a caller can tell it from a pure no-op', async () => {
  await seed(makeLeague('alpha', 2019, { state: 'season', year: YEAR }));

  const outcome = await completeSeasonTransition('alpha', YEAR);

  assert.equal(outcome.outcome, 'already-in-target-season');
  if (outcome.outcome !== 'already-in-target-season') return;
  assert.equal(outcome.healed, true, 'the projection was repaired — data changed');
});

test('a structurally invalid stored preseason year is refused, not laundered', async () => {
  // The route groups by `status.year`, so the target equals the stored value and
  // the equality check passes — only the structural guard stops these.
  await seed(
    makeLeague('alpha', 1800, { state: 'preseason', year: 1800 }),
    makeLeague('bravo', 2026.5, { state: 'preseason', year: 2026.5 })
  );
  const before = await readRegistry();

  assert.deepEqual(await completeSeasonTransition('alpha', 1800), {
    outcome: 'not-in-target-preseason',
  });
  assert.deepEqual(await completeSeasonTransition('bravo', 2026.5), {
    outcome: 'not-in-target-preseason',
  });

  assert.deepEqual(await readRegistry(), before, 'no invalid year reached a season status');
});

test('a league already in the target season is benign and writes nothing when synced', async () => {
  await seed(makeLeague('alpha', YEAR, { state: 'season', year: YEAR }));
  const before = await readRegistry();

  assert.deepEqual(await completeSeasonTransition('alpha', YEAR), {
    outcome: 'already-in-target-season',
    year: YEAR,
    healed: false,
  });

  assert.deepEqual(await readRegistry(), before, 'an already-correct record is untouched');
});

// 7 — the idempotent path heals a stale projection.
test('an overlapping delivery heals a desynchronized top-level year', async () => {
  // Scoped honestly: this is an OVERLAPPING invocation (or a redelivery that
  // still holds the preseason snapshot) observing a record whose status
  // committed with a desynchronized year. A later daily run cannot reach this —
  // the cron's target filter is preseason-only, so a league already in `season`
  // is never selected again. See the deferral in docs/next-tasks.md.
  await seed(makeLeague('alpha', 2019, { state: 'season', year: YEAR }));

  assert.deepEqual(await completeSeasonTransition('alpha', YEAR), {
    outcome: 'already-in-target-season',
    year: YEAR,
    healed: true,
  });

  const stored = await readLeague('alpha');
  assert.deepEqual(stored.status, { state: 'season', year: YEAR });
  assert.equal(stored.year, YEAR, 'the stale projection was repaired');
});

test('a season league at a DIFFERENT year is refused, not treated as idempotent', async () => {
  await seed(makeLeague('alpha', 2027, { state: 'season', year: 2027 }));
  const before = await readRegistry();

  assert.deepEqual(await completeSeasonTransition('alpha', YEAR), {
    outcome: 'not-in-target-preseason',
  });

  assert.deepEqual(await readRegistry(), before);
});

// 8 — overlapping calls.
test('two overlapping calls produce exactly one transition and one benign duplicate', async () => {
  await seed(makeLeague('alpha', 2025, { state: 'preseason', year: YEAR }));

  const outcomes = await Promise.all([
    completeSeasonTransition('alpha', YEAR),
    completeSeasonTransition('alpha', YEAR),
  ]);

  assert.deepEqual(
    outcomes.map((o) => o.outcome).sort(),
    ['already-in-target-season', 'transitioned'],
    'the loser is benign, never a refusal'
  );
  const stored = await readLeague('alpha');
  assert.deepEqual(stored.status, { state: 'season', year: YEAR });
  assert.equal(stored.year, YEAR);
});

// 9 — store failure propagates and leaves prior state intact.
test('a registry write failure propagates and leaves the record unchanged', async () => {
  await seed(makeLeague('alpha', 2025, { state: 'preseason', year: YEAR }));
  const before = await readRegistry();

  __setAppStateWriteFailureForTests(new Error('simulated registry outage'), 'leagues');
  try {
    await assert.rejects(
      () => completeSeasonTransition('alpha', YEAR),
      /simulated registry outage/
    );
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.deepEqual(await readRegistry(), before, 'nothing partially applied');
});

test('a refusal performs no write, so a poisoned store cannot fail it', async () => {
  // A refusal never reaches `txn.write`, which is what makes it safe to run
  // against a degraded store.
  await seed(makeLeague('alpha', 2025, { state: 'offseason' }));

  __setAppStateWriteFailureForTests(new Error('simulated registry outage'), 'leagues');
  try {
    assert.deepEqual(await completeSeasonTransition('alpha', YEAR), {
      outcome: 'not-in-target-preseason',
    });
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
});

// 10 — outcomes are closed scalars with no credential-bearing data.
test('no outcome carries a league record or credential material', async () => {
  await seed(
    {
      ...makeLeague('alpha', 2025, { state: 'preseason', year: YEAR }),
      passwordHash: 'HASH-CANARY',
      passwordSalt: 'SALT-CANARY',
    },
    {
      ...makeLeague('bravo', 2025, { state: 'offseason' }),
      passwordHash: 'HASH-CANARY',
      passwordSalt: 'SALT-CANARY',
    },
    {
      ...makeLeague('charlie', YEAR, { state: 'season', year: YEAR }),
      passwordHash: 'HASH-CANARY',
      passwordSalt: 'SALT-CANARY',
    }
  );

  const outcomes: SeasonTransitionOutcome[] = [
    await completeSeasonTransition('alpha', YEAR),
    await completeSeasonTransition('bravo', YEAR),
    await completeSeasonTransition('charlie', YEAR),
    await completeSeasonTransition('ghost', YEAR),
  ];

  for (const outcome of outcomes) {
    const serialized = JSON.stringify(outcome);
    assert.ok(!serialized.includes('HASH-CANARY'), 'no password hash');
    assert.ok(!serialized.includes('SALT-CANARY'), 'no password salt');
    assert.ok(!serialized.includes('passwordHash'), 'no credential field names');
    assert.ok(!serialized.includes('displayName'), 'no league record fields');
    // Only `outcome` and (where meaningful) `year`.
    assert.ok(
      Object.keys(outcome).every((k) => k === 'outcome' || k === 'year' || k === 'healed'),
      `closed scalar shape, got ${serialized}`
    );
  }
});
// The heal path is gated by the SAME structural validation as the transition.

test('an invalid target season year is refused before healing, leaving the registry byte-identical', () => {
  // Before the validation was hoisted, this record took the idempotent branch:
  // `status.year === targetYear` matched, `current.year` differed, and the heal
  // synced `league.year` to the unsupported value and reported `healed: true`.
  // The guard below the branch could never see it.
  return (async () => {
    await seed(
      makeLeague('alpha', 2019, { state: 'season', year: 1800 }),
      makeLeague('bravo', 2019, { state: 'season', year: 2026.5 })
    );
    const before = await readRegistry();

    assert.deepEqual(await completeSeasonTransition('alpha', 1800), {
      outcome: 'not-in-target-preseason',
    });
    assert.deepEqual(await completeSeasonTransition('bravo', 2026.5), {
      outcome: 'not-in-target-preseason',
    });

    assert.deepEqual(
      await readRegistry(),
      before,
      'no healing write — an unsupported year is never synced into the projection'
    );
    assert.equal((await readLeague('alpha')).year, 2019, 'the stale projection is left stale');
  })();
});

test('a poisoned store cannot fail an invalid-year refusal, proving no write is attempted', async () => {
  await seed(makeLeague('alpha', 2019, { state: 'season', year: 1800 }));

  __setAppStateWriteFailureForTests(new Error('simulated registry outage'), 'leagues');
  try {
    assert.deepEqual(await completeSeasonTransition('alpha', 1800), {
      outcome: 'not-in-target-preseason',
    });
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
});
