import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MIN_CONFIRMED_OWNERS,
  cleanOwnerNames,
  draftOwnersMatchRoster,
  findOwnerListProblem,
  selectConfirmedRoster,
  type ConfirmedRosterInput,
} from '../confirmedRoster.ts';

// ---------------------------------------------------------------------------
// PLATFORM-092 — the derivation, pinned without touching a store. The loader's
// job (reading the right two year-scoped records) is pinned in
// `src/lib/__tests__/server-confirmedRosterStore.test.ts`.
// ---------------------------------------------------------------------------

function input(overrides: Partial<ConfirmedRosterInput> = {}): ConfirmedRosterInput {
  return { confirmedOwnersRecord: null, ownersCsvRecord: null, ...overrides };
}

function csvOf(pairs: Array<[string, string]>): string {
  return ['team,owner', ...pairs.map(([team, owner]) => `${team},${owner}`)].join('\n');
}

test('nothing recorded means nothing confirmed', () => {
  assert.deepEqual(selectConfirmedRoster(input()), {
    owners: [],
    source: 'none',
    isConfirmed: false,
  });
});

test('the confirmation record confirms, in the order it was recorded', () => {
  const roster = selectConfirmedRoster(input({ confirmedOwnersRecord: ['Zach', 'Alice', 'Bob'] }));
  assert.equal(roster.isConfirmed, true);
  assert.equal(roster.source, 'preseason-owners');
  assert.deepEqual(roster.owners, ['Zach', 'Alice', 'Bob']);
});

test('a year-scoped owners CSV confirms when no confirmation record exists', () => {
  const roster = selectConfirmedRoster(
    input({
      ownersCsvRecord: csvOf([
        ['Texas', 'Alice'],
        ['Ohio State', 'Bob'],
      ]),
    })
  );
  assert.equal(roster.isConfirmed, true);
  assert.equal(roster.source, 'owners-csv');
  assert.deepEqual(roster.owners, ['Alice', 'Bob']);
});

test('the confirmation record wins, so re-confirming owners takes effect', () => {
  // The CSV is written when a draft CONFIRMS. If it won, a commissioner who then
  // added an owner would find the change silently ignored for the rest of the
  // season — Save succeeds, checklist stays ✓, and the draft still seeds the old
  // list. This module answers "who is in the league", which the commissioner
  // controls; `resolvePreseason` answers "what rows can I draw", which needs the
  // team→owner mapping only the CSV carries. Different questions, different
  // records — the mistake would be two answers to the SAME question.
  const roster = selectConfirmedRoster(
    input({
      confirmedOwnersRecord: ['Alice', 'Bob', 'Carol'],
      ownersCsvRecord: csvOf([
        ['Texas', 'Alice'],
        ['Ohio State', 'Bob'],
      ]),
    })
  );
  assert.equal(roster.source, 'preseason-owners');
  assert.deepEqual(roster.owners, ['Alice', 'Bob', 'Carol']);
});

test('a below-floor confirmation record falls through to the CSV', () => {
  const roster = selectConfirmedRoster(
    input({
      confirmedOwnersRecord: ['Alice'],
      ownersCsvRecord: csvOf([
        ['Texas', 'Carol'],
        ['Ohio State', 'Dave'],
      ]),
    })
  );
  assert.equal(roster.source, 'owners-csv');
  assert.deepEqual(roster.owners, ['Carol', 'Dave']);
});

// ---------------------------------------------------------------------------
// Names are never rewritten
// ---------------------------------------------------------------------------

test('names keep their exact spelling, and case is never folded', () => {
  // Owner identity is the raw string everywhere downstream — `deriveStandings`
  // keys on `row.owner`, and the only comparison in `standings.ts` is
  // `=== NO_CLAIM_OWNER`. Folding case here would merge two people the rest of
  // the app treats as distinct.
  const roster = selectConfirmedRoster({
    confirmedOwnersRecord: ['  Mike ', 'mike', 'ZACH'],
    ownersCsvRecord: null,
  });
  assert.deepEqual(roster.owners, ['Mike', 'mike', 'ZACH']);
});

test('cleanOwnerNames trims, drops blanks, and survives an untrusted shape', () => {
  // `getAppState` performs no runtime validation, so a legacy or hand-edited row
  // can hold any JSON. It must degrade to "no owners" rather than throw — a throw
  // here is a 500 from the create route and a render crash on the setup page.
  assert.deepEqual(cleanOwnerNames(['  Alice  ', '', '   ', 'Bob']), ['Alice', 'Bob']);
  assert.deepEqual(cleanOwnerNames(['Alice', 7, null, 'Bob']), ['Alice', 'Bob']);
  for (const shape of ['Alice,Bob', 42, { owners: ['A'] }, null, undefined, true]) {
    assert.deepEqual(cleanOwnerNames(shape), [], String(shape));
  }
});

test('NoClaim is dropped from the CSV but never from typed input', () => {
  // It legitimately appears in the CSV as the absorber for unclaimed teams.
  const roster = selectConfirmedRoster(
    input({
      ownersCsvRecord: csvOf([
        ['Texas', 'Alice'],
        ['Ohio State', 'Bob'],
        ['Air Force', 'NoClaim'],
      ]),
    })
  );
  assert.deepEqual(roster.owners, ['Alice', 'Bob']);

  // Typed input is refused instead, so a commissioner is told rather than
  // silently given a shorter roster than they entered.
  assert.match(findOwnerListProblem(['NoClaim', 'Alice']) ?? '', /reserved for unclaimed teams/);
});

test('a CSV that parses to fewer than two real owners is not a roster', () => {
  assert.equal(MIN_CONFIRMED_OWNERS, 2);
  for (const csv of [
    '',
    'team,owner',
    'team,owner\n\n\n',
    'team,owner\n,\n,',
    csvOf([['Texas', 'Alice']]),
    csvOf([
      ['Texas', 'Alice'],
      ['Air Force', 'NoClaim'],
    ]),
    // One owner holding two teams is one person, not a league.
    csvOf([
      ['Texas', 'Alice'],
      ['Ohio State', 'Alice'],
    ]),
  ]) {
    assert.equal(selectConfirmedRoster(input({ ownersCsvRecord: csv })).isConfirmed, false, csv);
  }
});

// ---------------------------------------------------------------------------
// What a commissioner may submit
// ---------------------------------------------------------------------------

test('findOwnerListProblem reports the specific mistake', () => {
  assert.equal(findOwnerListProblem(['Alice', 'Bob']), null);
  assert.equal(findOwnerListProblem(['  Alice  ', 'Bob']), null);
  assert.match(findOwnerListProblem(['Alice']) ?? '', /at least 2 owners/);
  assert.match(findOwnerListProblem(['Alice', 'Alice']) ?? '', /"Alice" is listed more than once/);
  assert.match(findOwnerListProblem(['Alice', ' Alice ']) ?? '', /listed more than once/);
  // Case is NOT a duplicate here — two people may be "Mike" and "mike", and the
  // entry form catches the accidental near-duplicate case separately.
  assert.equal(findOwnerListProblem(['Mike', 'mike']), null);
});

test('findOwnerListProblem refuses a non-array instead of throwing', () => {
  // Its documented caller is a Server Action, and Server Action arguments cross
  // HTTP unvalidated. Taking `readonly string[]` on faith meant a forged call
  // produced `names.map is not a function` — a 500 rather than the refusal this
  // function exists to produce.
  for (const forged of ['Alice,Bob', 42, { owners: ['A', 'B'] }, null, undefined, true]) {
    assert.match(findOwnerListProblem(forged) ?? '', /at least 2 owners/, String(forged));
  }
});

// ---------------------------------------------------------------------------
// Staleness — the only comparison in the module
// ---------------------------------------------------------------------------

test('a draft matches its roster by exact set, regardless of order', () => {
  assert.equal(draftOwnersMatchRoster(['Alice', 'Bob'], ['Bob', 'Alice']), true);
  assert.equal(draftOwnersMatchRoster(['Alice', 'Bob'], ['Alice', 'Bob']), true);
});

test('a draft does not match a roster that has since changed', () => {
  assert.equal(draftOwnersMatchRoster(['Alice', 'Bob'], ['Alice', 'Carol']), false);
  assert.equal(draftOwnersMatchRoster(['Alice', 'Bob'], ['Alice', 'Bob', 'Carol']), false);
  assert.equal(draftOwnersMatchRoster(['Alice', 'Bob', 'Carol'], ['Alice', 'Bob']), false);
  // Exact names — `alice` is a different owner downstream.
  assert.equal(draftOwnersMatchRoster(['alice', 'Bob'], ['Alice', 'Bob']), false);
  assert.equal(draftOwnersMatchRoster(['Alice'], []), false);
});

test('a duplicated owner never stands in for a missing one', () => {
  // Same length plus "every draft name is in the roster" is not set equality:
  // this passed while Bob was missing from the draft entirely. Drafts created
  // before this work accepted any two non-empty strings, so a stored duplicate
  // is reachable on legacy data.
  assert.equal(draftOwnersMatchRoster(['Alice', 'Alice'], ['Alice', 'Bob']), false);
  assert.equal(draftOwnersMatchRoster(['Alice', 'Bob'], ['Alice', 'Alice']), false);
});

test('two empty lists match, so the CALLER must check isConfirmed first', () => {
  // Documented rather than "fixed": an empty draft against an empty roster is
  // vacuously equal, and forcing it to false here would be a lie about set
  // equality. The route asks `roster.isConfirmed` BEFORE reaching this, so an
  // unconfirmed league is refused with its own reason rather than sliding
  // through a comparison that has nothing to compare.
  assert.equal(draftOwnersMatchRoster([], []), true);
});
