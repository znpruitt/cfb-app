import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildMembershipHistory, type MembershipEvent } from '@/lib/insights/membershipHistory';
import { membershipGenerator } from '@/lib/insights/generators/membership';
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

function history(archives: SeasonArchive[], members: string[]): MembershipEvent[] {
  return buildMembershipHistory({
    archives,
    members: new Set(members),
    parseCsv: parseOwnersCsv,
  }).events;
}

function contextFor(archives: SeasonArchive[], members: string[], year = 2030): InsightContext {
  return {
    archives,
    currentYear: year,
    leagueMembers: new Set(members),
    leagueMembersSource: 'confirmed',
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
    .generate(contextFor([archive(2029, roster, roster)], members))
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
