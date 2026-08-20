import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { addLeague } from '@/lib/leagueRegistry';
import {
  setAppState,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '@/lib/server/appStateStore';
import { buildLeagueInsightContext } from '@/lib/insights/loadInsights';
import { generateRawInsights } from '@/lib/insights/engine';
import '@/lib/insights/generators';

// ---------------------------------------------------------------------------
// INSIGHTS-033 — the sites the standing guards could not reach.
//
// `preseasonGates.test.ts` builds a PRESEASON context, and `historical` and
// `rivalry` do not support preseason — `generateRawInsights` filters the whole
// generator out — so widening its `OPENED` set for `drought` or
// `dominance_streak` would be vacuous. `leagueRecords.test.ts` builds an
// offseason one and reaches `drought`, but its fixture produces no dominance
// streak and no qualifying even rivalry.
//
// This file owns fixtures engineered to REACH the claims: a three-meeting
// streak between two members, an even rivalry whose record belongs to a
// departed pair, and a season whose biggest climb belongs to a departed owner.
// Each test asserts the insight EXISTS before asserting its wording, because a
// generator that returns null would otherwise satisfy every "must not say"
// assertion here.
// ---------------------------------------------------------------------------

const SLUG = 'participation';
const YEAR = 2026;

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

const TEAM_BY_OWNER: Record<string, string> = {
  Alice: 'Clemson',
  Bob: 'Alabama',
  Carol: 'Ohio State',
  Dave: 'Georgia',
  Erin: 'Texas',
  Frank: 'Oregon',
  Gina: 'Michigan',
  Zed: 'Penn State',
};

type Meeting = { game: Record<string, unknown>; key: string; score: Record<string, unknown> };

/** A head-to-head result in the shape `collectHeadToHead` reads. */
function meeting(year: number, winner: string, loser: string): Meeting {
  const key = `${year}-${winner}-${loser}`;
  return {
    key,
    game: {
      key,
      week: 5,
      date: `${year}-10-01`,
      csvHome: TEAM_BY_OWNER[winner],
      csvAway: TEAM_BY_OWNER[loser],
      canHome: TEAM_BY_OWNER[winner],
      canAway: TEAM_BY_OWNER[loser],
      status: 'final',
    },
    score: { status: 'final', home: { score: 31 }, away: { score: 17 } },
  };
}

const POINTS_BY_RANK = [900, 800, 700, 600, 500, 400, 300];
const WINS_BY_RANK = [80, 75, 70, 65, 60, 55, 50];

async function seedArchive(year: number, order: string[], meetings: Meeting[]): Promise<void> {
  const csv = 'team,owner\n' + order.map((o) => `${TEAM_BY_OWNER[o]},${o}`).join('\n');
  await setAppState(`standings-archive:${SLUG}`, String(year), {
    leagueSlug: SLUG,
    year,
    archivedAt: `${year + 1}-01-01T00:00:00.000Z`,
    ownerRosterSnapshot: csv,
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: order.map((owner, rank) => {
      const wins = WINS_BY_RANK[rank]!;
      const losses = 110 - wins;
      return {
        owner,
        wins,
        losses,
        ties: 0,
        winPct: wins / 110,
        pointsFor: POINTS_BY_RANK[rank]!,
        pointsAgainst: 300,
        pointDifferential: POINTS_BY_RANK[rank]! - 300,
        gamesBack: 0,
        // `MIN_GAMES_GREATEST_SEASON` is 100; a 12-game row disqualifies the
        // season generators and makes assertions about them vacuous.
        finalGames: 110,
      };
    }),
    games: meetings.map((m) => m.game),
    scoresByKey: Object.fromEntries(meetings.map((m) => [m.key, m.score])),
  });
}

async function seedLeague(): Promise<void> {
  await addLeague({
    slug: SLUG,
    displayName: 'Participation League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2020,
    // OFFSEASON — the lifecycle `historical` and `rivalry` actually run in, and
    // the one a league sits in for months after rollover with no new roster
    // named. Preseason cannot reach either generator.
    status: { state: 'offseason' },
  });
}

/**
 * Alice sweeps Bob in the three most recent seasons, so `activeStreak` — which
 * reads from the END of the series — returns 3, exactly `MIN_DOMINANCE_STREAK`.
 * Dave finishes first every year and never appears in the streak, so he is free
 * to be the departed owner.
 */
async function seedDominanceLeague(): Promise<void> {
  await seedLeague();
  const ORDER: Record<number, string[]> = {
    2021: ['Dave', 'Alice', 'Bob', 'Carol'],
    2022: ['Dave', 'Bob', 'Alice', 'Carol'],
    2023: ['Dave', 'Alice', 'Bob', 'Carol'],
    2024: ['Dave', 'Alice', 'Bob', 'Carol'],
    2025: ['Dave', 'Alice', 'Carol', 'Bob'],
  };
  for (const [yearText, order] of Object.entries(ORDER)) {
    const year = Number(yearText);
    // Bob takes the first two, Alice the last three: a three-meeting ACTIVE
    // streak, with an earlier reversal so the streak is not simply the whole
    // series.
    const winner = year <= 2022 ? 'Bob' : 'Alice';
    const loser = winner === 'Bob' ? 'Alice' : 'Bob';
    await seedArchive(year, order, [meeting(year, winner, loser)]);
  }
}

type Card = { type: string; title: string; description: string; statValue?: number };

function find(insights: Card[], type: string): Card {
  const hit = insights.find((i) => i.type === type);
  assert.ok(hit, `the fixture must produce a ${type} insight for this test to mean anything`);
  return hit;
}

async function contextFor(
  confirmed?: string[]
): Promise<Awaited<ReturnType<typeof buildLeagueInsightContext>>> {
  if (confirmed) await setAppState(`preseason-owners:${SLUG}`, String(YEAR), confirmed);
  return buildLeagueInsightContext(SLUG, YEAR, new Date());
}

// ---------------------------------------------------------------------------
// Dominance streak — the claim item 36 recorded and no fixture reached.
// ---------------------------------------------------------------------------

test('dominance streak: with membership CONFIRMED, the active wording is licensed', async () => {
  // The positive control. Without it the guard below could pass because the
  // phrasing vanished everywhere rather than because it is correctly gated.
  await seedDominanceLeague();
  const context = await contextFor(['Alice', 'Bob', 'Carol']);
  assert.equal(context.leagueMembersSource, 'confirmed');

  const dominance = find(generateRawInsights(context), 'dominance_streak');
  assert.equal(dominance.title, 'Active dominance streak');
  assert.match(dominance.description, /pattern is emerging/);
});

test('dominance streak: with membership UNKNOWN, nothing is called active', async () => {
  await seedDominanceLeague();
  const context = await contextFor();
  assert.equal(
    context.leagueMembersSource,
    'previous-roster',
    'the fixture must actually reach the unknown-membership state'
  );

  const dominance = find(generateRawInsights(context), 'dominance_streak');
  // The TITLE and the DESCRIPTION. INSIGHTS-023 gated the body and left
  // "Active dominance streak" rendering one line above it.
  assert.equal(dominance.title, 'Dominance streak');
  assert.doesNotMatch(
    `${dominance.title} ${dominance.description}`,
    /\bactive\b|pattern is emerging|rent-free|subscription/i,
    `unlicensed participation claim: "${dominance.title}" / ${dominance.description}`
  );
  // And the fact survives — the owner's standing ruling is that a card states
  // what is true rather than going dark.
  assert.match(dominance.description, /has won 3 straight against/);
});

// ---------------------------------------------------------------------------
// Title drought — the claim that reaches the widest audience, because
// `historical` runs from early season through the whole offseason.
// ---------------------------------------------------------------------------

/**
 * Five seasons in which EVERY owner has won at least one title, so nobody takes
 * the never-won branch and the longest drought belongs to exactly one person:
 * Alice, champion in 2021 and nothing since. That is the branch carrying "still
 * waiting for another ring" — a sentence about someone who may not be in the
 * league at all.
 */
async function seedDroughtLeague(): Promise<void> {
  await seedLeague();
  const ORDER: Record<number, string[]> = {
    2021: ['Alice', 'Bob', 'Carol', 'Dave'],
    2022: ['Dave', 'Bob', 'Carol', 'Alice'],
    2023: ['Dave', 'Carol', 'Bob', 'Alice'],
    2024: ['Carol', 'Bob', 'Dave', 'Alice'],
    2025: ['Bob', 'Carol', 'Dave', 'Alice'],
  };
  for (const [yearText, order] of Object.entries(ORDER)) {
    await seedArchive(Number(yearText), order, []);
  }
}

test('drought: with membership CONFIRMED, the active wording is licensed', async () => {
  await seedDroughtLeague();
  const context = await contextFor(['Alice', 'Bob', 'Carol']);
  assert.equal(context.leagueMembersSource, 'confirmed');

  const drought = find(generateRawInsights(context), 'drought');
  assert.equal(drought.title, 'Longest active title drought');
  assert.match(
    drought.description,
    /the longest active drought in the league\. Still waiting for another ring\.$/
  );
});

test('drought: with membership UNKNOWN, neither the title nor the body claims a runner', async () => {
  await seedDroughtLeague();
  const context = await contextFor();
  assert.equal(
    context.leagueMembersSource,
    'previous-roster',
    'the fixture must actually reach the unknown-membership state'
  );

  const drought = find(generateRawInsights(context), 'drought');
  assert.equal(drought.title, 'Longest title drought');
  assert.doesNotMatch(
    `${drought.title} ${drought.description}`,
    /\bactive\b|still waiting|the longest .* in the league/i,
    `unlicensed participation claim: "${drought.title}" / ${drought.description}`
  );
  // The SPAN survives, and the record claim with it — Alice genuinely holds the
  // longest drought across the whole archive population here, so "on record" is
  // measured rather than assumed. What is gone is the word "active" and the
  // "still waiting for another ring" clause, both of which assert she is playing.
  assert.match(
    drought.description,
    /hasn't won a title in 4 seasons — the longest title drought on record\.$/
  );
});

test('drought: a season SAT OUT is not counted against the owner', async () => {
  // INSIGHTS-033 changed the count from calendar years to seasons PLAYED since
  // the last title. Alice won 2021, played 2022, sat out 2023 and 2024, and came
  // back in 2025 — two seasons of drought, not four. Calendar counting charged
  // her for two seasons she was not in, and the owner confirmed (2026-08-19)
  // that owners here do sit a year out and return.
  //
  // It is also what makes the record population sound: measured in calendar
  // years, an owner who left years ago keeps accruing drought forever and holds
  // the record by default.
  await seedLeague();
  const ORDER: Record<number, string[]> = {
    2021: ['Alice', 'Bob', 'Carol'],
    2022: ['Bob', 'Carol', 'Alice'],
    2023: ['Carol', 'Bob'],
    2024: ['Bob', 'Carol'],
    2025: ['Carol', 'Bob', 'Alice'],
  };
  for (const [yearText, order] of Object.entries(ORDER)) {
    await seedArchive(Number(yearText), order, []);
  }
  const context = await contextFor(['Alice', 'Bob', 'Carol']);

  const drought = find(generateRawInsights(context), 'drought');
  assert.match(
    drought.description,
    /Alice hasn't won a title in 2 seasons/,
    `the two seasons Alice sat out were counted against her: ${drought.description}`
  );
  assert.equal(drought.statValue, 2);
});

test('drought: the longest is measured over EVERY owner, not just members', async () => {
  // Zed plays all five seasons and never wins — a five-season drought — while
  // Alice, the longest-suffering MEMBER, last won in 2021 and has gone four.
  // Pre-conversion the entry loop iterated `activeOwners`, so Zed was invisible
  // and the card called Alice's the longest, under a title that said so twice.
  await seedLeague();
  const ORDER: Record<number, string[]> = {
    2021: ['Alice', 'Bob', 'Carol', 'Zed'],
    2022: ['Bob', 'Carol', 'Zed', 'Alice'],
    2023: ['Carol', 'Bob', 'Zed', 'Alice'],
    2024: ['Bob', 'Carol', 'Zed', 'Alice'],
    2025: ['Carol', 'Bob', 'Zed', 'Alice'],
  };
  for (const [yearText, order] of Object.entries(ORDER)) {
    await seedArchive(Number(yearText), order, []);
  }
  const context = await contextFor(['Alice', 'Bob', 'Carol']);
  assert.ok(!context.leagueMembers.has('Zed'), 'Zed must be outside the membership');

  const drought = find(generateRawInsights(context), 'drought');
  // The TITLE drops "Longest" entirely — it is the half the first round left in
  // place while removing only "active", which WIDENED a member-only claim into
  // a league-wide one.
  assert.equal(drought.title, 'Title drought');
  // OWNER RULING: say both, active first.
  assert.match(drought.description, /the longest among active owners\./);
  assert.match(drought.description, /Zed's 5 seasons is the longest on record\.$/);
});

// ---------------------------------------------------------------------------
// Even rivalry — a record measured over member pairs only.
// ---------------------------------------------------------------------------

/**
 * Dave plays 2018–2023 and is gone by 2024, so he is outside the membership in
 * BOTH states — the confirmed list and the previous-roster fallback (2025) each
 * exclude him. The member set is therefore identical either way and only the
 * SOURCE differs, which isolates the membership gate from every other variable.
 *
 * Carol and Dave finish 3–3 over six meetings; Alice and Bob finish 4–3 over
 * seven. The departed pair is CLOSER (dead level) while the member pair has met
 * more often — the exact shape that ranking by meeting count got backwards, and
 * that the first round's fixture could not produce because it ranked the same
 * wrong way.
 */
async function seedEvenRivalryLeague(): Promise<void> {
  await seedLeague();
  for (let year = 2018; year <= 2025; year += 1) {
    const withDave = year <= 2023;
    const order = withDave ? ['Alice', 'Bob', 'Carol', 'Dave'] : ['Alice', 'Bob', 'Carol'];
    const meetings: Meeting[] = [];
    // Carol–Dave, six meetings, three apiece.
    if (withDave) {
      meetings.push(year <= 2020 ? meeting(year, 'Carol', 'Dave') : meeting(year, 'Dave', 'Carol'));
    }
    // Alice–Bob, seven meetings, Alice four.
    if (year <= 2024) {
      meetings.push(year <= 2021 ? meeting(year, 'Alice', 'Bob') : meeting(year, 'Bob', 'Alice'));
    }
    await seedArchive(year, order, meetings);
  }
}

test('even rivalry: CLOSEST is the win difference, not the meeting count', async () => {
  await seedEvenRivalryLeague();
  const context = await contextFor(['Alice', 'Bob', 'Carol']);
  assert.equal(context.leagueMembersSource, 'confirmed');
  assert.ok(!context.leagueMembers.has('Dave'), 'and Dave must be outside the membership');

  const even = find(generateRawInsights(context), 'even_rivalry');
  // Pre-fix this ranked by meetings, so the member pair at 4–3 over seven
  // outranked a dead-even pair over six and was called "the closest rivalry in
  // the league". Both reviewers found it; item 33 recorded it first.
  assert.equal(even.title, 'An even rivalry');
  assert.match(
    even.description,
    /Carol and Dave at 3–3 over 6 meetings is the closest on record\.$/,
    `the closer pair must hold the record: ${even.description}`
  );
  // OWNER RULING: say both, active first. The member pair keeps a standing of
  // its own rather than being reduced to a footnote on someone else's record.
  assert.match(even.description, /the closest rivalry among active owners\./);
});

test('even rivalry: with membership UNKNOWN, the active standing is withheld', async () => {
  // The other direction of the same gate. `/code-review` mutation-proved the
  // first round's `evenKnown` was dead — flipping it either way left all 131
  // tests green — because the fixture only reached a branch that never read it.
  // The member SET is identical here; only the source differs.
  await seedEvenRivalryLeague();
  const context = await contextFor();
  assert.equal(context.leagueMembersSource, 'previous-roster');
  assert.ok(!context.leagueMembers.has('Dave'), 'the member set must be unchanged');

  const even = find(generateRawInsights(context), 'even_rivalry');
  assert.doesNotMatch(
    `${even.title} ${even.description}`,
    /active owners?|closest rivalry in the league/i,
    `unlicensed participation claim: ${even.description}`
  );
  // The record citation still lands — withholding the standing must not
  // withhold the fact.
  assert.match(
    even.description,
    /Carol and Dave at 3–3 over 6 meetings is the closest on record\.$/
  );
});

// ---------------------------------------------------------------------------
// Season-to-season movement — reconstructed in INSIGHTS-033. The model lives in
// `docs/architecture/insight-movement-model.md`.
//
// A completed season's biggest mover is a fact about that season, so these cards
// name whoever made the move and state the year. They do not filter by
// membership, which is why they are exempt by id from the departed-owner wiring
// rule — an exemption that is only sound while the year is stated.
// ---------------------------------------------------------------------------

/** Dave leaves after 2025; his 2025 move is the season's biggest. */
async function seedMovementLeague(): Promise<void> {
  await seedLeague();
  await seedArchive(2023, ['Bob', 'Carol', 'Erin', 'Frank', 'Alice', 'Dave'], []);
  await seedArchive(2024, ['Bob', 'Carol', 'Erin', 'Frank', 'Alice', 'Dave'], []);
  await seedArchive(2025, ['Dave', 'Alice', 'Bob', 'Carol', 'Erin', 'Frank'], []);
}

test('season movement: the biggest mover is named even after leaving', async () => {
  await seedMovementLeague();
  const context = await contextFor(['Alice', 'Bob', 'Carol', 'Erin', 'Frank']);
  assert.ok(!context.leagueMembers.has('Dave'), 'Dave must be outside the membership');

  const insights = generateRawInsights(context);
  const season = insights.find((i) => i.id.startsWith(`season-swing-2025-`));
  assert.ok(season, 'the season card must fire');
  // The subject is the actual biggest mover. The previous model anchored the
  // card on a member and demoted the real one to a citation, which took four
  // passes to get wrong in four different ways.
  assert.match(season.description, /^Dave climbed from 6th to 1st between 2024 and 2025/);
  assert.match(season.description, /the biggest move of the 2025 season\.$/);
  // The YEAR is in the headline too — the exemption that lets this card name a
  // departed owner holds only while the copy says which season it describes.
  assert.equal(season.title, 'Biggest move of 2025');
});

test('season movement: the all-time record is its own card, with its own years', async () => {
  // Erin climbs five places in 2024; the biggest 2025 move is Alice's three. Two
  // distinct facts, so two cards.
  await seedLeague();
  await seedArchive(2023, ['Bob', 'Carol', 'Alice', 'Frank', 'Gina', 'Erin'], []);
  await seedArchive(2024, ['Erin', 'Bob', 'Carol', 'Alice', 'Frank', 'Gina'], []);
  await seedArchive(2025, ['Alice', 'Erin', 'Bob', 'Carol', 'Frank', 'Gina'], []);
  const context = await contextFor(['Alice', 'Bob', 'Carol', 'Erin', 'Frank', 'Gina']);

  const insights = generateRawInsights(context);
  const season = insights.find((i) => i.id.startsWith('season-swing-2025-'));
  const record = insights.find((i) => i.id.startsWith('season-swing-record-'));
  assert.ok(season, 'the season card must fire');
  assert.ok(record, 'and the record card must fire separately');

  // The season card claims only the season. Attaching the all-time standing to
  // this climb is the P1 both reviewers found in the previous round.
  assert.doesNotMatch(
    season.description,
    /league history/,
    `the season card claimed the all-time record: ${season.description}`
  );
  assert.match(record.description, /Erin's 5 places between 2023 and 2024/);
  assert.match(record.description, /is the biggest single-season move in league history\.$/);
});

test('season movement: the record card is withheld when it repeats the season card', async () => {
  // Here the biggest move ever IS this season's, so the two cards would carry
  // one sentence.
  await seedMovementLeague();
  const context = await contextFor(['Alice', 'Bob', 'Carol', 'Erin', 'Frank']);

  const insights = generateRawInsights(context);
  assert.ok(
    insights.some((i) => i.id.startsWith('season-swing-2025-')),
    'the season card must still fire'
  );
  assert.equal(
    insights.filter((i) => i.id.startsWith('season-swing-record-')).length,
    0,
    'the record card must not repeat it'
  );
});

test('season movement: a shrinking roster is not a climb', async () => {
  // `/code-review` reproduced this and I confirmed it by running it: six owners
  // become three, and the three who stayed each "climbed 3 places" without
  // playing differently — which the record card would then enshrine as the
  // biggest move in league history, permanently. Ranking within the owners
  // present in BOTH seasons removes it by construction.
  await seedLeague();
  await seedArchive(2024, ['Erin', 'Frank', 'Gina', 'Alice', 'Bob', 'Carol'], []);
  await seedArchive(2025, ['Alice', 'Bob', 'Carol'], []);
  const context = await contextFor(['Alice', 'Bob', 'Carol']);

  const swings = generateRawInsights(context).filter((i) => i.id.startsWith('season-swing'));
  assert.deepEqual(
    swings.map((i) => i.description),
    [],
    `a roster contraction was reported as a climb: ${swings.map((i) => i.description).join(' | ')}`
  );
});

test('season movement: the record card names its season in the TITLE', async () => {
  // The condition the departed-owner exemption rests on. Codex found the title a
  // bare constant while AGENTS.md invariant 5 — amended in the same commit —
  // required the year.
  await seedLeague();
  await seedArchive(2023, ['Bob', 'Carol', 'Alice', 'Frank', 'Gina', 'Erin'], []);
  await seedArchive(2024, ['Erin', 'Bob', 'Carol', 'Alice', 'Frank', 'Gina'], []);
  await seedArchive(2025, ['Alice', 'Erin', 'Bob', 'Carol', 'Frank', 'Gina'], []);
  const context = await contextFor(['Alice', 'Bob', 'Carol', 'Erin', 'Frank', 'Gina']);

  const record = generateRawInsights(context).find((i) => i.id.startsWith('season-swing-record-'));
  assert.ok(record, 'the record card must fire');
  assert.equal(record.title, 'Biggest single-season move on record — 2024');
});

test('season movement: one owner holding the record twice is named once', async () => {
  // `recordLeaders` is a list of CLIMBS. Erin sets the same mark in two separate
  // season pairs, which produced `season-swing-record-erin-erin` and an `owners`
  // array naming her twice.
  await seedLeague();
  await seedArchive(2021, ['Bob', 'Carol', 'Alice', 'Frank', 'Erin'], []);
  await seedArchive(2022, ['Erin', 'Bob', 'Carol', 'Alice', 'Frank'], []);
  await seedArchive(2023, ['Bob', 'Carol', 'Alice', 'Frank', 'Erin'], []);
  await seedArchive(2024, ['Erin', 'Bob', 'Carol', 'Alice', 'Frank'], []);
  await seedArchive(2025, ['Bob', 'Erin', 'Carol', 'Alice', 'Frank'], []);
  const context = await contextFor(['Alice', 'Bob', 'Carol', 'Erin', 'Frank']);

  const record = generateRawInsights(context).find((i) => i.id.startsWith('season-swing-record-'));
  assert.ok(record, 'the record card must fire');
  assert.equal(record.id, 'season-swing-record-erin', 'the id must name her once');
  assert.deepEqual(record.relatedOwners ?? [], [], 'and she is not her own related owner');
});

test('even rivalry: two equally close member pairs are level, not one champion', async () => {
  // `resolveSuperlative` lists only NON-member holders, so two member pairs at
  // the same closeness were invisible and the card crowned whichever one it
  // happened to pick. A regression: before this slice the dead-even sentence
  // carried no superlative at all.
  await seedLeague();
  for (let year = 2019; year <= 2024; year += 1) {
    await seedArchive(
      year,
      ['Alice', 'Bob', 'Carol', 'Erin'],
      [
        year <= 2021 ? meeting(year, 'Alice', 'Bob') : meeting(year, 'Bob', 'Alice'),
        year <= 2021 ? meeting(year, 'Carol', 'Erin') : meeting(year, 'Erin', 'Carol'),
      ]
    );
  }
  const context = await contextFor(['Alice', 'Bob', 'Carol', 'Erin']);

  const even = find(generateRawInsights(context), 'even_rivalry');
  assert.doesNotMatch(
    even.description,
    /the closest rivalry on record\./,
    `sole possession claimed while another pair is exactly as close: ${even.description}`
  );
  assert.match(even.description, /level with Carol and Erin at 3–3 over 6 meetings\.$/);
});
