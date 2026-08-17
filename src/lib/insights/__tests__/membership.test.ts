import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildMembershipHistory, type MembershipEvent } from '@/lib/insights/membershipHistory';
import { membershipGenerator } from '@/lib/insights/generators/membership';
import { generateRawInsights } from '@/lib/insights/engine';
import type { Insight } from '@/lib/selectors/insights';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import type { SeasonArchive } from '@/lib/seasonArchive';
import type { InsightContext } from '@/lib/insights/types';

// ---------------------------------------------------------------------------
// INSIGHTS-025 — who joined, who came back, who is gone.
//
// Every figure is derived from the archives at request time. The last test in
// this file is a source scan that fails if an owner name or a season ever gets
// written into the feature as a literal — the owner was explicit that hardcoded
// insights are not acceptable, and "I didn't hardcode anything" is a claim worth
// enforcing rather than asserting.
// ---------------------------------------------------------------------------

/** An archive whose roster is `roster` and whose table is `order`, best first. */
function archive(year: number, roster: string[], order: string[]): SeasonArchive {
  return {
    leagueSlug: 'l',
    year,
    archivedAt: `${year + 1}-01-01T00:00:00.000Z`,
    ownerRosterSnapshot:
      'team,owner\n' + roster.map((owner, i) => `Team${i}_${year},${owner}`).join('\n'),
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: order.map((owner, i) => ({
      owner,
      wins: 80 - i * 3,
      losses: 40 + i * 3,
      ties: 0,
      winPct: (80 - i * 3) / 120,
      pointsFor: 900 - i * 20,
      pointsAgainst: 500,
      pointDifferential: 400 - i * 20,
      gamesBack: i,
    })),
    games: [],
    scoresByKey: {},
  } as unknown as SeasonArchive;
}

/**
 * Events for a league whose newest archive is the season before `currentYear`.
 *
 * The default is derived from the archives rather than pinned, because the
 * derivation now REQUIRES the newest archive to be last season — a gap made it
 * re-announce settled events as this year's news.
 */
function history(
  archives: SeasonArchive[],
  members: string[],
  currentYear?: number
): MembershipEvent[] {
  const newest = Math.max(...archives.map((a) => a.year), 0);
  return buildMembershipHistory({
    archives,
    members: new Set(members),
    parseCsv: parseOwnersCsv,
    currentYear: currentYear ?? newest + 1,
  }).events;
}

function contextFor(archives: SeasonArchive[], members: string[], year?: number): InsightContext {
  const newest = Math.max(...archives.map((a) => a.year), 0);
  return {
    archives,
    currentYear: year ?? newest + 1,
    leagueMembers: new Set(members),
    leagueMembersSource: 'confirmed',
    // Setup FINISHED, not merely known — the gate this slice needed. Individual
    // tests override it to prove the gate bites.
    lifecycleState: 'preseason',
    preseasonSetupComplete: true,
    // The gate reads this, not the flag above — completeness is one resolved
    // answer on the context (`membershipCompleteness.ts`), so fixtures state it
    // directly rather than restating the evidence rules.
    membershipCompleteness: {
      complete: true,
      evidence: 'published-roster' as const,
      unlistedRosterOwners: [],
    },
  } as unknown as InsightContext;
}

// ---------------------------------------------------------------------------
// The derivation.
// ---------------------------------------------------------------------------

test('an owner with no history JOINED', () => {
  const events = history([archive(2029, ['A', 'B'], ['A', 'B'])], ['A', 'B', 'C']);
  assert.deepEqual(events, [{ kind: 'joined', owners: ['C'] }]);
});

test('arrivals are grouped into ONE event', () => {
  // Three new owners must not consume three of the Overview's five slots.
  const events = history([archive(2029, ['A'], ['A'])], ['A', 'X', 'Y', 'Z']);
  const joined = events.filter((e) => e.kind === 'joined');
  assert.equal(joined.length, 1);
  assert.deepEqual(joined[0], { kind: 'joined', owners: ['X', 'Y', 'Z'] });
});

test('an owner with history who missed the last season RETURNED, with the gap counted', () => {
  const archives = [
    archive(2027, ['A', 'B'], ['A', 'B']),
    archive(2028, ['A'], ['A']),
    archive(2029, ['A'], ['A']),
  ];
  const [event] = history(archives, ['A', 'B']).filter((e) => e.kind === 'returned');
  assert.ok(event && event.kind === 'returned');
  assert.equal(event.owner, 'B');
  assert.equal(event.lastSeason.year, 2027);
  // Two archived seasons exist after the one they last played.
  assert.equal(event.seasonsAway, 2);
});

test('a returner with ONE prior season gets no best-season', () => {
  // "Their best finish" collapses to "their only finish", which welcomes someone
  // back with their worst result. Null by construction so the warm variant
  // cannot render.
  const archives = [archive(2027, ['A', 'B'], ['A', 'B']), archive(2029, ['A'], ['A'])];
  const [event] = history(archives, ['A', 'B']).filter((e) => e.kind === 'returned');
  assert.ok(event && event.kind === 'returned');
  assert.equal(event.bestSeason, null);
});

test('a returner with several seasons is described by their BEST, not their last', () => {
  // B finishes 2nd, then last, then leaves. A welcome leads with the 2nd.
  const archives = [
    archive(2026, ['A', 'B', 'C'], ['A', 'B', 'C']),
    archive(2027, ['A', 'B', 'C'], ['A', 'C', 'B']),
    archive(2029, ['A', 'C'], ['A', 'C']),
  ];
  const [event] = history(archives, ['A', 'B', 'C']).filter((e) => e.kind === 'returned');
  assert.ok(event && event.kind === 'returned');
  assert.equal(event.bestSeason?.year, 2026);
  assert.equal(event.bestSeason?.placement, 2);
  assert.equal(event.lastSeason.placement, 3, 'and their last was worse');
});

test('a tied best finish breaks toward the MOST RECENT', () => {
  const archives = [
    archive(2026, ['A', 'B'], ['A', 'B']),
    archive(2027, ['A', 'B'], ['A', 'B']),
    archive(2029, ['A'], ['A']),
  ];
  const [event] = history(archives, ['A', 'B']).filter((e) => e.kind === 'returned');
  assert.ok(event && event.kind === 'returned');
  assert.equal(event.bestSeason?.year, 2027, 'the one people remember');
});

test('an owner on the last roster who is not a member LEFT, with their finish', () => {
  const events = history([archive(2029, ['A', 'B', 'C'], ['A', 'B', 'C'])], ['A', 'B']);
  const left = events.filter((e) => e.kind === 'left');
  assert.equal(left.length, 1);
  assert.ok(left[0] && left[0].kind === 'left');
  assert.equal(left[0].owner, 'C');
  assert.equal(left[0].finalSeason.placement, 3);
  assert.equal(left[0].finalSeason.fieldSize, 3, 'placement is meaningless without the field');
});

test('an owner on the roster but absent from the table has a NULL placement', () => {
  // Roster and standings can disagree — an owner who drafted but never appears in
  // `finalStandings` still took part, and reading only the table would drop them.
  const events = history([archive(2029, ['A', 'B', 'C'], ['A', 'B'])], ['A', 'B']);
  const left = events.filter((e) => e.kind === 'left');
  assert.ok(left[0] && left[0].kind === 'left');
  assert.equal(left[0].owner, 'C');
  assert.equal(left[0].finalSeason.placement, null);
});

test('with NO archives there are no events at all', () => {
  // A brand-new league is not a league where everyone just arrived.
  assert.deepEqual(history([], ['A', 'B', 'C']), []);
});

test('NoClaim is never an owner, joining, leaving or returning', () => {
  const events = history([archive(2029, ['A', 'NoClaim'], ['A', 'NoClaim'])], ['A', 'NoClaim']);
  for (const event of events) {
    const named =
      event.kind === 'joined' ? event.owners : [event.kind === 'left' ? event.owner : event.owner];
    for (const owner of named) assert.notEqual(owner, 'NoClaim');
  }
});

// ---------------------------------------------------------------------------
// Gating.
// ---------------------------------------------------------------------------

test('membership must be KNOWN or the subject is unanswerable', () => {
  // With `previous-roster` the members ARE last season's roster, so nobody could
  // ever be computed as joining or leaving — and anyone who merely sat a season
  // out would be reported as departed.
  const context = {
    ...contextFor([archive(2029, ['A', 'B'], ['A', 'B'])], ['A', 'C']),
    leagueMembersSource: 'previous-roster',
  } as unknown as InsightContext;
  assert.deepEqual(membershipGenerator.generate(context), []);
});

// ---------------------------------------------------------------------------
// Copy: tiered by count, no pronouns, no positional mapping past two.
// ---------------------------------------------------------------------------

function departureVariants(count: number): string[] {
  const roster = Array.from({ length: count + 2 }, (_, i) => `O${i}`);
  const leaving = roster.slice(2);
  const members = roster.slice(0, 2);
  const insight = membershipGenerator
    .generate(contextFor([archive(2029, roster, roster)], members, 2030))
    .find((i) => i.type === 'owners_left');
  assert.ok(insight, `expected a departure insight for ${count} leaver(s)`);
  assert.equal(
    (insight.relatedOwners?.length ?? 0) + 1,
    leaving.length,
    'every departing owner is accounted for'
  );
  return insight.descriptionVariants ?? [];
}

test('a single departure names the owner, the finish and the year', () => {
  const variants = departureVariants(1);
  assert.equal(variants.length, 2, 'the named line and the bare line');
  assert.match(variants[0]!, /has left the league after finishing \d+\w\w in \d{4}\./);
});

test('the positional form appears at TWO and nowhere else', () => {
  // "they finished 14th and 5th" makes the reader map names to placements by
  // position. That is readable with one "and" and collapses at three.
  const positional = /they finished \d+\w\w and \d+\w\w/;
  assert.ok(
    departureVariants(2).some((v) => positional.test(v)),
    'two leavers get it'
  );
  for (const count of [1, 3, 4]) {
    assert.ok(
      !departureVariants(count).some((v) => positional.test(v)),
      `${count} leavers must not`
    );
  }
});

test('placements are dropped past the cap', () => {
  // Five names with five ordinals is a table, not a sentence.
  const capped = departureVariants(4);
  for (const variant of capped) {
    assert.doesNotMatch(variant, /\(\d+\w\w\)/, `a placement list survived: ${variant}`);
  }
  assert.ok(
    departureVariants(3).some((v) => /\(\d+\w\w\)/.test(v)),
    'three still carries them'
  );
});

test('no copy uses a gendered pronoun', () => {
  // The generator cannot know anyone's pronouns. Verified across every arity and
  // every event type rather than by reading.
  const roster = ['A', 'B', 'C', 'D', 'E'];
  const context = contextFor(
    [archive(2027, roster, roster), archive(2029, ['A', 'B', 'C'], ['A', 'B', 'C'])],
    ['A', 'B', 'D', 'NEW']
  );
  const produced = membershipGenerator.generate(context);
  assert.ok(produced.length >= 3, `expected joined, returned and left; got ${produced.length}`);
  for (const insight of produced) {
    for (const variant of insight.descriptionVariants ?? []) {
      assert.doesNotMatch(variant, /\b(he|she|his|her|him|hers|himself|herself)\b/i, variant);
    }
  }
});

test('the count word opens a sentence capitalised', () => {
  const withCount = departureVariants(3).find((v) => /owners are out/.test(v));
  assert.ok(withCount, 'the parenthetical form exists at three');
  assert.match(withCount, /^[A-Z]/, `sentence starts lowercase: ${withCount}`);
});

// ---------------------------------------------------------------------------
// The rule the owner set: nothing about any real league is written down.
// ---------------------------------------------------------------------------

test('no owner name or season is hardcoded anywhere in this feature', () => {
  // "I did not hardcode anything" is a claim, and claims of mine have been wrong
  // today. This enforces it: if someone drops a name in to make a demo look
  // right, or pins a year to make an example render, the suite fails.
  const files = ['../membershipHistory.ts', '../generators/membership.ts'];
  let scanned = 0;

  for (const relative of files) {
    const src = readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
    scanned += 1;
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // A four-digit year in CODE would mean a season was pinned. Template slots
    // interpolate `${...}` instead, so none should appear.
    assert.doesNotMatch(code, /\b(19|20)\d{2}\b/, `a season literal in ${relative}`);

    // Every string literal must be copy or a key — never a league member. Owner
    // names in this league are capitalised words, so any capitalised bare word
    // inside a template's static text would be suspect; instead assert the
    // narrower, checkable thing: no literal equals a known-name shape used as a
    // comparison.
    assert.doesNotMatch(
      code,
      /owner\s*===\s*'[A-Z]/,
      `an owner name compared as a literal in ${relative}`
    );
  }

  assert.equal(scanned, files.length, 'both files must actually be read');

  // Anti-vacuity: the detectors must fire on the thing they are looking for.
  assert.match('const year = 2026;'.replace(/\/\/.*$/gm, ''), /\b(19|20)\d{2}\b/);
  assert.match("if (owner === 'Schmitt') {", /owner\s*===\s*'[A-Z]/);
});

// ---------------------------------------------------------------------------
// Completeness — the gate that "known" did not provide.
// ---------------------------------------------------------------------------

/**
 * Production path for the completeness gate.
 *
 * The gate lives in `shouldSuppressGenerator`, not inside `generate`, so a test
 * calling the generator directly cannot see it — and calling it directly is
 * exactly how the first version of these tests passed while `?bypassSuppression=1`
 * was silently unable to explain an empty feed. `generateRawInsights` is the
 * function production calls.
 */
function servedMembership(context: InsightContext, bypassSuppression = false): Insight[] {
  return generateRawInsights(context, { bypassSuppression }).filter((i) =>
    i.id.startsWith('membership-')
  );
}

/** A context whose member list omits half the league and has no completion evidence. */
function midSetupContext(roster: string[], entered: string[]): InsightContext {
  return {
    ...contextFor([archive(2029, roster, roster)], entered),
    preseasonSetupComplete: false,
    membershipCompleteness: {
      complete: false,
      evidence: 'roster-not-final' as const,
      unlistedRosterOwners: [],
    },
  } as unknown as InsightContext;
}

test('a half-entered owner list publishes NOTHING', () => {
  // THE finding, reproduced. `membershipIsKnown` is satisfied at two names, so
  // while a commissioner is still typing the list everyone not yet entered is
  // absent from `leagueMembers` and computed as departed. Before the gate, an
  // eight-owner league with two names entered produced a top-slot card naming six
  // real people as gone.
  const roster = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  assert.deepEqual(servedMembership(midSetupContext(roster, ['A', 'B'])), []);

  // POSITIVE CONTROL: the identical fixture WITH completion evidence reports, so
  // the gate is rejecting incompleteness rather than the fixture.
  const finished = servedMembership(contextFor([archive(2029, roster, roster)], ['A', 'B']));
  assert.ok(finished.length > 0, 'a complete list still reports');

  // And the suppression is VISIBLE to diagnostics, which is why the gate sits in
  // `shouldSuppressGenerator` rather than inside `generate`.
  assert.ok(
    servedMembership(midSetupContext(roster, ['A', 'B']), true).length > 0,
    'bypassSuppression must expose what production withheld'
  );
});

test('THE TRANSITION does not launder an unfinished list into the season', () => {
  // The P1 both reviewers found. `setupComplete` exists only on the preseason
  // variant of `LeagueStatus`, and `completeSeasonTransition` advances a league on
  // state and year alone — it never consults the flag. So an unfinished league is
  // carried into `early_season` with the field DELETED, and a gate written as
  // `lifecycleState === 'preseason' && !preseasonSetupComplete` stops applying
  // there. The first version of this feature served the six-owners-departed card
  // in season instead of preseason: relocated, not closed.
  const roster = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const transitioned = {
    ...midSetupContext(roster, ['A', 'B']),
    lifecycleState: 'early_season',
  } as unknown as InsightContext;

  assert.deepEqual(
    servedMembership(transitioned),
    [],
    'an unfinished list must not become trustworthy by crossing kickoff'
  );

  // POSITIVE CONTROL: an in-season league whose list IS corroborated reports. The
  // gate must not simply silence the whole season, which is the failure mode a
  // lifecycle-shaped fix would have.
  const healthy = {
    ...contextFor([archive(2029, roster, roster)], ['A', 'B']),
    lifecycleState: 'early_season',
  } as unknown as InsightContext;
  assert.ok(servedMembership(healthy).length > 0);
});

test('several returners are GROUPED into one insight', () => {
  // Emitting one each broke the rule stated in this generator's own comments and
  // did it at the highest priority score in the engine — four returners would
  // have taken four of the Overview's five slots.
  const archives = [
    archive(2027, ['A', 'B', 'C', 'D', 'E'], ['A', 'B', 'C', 'D', 'E']),
    archive(2029, ['A'], ['A']),
  ];
  const produced = membershipGenerator.generate(contextFor(archives, ['A', 'B', 'C', 'D']));
  const returns = produced.filter((i) => i.type === 'owner_returned');

  assert.equal(returns.length, 1, `three returners must be one insight, got ${returns.length}`);
  assert.equal((returns[0]?.relatedOwners?.length ?? 0) + 1, 3, 'and all three are named');

  // A SINGLE returner keeps the richer copy that names the year they last played.
  const one = membershipGenerator
    .generate(contextFor(archives, ['A', 'B']))
    .find((i) => i.type === 'owner_returned');
  assert.match(one!.description, /last appeared in \d{4}/);
});

test('a DRIFTED name produces silence, in every shape drift can take', () => {
  // Owner identity is a raw string and nothing folds case, so a commissioner
  // re-typing a name made this generator assert both "bee joins the league" and
  // "Bee has left the league" in one feed.
  //
  // Detected once over every name compared, and DROPPED — not merged. Merging by
  // normalized name resolved the drift but also collapsed two genuinely distinct
  // owners: `cleanOwnerNames` trims without folding case precisely so a league may
  // hold both `Mike` and `mike`, and AGENTS.md invariant 11 records canonical
  // owner identity as deferred. Deciding that deferral inside a content feature is
  // not this module's call, and merging can attach one owner's placement to the
  // other. Refusing to speak about a collision decides nothing.
  const lastSeason = [archive(2029, ['A', 'Bee'], ['A', 'Bee'])];

  // 1. Drifted CONTINUING member: neither joined nor left.
  assert.deepEqual(history(lastSeason, ['A', 'bee']), []);

  // 2. Drifted RETURNER — the shape the first version of this rule missed. It
  //    only examined the joined∩left overlap, and a returner is absent from last
  //    season's roster, so the re-typed name had nothing to collide with there:
  //    "alice joins the league — no history to hide behind" was served beside a
  //    history page showing two prior seasons.
  assert.deepEqual(
    history(
      [archive(2028, ['A', 'Alice'], ['A', 'Alice']), archive(2029, ['A'], ['A'])],
      ['A', 'alice']
    ),
    []
  );

  // 3. Whitespace drift, the other half of what a human re-typing produces.
  assert.deepEqual(history([archive(2029, ['A', 'Van  Dyke'], ['A'])], ['A', 'Van Dyke']), []);

  // 4. Two GENUINELY distinct owners the app cannot tell apart are equally
  //    unanswerable, and are equally left alone — no event, and no merged
  //    placement attributed from one to the other.
  const bothSpellings = history(
    [archive(2029, ['A', 'Mike', 'mike'], ['A', 'Mike', 'mike'])],
    ['A', 'Mike', 'mike']
  );
  assert.deepEqual(bothSpellings, []);

  // POSITIVE CONTROL: a genuinely different name still produces both events, so
  // drift detection is not swallowing real changes.
  assert.deepEqual(
    history(lastSeason, ['A', 'Cee'])
      .map((e) => e.kind)
      .sort(),
    ['joined', 'left']
  );
});

test('an EMPTY newest archive announces nobody', () => {
  // `buildSeasonArchive` defaults `ownersCsvText` to '' when the owners record is
  // missing, and `finalStandings` then derives to []. Such an archive exists for
  // exactly the right year and carries no membership at all — so every current
  // member had no history and the whole league was announced as joining. The
  // emptiest possible input produced the loudest possible claim.
  const roster = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  assert.deepEqual(history([archive(2029, [], [])], roster), []);

  // POSITIVE CONTROL: the same year with owners in it does derive events.
  assert.notDeepEqual(history([archive(2029, ['A', 'Z'], ['A', 'Z'])], roster), []);
});

test('an archive gap stops the derivation rather than re-announcing old news', () => {
  // The newest archive must BE last season. Otherwise settled events resurface as
  // this year's news, and an owner whose only season is unarchived is announced as
  // brand new.
  const archives = [archive(2027, ['A', 'B'], ['A', 'B'])];
  assert.deepEqual(history(archives, ['A'], 2030), [], 'a three-year gap says nothing');
  assert.notDeepEqual(history(archives, ['A'], 2028), [], 'and the adjacent year does');
});

test('a departure count never exceeds the names printed', () => {
  // "Two owners are out: C (3rd)." — the count came from the full list while the
  // sentence listed only the placed names, and this was the DEFAULT description.
  const roster = ['A', 'B', 'C', 'D'];
  // C and D depart; D is on the roster but absent from the standings table.
  const withUnranked = archive(2029, roster, ['A', 'B', 'C']);
  const insight = membershipGenerator
    .generate(contextFor([withUnranked], ['A', 'B']))
    .find((i) => i.type === 'owners_left');

  assert.ok(insight);
  for (const variant of insight.descriptionVariants ?? []) {
    const claimed = /^(One|Two|Three|Four|Five|Six)\b/.exec(variant);
    if (!claimed) continue;
    const listed = (variant.match(/\(\d+\w\w\)/g) ?? []).length;
    const word = claimed[1]!.toLowerCase();
    const expected = ['one', 'two', 'three', 'four', 'five', 'six'].indexOf(word) + 1;
    assert.equal(listed, expected, `count says ${word} but ${listed} named: ${variant}`);
  }
});

test('variants are never duplicated', () => {
  // A single unranked departure emitted the bare form twice, and the test
  // asserting `length === 2` passed on two copies of one string.
  const insight = membershipGenerator
    .generate(contextFor([archive(2029, ['A', 'B', 'C'], ['A', 'B'])], ['A', 'B']))
    .find((i) => i.type === 'owners_left');
  const variants = insight?.descriptionVariants ?? [];
  assert.equal(new Set(variants).size, variants.length, `duplicates: ${variants.join(' | ')}`);
});

test('a "best finish" needs more than one RANKED season to be a best', () => {
  // Counting seasons rather than RANKED seasons admitted a returner with two
  // prior seasons of which only one reached the standings table. `ranked.reduce`
  // then returned that single finish as their "best" — and a 2nd of 2 was
  // welcomed back as a podium when it was last place.
  const archives = [
    // B is on the 2027 roster but absent from its standings table.
    archive(2027, ['A', 'B'], ['A']),
    // B is ranked 2nd of 2 in 2028 — their only ranked season.
    archive(2028, ['A', 'B'], ['A', 'B']),
    archive(2029, ['A'], ['A']),
  ];
  const returned = history(archives, ['A', 'B']).find((e) => e.kind === 'returned');
  assert.ok(returned && returned.kind === 'returned');
  assert.equal(returned.seasonsAway, 1);
  assert.equal(
    returned.bestSeason,
    null,
    'one ranked season is not a best finish, however many seasons were played'
  );

  // And the copy must not claim one.
  const insight = membershipGenerator
    .generate(contextFor(archives, ['A', 'B']))
    .find((i) => i.type === 'owner_returned');
  for (const variant of [insight!.description, ...(insight!.descriptionVariants ?? [])]) {
    assert.doesNotMatch(variant, /best finish/, variant);
  }

  // POSITIVE CONTROL: with TWO ranked seasons the best-finish copy does appear,
  // and names the better of the two rather than the more recent.
  const twoRanked = [
    archive(2027, ['A', 'B'], ['B', 'A']),
    archive(2028, ['A', 'B'], ['A', 'B']),
    archive(2029, ['A'], ['A']),
  ];
  const best = history(twoRanked, ['A', 'B']).find((e) => e.kind === 'returned');
  assert.ok(best && best.kind === 'returned');
  assert.equal(best.bestSeason?.year, 2027, 'the 1st-place season, not the most recent');
  assert.ok(
    membershipGenerator
      .generate(contextFor(twoRanked, ['A', 'B']))
      .find((i) => i.type === 'owner_returned')
      ?.descriptionVariants?.some((v) => /best finish was 1st in 2027/.test(v))
  );
});

test('two owners the app cannot tell apart are kept SEPARATE, not merged', () => {
  // Codex's finding, pinned on the data structure rather than on the copy —
  // because the events for an ambiguous identity are suppressed, so a merge is
  // invisible there and a test written against the copy passes either way.
  //
  // `cleanOwnerNames` trims without folding case, deliberately, so a league may
  // hold both `Mike` and `mike`; AGENTS.md invariant 11 records a canonical
  // owner-identity mapping as DEFERRED. An earlier version of this module keyed
  // every map by the normalized name, which decided that deferral here and could
  // attach one owner's placement to the other.
  const built = buildMembershipHistory({
    archives: [archive(2029, ['Mike', 'mike'], ['Mike', 'mike'])],
    members: new Set(['Mike', 'mike']),
    parseCsv: parseOwnersCsv,
    currentYear: 2030,
  });

  assert.equal(built.seasonsByOwner.size, 2, 'two owners, two histories');
  assert.equal(built.seasonsByOwner.get('Mike')?.[0]?.placement, 1);
  assert.equal(
    built.seasonsByOwner.get('mike')?.[0]?.placement,
    2,
    'its OWN placement, not the other one’s'
  );
});

test('a member list holding BOTH spellings says nothing about either', () => {
  // The shape where the returned-side ambiguity check bites: `Alice` matches the
  // archive exactly and would return, while `alice` has no history and would
  // join — one owner announced as two different events in one feed.
  const events = history(
    [archive(2028, ['A', 'Alice'], ['A', 'Alice']), archive(2029, ['A'], ['A'])],
    ['A', 'Alice', 'alice']
  );
  assert.deepEqual(events, [], `expected silence, got ${JSON.stringify(events)}`);

  // POSITIVE CONTROL: with only the unambiguous spelling, the return IS reported.
  const single = history(
    [archive(2028, ['A', 'Alice'], ['A', 'Alice']), archive(2029, ['A'], ['A'])],
    ['A', 'Alice']
  );
  assert.deepEqual(
    single.map((e) => e.kind),
    ['returned']
  );
});
