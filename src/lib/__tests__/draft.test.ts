import assert from 'node:assert/strict';
import test from 'node:test';

import { getDraftEligibleTeams, isDraftEligibleTeam } from '@/lib/draft';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import teamsData from '@/data/teams.json';

// ---------------------------------------------------------------------------
// DRAFT-010 — shared draft-eligibility helper.
//
// Eligibility is defined by excluding the `NoClaim` schedule placeholder, NOT by a
// `classification` field. The shipped `teams.json` items carry no `classification`
// key, so any eligibility computation that filtered on `t.classification === 'fbs'`
// silently counted ZERO eligible teams. These tests lock in the correct, shared
// definition so setup/update/auto-pick/confirm can never diverge again.
// ---------------------------------------------------------------------------

type TeamsJson = { items: TeamCatalogItem[] };

test('isDraftEligibleTeam excludes the NoClaim placeholder and accepts real teams', () => {
  assert.equal(isDraftEligibleTeam({ school: 'NoClaim' }), false);
  assert.equal(isDraftEligibleTeam({ school: 'Texas' }), true);
  assert.equal(isDraftEligibleTeam({ school: 'Ohio State' }), true);
});

test('getDraftEligibleTeams drops NoClaim from the eligible set', () => {
  const catalog = [{ school: 'Texas' }, { school: 'NoClaim' }, { school: 'Ohio State' }];
  const eligible = getDraftEligibleTeams(catalog);

  assert.deepEqual(
    eligible.map((t) => t.school),
    ['Texas', 'Ohio State']
  );
  assert.ok(
    !eligible.some((t) => t.school === 'NoClaim'),
    'NoClaim must never appear in the eligible count'
  );
});

test('getDraftEligibleTeams counts every team in the current teams.json (no classification field)', () => {
  const { items } = teamsData as TeamsJson;
  const eligible = getDraftEligibleTeams(items);

  // Regression on the original bug: a classification-based filter returns 0 here
  // because no item in the shipped catalog carries a `classification` key.
  assert.ok(
    !items.some((t) => 'classification' in t),
    'fixture invariant: teams.json items carry no classification key'
  );
  assert.ok(eligible.length > 0, 'eligible team count must be non-zero for the current catalog');
  assert.equal(
    eligible.length,
    items.length,
    'current teams.json has no NoClaim entry, so every item is draft-eligible'
  );
});
