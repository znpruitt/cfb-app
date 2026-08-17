import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMembershipCompleteness } from '@/lib/insights/membershipCompleteness';
import { NO_CLAIM_OWNER } from '@/lib/standings';
import type { LeagueMembersSource } from '@/lib/insights/types';

/**
 * The completeness authority. Every claim this feature makes is about ABSENCE, so
 * these tests are about one thing: does the answer require positive evidence, or
 * can silence about a problem pass for proof there isn't one.
 */

function rosterOf(owners: string[]): Map<string, string> {
  return new Map(owners.map((owner, i) => [`Team${i}`, owner]));
}

function ask(params: {
  members: string[];
  source?: LeagueMembersSource;
  roster?: string[];
  usingArchivedRoster?: boolean;
  preseasonSetupComplete?: boolean;
}) {
  return resolveMembershipCompleteness({
    members: new Set(params.members),
    source: params.source ?? 'confirmed',
    currentRoster: rosterOf(params.roster ?? []),
    usingArchivedRoster: params.usingArchivedRoster ?? false,
    preseasonSetupComplete: params.preseasonSetupComplete ?? false,
  });
}

test('no evidence means INCOMPLETE, not complete-by-default', () => {
  // The whole shape of the module. A league mid-setup — two names typed, no
  // roster, no completion — is the case that produced "Heidi, Grace, Frank, Erin,
  // Dave, and Carol have left the league".
  const answer = ask({ members: ['A', 'B'] });
  assert.equal(answer.complete, false);
  assert.equal(answer.evidence, 'none');
});

test('the commissioner finishing setup is evidence', () => {
  const answer = ask({ members: ['A', 'B'], preseasonSetupComplete: true });
  assert.equal(answer.complete, true);
  assert.equal(answer.evidence, 'setup-complete');
});

test('a roster that agrees with the list is evidence — this is what survives kickoff', () => {
  // `setupComplete` is deleted by the season transition (it exists only on the
  // preseason variant of `LeagueStatus`), so without this rule the feature would
  // be silent for the entire season rather than merely for unfinished leagues.
  const answer = ask({
    members: ['A', 'B', 'C'],
    roster: ['A', 'B', 'C', 'A', 'B'], // multi-round draft: owners repeat
    preseasonSetupComplete: false,
  });
  assert.equal(answer.complete, true);
  assert.equal(answer.evidence, 'roster-corroborates');
});

test('an owner holding a team but missing from the list proves the list is INCOMPLETE', () => {
  const answer = ask({ members: ['A', 'B'], roster: ['A', 'B', 'C', 'D'] });
  assert.equal(answer.complete, false);
  assert.deepEqual(answer.unlistedRosterOwners, ['C', 'D'], 'and says who, for diagnostics');
});

test('corroboration requires an INDEPENDENT list, or it is a tautology', () => {
  // The subtle one. When members are DERIVED from the roster, comparing them to
  // the roster cannot fail: a half-assigned roster of four owners yields four
  // members who all appear in it, "corroborating" a list that omits ten people.
  // That is the INSIGHTS-031 defect — a partially entered roster passing a
  // count-based check — arriving through a different door.
  for (const source of ['official-roster', 'partial-roster', 'previous-roster'] as const) {
    const answer = ask({ members: ['A', 'B', 'C', 'D'], roster: ['A', 'B', 'C', 'D'], source });
    assert.equal(answer.complete, false, `${source} must not corroborate itself`);
  }
  // POSITIVE CONTROL: the identical roster and members DO corroborate when the
  // list came from the confirmation record, which is a second, independent witness.
  assert.equal(
    ask({ members: ['A', 'B', 'C', 'D'], roster: ['A', 'B', 'C', 'D'], source: 'confirmed' })
      .complete,
    true
  );
});

test('a BORROWED roster corroborates nothing', () => {
  // `usingArchivedRoster` means the roster is last season's, so its owners are
  // exactly the people who might have left — using it as evidence would let the
  // set being tested vouch for itself.
  const answer = ask({
    members: ['A', 'B'],
    roster: ['A', 'B'],
    usingArchivedRoster: true,
  });
  assert.equal(answer.complete, false);
  assert.equal(answer.evidence, 'none');
  assert.deepEqual(answer.unlistedRosterOwners, [], 'and it is not reported as a divergence');
});

test('an empty roster is not agreement', () => {
  // Vacuous truth: with no roster, "every roster owner is listed" holds. A
  // preseason league before its draft is exactly this, and it is the state the
  // gate exists for.
  const answer = ask({ members: ['A', 'B'], roster: [] });
  assert.equal(answer.complete, false);
});

test('NoClaim is not an owner, on either side of the comparison', () => {
  // `NoClaim` absorbs unowned teams, so it appears in the roster map for every
  // undrafted team and would otherwise read as an owner missing from the list —
  // silencing every league with leftover teams. 136 teams over 14 owners leaves
  // ten, so this is the ordinary case, not an edge.
  const answer = resolveMembershipCompleteness({
    members: new Set(['A', 'B']),
    source: 'confirmed',
    currentRoster: new Map([
      ['T1', 'A'],
      ['T2', 'B'],
      ['T3', NO_CLAIM_OWNER],
    ]),
    usingArchivedRoster: false,
    preseasonSetupComplete: false,
  });
  assert.equal(answer.complete, true);
  assert.deepEqual(answer.unlistedRosterOwners, []);
});

test('the diagnostics field is populated even when other evidence answered first', () => {
  // `unlistedRosterOwners` explains a silence. Computing it after the
  // `setupComplete` early return would have returned an empty array for a league
  // whose roster genuinely diverges, which is the one case an operator is looking
  // at the field to see.
  const answer = ask({
    members: ['A', 'B'],
    roster: ['A', 'B', 'C'],
    preseasonSetupComplete: true,
  });
  assert.equal(answer.complete, true);
  assert.equal(answer.evidence, 'setup-complete');
  assert.deepEqual(answer.unlistedRosterOwners, ['C'], 'the divergence is still reported');
});
