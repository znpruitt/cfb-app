import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveMembershipCompleteness } from '@/lib/insights/membershipCompleteness';
import { buildInsightContext } from '@/lib/insights/context';
import { NO_CLAIM_OWNER } from '@/lib/standings';

/**
 * The completeness authority. Every claim this feature makes is about ABSENCE, so
 * these tests are about one thing: does the answer require positive evidence, or
 * can silence about a problem pass for proof there isn't one.
 *
 * Two earlier versions of this file asserted the two defects review found. They
 * are replaced rather than extended, and each is now pinned from the other side —
 * a test that asserts the defect is worse than no test, because it defends it.
 */

function rosterOf(owners: string[]): Map<string, string> {
  return new Map(owners.map((owner, i) => [`Team${i}`, owner]));
}

function ask(params: {
  members: string[];
  roster?: string[];
  usingArchivedRoster?: boolean;
  rosterIsPublished?: boolean;
}) {
  return resolveMembershipCompleteness({
    members: new Set(params.members),
    currentRoster: rosterOf(params.roster ?? []),
    usingArchivedRoster: params.usingArchivedRoster ?? false,
    rosterIsPublished: params.rosterIsPublished ?? false,
  });
}

test('a PUBLISHED roster whose owners are all listed is complete', () => {
  const answer = ask({
    members: ['A', 'B', 'C'],
    roster: ['A', 'B', 'C', 'A', 'B'], // multi-round draft: owners repeat
    rosterIsPublished: true,
  });
  assert.equal(answer.complete, true);
  assert.equal(answer.evidence, 'published-roster');
});

test('an UNPUBLISHED roster is never evidence, however well it agrees', () => {
  // THE SECOND HIGH. v2 accepted "every roster owner is listed" on its own, which
  // a two-row roster satisfies against a two-name list — and `PUT /api/owners`
  // enforces no minimum row count, so a mid-setup save is an ordinary state. Two
  // half-finished records agree perfectly. Publication is what rules out
  // partiality; agreement never could.
  const answer = ask({ members: ['A', 'B'], roster: ['A', 'B'], rosterIsPublished: false });
  assert.equal(answer.complete, false);
  assert.equal(answer.evidence, 'roster-not-final');
});

test('an owner holding a team but missing from the list DEFEATS publication', () => {
  // THE FIRST HIGH, inverted. v2 checked the contradiction only as a fallback,
  // after an assertion of completeness could already have returned true — so a
  // commissioner re-confirming a shortened list (the owner editor stays reachable
  // all preseason, and re-confirming never resets the flag) published a real
  // owner as departed while they still held a team.
  const answer = ask({
    members: ['A', 'B'],
    roster: ['A', 'B', 'C', 'D'],
    rosterIsPublished: true,
  });
  assert.equal(answer.complete, false, 'a visible contradiction outranks any assertion');
  assert.equal(answer.evidence, 'list-contradicted');
  assert.deepEqual(answer.unlistedRosterOwners, ['C', 'D'], 'and names who, for diagnostics');
});

test('a BORROWED roster is neither final nor a contradiction', () => {
  // `usingArchivedRoster` means the roster is last season's, so its owners are
  // exactly the people who might have left. Reading it as a contradiction would
  // silence every league in the rollover window; reading it as final would let
  // the set being tested vouch for itself.
  const answer = ask({
    members: ['A', 'B'],
    roster: ['A', 'B', 'C'],
    usingArchivedRoster: true,
    rosterIsPublished: true,
  });
  assert.equal(answer.complete, false);
  assert.equal(answer.evidence, 'roster-not-final');
  assert.deepEqual(answer.unlistedRosterOwners, []);
});

test('an empty roster is not agreement', () => {
  // Vacuous truth: with no roster, "every roster owner is listed" holds. Only
  // publication distinguishes "nobody has drafted yet" from "the draft is done".
  assert.equal(ask({ members: ['A', 'B'], roster: [] }).complete, false);
  // And a published draft cannot have an empty roster, so this pairing is
  // unreachable in production; asserted anyway because the module must not depend
  // on that being true elsewhere.
  assert.equal(ask({ members: ['A', 'B'], roster: [], rosterIsPublished: true }).complete, true);
});

test('a roster of nothing but NoClaim proves nothing about membership', () => {
  // `buildConfirmedOwnersCsv` writes a NoClaim row for every undrafted eligible
  // team, so an all-NoClaim CSV is a real shape. It has a positive `size` and
  // yields no unlisted owners once the sentinel is filtered, which is how it read
  // as agreement — but no real owner appears in it at all.
  const answer = resolveMembershipCompleteness({
    members: new Set(['A', 'B']),
    currentRoster: new Map([
      ['T1', NO_CLAIM_OWNER],
      ['T2', NO_CLAIM_OWNER],
    ]),
    usingArchivedRoster: false,
    rosterIsPublished: false,
  });
  assert.equal(answer.complete, false, 'agreement with nobody is not agreement');
});

test('NoClaim is not counted as an unlisted owner', () => {
  // The other direction: NoClaim absorbs unowned teams, so it appears in the
  // roster map for every undrafted team and would otherwise read as an owner
  // missing from the list — silencing every league with leftover teams. 136 teams
  // over 14 owners leaves ten, so this is the ordinary case, not an edge.
  const answer = resolveMembershipCompleteness({
    members: new Set(['A', 'B']),
    currentRoster: new Map([
      ['T1', 'A'],
      ['T2', 'B'],
      ['T3', NO_CLAIM_OWNER],
    ]),
    usingArchivedRoster: false,
    rosterIsPublished: true,
  });
  assert.equal(answer.complete, true);
  assert.deepEqual(answer.unlistedRosterOwners, []);
});

test('the contradiction check compares NORMALIZED identity, like the history layer', () => {
  // Compared raw at first, so a case drift between the CSV and the confirmed list
  // — the exact drift `identityKey` exists for, which the history layer resolves
  // — put a name in `unlistedRosterOwners` and silenced the whole feed. It failed
  // closed, so no false claim, but the silence was indistinguishable from having
  // nothing to say.
  const answer = ask({
    members: ['Alice', 'Bob'],
    roster: ['alice', 'BOB'],
    rosterIsPublished: true,
  });
  assert.equal(answer.complete, true);
  assert.deepEqual(answer.unlistedRosterOwners, []);

  // POSITIVE CONTROL: a genuinely different name is still a contradiction.
  assert.equal(
    ask({ members: ['Alice', 'Bob'], roster: ['alice', 'Carol'], rosterIsPublished: true })
      .complete,
    false
  );
});

test('an out-of-year request cannot be answered, so it is not answered', async () => {
  // `/api/insights/{slug}?year=2024` is reachable by any caller on a passwordless
  // league, and the mixture it produced was silent: `leagueMembers` and
  // `currentRoster` are read for the REQUESTED year while `currentYear` — which
  // decides what counts as "last season" — comes from the league record. On a
  // 2027 league, `?year=2024` diffed the 2024 roster against the 2026 archive and
  // announced everyone who joined since as departed, in copy dated 2027.
  const league = {
    slug: 'l',
    displayName: 'L',
    year: 2027,
    createdAt: '2024-01-01T00:00:00.000Z',
    status: { state: 'preseason' as const, year: 2027, setupComplete: true },
  };
  const roster = new Map([
    ['T0', 'A'],
    ['T1', 'B'],
  ]);
  const build = (resolvedYear: number) =>
    buildInsightContext(
      'l',
      league,
      [],
      [],
      [],
      'in-season',
      null,
      roster,
      new Date('2027-08-01T00:00:00.000Z'),
      ['A', 'B'],
      'preseason-owners',
      true,
      resolvedYear
    );

  const mismatched = await build(2024);
  assert.equal(mismatched.membershipCompleteness.complete, false, 'a foreign year is unanswerable');

  // POSITIVE CONTROL: the identical inputs at the league's OWN year do answer, so
  // the guard is rejecting the mismatch rather than the fixture.
  const coherent = await build(2027);
  assert.equal(coherent.membershipCompleteness.complete, true);
  assert.equal(coherent.membershipCompleteness.evidence, 'published-roster');
});
