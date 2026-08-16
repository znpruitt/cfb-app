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

type Entry = { owner: string; v: number };
const members = new Set(['Alice', 'Bob']);
const isMember = (e: Entry): boolean => members.has(e.owner);

test('resolveSuperlative separates who may be named from what the record spans', () => {
  const population: Entry[] = [
    { owner: 'Dave', v: 100 },
    { owner: 'Alice', v: 60 },
    { owner: 'Bob', v: 40 },
  ];

  const result = resolveSuperlative({
    population,
    isMember,
    value: (e) => e.v,
    owner: (e) => e.owner,
  });

  assert.equal(result?.best.owner, 'Alice', 'names the best MEMBER');
  assert.equal(result?.standing, 'trails');
  assert.deepEqual(
    result?.recordHolders.map((h) => ({ owner: h.owner, value: h.value })),
    [{ owner: 'Dave', value: 100 }]
  );
  // The ENTRY comes back too. Callers need the rest of it — a rivalry's
  // scoreline, a season's year — and the two that went back to the population to
  // re-find it both got it wrong.
  assert.deepEqual(result?.recordHolders[0]?.entry, { owner: 'Dave', v: 100 });
});

test('a member level with a departed holder SHARES — neither takes nor loses it', () => {
  // The third state. Two states forced a tie to read as "Alice takes the
  // all-time lead" while Dave sat on the identical number.
  const result = resolveSuperlative({
    population: [
      { owner: 'Dave', v: 100 },
      { owner: 'Alice', v: 100 },
    ],
    isMember,
    value: (e) => e.v,
    owner: (e) => e.owner,
  });

  assert.equal(result?.standing, 'shares');
  assert.deepEqual(
    result?.recordHolders.map((h) => ({ owner: h.owner, value: h.value })),
    [{ owner: 'Dave', value: 100 }]
  );
});

test('a record held only by members is HELD, and cites nobody', () => {
  const result = resolveSuperlative({
    population: [
      { owner: 'Alice', v: 100 },
      { owner: 'Bob', v: 40 },
    ],
    isMember,
    value: (e) => e.v,
    owner: (e) => e.owner,
  });

  assert.equal(result?.best.owner, 'Alice');
  assert.equal(result?.standing, 'holds');
  assert.deepEqual(result?.recordHolders, []);
});

test('direction min finds the lowest, not the highest', () => {
  const result = resolveSuperlative({
    population: [
      { owner: 'Dave', v: 1 },
      { owner: 'Alice', v: 5 },
    ],
    isMember,
    value: (e) => e.v,
    owner: (e) => e.owner,
    direction: 'min',
  });

  assert.equal(result?.standing, 'trails');
  assert.deepEqual(
    result?.recordHolders.map((h) => ({ owner: h.owner, value: h.value })),
    [{ owner: 'Dave', value: 1 }]
  );
});

test('a member can never be cited as the record holder', () => {
  // The structural guarantee the predicate buys. Under the old two-list API the
  // caller filtered `population` and `nameable` separately, and turnover margin
  // dropped the seasons floor from one of them — so Erin, a CURRENT member,
  // could be named as the departed record holder. With one population and a
  // predicate, `best` IS the member extreme, so no member can out-rank it.
  const population: Entry[] = [
    { owner: 'Bob', v: 300 },
    { owner: 'Alice', v: 60 },
    { owner: 'Dave', v: 50 },
  ];

  const result = resolveSuperlative({
    population,
    isMember,
    value: (e) => e.v,
    owner: (e) => e.owner,
  });

  assert.equal(result?.best.owner, 'Bob', 'the best member is the best member');
  assert.equal(result?.standing, 'holds');
  for (const holder of result?.recordHolders ?? []) {
    assert.ok(!members.has(holder.owner), `cited an active member: ${holder.owner}`);
  }
});

test('comparison uses the DISPLAYED value when one is supplied', () => {
  // .859504 and .860000 both render `.860`. Comparing raw values produced
  // "Alice's .860 ... Dave's .860 remains the league record" — two identical
  // figures, one said to beat the other.
  const population = [
    { owner: 'Dave', v: 0.86 },
    { owner: 'Alice', v: 0.859504 },
  ];

  const raw = resolveSuperlative({
    population,
    isMember: (e) => e.owner === 'Alice',
    value: (e) => e.v,
    owner: (e) => e.owner,
  });
  assert.equal(raw?.standing, 'trails', 'raw precision says Dave is ahead');

  const shown = resolveSuperlative({
    population,
    isMember: (e) => e.owner === 'Alice',
    value: (e) => e.v,
    owner: (e) => e.owner,
    compareOn: (e) => Math.round(e.v * 1000),
  });
  assert.equal(shown?.standing, 'shares', 'but what a reader sees is a tie');
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

// `career:turnover_margin` is NOT part of this slice — the generator is
// untouched and still carries the defect, exactly as `main` has it.
//
// It cannot be covered from an archive fixture: `totalTurnoverMargin`
// accumulates from cached game-stats partitions behind archive slate
// provenance, a different subsystem from the archives the other four sites
// read. AGENTS.md → Scope and sizing allows two responses to a surface a PR
// touches — cover it, or omit it. An earlier version of this file took a third:
// a test wrapped in `if (margin)` that passed on a null every time. Omitting is
// the compliant option and leaves nothing worse than it found. Filed in
// docs/next-tasks.md with the fixture it needs.

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
    // `level`/`are level on` admit the SHARES copy. Without them the sweep failed
    // on correct sentences the moment a fixture reached that state — and a guard
    // that fails on correct output teaches the next reader to weaken it.
    const scoped =
      /(active owners|still playing|remains the league record|still stands|is the league record|level with|are level)/i.test(
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

test('with membership UNKNOWN, the copy claims nothing about who is playing', async () => {
  // THE finding both reviewers raised, and the one `/code-review` rated HIGH.
  //
  // With archives but no confirmed list and no current roster, membership is
  // just last season's snapshot — so an owner who merely SAT OUT a season is
  // absent from it. Saying the rest are "active owners", or that a record
  // holder is not "still playing", asserts participation from archived data:
  // AGENTS.md Insights invariant 5, and the same reasoning that deleted
  // `applyReturningOwnerFraming` in INSIGHTS-022.
  //
  // The fallback is NOT the pre-030 wording — that wording is the false claim
  // this slice removes. It is neutral copy stating both figures.
  await addLeague({
    slug: SLUG,
    displayName: 'Records League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2021,
    status: { state: 'offseason' },
  });
  const ORDER: Record<number, string[]> = {
    2021: ['Dave', 'Bob', 'Carol', 'Alice'],
    2022: ['Dave', 'Alice', 'Bob', 'Carol'],
    2023: ['Dave', 'Alice', 'Carol', 'Bob'],
    // Dave SITS OUT 2025 — he has not left, and nothing here can know that.
    2025: ['Alice', 'Bob', 'Carol'],
  };
  const PTS = [900, 700, 500, 300];
  const REC = [
    { wins: 80, losses: 30 },
    { wins: 70, losses: 40 },
    { wins: 60, losses: 50 },
    { wins: 50, losses: 60 },
  ];
  for (const [yearText, order] of Object.entries(ORDER)) {
    const year = Number(yearText);
    await seedArchive(
      year,
      order.map((owner, rank) => ({
        owner,
        wins: owner === 'Dave' && year === 2021 ? 90 : REC[rank]!.wins,
        losses: owner === 'Dave' && year === 2021 ? 20 : REC[rank]!.losses,
        pointsFor: PTS[rank]!,
      }))
    );
  }
  // No `preseason-owners`, no owners CSV — membership falls back to 2025's roster.

  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.equal(
    context.leagueMembersSource,
    'previous-roster',
    'the fixture must actually reach the unknown-membership state'
  );
  assert.ok(!context.leagueMembers.has('Dave'), 'and Dave must be outside it');

  const insights = generateRawInsights(context);
  assert.ok(insights.length > 0, 'and it must generate something to inspect');

  for (const insight of insights) {
    assert.doesNotMatch(
      insight.description,
      /(active owners|still playing)/i,
      `participation claim with membership unknown, from ${insight.type}: ${insight.description}`
    );
  }

  // Neutral, not silent, and not the old false claim.
  const points = describe(insights, 'career_points_leader');
  assert.ok(points, 'the insight still runs');
  assert.doesNotMatch(points, /all-time (lead|scoring)/, 'and does not steal the record');
  assert.match(points, /is the league record/, 'it states both figures instead');
});

/**
 * A league where a DEPARTED owner and a MEMBER are exactly level at the top of
 * every record — the `shares` state.
 *
 * No fixture reached this state before, which is why three defects lived in it:
 * rivalry cited the member pair against itself, greatest-season fell through to
 * the untouched "remains the best on record", and the sweep's allowlist admitted
 * none of the shared-record copy. `trails` was the only path anything exercised.
 *
 * Dave and Alice each take two titles, identical points, identical best seasons.
 * The member rivalry is seeded FIRST each year, because insertion order is what
 * decided the self-referential citation.
 */
async function seedSharedRecord(): Promise<void> {
  await addLeague({
    slug: SLUG,
    displayName: 'Shared League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2022,
    status: { state: 'offseason' },
  });

  const ORDER: Record<number, string[]> = {
    2022: ['Dave', 'Alice', 'Bob', 'Carol'],
    2023: ['Alice', 'Dave', 'Carol', 'Bob'],
    2024: ['Dave', 'Alice', 'Bob', 'Carol'],
    2025: ['Alice', 'Dave', 'Carol', 'Bob'],
  };
  const PTS = [900, 700, 500, 300];
  const REC = [
    { wins: 80, losses: 30 },
    { wins: 70, losses: 40 },
    { wins: 60, losses: 50 },
    { wins: 50, losses: 60 },
  ];

  for (const [yearText, order] of Object.entries(ORDER)) {
    const year = Number(yearText);
    await seedArchive(
      year,
      order.map((owner, rank) => ({
        owner,
        wins: REC[rank]!.wins,
        losses: REC[rank]!.losses,
        pointsFor: PTS[rank]!,
      })),
      [
        // Member pair FIRST — the ordering that produced the self-citation.
        meeting(year, 'Alice', 'Bob', 30, 10),
        meeting(year, 'Dave', 'Carol', 30, 10),
      ]
    );
  }

  // Membership is KNOWN and Dave is not in it.
  await setAppState(`preseason-owners:${SLUG}`, String(YEAR), ['Alice', 'Bob', 'Carol']);
}

test('SHARES: a level rivalry names the OTHER pair, never itself', async () => {
  await seedSharedRecord();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  const insights = generateRawInsights(context);

  const lopsided = describe(insights, 'lopsided_rivalry');
  assert.ok(lopsided, 'the rivalry insight must exist for this fixture');
  assert.match(lopsided, /Alice leads Bob 4–0/, 'the member pair is the one named');
  assert.match(lopsided, /Dave's 4–0 over Carol/, 'and the outside pair is the co-holder');
  assert.doesNotMatch(
    lopsided,
    /level with Alice's .* over Bob/,
    'the sentence must not cite the named pair against itself'
  );
});

test('SHARES: a level season is not announced as the outright record', async () => {
  await seedSharedRecord();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  const insights = generateRawInsights(context);

  const season = describe(insights, 'greatest_season');
  assert.ok(season, 'the greatest-season insight must exist for this fixture');
  assert.doesNotMatch(
    season,
    /remains the best single-season performance on record/,
    'Dave is level with her — she did not set it alone'
  );
  assert.match(season, /is level with Dave's/, 'the shared holder is named');
});

test('SHARES: career points and titles say level, not taken', async () => {
  await seedSharedRecord();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  const insights = generateRawInsights(context);

  const points = describe(insights, 'career_points_leader');
  assert.ok(points, 'the points insight must exist for this fixture');
  assert.doesNotMatch(
    points,
    /takes the all-time scoring lead/,
    'she shares it, she did not take it'
  );
  assert.match(points, /Dave/, 'and the co-holder is named');

  const dynasty = describe(insights, 'dynasty');
  // Unguarded, and the negative assertion here was WRONG the first time: it
  // rejected "the most in league history", but with both names in the sentence
  // that phrase is TRUE — they are jointly the most in league history. The claim
  // to reject is sole possession, not the superlative.
  assert.ok(dynasty, 'the dynasty insight must exist for this fixture');
  assert.match(dynasty, /Alice and Dave are level on 2 league titles/);
  assert.doesNotMatch(dynasty, /the most of anyone still playing/, 'not a trails claim');
});

test('the sweep admits the shared-record copy it is meant to allow', async () => {
  // The sweep runs over the DEPARTED fixture, so it never saw `shares` copy and
  // its allowlist silently excluded all three shared sentences. Running it over
  // the shared fixture is what proves the allowlist matches reality rather than
  // matching whatever the one fixture happened to produce.
  await seedSharedRecord();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  const insights = generateRawInsights(context);

  const superlative =
    /(in league history|the most ever|the most consistent|the best single-season|the largest career|the most lopsided|all-time)/i;
  const scoped =
    /(active owners|still playing|remains the league record|still stands|is the league record|level with|are level)/i;

  const FIXED_BY_THIS_SLICE = new Set([
    'career_points_leader',
    'dynasty',
    'greatest_season',
    'lopsided_rivalry',
  ]);

  let checked = 0;
  for (const insight of insights) {
    if (!FIXED_BY_THIS_SLICE.has(insight.type)) continue;
    if (!superlative.test(insight.description)) continue;
    checked += 1;
    assert.ok(
      scoped.test(insight.description),
      `shared-record copy rejected by the sweep, from ${insight.type}: ${insight.description}`
    );
  }
  assert.ok(checked >= 2, `expected shared superlative copy to inspect, saw ${checked}`);

  // `consistency` is EXCLUDED, and this assertion pins why rather than letting
  // the exclusion be silent. Its record already spans the full population — it
  // is not one of this slice's five sites — but its `maxCount >= allTimeMax`
  // tie-handling prints "the most ever" without naming the owner who is level.
  // Pre-existing on `main`; this fixture is simply the first to create the tie.
  // Filed in docs/next-tasks.md. If this assertion starts failing, the copy was
  // fixed and the exclusion should go.
  const consistency = describe(insights, 'consistency');
  if (consistency) {
    assert.match(
      consistency,
      /the most ever/,
      'the known tie-copy gap: still claiming the record outright while level'
    );
  }
});
