import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  completeSeasonTransition,
  resetTestLeagueLifecycle,
  setTestLeagueLifecycleState,
  TEST_LEAGUE_RESET_YEAR,
  type TestLeagueLifecycleOutcome,
  type TestLeagueResetOutcome,
} from '../leagueRegistry.ts';
import { TEST_LEAGUE_SLUG, type League } from '../league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1T1 — the slugless demo-league lifecycle authority.
//
// It replaces the arbitrary-slug compatibility setter, which took a caller's
// year on trust and could be pointed at any league. The replacement takes NO
// slug, and derives + validates every year INSIDE the serialized registry
// transaction, so a caller can never compute a year from a pre-lock snapshot
// (`getLeague` is React-`cache`d) and submit it against a record that moved.
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

// Risk: a caller could point the demo control at a production league.
test('the authority accepts no slug and cannot reach a production league', async () => {
  await seed(
    makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }),
    makeLeague('alpha', 2025, { state: 'season', year: 2025 })
  );

  // Arity is a WEAK signal, not a guarantee: `Function.length` stops counting at
  // the first default parameter, so a reintroduced
  // `(state, slug = TEST_LEAGUE_SLUG)` would still report 1. What this pins is
  // the declared signature; the behavioral guarantee is the assertion below —
  // a production league is untouched no matter what the demo control does.
  assert.equal(setTestLeagueLifecycleState.length, 1);
  assert.equal(resetTestLeagueLifecycle.length, 0);

  await setTestLeagueLifecycleState('offseason');

  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG)).status, { state: 'offseason' });
  assert.deepEqual(
    (await readLeague('alpha')).status,
    { state: 'season', year: 2025 },
    'no production league is reachable through the demo control'
  );
});

// Risk: an absent demo league is silently created, or reported as success.
test('a missing demo league is reported, never created', async () => {
  await seed(makeLeague('alpha', 2025, { state: 'season', year: 2025 }));

  assert.deepEqual(await setTestLeagueLifecycleState('preseason'), {
    outcome: 'league-not-found',
  });
  assert.deepEqual(await resetTestLeagueLifecycle(), { outcome: 'league-not-found' });

  assert.equal((await readRegistry()).length, 1, 'nothing was created');
});

// Risk: the dry-run year drifts — a double increment, or no increment at all.
test('season(N) advances to preseason(N+1)', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }));

  assert.deepEqual(await setTestLeagueLifecycleState('preseason'), {
    outcome: 'applied',
    status: { state: 'preseason', year: 2026 },
    // PLATFORM-086F2H3B1 — the status read UNDER THE LOCK, so an operator
    // surface can distinguish "Moved to" from "Already in" without a second,
    // racy read.
    previousStatus: { state: 'season', year: 2025 },
  });
  assert.equal((await readLeague(TEST_LEAGUE_SLUG)).year, 2026, 'projection synchronized');
});

test('preseason(N) stays at N when preseason is requested again', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2026, { state: 'preseason', year: 2026 }));

  assert.deepEqual(await setTestLeagueLifecycleState('preseason'), {
    outcome: 'applied',
    status: { state: 'preseason', year: 2026 },
    // Identical to `status` — this is the idempotent case the field exists for.
    previousStatus: { state: 'preseason', year: 2026 },
  });
});

test('offseason and missing-status records derive the successor from the stored year', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2024, { state: 'offseason' }));
  assert.deepEqual(await setTestLeagueLifecycleState('preseason'), {
    outcome: 'applied',
    status: { state: 'preseason', year: 2025 },
    previousStatus: { state: 'offseason' },
  });

  await seed(makeLeague(TEST_LEAGUE_SLUG, 2030));
  assert.deepEqual(await setTestLeagueLifecycleState('preseason'), {
    outcome: 'applied',
    status: { state: 'preseason', year: 2031 },
    // A legacy record stores NO status, so there is no previous one to report.
    previousStatus: null,
  });
});

test('preseason(N) becomes season(N), preserving the increment', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2024, { state: 'preseason', year: 2026 }));

  assert.deepEqual(await setTestLeagueLifecycleState('season'), {
    outcome: 'applied',
    status: { state: 'season', year: 2026 },
    previousStatus: { state: 'preseason', year: 2026 },
  });
  const stored = await readLeague(TEST_LEAGUE_SLUG);
  assert.deepEqual(stored.status, { state: 'season', year: 2026 });
  assert.equal(stored.year, 2026);
});

test('season(N) requested again stays at N', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }));

  assert.deepEqual(await setTestLeagueLifecycleState('season'), {
    outcome: 'applied',
    status: { state: 'season', year: 2025 },
    previousStatus: { state: 'season', year: 2025 },
  });
});

// Risk: the offseason projection carries a stale top-level year forward.
test('offseason retains the last authoritative season year as the projection', async () => {
  // Deliberately desynchronized: the projection must come from `status.year`.
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2010, { state: 'season', year: 2023 }));

  assert.deepEqual(await setTestLeagueLifecycleState('offseason'), {
    outcome: 'applied',
    status: { state: 'offseason' },
    previousStatus: { state: 'season', year: 2023 },
  });
  const stored = await readLeague(TEST_LEAGUE_SLUG);
  assert.deepEqual(stored.status, { state: 'offseason' });
  assert.equal(stored.year, 2023, 'archived year comes from status.year, not the stale projection');
});

// Risk: a corrupt demo record becomes unrecoverable.
test('reset installs the known-good season regardless of the stored record', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 1999, { state: 'preseason', year: 2031 }));

  assert.deepEqual(await resetTestLeagueLifecycle(), {
    outcome: 'applied',
    status: { state: 'season', year: TEST_LEAGUE_RESET_YEAR },
  });
  const stored = await readLeague(TEST_LEAGUE_SLUG);
  assert.deepEqual(stored.status, { state: 'season', year: TEST_LEAGUE_RESET_YEAR });
  assert.equal(stored.year, TEST_LEAGUE_RESET_YEAR);
});

test('reset returns a fresh status object per call, never a shared identity', async () => {
  // The status is both written into the registry record AND handed to the
  // caller, so a module-level constant would give every reset in the process
  // one mutable identity.
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2031, { state: 'preseason', year: 2031 }));

  const first = await resetTestLeagueLifecycle();
  const second = await resetTestLeagueLifecycle();

  assert.equal(first.outcome, 'applied');
  assert.equal(second.outcome, 'applied');
  if (first.outcome !== 'applied' || second.outcome !== 'applied') return;
  assert.notEqual(first.status, second.status, 'distinct objects');
  assert.deepEqual(first.status, second.status, 'with equal values');
});

// Risk: an unrecognized state crosses the Server Action boundary (its argument
// is never runtime-validated) and crashes instead of refusing.
test('an unsupported state refuses with a typed outcome and writes nothing', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }));
  const before = await readRegistry();

  for (const bad of ['Season', '', 'PRESEASON', 'archived', null, undefined, 7, {}]) {
    assert.deepEqual(
      await setTestLeagueLifecycleState(bad as never),
      { outcome: 'unsupported-state' },
      `${JSON.stringify(bad)} must refuse, not throw`
    );
  }

  assert.deepEqual(await readRegistry(), before, 'no write of any kind');
});

// Risk: an unusable persisted year is laundered into a lifecycle write.
test('an unusable stored year refuses every derived state without writing', async () => {
  for (const status of [
    { state: 'season', year: 1800 },
    { state: 'preseason', year: 2026.5 },
    { state: 'season', year: Number.NaN },
  ] as Array<League['status']>) {
    await seed(makeLeague(TEST_LEAGUE_SLUG, 1800, status));
    const before = await readRegistry();

    for (const state of ['season', 'preseason', 'offseason'] as const) {
      assert.deepEqual(
        await setTestLeagueLifecycleState(state),
        { outcome: 'unusable-stored-year' },
        `${state} from ${JSON.stringify(status)}`
      );
    }

    assert.deepEqual(await readRegistry(), before, 'byte-equivalent — no write of any kind');
  }
});

// Risk: a boundary year persists a silently-rounded successor.
test('the largest valid predecessor advances, and the boundary beyond it refuses', async () => {
  const maxSafe = Number.MAX_SAFE_INTEGER;

  await seed(makeLeague(TEST_LEAGUE_SLUG, maxSafe - 1, { state: 'season', year: maxSafe - 1 }));
  assert.deepEqual(await setTestLeagueLifecycleState('preseason'), {
    outcome: 'applied',
    status: { state: 'preseason', year: maxSafe },
    previousStatus: { state: 'season', year: maxSafe - 1 },
  });

  // `maxSafe + 1` is not exactly representable, so the successor is refused
  // rather than persisted as a rounded year. This is the existing structural
  // predicate doing the work — no new ceiling is introduced.
  await seed(makeLeague(TEST_LEAGUE_SLUG, maxSafe, { state: 'season', year: maxSafe }));
  const before = await readRegistry();
  assert.deepEqual(await setTestLeagueLifecycleState('preseason'), {
    outcome: 'unusable-derived-year',
  });
  assert.deepEqual(await readRegistry(), before, 'no rounded year persisted');

  // Only the ARITHMETIC is unsafe — the record can still enter season, and
  // reset always recovers it.
  assert.deepEqual(await setTestLeagueLifecycleState('season'), {
    outcome: 'applied',
    status: { state: 'season', year: maxSafe },
    previousStatus: { state: 'season', year: maxSafe },
  });
  assert.deepEqual(await resetTestLeagueLifecycle(), {
    outcome: 'applied',
    status: { state: 'season', year: TEST_LEAGUE_RESET_YEAR },
  });
});

// Risk: credential material leaks through an outcome.
test('no outcome carries a league record or credential material', async () => {
  await seed({
    ...makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }),
    passwordHash: 'HASH-CANARY',
    passwordSalt: 'SALT-CANARY',
  });

  const outcomes: Array<TestLeagueLifecycleOutcome | TestLeagueResetOutcome> = [
    await setTestLeagueLifecycleState('preseason'),
    await setTestLeagueLifecycleState('season'),
    await setTestLeagueLifecycleState('offseason'),
    await resetTestLeagueLifecycle(),
  ];

  for (const outcome of outcomes) {
    const serialized = JSON.stringify(outcome);
    assert.ok(!serialized.includes('HASH-CANARY'), 'no password hash');
    assert.ok(!serialized.includes('SALT-CANARY'), 'no password salt');
    assert.ok(!serialized.includes('passwordHash'), 'no credential field names');
    assert.ok(!serialized.includes('displayName'), 'no league record fields');
    assert.ok(!serialized.includes('createdAt'));
    // PLATFORM-086F2H3B1 added `previousStatus`, which makes this closed-shape
    // check load-bearing rather than incidental: the prior status is read from
    // the league record under the lock, so returning the RECORD instead of its
    // `status` would leak credential fields straight into a Server Action
    // response. The canary above proves the observer can see such a leak.
    assert.ok(
      Object.keys(outcome).every(
        (k) => k === 'outcome' || k === 'status' || k === 'previousStatus'
      ),
      `closed shape, got ${serialized}`
    );
  }
});

// Risk: a concurrent registry mutation is dropped by a whole-array rewrite.
test('concurrent lifecycle writes both persist — neither is dropped', async () => {
  await seed(
    makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }),
    makeLeague('bravo', 2024, { state: 'preseason', year: 2026 })
  );

  const [demo] = await Promise.all([
    setTestLeagueLifecycleState('preseason'),
    completeSeasonTransition('bravo', 2026),
  ]);

  assert.deepEqual(demo, {
    outcome: 'applied',
    status: { state: 'preseason', year: 2026 },
    previousStatus: { state: 'season', year: 2025 },
  });
  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG)).status, {
    state: 'preseason',
    year: 2026,
  });
  assert.deepEqual(
    (await readLeague('bravo')).status,
    { state: 'season', year: 2026 },
    'the racing guarded transition was not dropped'
  );
});

test('two overlapping preseason requests are idempotent', async () => {
  // Scoped honestly: this pins IDEMPOTENCE, not transaction-local derivation.
  // It cannot discriminate against a read-then-write implementation — with
  // `season(N)→N+1` and `preseason(N)→N`, both interleavings still land on
  // 2026 (either both read `season(2025)`, or the loser reads the winner's
  // `preseason(2026)`). Serialization is covered by the test above.
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }));

  const outcomes = await Promise.all([
    setTestLeagueLifecycleState('preseason'),
    setTestLeagueLifecycleState('preseason'),
  ]);

  for (const outcome of outcomes) {
    assert.equal(outcome.outcome, 'applied');
    assert.deepEqual(
      (outcome as { status: unknown }).status,
      { state: 'preseason', year: 2026 },
      'both land on the same year'
    );
  }

  // PLATFORM-086F2H3B1 — and `previousStatus` now DOES discriminate here, which
  // the caveat above could not. Under serialization exactly one transaction sees
  // the seeded `season(2025)` and the other sees the winner's `preseason(2026)`.
  // A read-then-write implementation, or one capturing the prior status outside
  // the lock, would report the same predecessor twice.
  assert.deepEqual(
    outcomes.map((o) => JSON.stringify((o as { previousStatus?: unknown }).previousStatus)).sort(),
    [
      JSON.stringify({ state: 'preseason', year: 2026 }),
      JSON.stringify({ state: 'season', year: 2025 }),
    ].sort(),
    'each transaction reported the record IT read under the lock'
  );
  assert.equal((await readLeague(TEST_LEAGUE_SLUG)).year, 2026, 'no double increment');
});

// Risk: a failed write leaves the two year fields partially synchronized.
test('a registry write failure propagates and leaves the record unchanged', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }));
  const before = await readRegistry();

  __setAppStateWriteFailureForTests(new Error('simulated registry outage'), 'leagues');
  try {
    await assert.rejects(
      () => setTestLeagueLifecycleState('preseason'),
      /simulated registry outage/
    );
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.deepEqual(await readRegistry(), before, 'nothing partially applied');
});

test('a refusal performs no write, so a poisoned store cannot fail it', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 1800, { state: 'season', year: 1800 }));

  __setAppStateWriteFailureForTests(new Error('simulated registry outage'), 'leagues');
  try {
    assert.deepEqual(await setTestLeagueLifecycleState('preseason'), {
      outcome: 'unusable-stored-year',
    });
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
});

// ---------------------------------------------------------------------------
// Risk: the arbitrary-slug setter returns, reopening an unguarded write path.

test('the arbitrary-slug lifecycle setter is not exported', async () => {
  const registry = (await import('../leagueRegistry.ts')) as Record<string, unknown>;

  assert.equal(registry.updateLeagueStatus, undefined, 'the setter is retired');

  // Assert the SHAPE a reintroduction would have, not just the name: the demo
  // writers are slug-free by arity, and the guarded transitions take
  // (slug, expectedYear) rather than (slug, status).
  const exported = Object.entries(registry).filter(([, v]) => typeof v === 'function') as Array<
    [string, (...args: unknown[]) => unknown]
  >;
  assert.ok(exported.length > 0);
  assert.deepEqual(
    exported
      .filter(([k]) => k.toLowerCase().includes('testleague'))
      .map(([k, fn]) => `${k}/${fn.length}`)
      .sort(),
    ['resetTestLeagueLifecycle/0', 'setTestLeagueLifecycleState/1'],
    'the demo writers accept no slug'
  );
});

test('no production source imports or calls the retired setter', () => {
  // Matches CALL SITES and IMPORTS, not every mention: a docstring explaining
  // what the authority replaced is useful history, while an import or an
  // invocation would be a reintroduced write path.
  const CALL = /\bupdateLeagueStatus\s*\(/;
  const IMPORT = /import[^;]*\bupdateLeagueStatus\b[^;]*from/;
  const root = join(process.cwd(), 'src');
  const offenders: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      const source = readFileSync(full, 'utf8');
      if (CALL.test(source) || IMPORT.test(source)) offenders.push(full.slice(root.length + 1));
    }
  };
  walk(root);

  assert.deepEqual(
    offenders,
    [],
    `production source must not import or call the retired setter: ${offenders.join(', ')}`
  );

  // The guard must actually be capable of failing.
  assert.ok(CALL.test("await updateLeagueStatus('test', { state: 'offseason' });"));
  assert.ok(IMPORT.test("import { getLeagues, updateLeagueStatus } from '@/lib/leagueRegistry';"));
  assert.ok(!CALL.test('replaces the arbitrary-slug `updateLeagueStatus`, which took'));
});

// Risk: the constant is re-homed and a second import path reappears.
test('the demo slug has exactly one definition, in the lifecycle-neutral module', () => {
  const league = readFileSync(join(process.cwd(), 'src/lib/league.ts'), 'utf8');
  const rollover = readFileSync(join(process.cwd(), 'src/lib/rolloverTargeting.ts'), 'utf8');

  assert.ok(league.includes("export const TEST_LEAGUE_SLUG = 'test';"), 'defined in league.ts');
  assert.ok(
    !/export\s*\{[^}]*TEST_LEAGUE_SLUG/.test(rollover),
    'rolloverTargeting.ts must not re-export it — nothing ever imported it from there'
  );
  assert.ok(!/export const TEST_LEAGUE_SLUG/.test(rollover), 'and must not redefine it');
});
