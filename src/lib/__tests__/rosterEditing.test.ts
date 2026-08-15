import assert from 'node:assert/strict';
import test from 'node:test';

import { countDroppedRows, countEditedTeams, selectRosterRows } from '../rosterEditing.ts';

// ---------------------------------------------------------------------------
// PLATFORM-099 — the roster editor is where a commissioner fixes ownership after
// a draft, and this covers the two decisions the page makes about a save: what
// order the rows appear in, and what the confirmation claims the save will do.
//
// Both are tested as functions rather than through a render: the panel fetches
// its roster on mount, so a statically rendered assertion only ever sees the
// loading state — coverage that looks real and observes nothing.
// ---------------------------------------------------------------------------

const TEAMS = [
  { school: 'Alabama', conference: 'SEC' },
  { school: 'Michigan', conference: 'Big Ten' },
  { school: 'Ohio State', conference: 'Big Ten' },
  { school: 'Texas', conference: 'SEC' },
  { school: 'Vanderbilt', conference: 'SEC' },
];

/** Alice holds two, Bob holds one, two teams are unowned. */
const SAVED = new Map<string, string>([
  ['Texas', 'Alice'],
  ['Michigan', 'Alice'],
  ['Alabama', 'Bob'],
]);

function schools(rows: ReadonlyArray<{ school: string }>): string[] {
  return rows.map((r) => r.school);
}

test('sorting by owner groups each owner together', () => {
  const rows = selectRosterRows(TEAMS, {
    search: '',
    sortKey: 'owner',
    sortDir: 'asc',
    savedOwners: SAVED,
  });
  // Alice before Bob; within an owner, teams in a stable readable order rather
  // than the catalog's.
  assert.deepEqual(schools(rows).slice(0, 3), ['Michigan', 'Texas', 'Alabama']);
});

test('unowned teams sort LAST in BOTH directions', () => {
  // The direction that matters: an empty owner string sorts before every real
  // name, so a naive comparator clumps every unowned team at the top the moment
  // the operator reverses the sort — burying the rows they came to work on.
  for (const sortDir of ['asc', 'desc'] as const) {
    const rows = selectRosterRows(TEAMS, {
      search: '',
      sortKey: 'owner',
      sortDir,
      savedOwners: SAVED,
    });
    assert.deepEqual(
      schools(rows).slice(-2).sort(),
      ['Ohio State', 'Vanderbilt'],
      `${sortDir}: the unowned teams are the last two`
    );
  }
});

test('reversing the owner sort actually reverses the owned rows', () => {
  // Guards the branch above from being satisfied by a comparator that ignores
  // direction entirely — unowned-last would still hold, and the test would pass.
  const asc = selectRosterRows(TEAMS, {
    search: '',
    sortKey: 'owner',
    sortDir: 'asc',
    savedOwners: SAVED,
  });
  const desc = selectRosterRows(TEAMS, {
    search: '',
    sortKey: 'owner',
    sortDir: 'desc',
    savedOwners: SAVED,
  });
  assert.deepEqual(schools(desc).slice(0, 3), schools(asc).slice(0, 3).reverse());
});

test('the order comes from the SAVED owners, not from an in-progress edit', () => {
  // The keystroke defect: ordering on the unsaved map re-sorts on every
  // character, so typing into an unowned team's field moves that row out of the
  // unowned block mid-word and the input slides away under the cursor. Here
  // `Vanderbilt` is being typed into and must not move until it is saved.
  const rows = selectRosterRows(TEAMS, {
    search: '',
    sortKey: 'owner',
    sortDir: 'asc',
    savedOwners: SAVED,
  });
  assert.ok(schools(rows).slice(-2).includes('Vanderbilt'), 'still in the unowned block');
});

test('search still filters, and sorting by school is unchanged', () => {
  // 'an' rather than 'a': every school in this fixture contains an "a", so the
  // first version of this assertion could not have failed on a broken filter.
  const rows = selectRosterRows(TEAMS, {
    search: 'an',
    sortKey: 'school',
    sortDir: 'asc',
    savedOwners: SAVED,
  });
  assert.deepEqual(schools(rows), ['Michigan', 'Vanderbilt']);
  assert.equal(
    selectRosterRows(TEAMS, {
      search: 'zzz',
      sortKey: 'school',
      sortDir: 'asc',
      savedOwners: SAVED,
    }).length,
    0,
    'and a term matching nothing returns nothing'
  );
});

// ---------------------------------------------------------------------------
// What the confirmation says a save will do
// ---------------------------------------------------------------------------

test('an owner rename counts as one edited team per team held', () => {
  const draft = new Map(SAVED);
  draft.set('Texas', 'Robert');
  assert.equal(countEditedTeams(SAVED, draft, TEAMS), 1);
});

test('no edit counts as nothing', () => {
  assert.equal(countEditedTeams(SAVED, new Map(SAVED), TEAMS), 0);
});

test('a non-catalog row is a DROPPED row, never an edit', () => {
  // These were one number serving as both the Save gate and the confirmation's
  // headline, and that could not work: `teams` is the STATIC `teams.json` import
  // while the stored CSV was validated against the mutable team database seeded
  // from it. A school in one and not the other pinned the count at >= 1 forever,
  // which collapsed the gate back to `hasChanges` — re-enabling the very
  // no-op-save case the gate exists to block — and inflated every real edit by a
  // number the operator cannot see, since those rows are not in the table.
  const savedWithLegacy = new Map(SAVED);
  savedWithLegacy.set('Idaho', 'Carol');
  const draftWithLegacy = new Map(savedWithLegacy);

  assert.equal(
    countEditedTeams(savedWithLegacy, draftWithLegacy, TEAMS),
    0,
    'the gate sees no edit, so Save stays disabled'
  );
  assert.equal(
    countDroppedRows(savedWithLegacy, TEAMS),
    1,
    'and the confirmation can still report the row the save will remove'
  );
});

test('an unowned non-catalog row is not reported as a dropped row', () => {
  // `buildCsv` filters falsy owners, so a blank row is not something the save
  // removes — reporting it would inflate the figure with a row that never
  // existed in the stored CSV.
  const saved = new Map(SAVED);
  saved.set('Idaho', '');
  assert.equal(countDroppedRows(saved, TEAMS), 0);
});

test('nothing outside the catalog is dropped when the roster is clean', () => {
  assert.equal(countDroppedRows(SAVED, TEAMS), 0);
});

test('a typed-then-deleted owner is not a change', () => {
  // `handleOwnerChange` writes unconditionally, so typing one character into an
  // unowned team's field and deleting it leaves `school -> ''` that the saved map
  // lacks. `mapsEqual` compares sizes and calls that "changed"; this count
  // normalizes both sides. Save is gated on THIS number so the two cannot
  // disagree — otherwise the operator saw "0 teams change owner" above a prompt
  // warning that the whole roster is about to be rewritten, which is the kind of
  // confirmation people learn to click through.
  const draft = new Map(SAVED);
  draft.set('Vanderbilt', '');
  assert.equal(countEditedTeams(SAVED, draft, TEAMS), 0);
});
