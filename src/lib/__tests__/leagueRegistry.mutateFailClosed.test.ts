import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addLeague,
  beginPreseasonTransition,
  clearLeaguePassword,
  completePreseasonSetup,
  completeSeasonRollover,
  completeSeasonTransition,
  LeagueRegistryMalformedError,
  removeLeague,
  resetTestLeagueLifecycle,
  setTestLeagueLifecycleState,
  updateLeague,
} from '../leagueRegistry.ts';
import type { League } from '../league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '../server/appStateStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-836 — `mutateRegistry` FAILS CLOSED on a malformed container.
//
// It used to repeat the collapse `readLeagueRegistry`'s docblock calls "the
// collapse this reader exists to prevent", twenty lines below it: a corrupt
// registry became a fabricated `[]`, and `addLeague` then WROTE `[newLeague]`
// over the corrupt value — turning a recoverable corruption into an
// unrecoverable registry that reports `ok`.
//
// ABSENT IS NOT MALFORMED. These two states are what the whole slice separates,
// so the empty-store positive control below is not decoration: it is what proves
// the refusal is keyed on corruption rather than on "no leagues".
//
// `getLeagues()` is deliberately UNCHANGED — 69 modules depend on its array
// contract — and that pin already exists as
// `leagueRegistry.readRegistry.test.ts` → 'R1 contract pin: getLeagues() still
// returns [] for absent AND malformed registries'. Not duplicated here.
// ---------------------------------------------------------------------------

const CORRUPT = { alpha: 1, nested: { passwordHash: 'HASH-CANARY' } };

function makeLeague(slug: string, year: number, status?: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2020-01-01T00:00:00.000Z',
    status,
  } as League;
}

async function seedMalformed(): Promise<unknown> {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await setAppState('leagues', 'registry', CORRUPT);
  const before = await getAppState<unknown>('leagues', 'registry');
  // POSITIVE CONTROL for every "unchanged" assertion below: the observer can see
  // the stored value at all. Without this, a reader that silently returned
  // nothing would make "unchanged" vacuously true.
  assert.ok(before !== null && before.value !== undefined, 'the corrupt value was readable');
  return before;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// REGRESSION TEST — the destructive half, and the one the issue did not name.
//
// Asserting only that something THREW would be satisfied by the pre-existing
// duplicate-slug throw, so this asserts the registry is BYTE-FOR-BYTE unchanged
// and that the refusal is the typed one.
test('mutateRegistry refuses a malformed registry and leaks no stored value', async () => {
  const before = await seedMalformed();

  const error = await addLeague(makeLeague('alpha', 2026)).then(
    () => null,
    (e: unknown) => e
  );

  // THE LOAD-BEARING ASSERTION, AND IT IS DELIBERATELY FIRST.
  //
  // Ordering it after the error-type check would make it unreachable under the
  // mutation that matters: restore the `Array.isArray(...) ? ... : []` collapse
  // and `addLeague` RESOLVES, so an error-type assertion fires first and this
  // line never runs — proving only that something threw, which is the false
  // green this slice was warned about. First, it reddens on its own with
  // "the malformed registry is byte-for-byte unchanged", which is the claim.
  assert.deepEqual(
    await getAppState<unknown>('leagues', 'registry'),
    before,
    'the malformed registry is byte-for-byte unchanged, so the corruption stays recoverable'
  );
  assert.ok(
    error instanceof LeagueRegistryMalformedError,
    `expected LeagueRegistryMalformedError, got ${String(error)}`
  );
  assert.ok(
    !String((error as Error).message).includes('HASH-CANARY'),
    'the refusal never carries the malformed value'
  );
});

// POSITIVE CONTROL — absent is NOT malformed.
//
// This is the assertion that keeps the refusal honest: a guard that refused on
// `[]` would also refuse the very first league in a fresh store, and would break
// every test that seeds through `addLeague`.
test('an ABSENT registry still creates the first league', async () => {
  assert.equal(await getAppState('leagues', 'registry'), null, 'precondition: no record');

  const updated = await addLeague(makeLeague('alpha', 2026));

  assert.deepEqual(
    updated.map((l) => l.slug),
    ['alpha'],
    'a first-run absence is a genuine empty registry, not corruption'
  );
});

// POSITIVE CONTROL — a stored EMPTY ARRAY is also not corruption.
test('a stored empty array still creates a league', async () => {
  await setAppState('leagues', 'registry', []);

  const updated = await addLeague(makeLeague('alpha', 2026));

  assert.deepEqual(
    updated.map((l) => l.slug),
    ['alpha'],
    'an empty array is a well-formed registry holding no leagues'
  );
});

// CONTRACT PIN — the disposition of EVERY other `mutateRegistry` caller.
//
// None of these wrote under a malformed registry before 836, but each was safe
// BY ACCIDENT rather than by refusal: `findIndex` returned -1 on the fabricated
// `[]`, so each answered a CORRUPT registry with a confident "that league does
// not exist". They now refuse. Enumerated individually — a loop asserting "they
// all throw" would not record which caller has which disposition.
test('every other registry mutator refuses instead of reporting league-not-found', async () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ['updateLeague', () => updateLeague('alpha', { displayName: 'Renamed' })],
    ['clearLeaguePassword', () => clearLeaguePassword('alpha')],
    ['removeLeague', () => removeLeague('alpha')],
    ['completeSeasonRollover', () => completeSeasonRollover('alpha', 2026)],
    ['completeSeasonTransition', () => completeSeasonTransition('alpha', 2026)],
    ['beginPreseasonTransition', () => beginPreseasonTransition('alpha')],
    ['completePreseasonSetup', () => completePreseasonSetup('alpha', 2026)],
    ['setTestLeagueLifecycleState', () => setTestLeagueLifecycleState('season')],
    ['resetTestLeagueLifecycle', () => resetTestLeagueLifecycle()],
  ];

  for (const [name, call] of cases) {
    const before = await seedMalformed();

    const error = await call().then(
      () => null,
      (e: unknown) => e
    );

    assert.ok(
      error instanceof LeagueRegistryMalformedError,
      `${name} must refuse a malformed registry, got ${String(error)}`
    );
    assert.deepEqual(
      await getAppState<unknown>('leagues', 'registry'),
      before,
      `${name} wrote nothing`
    );
  }
});

// REGRESSION TEST — the advisory lock is unchanged.
//
// The refusal throws INSIDE `withAppStateKeyTransaction`, the same path
// `addLeague`'s pre-existing duplicate-slug throw has always taken. If the lock
// leaked, the NEXT mutation on the same key would hang or fail rather than
// proceed, so a successful mutation after a refusal is the observable proof.
test('a refusal releases the registry lock, so the next mutation proceeds', async () => {
  await seedMalformed();

  await assert.rejects(() => addLeague(makeLeague('alpha', 2026)), LeagueRegistryMalformedError);

  // Repair the registry exactly as an operator would, then mutate again.
  await setAppState('leagues', 'registry', [makeLeague('restored', 2026)]);
  const updated = await addLeague(makeLeague('alpha', 2026));

  assert.deepEqual(
    updated.map((l) => l.slug),
    ['restored', 'alpha'],
    'the lock was released and the repaired registry accepts writes'
  );
});

// REGRESSION TEST — a refusal is RECOVERABLE, which is the argument for refusing
// at all. After the refusal the corrupt value is still readable, so an operator
// can inspect and repair it; a write is what destroys that.
test('a refused mutation leaves the corruption inspectable', async () => {
  await seedMalformed();

  await assert.rejects(() => removeLeague('alpha'), LeagueRegistryMalformedError);

  const after = await getAppState<Record<string, unknown>>('leagues', 'registry');
  assert.deepEqual(after?.value, CORRUPT, 'the operator can still read what was stored');
});
