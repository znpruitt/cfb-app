import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginPreseasonTransition,
  completePreseasonSetup,
  completeSeasonTransition,
  initializeMissingLifecycleStatus,
} from '../leagueRegistry.ts';
import type { League } from '../league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1 — every normal production lifecycle transition is guarded
// inside the ONE serialized registry transaction: expected-state validation,
// year derivation, and the write all happen under the lock, so a stale caller
// (double-click, stale form, stale cron snapshot, concurrent lifecycle actor)
// can never overwrite newer lifecycle state or double-increment a year.
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

async function seed(leagues: League[]): Promise<void> {
  await setAppState('leagues', 'registry', leagues);
}

async function readLeague(slug: string): Promise<League> {
  const league = (await readRegistry()).find((l) => l.slug === slug);
  assert.ok(league, `league '${slug}' present`);
  return league;
}

/**
 * Every CONFIRMED transition must leave the lifecycle authority (`status.year`)
 * and its compatibility projection (`league.year`) synchronized in the SAME
 * stored record (prompt §9.15).
 */
function assertYearSynchronized(league: League): void {
  assert.ok(league.status, 'a transitioned league always carries a status');
  if (league.status.state === 'offseason') return;
  assert.equal(
    league.year,
    league.status.year,
    'top-level year synchronized to the lifecycle year'
  );
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(async () => {
  __resetAppStateForTests();
});

// ---------------------------------------------------------------------------
// §3 — offseason → preseason

test('beginPreseasonTransition derives the next year inside the transaction', async () => {
  await seed([makeLeague('alpha', 2025, { state: 'offseason' })]);

  const transition = await beginPreseasonTransition('alpha');

  assert.equal(transition.outcome, 'transitioned');
  const stored = await readLeague('alpha');
  assert.deepEqual(stored.status, { state: 'preseason', year: 2026 });
  assert.equal(stored.year, 2026);
  assertYearSynchronized(stored);
});

test('two concurrent begin-preseason attempts produce ONE transition and no double increment', async () => {
  await seed([makeLeague('alpha', 2025, { state: 'offseason' })]);

  // Both calls race on the ONE registry key. The per-key advisory lock
  // serializes them, and the loser re-reads `preseason` under the lock.
  const [first, second] = await Promise.all([
    beginPreseasonTransition('alpha'),
    beginPreseasonTransition('alpha'),
  ]);

  const outcomes = [first.outcome, second.outcome].sort();
  assert.deepEqual(outcomes, ['not-in-offseason', 'transitioned']);

  const stored = await readLeague('alpha');
  assert.deepEqual(stored.status, { state: 'preseason', year: 2026 }, 'incremented exactly once');
  assert.equal(stored.year, 2026);
});

test('a stale begin-preseason cannot overwrite a league already in preseason or season', async () => {
  await seed([
    makeLeague('alpha', 2026, { state: 'preseason', year: 2026 }),
    makeLeague('bravo', 2026, { state: 'season', year: 2026 }),
  ]);
  const before = await readRegistry();

  const stalePreseason = await beginPreseasonTransition('alpha');
  const staleSeason = await beginPreseasonTransition('bravo');

  assert.equal(stalePreseason.outcome, 'not-in-offseason');
  assert.equal(staleSeason.outcome, 'not-in-offseason');
  assert.deepEqual(await readRegistry(), before, 'refusals write nothing');
});

test('beginPreseasonTransition reports an unknown league and an unusable stored year', async () => {
  await seed([
    makeLeague('alpha', Number.NaN as number, { state: 'offseason' }),
    makeLeague('bravo', 1900, { state: 'offseason' }),
    makeLeague('charlie', 2024.5, { state: 'offseason' }),
    makeLeague('delta', '2024' as unknown as number, { state: 'offseason' }),
    // Out of range outright (rejected by the STORED-year check).
    makeLeague('echo', 2200, { state: 'offseason' }),
  ]);
  const before = await readRegistry();

  assert.equal((await beginPreseasonTransition('ghost')).outcome, 'league-not-found');
  for (const slug of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) {
    assert.equal((await beginPreseasonTransition(slug)).outcome, 'invalid-year', `${slug} refused`);
  }

  assert.deepEqual(await readRegistry(), before, 'no year was invented');
});

test('beginPreseasonTransition refuses when only the DERIVED year is out of range', async () => {
  // At the very top of the accepted range the STORED year is valid, so this is
  // the only fixture that actually reaches the derived-year guard — the previous
  // fixture (2200) was rejected by the stored-year check first, leaving that
  // branch untested (F2H review).
  await seed([makeLeague('alpha', 2100, { state: 'offseason' })]);
  const before = await readRegistry();

  const transition = await beginPreseasonTransition('alpha');

  assert.equal(transition.outcome, 'invalid-year');
  assert.deepEqual(await readRegistry(), before, 'the out-of-range increment was not written');
});

test('completePreseasonSetup separates a stale form from a corrupt stored year', async () => {
  const corrupt = 1e21;
  await seed([
    makeLeague('alpha', 2026, { state: 'preseason', year: 2026 }),
    makeLeague('bravo', corrupt, { state: 'preseason', year: corrupt }),
  ]);

  // Submitted year does not match what is stored → a stale form.
  assert.equal((await completePreseasonSetup('alpha', 2025)).outcome, 'year-mismatch');
  // Submitted year MATCHES the record, but the record itself is unusable —
  // reporting `year-mismatch` here would be self-contradictory.
  assert.equal((await completePreseasonSetup('bravo', corrupt)).outcome, 'invalid-year');
});

test('a structurally valid but out-of-range legacy status is NOT called malformed', async () => {
  // `{ state: 'season', year: 1999 }` is assignable to `LeagueStatus`; it is a
  // real status, so recovery must report `status-already-present` rather than
  // telling the operator their well-formed record is corrupt (F2H review).
  await seed([makeLeague('alpha', 1999, { state: 'season', year: 1999 })]);

  const result = await initializeMissingLifecycleStatus('alpha');

  assert.equal(result.outcome, 'status-already-present');
});

// ---------------------------------------------------------------------------
// §4 — preseason setup completion

test('completePreseasonSetup succeeds only for the exact current preseason year', async () => {
  await seed([makeLeague('alpha', 2026, { state: 'preseason', year: 2026 })]);

  const completion = await completePreseasonSetup('alpha', 2026);

  assert.equal(completion.outcome, 'completed');
  const stored = await readLeague('alpha');
  assert.deepEqual(stored.status, { state: 'preseason', year: 2026, setupComplete: true });
  assertYearSynchronized(stored);
});

test('a stale setup form cannot move the lifecycle year backward or forward', async () => {
  await seed([makeLeague('alpha', 2026, { state: 'preseason', year: 2026 })]);
  const before = await readRegistry();

  const backward = await completePreseasonSetup('alpha', 2025);
  const forward = await completePreseasonSetup('alpha', 2027);

  assert.equal(backward.outcome, 'year-mismatch');
  assert.equal(forward.outcome, 'year-mismatch');
  assert.deepEqual(await readRegistry(), before, 'stale setup submissions write nothing');
});

test('completePreseasonSetup refuses a league that has left preseason, and unknown leagues', async () => {
  await seed([
    makeLeague('alpha', 2026, { state: 'season', year: 2026 }),
    makeLeague('bravo', 2025, { state: 'offseason' }),
    makeLeague('charlie', 2025),
  ]);
  const before = await readRegistry();

  assert.equal((await completePreseasonSetup('alpha', 2026)).outcome, 'not-in-preseason');
  assert.equal((await completePreseasonSetup('bravo', 2026)).outcome, 'not-in-preseason');
  assert.equal(
    (await completePreseasonSetup('charlie', 2025)).outcome,
    'not-in-preseason',
    'a legacy missing-status record is not a setup target'
  );
  assert.equal((await completePreseasonSetup('ghost', 2026)).outcome, 'league-not-found');

  assert.deepEqual(await readRegistry(), before);
});

test('repeated matching setup completion is a typed no-op that rewrites nothing', async () => {
  await seed([makeLeague('alpha', 2026, { state: 'preseason', year: 2026 })]);

  assert.equal((await completePreseasonSetup('alpha', 2026)).outcome, 'completed');
  const afterFirst = await readRegistry();

  const repeat = await completePreseasonSetup('alpha', 2026);

  assert.equal(repeat.outcome, 'already-complete');
  assert.deepEqual(await readRegistry(), afterFirst, 'the registry is untouched by the repeat');
});

test('completePreseasonSetup heals a desynchronized legacy top-level year', async () => {
  // Legacy record whose top-level projection lags its authoritative status year.
  await seed([makeLeague('alpha', 2019, { state: 'preseason', year: 2026 })]);

  assert.equal((await completePreseasonSetup('alpha', 2026)).outcome, 'completed');

  const stored = await readLeague('alpha');
  assert.equal(stored.year, 2026);
  assertYearSynchronized(stored);
});

// ---------------------------------------------------------------------------
// §5 — preseason → season (the daily cron's authority)

test('completeSeasonTransition succeeds only for the exact current preseason year', async () => {
  await seed([makeLeague('alpha', 2026, { state: 'preseason', year: 2026 })]);

  const transition = await completeSeasonTransition('alpha', 2026);

  assert.equal(transition.outcome, 'transitioned');
  const stored = await readLeague('alpha');
  assert.deepEqual(stored.status, { state: 'season', year: 2026 });
  assert.equal(stored.year, 2026);
  assertYearSynchronized(stored);
});

test('the exact-year operations refuse a corrupt stored year rather than laundering it forward', async () => {
  // A matching submission must not promote a corrupt stored year into a new
  // status (or onto the top-level projection) — validate as well as match.
  const corrupt = 1e21;
  await seed([
    makeLeague('alpha', corrupt, { state: 'preseason', year: corrupt }),
    makeLeague('bravo', corrupt, { state: 'preseason', year: corrupt }),
  ]);
  const before = await readRegistry();

  assert.equal((await completePreseasonSetup('alpha', corrupt)).outcome, 'invalid-year');
  assert.equal(
    (await completeSeasonTransition('bravo', corrupt)).outcome,
    'not-in-target-preseason'
  );

  assert.deepEqual(await readRegistry(), before, 'corrupt years are never propagated');
});

test('a stale cron snapshot cannot overwrite offseason, season, or a different preseason year', async () => {
  await seed([
    // Rolled over by another actor since this run's snapshot was taken.
    makeLeague('alpha', 2026, { state: 'offseason' }),
    // Advanced to the NEXT preseason year since the snapshot.
    makeLeague('charlie', 2027, { state: 'preseason', year: 2027 }),
    // Legacy missing-status record.
    makeLeague('delta', 2026),
    // NOTE: a league already in `season` at the TARGET year is deliberately not
    // here — that is the benign idempotent case, covered by its own tests.
  ]);
  const before = await readRegistry();

  for (const slug of ['alpha', 'charlie', 'delta']) {
    const transition = await completeSeasonTransition(slug, 2026);
    assert.equal(transition.outcome, 'not-in-target-preseason', `${slug} refused`);
  }
  const missing = await completeSeasonTransition('ghost', 2026);
  assert.equal(missing.outcome, 'not-in-target-preseason');
  assert.equal(missing.league, null, 'an unknown league reports no record');

  assert.deepEqual(await readRegistry(), before, 'every refusal wrote nothing');
});

test('a league already in the target season reports the benign idempotent outcome', async () => {
  // At-least-once scheduler delivery means two overlapping runs can both snapshot
  // `preseason`; the second must not read as a stale target set (F2H review).
  await seed([makeLeague('alpha', 2026, { state: 'season', year: 2026 })]);
  const before = await readRegistry();

  const transition = await completeSeasonTransition('alpha', 2026);

  assert.equal(transition.outcome, 'already-in-target-season');
  assert.deepEqual(await readRegistry(), before, 'the idempotent case writes nothing');
});

test('already-in-target-season is distinct from a genuinely stale target', async () => {
  await seed([
    makeLeague('alpha', 2026, { state: 'season', year: 2026 }),
    // Rolled over — NOT the desired end state for a 2026 transition.
    makeLeague('bravo', 2026, { state: 'offseason' }),
    // Transitioned for a DIFFERENT year.
    makeLeague('charlie', 2027, { state: 'season', year: 2027 }),
  ]);

  assert.equal((await completeSeasonTransition('alpha', 2026)).outcome, 'already-in-target-season');
  assert.equal((await completeSeasonTransition('bravo', 2026)).outcome, 'not-in-target-preseason');
  assert.equal(
    (await completeSeasonTransition('charlie', 2026)).outcome,
    'not-in-target-preseason'
  );
});

test('a repeated setup completion still HEALS a desynchronized legacy top-level year', async () => {
  // Pre-F2H1 this path rewrote the status unconditionally, which healed the
  // projection as a side effect; the typed no-op must not silently drop that
  // (F2H review).
  await seed([
    { ...makeLeague('alpha', 2019, { state: 'preseason', year: 2026, setupComplete: true }) },
  ]);

  const repeat = await completePreseasonSetup('alpha', 2026);

  assert.equal(repeat.outcome, 'already-complete');
  const stored = await readLeague('alpha');
  assert.equal(stored.year, 2026, 'the stale projection was healed');
  assertYearSynchronized(stored);
});

test('a repeated setup completion on an already-synchronized record writes nothing', async () => {
  await seed([makeLeague('alpha', 2026, { state: 'preseason', year: 2026, setupComplete: true })]);
  const before = await readRegistry();

  const repeat = await completePreseasonSetup('alpha', 2026);

  assert.equal(repeat.outcome, 'already-complete');
  assert.deepEqual(await readRegistry(), before, 'the common repeat stays a true no-op');
});

test('concurrent season transitions for the same league confirm exactly once', async () => {
  await seed([makeLeague('alpha', 2026, { state: 'preseason', year: 2026 })]);

  const results = await Promise.all([
    completeSeasonTransition('alpha', 2026),
    completeSeasonTransition('alpha', 2026),
  ]);

  const confirmed = results.filter((r) => r.outcome === 'transitioned');
  assert.equal(confirmed.length, 1, 'exactly one confirmed transition');
  const stored = await readLeague('alpha');
  assert.deepEqual(stored.status, { state: 'season', year: 2026 });
});

// ---------------------------------------------------------------------------
// §7 — legacy missing-status recovery

test('initializeMissingLifecycleStatus installs season at the stored legacy year', async () => {
  await seed([makeLeague('alpha', 2024)]);

  const result = await initializeMissingLifecycleStatus('alpha');

  assert.equal(result.outcome, 'initialized');
  const stored = await readLeague('alpha');
  assert.deepEqual(
    stored.status,
    { state: 'season', year: 2024 },
    'exactly the read-only compatibility interpretation'
  );
  assert.equal(stored.year, 2024, 'the stored year is preserved, never incremented');
  assertYearSynchronized(stored);
});

test('a persisted null status counts as ABSENT and is initialized, like every reader treats it', async () => {
  // `leagueStandings.ts` (`league.status ?? …`) and `rolloverTargeting.ts`
  // (`!status`) both render a null status under the read-only compatibility
  // inference — indistinguishable from a missing one. Recovery must be able to
  // repair exactly that record class (F2H1 review).
  await seed([makeLeague('alpha', 2024, null as unknown as League['status'])]);

  const result = await initializeMissingLifecycleStatus('alpha');

  assert.equal(result.outcome, 'initialized');
  const stored = await readLeague('alpha');
  assert.deepEqual(stored.status, { state: 'season', year: 2024 });
  assert.equal(stored.year, 2024);
  assertYearSynchronized(stored);
});

test('the initialized outcome reports the status it actually installed', async () => {
  await seed([makeLeague('alpha', 2024)]);

  const result = await initializeMissingLifecycleStatus('alpha');

  assert.equal(result.outcome, 'initialized');
  if (result.outcome !== 'initialized') return;
  assert.deepEqual(result.status, { state: 'season', year: 2024 });
  assert.deepEqual(
    result.status,
    (await readLeague('alpha')).status,
    'the reported status matches the stored record exactly'
  );
});

test('initialization preserves every other field of the legacy record', async () => {
  await seed([
    {
      ...makeLeague('alpha', 2024),
      foundedYear: 2011,
      assignmentMethod: 'draft',
      passwordHash: 'hash',
      passwordSalt: 'salt',
    },
  ]);

  assert.equal((await initializeMissingLifecycleStatus('alpha')).outcome, 'initialized');

  const stored = await readLeague('alpha');
  assert.equal(stored.foundedYear, 2011);
  assert.equal(stored.assignmentMethod, 'draft');
  assert.equal(stored.passwordHash, 'hash', 'credential material is untouched');
  assert.equal(stored.passwordSalt, 'salt');
});

test('initialization refuses every league that already has a valid lifecycle status', async () => {
  await seed([
    makeLeague('alpha', 2024, { state: 'season', year: 2024 }),
    makeLeague('bravo', 2026, { state: 'preseason', year: 2026 }),
    makeLeague('charlie', 2025, { state: 'offseason' }),
    makeLeague('delta', 2026, { state: 'preseason', year: 2026, setupComplete: true }),
    makeLeague('echo', 2026, { state: 'preseason', year: 2026, setupComplete: false }),
    // `setupComplete` is declared ONLY on the preseason variant, so an extra key
    // on season/offseason leaves the record structurally assignable — it is a
    // valid status, not a malformed one.
    makeLeague('foxtrot', 2024, {
      state: 'season',
      year: 2024,
      setupComplete: true,
    } as unknown as League['status']),
  ]);
  const before = await readRegistry();

  for (const slug of ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']) {
    const result = await initializeMissingLifecycleStatus(slug);
    assert.equal(result.outcome, 'status-already-present', `${slug} refused`);
  }

  assert.deepEqual(await readRegistry(), before, 'a valid status is never altered');
});

test('initialization refuses a malformed status object rather than repairing it', async () => {
  await seed([
    makeLeague('alpha', 2024, {} as League['status']),
    makeLeague('bravo', 2024, { state: 'bogus' } as unknown as League['status']),
    makeLeague('charlie', 2024, { state: 'season' } as unknown as League['status']),
    makeLeague('delta', 2024, { state: 'season', year: 'nope' } as unknown as League['status']),
    // `setupComplete` is `?: boolean` on the preseason variant — a non-boolean
    // value makes the record unassignable to `LeagueStatus`, so the type guard
    // must classify it as MALFORMED rather than as an existing valid status
    // (raised at F2H1 Codex review round 2).
    makeLeague('golf', 2026, {
      state: 'preseason',
      year: 2026,
      setupComplete: 'yes',
    } as unknown as League['status']),
    makeLeague('hotel', 2026, {
      state: 'preseason',
      year: 2026,
      setupComplete: null,
    } as unknown as League['status']),
  ]);
  const before = await readRegistry();

  for (const slug of ['alpha', 'bravo', 'charlie', 'delta', 'golf', 'hotel']) {
    const result = await initializeMissingLifecycleStatus(slug);
    assert.equal(result.outcome, 'invalid-existing-status', `${slug} refused`);
  }

  assert.deepEqual(await readRegistry(), before, 'malformed statuses are never repaired');
});

test('initialization refuses an invalid legacy year', async () => {
  await seed([
    makeLeague('alpha', Number.NaN as number),
    makeLeague('bravo', 1900),
    makeLeague('charlie', 2024.5),
    makeLeague('delta', '2024' as unknown as number),
  ]);
  const before = await readRegistry();

  for (const slug of ['alpha', 'bravo', 'charlie', 'delta']) {
    const result = await initializeMissingLifecycleStatus(slug);
    assert.equal(result.outcome, 'invalid-legacy-year', `${slug} refused`);
  }

  assert.deepEqual(await readRegistry(), before, 'no season year was invented');
});

test('initialization refuses the test league, whose lifecycle is managed separately', async () => {
  await seed([makeLeague('test', 2024)]);
  const before = await readRegistry();

  const result = await initializeMissingLifecycleStatus('test');

  assert.equal(result.outcome, 'test-league-managed-separately');
  assert.deepEqual(await readRegistry(), before);
});

test('initialization reports an unknown league', async () => {
  await seed([makeLeague('alpha', 2024, { state: 'season', year: 2024 })]);

  const result = await initializeMissingLifecycleStatus('ghost');

  assert.equal(result.outcome, 'league-not-found');
});

test('initialization refuses a league that acquired a status concurrently', async () => {
  await seed([makeLeague('alpha', 2024)]);

  // Two recovery attempts race on the ONE registry key. The loser re-reads the
  // just-installed status under the lock and refuses.
  const results = await Promise.all([
    initializeMissingLifecycleStatus('alpha'),
    initializeMissingLifecycleStatus('alpha'),
  ]);

  const outcomes = results.map((r) => r.outcome).sort();
  assert.deepEqual(outcomes, ['initialized', 'status-already-present']);

  const stored = await readLeague('alpha');
  assert.deepEqual(stored.status, { state: 'season', year: 2024 });
});

test('a second recovery request cannot overwrite the newly installed status', async () => {
  await seed([makeLeague('alpha', 2024)]);

  assert.equal((await initializeMissingLifecycleStatus('alpha')).outcome, 'initialized');
  const afterFirst = await readRegistry();

  const repeat = await initializeMissingLifecycleStatus('alpha');

  assert.equal(repeat.outcome, 'status-already-present');
  assert.deepEqual(await readRegistry(), afterFirst);
});

test('initialization does not touch sibling leagues', async () => {
  await seed([
    makeLeague('alpha', 2024),
    makeLeague('bravo', 2026, { state: 'preseason', year: 2026 }),
  ]);

  assert.equal((await initializeMissingLifecycleStatus('alpha')).outcome, 'initialized');

  const bravo = await readLeague('bravo');
  assert.deepEqual(bravo.status, { state: 'preseason', year: 2026 });
  assert.equal(bravo.year, 2026);
});

// ---------------------------------------------------------------------------
// §9.16 — a registry write failure leaves the entire prior record unchanged

test('a registry write failure leaves the prior record unchanged for every guarded operation', async () => {
  await seed([
    makeLeague('alpha', 2025, { state: 'offseason' }),
    makeLeague('bravo', 2026, { state: 'preseason', year: 2026 }),
    makeLeague('charlie', 2024),
  ]);
  const before = await readRegistry();

  __setAppStateWriteFailureForTests(new Error('simulated registry outage'), 'leagues');
  try {
    await assert.rejects(() => beginPreseasonTransition('alpha'), /simulated registry outage/);
    await assert.rejects(() => completePreseasonSetup('bravo', 2026), /simulated registry outage/);
    await assert.rejects(
      () => completeSeasonTransition('bravo', 2026),
      /simulated registry outage/
    );
    await assert.rejects(
      () => initializeMissingLifecycleStatus('charlie'),
      /simulated registry outage/
    );
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  assert.deepEqual(await readRegistry(), before, 'nothing was partially applied');
});
