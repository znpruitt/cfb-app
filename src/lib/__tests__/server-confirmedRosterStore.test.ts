import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../server/appStateStore.ts';
import { savePreseasonOwners } from '../preseasonOwnerStore.ts';
import { getConfirmedRoster } from '../server/confirmedRosterStore.ts';

// ---------------------------------------------------------------------------
// PLATFORM-092 — the STORAGE half: that the loader reads the right two records,
// year-scoped and league-scoped. The derivation is pinned without a store in
// `src/lib/selectors/__tests__/confirmedRoster.test.ts`.
//
// Records are cleared with `__deleteAppStateFileForTests()`, not
// `__resetAppStateForTests()` — the latter resets init state, failure injectors
// and the pool but leaves stored rows in place, so using it mid-test lets one
// assertion run against data another seeded.
// ---------------------------------------------------------------------------

const SLUG = 'tsc';
const YEAR = 2026;

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('reads the confirmation record for the requested year', async () => {
  await savePreseasonOwners(SLUG, YEAR, ['Alice', 'Bob']);

  const roster = await getConfirmedRoster(SLUG, YEAR);
  assert.equal(roster.isConfirmed, true);
  assert.equal(roster.source, 'preseason-owners');
  assert.deepEqual(roster.owners, ['Alice', 'Bob']);
});

test('reads the owners CSV for the requested year', async () => {
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nOhio State,Bob');

  const roster = await getConfirmedRoster(SLUG, YEAR);
  assert.equal(roster.source, 'owners-csv');
  assert.deepEqual(roster.owners, ['Alice', 'Bob']);
});

test("a PRIOR season's roster does not confirm this one", async () => {
  // Both records are year-scoped. This is the whole point: the archive fallback
  // this work removed was reading last season's owners.
  await savePreseasonOwners(SLUG, YEAR - 1, ['Alice', 'Bob']);
  await setAppState(`owners:${SLUG}:${YEAR - 1}`, 'csv', 'team,owner\nTexas,Alice\nOhio State,Bob');

  assert.equal((await getConfirmedRoster(SLUG, YEAR)).isConfirmed, false);
  // The prior year itself still reads as confirmed — the scoping is not a
  // blanket refusal.
  assert.equal((await getConfirmedRoster(SLUG, YEAR - 1)).isConfirmed, true);
});

test('rosters do not leak between leagues', async () => {
  await savePreseasonOwners('other-league', YEAR, ['Alice', 'Bob']);
  assert.equal((await getConfirmedRoster(SLUG, YEAR)).isConfirmed, false);
});

test('a stored record of the wrong shape degrades rather than throwing', async () => {
  // A 500 from the create-draft route and a render crash on the setup page is
  // the alternative.
  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), 'Alice,Bob');
  assert.equal((await getConfirmedRoster(SLUG, YEAR)).isConfirmed, false);
});
