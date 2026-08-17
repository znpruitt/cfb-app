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

test('an empty roster is not agreement, published or not', () => {
  // Vacuous truth: with no roster, "every roster owner is listed" holds — an
  // empty set is contained in everything. `PUT /api/owners` can blank the CSV
  // without touching the draft, so a published draft beside an empty roster is
  // reachable, and the one-way check called it complete.
  assert.equal(ask({ members: ['A', 'B'], roster: [] }).complete, false);
  assert.equal(ask({ members: ['A', 'B'], roster: [], rosterIsPublished: true }).complete, false);
});

test('a member holding no team means the roster is BEHIND the list', () => {
  // Publication is a PAST event. Publish an A/B draft, then re-confirm A/B/C:
  // the publication stays valid, roster ⊆ members still holds, and C was
  // announced as joining a league whose final roster does not include them.
  const answer = ask({ members: ['A', 'B', 'C'], roster: ['A', 'B'], rosterIsPublished: true });
  assert.equal(answer.complete, false);
  assert.equal(answer.evidence, 'roster-behind-list');
  assert.deepEqual(answer.unrosteredMembers, ['C']);

  // POSITIVE CONTROL: with C drafted too, it is complete.
  assert.equal(
    ask({ members: ['A', 'B', 'C'], roster: ['A', 'B', 'C'], rosterIsPublished: true }).complete,
    true
  );
});

test('two spellings of one identity FAIL CLOSED rather than corroborating', () => {
  // The matching below normalizes, so `Mike` and `mike` would otherwise vouch for
  // each other — deciding a canonical owner identity that AGENTS.md invariant 11
  // defers. `membershipHistory` already refuses to speak about such an identity;
  // this makes the completeness answer agree instead of the two layers
  // disagreeing about who exists.
  const answer = ask({ members: ['Mike', 'mike'], roster: ['Mike'], rosterIsPublished: true });
  assert.equal(answer.complete, false);
  assert.equal(answer.evidence, 'identity-ambiguous');
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
  assert.equal(answer.evidence, 'roster-not-final', 'unpublished is the first thing wrong');

  // PUBLISHED and all-NoClaim — reachable, because `PUT /api/owners` can blank a
  // roster without touching the draft. The two-way check is what catches it.
  const published = resolveMembershipCompleteness({
    members: new Set(['A', 'B']),
    currentRoster: new Map([['T1', NO_CLAIM_OWNER]]),
    usingArchivedRoster: false,
    rosterIsPublished: true,
  });
  assert.equal(published.complete, false);
  // `roster-not-final` rather than `roster-behind-list`: once the sentinel is
  // filtered this roster names NO owners, which is indistinguishable from having
  // no roster at all, and that is the more truthful thing to tell an operator.
  // The ordering is deliberate — "nobody holds anything" outranks "these members
  // hold nothing".
  assert.equal(published.evidence, 'roster-not-final');
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

test('a spelling drift between the CSV and the list FAILS CLOSED, and says so', () => {
  // This reverses a narrower earlier version of this test, deliberately, so the
  // reasoning is recorded rather than re-litigated.
  //
  // One review round flagged raw comparison as SILENT over-suppression: a case
  // drift the history layer resolves would silence the whole feed for no visible
  // reason. The fix was to compare normalized. The next round flagged the
  // consequence: normalizing lets `Mike` and `mike` — which `cleanOwnerNames`
  // deliberately keeps distinct, and which AGENTS.md invariant 11 defers a
  // canonical mapping for — corroborate each other.
  //
  // Both are right. The resolution is to fail closed AND to stop being silent
  // about it: `identity-ambiguous` is now a reported evidence value with its own
  // diagnostics caption naming the fix. A feature whose failure mode is
  // announcing that real people quit does not get to guess which of two readings
  // is correct.
  const drifted = ask({
    members: ['Alice', 'Bob'],
    roster: ['alice', 'BOB'],
    rosterIsPublished: true,
  });
  assert.equal(drifted.complete, false);
  assert.equal(drifted.evidence, 'identity-ambiguous', 'and the operator is told which problem');

  // POSITIVE CONTROL: consistent spellings publish normally, so the check is
  // rejecting the drift rather than the fixture.
  assert.equal(
    ask({ members: ['Alice', 'Bob'], roster: ['Alice', 'Bob'], rosterIsPublished: true }).complete,
    true
  );
});

test('an out-of-year request cannot be answered, so it is not answered', async () => {
  // `/api/insights/{slug}?year=2024` is reachable by any caller on a passwordless
  // league, and the mixture it produced was silent: `leagueMembers` and
  // `currentRoster` are read for the REQUESTED year while `currentYear` — which
  // decides what counts as "last season" — comes from the league record. On a
  // 2027 league, `?year=2024` diffed the 2024 roster against the 2026 archive and
  // announced everyone who joined since as departed, in copy dated 2027.
  //
  // (This test was lost once to a scripted truncation of this file and restored
  // when `lint:all` flagged the orphaned import — the only thing that noticed.)
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

  // POSITIVE CONTROL: identical inputs at the league's OWN year do answer, so the
  // guard is rejecting the mismatch rather than the fixture.
  const coherent = await build(2027);
  assert.equal(coherent.membershipCompleteness.complete, true);
  assert.equal(coherent.membershipCompleteness.evidence, 'published-roster');
});
