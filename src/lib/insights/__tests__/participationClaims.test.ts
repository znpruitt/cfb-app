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

const POINTS_BY_RANK = [900, 800, 700, 600, 500, 400];
const WINS_BY_RANK = [80, 75, 70, 65, 60, 55];

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

function find(
  insights: { type: string; title: string; description: string }[],
  type: string
): { type: string; title: string; description: string } {
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
  assert.match(drought.description, /still waiting for another ring/);
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
  // The SPAN survives, and it is stated as a span rather than "N seasons ago" —
  // `longestDrought` counts from the newest ARCHIVE year, so a reader counting
  // back from today would land a year early. INSIGHTS-023 wrote that phrasing
  // and caught it in review.
  assert.match(drought.description, /has gone 4 seasons without a title\.$/);
});

// ---------------------------------------------------------------------------
// Even rivalry — a record measured over member pairs only.
// ---------------------------------------------------------------------------

/**
 * Seven seasons. Dave and Carol meet every year and finish 4–3; Alice and Bob
 * meet six times and finish 3–3. Both pairs are "even" (`EVEN_MAX_WIN_DIFF` is
 * 1), and the record — most meetings — belongs to the pair holding a DEPARTED
 * owner, which the member-only search could never see.
 */
async function seedEvenRivalryLeague(): Promise<void> {
  await seedLeague();
  for (let year = 2019; year <= 2025; year += 1) {
    const order =
      year % 2 === 0 ? ['Dave', 'Alice', 'Bob', 'Carol'] : ['Alice', 'Dave', 'Carol', 'Bob'];
    const meetings: Meeting[] = [
      // Dave–Carol, all seven years: Dave takes four, Carol three.
      year <= 2022 ? meeting(year, 'Dave', 'Carol') : meeting(year, 'Carol', 'Dave'),
    ];
    // Alice–Bob, six years: three apiece.
    if (year >= 2020) {
      meetings.push(year <= 2022 ? meeting(year, 'Alice', 'Bob') : meeting(year, 'Bob', 'Alice'));
    }
    await seedArchive(year, order, meetings);
  }
}

test('even rivalry: the closest series is measured over EVERY pair, not just members', async () => {
  await seedEvenRivalryLeague();
  const context = await contextFor(['Alice', 'Bob', 'Carol']);
  assert.equal(context.leagueMembersSource, 'confirmed');
  assert.ok(!context.leagueMembers.has('Dave'), 'and Dave must be outside the membership');

  const even = find(generateRawInsights(context), 'even_rivalry');
  // Membership is KNOWN here, so this is not the participation gate — it is the
  // population. Pre-fix the copy read "the closest rivalry in the league" about
  // Alice and Bob while Dave and Carol had stayed level a season longer.
  assert.doesNotMatch(
    `${even.title} ${even.description}`,
    /closest rivalry|Most evenly matched/i,
    `a member pair claimed the record while a departed pair held it: ${even.description}`
  );
  assert.match(
    even.description,
    /Carol and Dave at 3–4 over 7 meetings/,
    'the real record pair is named, with its scoreline'
  );
  assert.equal(even.title, 'An even rivalry');
});

// ---------------------------------------------------------------------------
// Biggest year-over-year leap — the season claim had no population at all.
// ---------------------------------------------------------------------------

/**
 * Six owners over three seasons. In 2025 Alice climbs 5th → 2nd (three places,
 * exactly `MIN_IMPROVEMENT_POSITIONS`) and Dave climbs 6th → 1st (five). The
 * all-time comparison already spanned everyone, so Dave's five-place climb
 * pushes the hook off `new_record`; the SEASON claim underneath it was measured
 * over members only and crowned Alice.
 */
async function seedImprovementLeague(): Promise<void> {
  await seedLeague();
  await seedArchive(2023, ['Bob', 'Carol', 'Erin', 'Frank', 'Alice', 'Dave'], []);
  await seedArchive(2024, ['Bob', 'Carol', 'Erin', 'Frank', 'Alice', 'Dave'], []);
  await seedArchive(2025, ['Dave', 'Alice', 'Bob', 'Carol', 'Erin', 'Frank'], []);
}

test("biggest leap: a member does not take the season's climb from a departed owner", async () => {
  await seedImprovementLeague();
  const context = await contextFor(['Alice', 'Bob', 'Carol', 'Erin', 'Frank']);
  assert.equal(context.leagueMembersSource, 'confirmed');
  assert.ok(!context.leagueMembers.has('Dave'), 'and Dave must be outside the membership');

  const improvement = find(generateRawInsights(context), 'improvement');
  assert.match(improvement.description, /Alice jumped from 5 to 2/, 'Alice is still named');
  assert.doesNotMatch(
    improvement.description,
    /the biggest improvement of the season/,
    `a member took the season's biggest climb while a departed owner made a larger one: ${improvement.description}`
  );
  assert.match(improvement.description, /Dave's 5-place climb was the season's biggest/);
});
