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
import { resolveSuperlative } from '@/lib/insights/superlative';
import '@/lib/insights/generators';

// ---------------------------------------------------------------------------
// INSIGHTS-030 — a record is measured against the LEAGUE'S HISTORY; membership
// only decides who may be named.
//
// Five generators collapsed the two, so when the real record holder left, the
// best remaining member was crowned with a claim the archives disprove. The
// owner's ruling (2026-08-16) is to NAME the departed record holder rather than
// narrow the claim or go silent.
//
// The fixture below is one league where a departed owner, Dave, holds every
// record. Each test asserts the claim is not stolen AND that the citation
// appears — a test that only checked for the absence of "league history" would
// pass on an insight that vanished entirely, which is the outcome the owner
// explicitly rejected.
// ---------------------------------------------------------------------------

const SLUG = 'records';
const YEAR = 2026;

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

/**
 * One team per owner, held for every season. Rivalry pairs are resolved through
 * each archive's roster snapshot, so a team that changes hands year to year
 * yields no repeated meetings and the whole generator stays silent.
 */
const TEAM_BY_OWNER: Record<string, string> = {
  Dave: 'Georgia',
  Alice: 'Clemson',
  Bob: 'Alabama',
  Carol: 'Ohio State',
};

/**
 * A head-to-head result for one season, in the shape `collectHeadToHead` reads:
 * a game whose `csvHome`/`csvAway` hit the roster snapshot, plus a final score.
 */
function meeting(
  year: number,
  home: string,
  away: string,
  homeScore: number,
  awayScore: number
): { game: Record<string, unknown>; key: string; score: Record<string, unknown> } {
  const key = `${year}-${home}-${away}`;
  return {
    key,
    game: {
      key,
      week: 5,
      date: `${year}-10-01`,
      csvHome: TEAM_BY_OWNER[home],
      csvAway: TEAM_BY_OWNER[away],
      canHome: TEAM_BY_OWNER[home],
      canAway: TEAM_BY_OWNER[away],
      status: 'final',
    },
    score: {
      status: 'final',
      home: { score: homeScore },
      away: { score: awayScore },
    },
  };
}

type Row = {
  owner: string;
  wins: number;
  losses: number;
  pointsFor: number;
};

async function seedArchive(
  year: number,
  rows: Row[],
  meetings: ReturnType<typeof meeting>[] = []
): Promise<void> {
  const csv =
    'team,owner\n' + rows.map((r) => `${TEAM_BY_OWNER[r.owner] ?? r.owner},${r.owner}`).join('\n');
  await setAppState(`standings-archive:${SLUG}`, String(year), {
    leagueSlug: SLUG,
    year,
    archivedAt: `${year + 1}-01-01T00:00:00.000Z`,
    ownerRosterSnapshot: csv,
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: [...rows]
      .sort((a, b) => b.wins - a.wins)
      .map((r) => ({
        owner: r.owner,
        wins: r.wins,
        losses: r.losses,
        ties: 0,
        winPct: r.wins / (r.wins + r.losses),
        pointsFor: r.pointsFor,
        pointsAgainst: 300,
        pointDifferential: r.pointsFor - 300,
        gamesBack: 0,
        // `MIN_GAMES_GREATEST_SEASON` is 100 — an owner holds several teams, so
        // a season row aggregates ~9 teams x 12 games. A 12-game row silently
        // disqualified the whole generator and made its test vacuous.
        finalGames: r.wins + r.losses,
      })),
    games: meetings.map((m) => m.game),
    scoresByKey: Object.fromEntries(meetings.map((m) => [m.key, m.score])),
  });
}

/**
 * Three seasons in which DAVE is the best at everything — most career points,
 * most titles, best single season — and then leaves. Alice is the best of who
 * remains.
 */
async function seedRecordsLeague(confirmedOwners: string[]): Promise<void> {
  await addLeague({
    slug: SLUG,
    displayName: 'Records League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2023,
    // OFFSEASON, not preseason: all five of these generators are dark in
    // preseason today — which is the gate INSIGHTS-023 opens next, and the
    // reason this fix has to land first. The positive control caught the
    // mis-set fixture rather than reporting a false green.
    status: { state: 'offseason' },
  });

  // FIVE seasons, hand-ordered so that Dave holds every record STRICTLY while a
  // MEMBER still clears each generator's floor. Both matter:
  //   - A member must reach the floor or the generator returns null and the
  //     test asserting on it passes vacuously. `dynasty` needs a member with 2+
  //     titles, so Alice wins two.
  //   - No member may TIE Dave, or the "league record" claim is true and the
  //     sweep cannot tell a stolen claim from an earned one. Alice therefore
  //     misses the top three in 2021, keeping Dave strictly ahead on
  //     consistency, and Dave's 2021 is his standout year on win rate.
  //
  // Points by finish: 1st 900, 2nd 700, 3rd 500, 4th 300.
  //   Dave 4,100 / Alice 3,500 / Bob 2,300 / Carol 2,100
  //   Titles      Dave 3 / Alice 2
  //   Top-3       Dave 5 / Alice 4
  //   Best season Dave .818 (2021) / Alice .727
  const ORDER_BY_YEAR: Record<number, string[]> = {
    2021: ['Dave', 'Bob', 'Carol', 'Alice'],
    2022: ['Dave', 'Alice', 'Bob', 'Carol'],
    2023: ['Dave', 'Alice', 'Carol', 'Bob'],
    2024: ['Alice', 'Dave', 'Bob', 'Carol'],
    2025: ['Alice', 'Dave', 'Carol', 'Bob'],
  };
  const POINTS_BY_RANK = [900, 700, 500, 300];
  const RECORD_BY_RANK = [
    { wins: 80, losses: 30 },
    { wins: 70, losses: 40 },
    { wins: 60, losses: 50 },
    { wins: 50, losses: 60 },
  ];

  for (const [yearText, order] of Object.entries(ORDER_BY_YEAR)) {
    const year = Number(yearText);
    await seedArchive(
      year,
      order.map((owner, rank) => {
        const base = RECORD_BY_RANK[rank]!;
        // Dave's standout season, so his best win rate strictly beats Alice's
        // best. Without it both peak at .727 and the record is a TIE, which
        // correctly suppresses the citation and would leave the greatest-season
        // assertion below testing nothing.
        const standout = owner === 'Dave' && year === 2021;
        return {
          owner,
          wins: standout ? 90 : base.wins,
          losses: standout ? 20 : base.losses,
          pointsFor: POINTS_BY_RANK[rank]!,
        };
      }),
      [
        // Dave sweeps Alice 5-0 across the archives — the league's most lopsided
        // series, and he has left. Alice leads Bob 4-1, the most lopsided among
        // owners who remain, which is what the copy may claim.
        meeting(year, 'Dave', 'Alice', 38, 10),
        year === 2023
          ? meeting(year, 'Bob', 'Alice', 31, 17)
          : meeting(year, 'Alice', 'Bob', 28, 14),
      ]
    );
  }

  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), confirmedOwners);
}

/** Dave is NOT on the 2026 list. */
const seedDepartedRecordHolder = (): Promise<void> => seedRecordsLeague(['Alice', 'Bob', 'Carol']);

function describe(insights: { type: string; description: string }[], type: string): string | null {
  return insights.find((i) => i.type === type)?.description ?? null;
}

// ---------------------------------------------------------------------------
// The resolver itself.
// ---------------------------------------------------------------------------

test('resolveSuperlative separates who may be named from what the record spans', () => {
  const population = [
    { owner: 'Dave', v: 100 },
    { owner: 'Alice', v: 60 },
    { owner: 'Bob', v: 40 },
  ];
  const nameable = population.filter((e) => e.owner !== 'Dave');

  const result = resolveSuperlative({
    nameable,
    population,
    value: (e) => e.v,
    owner: (e) => e.owner,
  });

  assert.equal(result?.best.owner, 'Alice', 'names the best MEMBER');
  assert.equal(result?.holdsLeagueRecord, false);
  assert.deepEqual(result?.recordHolder, { owner: 'Dave', value: 100 });
});

test('a member who ties the all-time best still HOLDS the record', () => {
  // Equal is not beaten. Without this a shared record would tell the member
  // someone else holds what they also hold.
  const population = [
    { owner: 'Dave', v: 100 },
    { owner: 'Alice', v: 100 },
  ];
  const result = resolveSuperlative({
    nameable: [{ owner: 'Alice', v: 100 }],
    population,
    value: (e) => e.v,
    owner: (e) => e.owner,
  });

  assert.equal(result?.holdsLeagueRecord, true);
  assert.equal(result?.recordHolder, null, 'and cites nobody');
});

test('resolveSuperlative never cites a record the named member already holds', () => {
  const population = [
    { owner: 'Alice', v: 100 },
    { owner: 'Bob', v: 40 },
  ];
  const result = resolveSuperlative({
    nameable: population,
    population,
    value: (e) => e.v,
    owner: (e) => e.owner,
  });

  assert.equal(result?.best.owner, 'Alice');
  assert.equal(result?.holdsLeagueRecord, true);
  assert.equal(result?.recordHolder, null);
});

test('direction min finds the lowest, not the highest', () => {
  const population = [
    { owner: 'Dave', v: 1 },
    { owner: 'Alice', v: 5 },
  ];
  const result = resolveSuperlative({
    nameable: [{ owner: 'Alice', v: 5 }],
    population,
    value: (e) => e.v,
    owner: (e) => e.owner,
    direction: 'min',
  });

  assert.equal(result?.holdsLeagueRecord, false);
  assert.deepEqual(result?.recordHolder, { owner: 'Dave', value: 1 });
});

// ---------------------------------------------------------------------------
// POSITIVE CONTROL — the fixture must be able to produce the claims at all.
// ---------------------------------------------------------------------------

test('POSITIVE CONTROL: with nobody departed, the league-record claims still fire', async () => {
  // Same data, except Dave is still a member. Every superlative below must
  // appear in its ORIGINAL "league record" wording. If this test goes quiet the
  // fixture has stopped producing these insights and the assertions in the rest
  // of this file would pass vacuously.
  // The SAME archives, with Dave still a member — so this control proves the
  // fixture can produce these insights, not merely that some other fixture can.
  await seedRecordsLeague(['Alice', 'Bob', 'Carol', 'Dave']);

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  const insights = generateRawInsights(context);

  const points = describe(insights, 'career_points_leader');
  assert.ok(points, 'the points-leader insight must exist for this fixture');
  assert.match(points, /Dave/, 'and it must name the real record holder');
  assert.doesNotMatch(
    points,
    /still stands as the league record/,
    'no citation when the record holder is the one being named'
  );
});

// ---------------------------------------------------------------------------
// The five sites.
// ---------------------------------------------------------------------------

test('career points: a member never inherits the departed leader’s all-time claim', async () => {
  await seedDepartedRecordHolder();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  const insights = generateRawInsights(context);

  const points = describe(insights, 'career_points_leader');
  assert.ok(points, 'the insight still runs — silence was the rejected option');
  assert.match(points, /Alice/, 'names the best remaining member');
  assert.doesNotMatch(
    points,
    /all-time (lead|scoring)/,
    'and must not claim the all-time lead she does not hold'
  );
  // The FIGURE is asserted, not just the phrase: 900+900+900+700+700 = 4,100
  // proves the record was summed over Dave's whole career, and 3,500 that
  // Alice's was summed over hers.
  assert.match(points, /Alice leads active owners with 3,500/);
  assert.match(points, /Dave's 4,100 still stands as the league record/, 'and cites who does');
});

// NO TEST for `career:turnover_margin`, deliberately, and this comment is the
// record of why. `totalTurnoverMargin` accumulates from archived GAME STATS
// (`totalTurnoversForced - totalTurnovers`), not from any field on
// `finalStandings`, and the floor is +20 — so no archive-shaped fixture can
// reach the generator at all. The first version of this file shipped a test for
// it wrapped in `if (margin)`, which passed because the insight was always null:
// a vacuous test wearing a passing badge, the exact failure this project has
// repeated. Its fix is the same three lines as the points leader and goes
// through the same `resolveSuperlative` call, covered by the resolver's own
// tests above. Reaching it behaviourally needs a game-stats fixture; recorded in
// docs/next-tasks.md rather than faked here.

test('greatest season: a member’s best is not the league record while Dave’s stands', async () => {
  await seedDepartedRecordHolder();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  const insights = generateRawInsights(context);

  const season = describe(insights, 'greatest_season');
  // NOT guarded by `if (season)`. That guard is what made this test vacuous:
  // `MIN_GAMES_GREATEST_SEASON` is 100 and the fixture's rows had 12, so the
  // generator never ran and the assertions never executed.
  assert.ok(season, 'the greatest-season insight must exist for this fixture');
  assert.match(season, /Alice/);
  assert.doesNotMatch(
    season,
    /remains the best single-season performance on record/,
    'that phrase belongs to Dave’s season, not hers'
  );
  assert.match(season, /Dave's \.818 in 2021 remains the league record/);
});

test('dynasty: the most titles of anyone STILL PLAYING, with the record named', async () => {
  await seedDepartedRecordHolder();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  const insights = generateRawInsights(context);

  const dynasty = describe(insights, 'dynasty');
  // Unguarded for the same reason: dynasty needs a MEMBER holding 2+ titles, so
  // Alice wins two while Dave keeps three. With Dave holding all of them the
  // generator returned null and this test proved nothing.
  assert.ok(dynasty, 'the dynasty insight must exist for this fixture');
  assert.match(dynasty, /Alice has 2 titles — the most of anyone still playing/);
  assert.doesNotMatch(
    dynasty,
    /the most (in league history|ever)/,
    'Dave holds three; Alice must not be handed the record'
  );
  assert.match(dynasty, /Dave's 3 remains the league record/);
});

test('every generated insight in this state is free of a stolen record claim', async () => {
  // The sweep. Written because five separate assertions above can each be true
  // while a SIXTH site — one nobody enumerated — still crowns a member. If a
  // future generator adds an "all-time" claim over members, this fails without
  // anyone remembering to extend the list.
  await seedDepartedRecordHolder();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  const insights = generateRawInsights(context);

  assert.ok(insights.length > 0, 'the fixture must generate something to sweep');

  // Superlative CLAIMS only. "N seasons on record" is a count, not a claim, and
  // flagging it would have this sweep fail on honest copy — `consistency`'s
  // non-record branch says exactly that.
  const superlative =
    /(in league history|the most ever|the most consistent|the best single-season|the largest career|the most lopsided|all-time)/i;
  for (const insight of insights) {
    if (!superlative.test(insight.description)) continue;
    // A superlative is allowed ONLY when it is Dave's record being cited, or
    // when the sentence scopes itself to current owners.
    const scoped = /(active owners|still playing|remains the league record|still stands)/i.test(
      insight.description
    );
    assert.ok(scoped, `unscoped league-record claim from ${insight.type}: ${insight.description}`);
  }
});

test('lopsided rivalry: the record series is named even though both are gone', async () => {
  // Pair-shaped rather than owner-shaped — the record holder is two names and a
  // scoreline. Dave swept Alice 5-0 and has left; Alice leads Bob 4-1, which is
  // the most lopsided among owners who remain. Unguarded, so a fixture that
  // stops producing rivalries fails here instead of passing silently.
  await seedDepartedRecordHolder();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  const insights = generateRawInsights(context);

  const lopsided = describe(insights, 'lopsided_rivalry');
  assert.ok(lopsided, 'the lopsided-rivalry insight must exist for this fixture');
  assert.match(lopsided, /Alice leads Bob 4–1/);
  assert.doesNotMatch(
    lopsided,
    /the most lopsided rivalry on record/,
    'Dave–Alice was more lopsided'
  );
  assert.match(lopsided, /Dave's 5–0 over Alice remains the league record/);
});
