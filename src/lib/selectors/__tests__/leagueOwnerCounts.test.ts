import assert from 'node:assert/strict';
import test from 'node:test';

import { countDistinctOwners, NO_CLAIM_OWNER } from '../leagueOwnerCounts.ts';

// ---------------------------------------------------------------------------
// PLATFORM-088 — the derivation moved here from the homepage RSC.
//
// AGENTS.md invariant 9: all derived league data is computed in
// `src/lib/selectors/`, never inline in UI. The first pass at this slice moved
// the counting into `src/components/`, which was the violation in a new place.
// ---------------------------------------------------------------------------

test('absent, empty, and header-only input all count zero', () => {
  assert.equal(countDistinctOwners(null), 0);
  assert.equal(countDistinctOwners(undefined), 0);
  assert.equal(countDistinctOwners(''), 0);
  assert.equal(countDistinctOwners('Team,Owner'), 0, 'a header with no rows is not an owner');
});

test('distinct people are counted once each', () => {
  const csv = 'Team,Owner\nAlabama,Dana\nGeorgia,Dana\nUtah,Sam';
  assert.equal(countDistinctOwners(csv), 2, 'Dana owns two teams but is one person');
});

// REGRESSION TEST — the sentinel is a marker for an unclaimed team, not a person.
test('the NoClaim sentinel is never counted as an owner', () => {
  const csv = `Team,Owner\nAlabama,Dana\nGeorgia,${NO_CLAIM_OWNER}\nUtah,${NO_CLAIM_OWNER}`;
  assert.equal(countDistinctOwners(csv), 1);
});

// REGRESSION TEST — the header locates the owner column. The homepage used to
// split on the first comma and take whatever followed, which silently read the
// TEAM column when the header was ordered the other way.
test('a reordered header still finds the owner column', () => {
  const csv = 'Owner,Team\nDana,Alabama\nSam,Georgia';
  assert.equal(countDistinctOwners(csv), 2);
});

// REGRESSION TEST — a quoted field containing a comma. The positional split
// landed inside the quotes and produced a fragment of the team name as an owner.
test('a quoted team name containing a comma does not corrupt the count', () => {
  const csv = 'Team,Owner\n"Texas A&M, College Station",Dana\nGeorgia,Sam';
  assert.equal(countDistinctOwners(csv), 2, 'two real owners, not a fragment');
});

test('blank owner cells are not people', () => {
  const csv = 'Team,Owner\nAlabama,Dana\nGeorgia,\nUtah,   ';
  assert.equal(countDistinctOwners(csv), 1);
});
