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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// INSIGHTS-023 — preseason breadth.
//
// The gates were set one at a time over months and disagreed with each other:
// `career:volatility` ran in preseason while `career:points_leader` did not,
// though both are facts about finished seasons. This slice decides by a rule —
// (1) does it need CURRENT-SEASON evidence? (2) otherwise, is it a fact about a
// completed season or an accumulated record? — and pins the answer.
//
// It could only land after INSIGHTS-023a (membership from the confirmed owner
// list) and INSIGHTS-030 (records measured against the whole league). Without
// those, opening these gates would have named last season's roster from a
// borrowed map and handed departed owners' records to whoever remained.
// ---------------------------------------------------------------------------

const SLUG = 'gates';
const YEAR = 2026;
const OWNERS = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Gail', 'Hank'];
const TEAMS = [
  'Georgia',
  'Clemson',
  'Alabama',
  'Ohio State',
  'Texas',
  'Oregon',
  'Michigan',
  'Utah',
];

beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

/**
 * Eight owners, five archived seasons, head-to-head games — enough history for
 * every generator this slice enables to have something to say. `confirmed`
 * controls whether the 2026 owner list exists, which is what decides whether
 * copy may claim who is playing.
 */
async function seedPreseasonLeague(opts: { confirmed?: string[] } = {}): Promise<void> {
  await addLeague({
    slug: SLUG,
    displayName: 'Gates League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2021,
    status: { state: 'preseason', year: YEAR },
  });

  for (let i = 0; i < 5; i += 1) {
    const year = 2021 + i;
    const order = [...OWNERS.slice(i % OWNERS.length), ...OWNERS.slice(0, i % OWNERS.length)];
    const rows = order.map((owner, rank) => ({
      owner,
      wins: 80 - rank * 8,
      losses: 30 + rank * 8,
      pointsFor: 900 - rank * 70,
    }));
    const meetings = [0, 1, 2, 3].map((k) => {
      const home = order[k]!;
      const away = order[(k + 4) % order.length]!;
      const key = `${year}-${home}-${away}`;
      return {
        key,
        game: {
          key,
          week: 5 + k,
          date: `${year}-10-0${k + 1}`,
          csvHome: TEAMS[OWNERS.indexOf(home)],
          csvAway: TEAMS[OWNERS.indexOf(away)],
          canHome: TEAMS[OWNERS.indexOf(home)],
          canAway: TEAMS[OWNERS.indexOf(away)],
          status: 'final',
        },
        score: { status: 'final', home: { score: 35 }, away: { score: 14 } },
      };
    });

    await setAppState(`standings-archive:${SLUG}`, String(year), {
      leagueSlug: SLUG,
      year,
      archivedAt: `${year + 1}-01-01T00:00:00.000Z`,
      ownerRosterSnapshot: 'team,owner\n' + OWNERS.map((o, j) => `${TEAMS[j]},${o}`).join('\n'),
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
          finalGames: r.wins + r.losses,
        })),
      games: meetings.map((m) => m.game),
      scoresByKey: Object.fromEntries(meetings.map((m) => [m.key, m.score])),
    });
  }

  if (opts.confirmed) {
    await setAppState(`preseason-owners:${SLUG}`, String(YEAR), opts.confirmed);
  }
}

/** Dave and Erin have left; Ivy is new. */
const CONFIRMED_2026 = ['Alice', 'Bob', 'Carol', 'Frank', 'Gail', 'Hank', 'Ivy'];

async function preseasonTypes(opts: { confirmed?: string[] } = {}): Promise<Set<string>> {
  await seedPreseasonLeague(opts);
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.equal(context.lifecycleState, 'preseason', 'the fixture must actually be in preseason');
  return new Set(generateRawInsights(context).map((i) => i.type));
}

test('the four opened gates produce insights in preseason', async () => {
  // Each of these was dark. They are archive facts — no current-season evidence
  // — so question 1 says nothing blocks them and question 2 says they belong.
  const types = await preseasonTypes({ confirmed: CONFIRMED_2026 });

  for (const type of ['drought', 'consistency', 'dominance_streak', 'career_points_leader']) {
    assert.ok(types.has(type), `${type} must run in preseason; saw ${[...types].join(', ')}`);
  }
  assert.ok(types.has('greatest_season'), 'greatest_season must run in preseason');
});

test('career:turnover_margin stays DARK in preseason, deliberately', () => {
  // The one sibling not opened. INSIGHTS-030 fixed four record populations and
  // CUT this one, so it can still hand a departed owner's margin to whoever
  // remains — and preseason is where membership diverges most.
  //
  // Pinned STRUCTURALLY, and that is a deliberate downgrade. The first version
  // asserted the insight was absent from a seeded preseason league and passed
  // whether the gate was open or shut: `totalTurnoverMargin` accumulates from
  // cached game-stats partitions an archive fixture cannot provide, so the
  // generator never fires either way. A behavioural assertion over an
  // unreachable surface is the `if (margin)` vacuity this project keeps
  // repeating, wearing a different hat. Reading the gate is the only thing here
  // that can actually fail.
  const src = readFileSync(
    fileURLToPath(new URL('../generators/career.ts', import.meta.url)),
    'utf8'
  );
  const withoutComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  const gate = /const TURNOVER_LEADER_LIFECYCLES[^=]*=\s*(\[[^\]]*\]|[^;]*);/.exec(withoutComments);
  assert.ok(gate, 'the turnover-margin gate must still exist to be pinned');
  assert.doesNotMatch(
    gate[1]!,
    /preseason/,
    'turnover margin must not run in preseason until its record population is fixed'
  );

  // Anti-vacuity, both halves: the detector must fire on a gate that DOES carry
  // preseason, and the comment stripper must not be what makes it pass.
  const sibling = /const POINTS_LEADER_LIFECYCLES[^=]*=\s*(\[[^\]]*\]|[^;]*);/.exec(
    withoutComments
  );
  assert.ok(sibling, 'and the sibling gate must be readable the same way');
  assert.match(sibling[1]!, /preseason/, 'the opened sibling proves the detector works');
});

test('the generators that need CURRENT-season evidence stay dark', async () => {
  // Question 1 of the rule. Weekly movement, a live race, and game stats do not
  // exist before kickoff, so these must not appear no matter how much history
  // the league has.
  const types = await preseasonTypes({ confirmed: CONFIRMED_2026 });

  for (const type of ['trajectory', 'race', 'championship_race']) {
    assert.ok(!types.has(type), `${type} needs current-season evidence and must stay dark`);
  }
});

test('with membership CONFIRMED, participation wording is licensed', async () => {
  // The positive control for the guard below. If this stops finding licensed
  // copy, the guard proves nothing — it would be passing because the phrasing
  // vanished everywhere rather than because it is correctly gated.
  await seedPreseasonLeague({ confirmed: CONFIRMED_2026 });
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.equal(context.leagueMembersSource, 'confirmed');

  const insights = generateRawInsights(context);
  assert.ok(
    insights.some((i) =>
      /active owners|still playing|active drought|active dominance/i.test(
        `${i.title} ${i.description}`
      )
    ),
    'a confirmed league should produce at least one participation claim'
  );
  // And the licensed TITLE specifically, since that is the half the guard missed.
  assert.ok(
    insights.some((i) => /active/i.test(i.title)),
    'a confirmed league keeps its participation-claiming titles'
  );
});

test('with membership UNKNOWN, the opened generators claim nothing about who is playing', async () => {
  // Preseason before owners are confirmed: membership falls back to last
  // season's roster, so an owner who merely sat out is absent from it. The
  // amended AGENTS.md invariant 5 licenses participation wording only when
  // `membershipIsKnown`.
  //
  // These generators already ran in `offseason`, where the same fallback
  // applies, so the claim was unlicensed there too — but extending the gate in
  // the same PR that writes the rule is not the way to inherit a defect.
  await seedPreseasonLeague();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.equal(context.leagueMembersSource, 'previous-roster', 'the fixture must reach it');

  const insights = generateRawInsights(context);
  assert.ok(insights.length > 0, 'and it must generate something to inspect');

  const OPENED = new Set([
    'drought',
    'dynasty',
    'improvement',
    'consistency',
    'lopsided_rivalry',
    'even_rivalry',
    'dominance_streak',
    'career_points_leader',
    'greatest_season',
  ]);
  // TITLE AND DESCRIPTION. The first version read `description` alone, which is
  // precisely why both reviewers found `'Longest active title drought'` and
  // `'Active dominance streak'` sitting above bodies this guard had certified —
  // the headline renders one line above the text it was checking.
  //
  // The `seen` counter is the other half: `insights.length > 0` is satisfied by
  // `milestone_watch` alone, so a fixture that stopped producing any OPENED type
  // would leave the loop body unreached and the test green. That is the same
  // vacuity this file calls out for the turnover-margin pin.
  let seen = 0;
  for (const insight of insights) {
    if (!OPENED.has(insight.type)) continue;
    seen += 1;
    assert.doesNotMatch(
      `${insight.title} ${insight.description}`,
      /(active owners?|still playing|active drought|active dominance|and counting|pattern is emerging|rent-free|subscription|closest rivalry in the league|closest in league history)/i,
      `unlicensed participation claim from ${insight.type}: "${insight.title}" / ${insight.description}`
    );
  }
  assert.ok(seen >= 3, `expected several opened insights to inspect, saw ${seen}`);

  // The TITLE gets a blunter rule than the description, because the phrase-list
  // approach failed on it: "Longest active title drought" does not contain
  // "active drought", so mutating that title back left this guard green. No
  // opened insight may call anything ACTIVE while membership is unknown.
  for (const insight of insights) {
    if (!OPENED.has(insight.type)) continue;
    assert.doesNotMatch(
      insight.title,
      /\bactive\b/i,
      `title claims participation with membership unknown: "${insight.title}" (${insight.type})`
    );
  }
});

test('opening these gates changes nothing about which season the data is from', async () => {
  // `usingArchivedRoster` stays TRUE in preseason — there is no team→owner map
  // before a draft — and that is independent of membership being known. The
  // INSIGHTS-024 audit records the conflation of these two flipping
  // `usingArchivedRoster` false and unlocking rookie claims as a side effect.
  await seedPreseasonLeague({ confirmed: CONFIRMED_2026 });
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());

  assert.equal(context.usingArchivedRoster, true, 'the roster MAP is still borrowed');
  assert.equal(context.leagueMembersSource, 'confirmed', 'while the member NAMES are confirmed');
});

/**
 * A second fixture, for two branches the main one cannot reach.
 *
 * The main fixture's drought is always the PLURAL never-won branch (three owners
 * have no title), and its rivalries are all 4–0 sweeps, so `even_rivalry` —
 * which needs six meetings at a win difference of one or less — never fires.
 * Both of the copy fixes below live in exactly those unreached branches, which
 * is why mutating them left the suite green.
 *
 * Five owners, SEVEN seasons, every owner a champion at least once so no drought
 * is a never-won; Alice won earliest, giving her the single longest drought.
 *
 * Bob and Carol meet all seven times and Bob wins FOUR. A 3–3 split was the
 * first attempt and it was wrong: a zero win-difference lands in the "are tied
 * at" branch, which carries no superlative, so the mutated line was never
 * reached. `EVEN_MAX_WIN_DIFF` is 1, so a 4–3 is the only shape that both
 * qualifies as even AND takes the leader/trailer wording being tested.
 */
async function seedEvenAndDroughtLeague(): Promise<void> {
  const OWNERS5 = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin'];
  await addLeague({
    slug: SLUG,
    displayName: 'Even League',
    year: YEAR,
    createdAt: '2026-01-01T00:00:00.000Z',
    foundedYear: 2020,
    status: { state: 'preseason', year: YEAR },
  });

  const CHAMPIONS = ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Bob', 'Carol'];
  for (const [i, champion] of CHAMPIONS.entries()) {
    const year = 2020 + i;
    const order = [champion, ...OWNERS5.filter((o) => o !== champion)];
    // Bob takes four of the seven — a win difference of exactly 1, the largest
    // that still counts as an even rivalry.
    const bobWins = i !== 1 && i !== 3 && i !== 5;
    const key = `${year}-BobCarol`;
    await setAppState(`standings-archive:${SLUG}`, String(year), {
      leagueSlug: SLUG,
      year,
      archivedAt: `${year + 1}-01-01T00:00:00.000Z`,
      ownerRosterSnapshot: 'team,owner\n' + OWNERS5.map((o, j) => `${TEAMS[j]},${o}`).join('\n'),
      standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
      finalStandings: order.map((owner, rank) => ({
        owner,
        wins: 80 - rank * 10,
        losses: 30 + rank * 10,
        ties: 0,
        winPct: (80 - rank * 10) / 110,
        pointsFor: 900 - rank * 70,
        pointsAgainst: 300,
        pointDifferential: 600 - rank * 70,
        gamesBack: 0,
        finalGames: 110,
      })),
      games: [
        {
          key,
          week: 5,
          date: `${year}-10-01`,
          csvHome: TEAMS[1],
          csvAway: TEAMS[2],
          canHome: TEAMS[1],
          canAway: TEAMS[2],
          status: 'final',
        },
      ],
      scoresByKey: {
        [key]: {
          status: 'final',
          home: { score: bobWins ? 31 : 17 },
          away: { score: bobWins ? 17 : 31 },
        },
      },
    });
  }
}

test('the drought duration counts SEASONS, not years back from today', async () => {
  // My own "neutral" rewrite said "last won a title N seasons ago" — but
  // `longestDrought` counts titleless seasons from the newest ARCHIVE year, and
  // in preseason the newest archive is last year. A reader in 2026 given "3
  // seasons ago" counts back to 2023 when the answer is 2022.
  //
  // Needs the fixture where everyone has won, or the drought falls into the
  // never-won branch and this phrasing is never reached.
  await seedEvenAndDroughtLeague();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.equal(context.leagueMembersSource, 'previous-roster');

  const drought = context && generateRawInsights(context).find((i) => i.type === 'drought');
  assert.ok(drought, 'the drought insight must exist for this fixture');
  assert.match(drought.description, /has gone \d+ seasons without a title/, 'the count phrasing');
  assert.doesNotMatch(
    drought.description,
    /seasons ago/,
    `an elapsed-time claim anchored to the reader's present: ${drought.description}`
  );
});

test('an even rivalry claims no league-wide record it did not measure', async () => {
  // `even_rivalry` compares member pairs only, and my unknown-membership variant
  // claimed "the closest in league history" — a WIDER claim than the gated
  // wording it replaced. Unguarded until this fixture, because no earlier one
  // produced a pair with six meetings inside the win-difference limit.
  await seedEvenAndDroughtLeague();
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  const even = generateRawInsights(context).find((i) => i.type === 'even_rivalry');

  assert.ok(even, 'the even-rivalry insight must exist for this fixture');
  assert.doesNotMatch(
    `${even.title} ${even.description}`,
    /(in league history|most evenly matched|closest)/i,
    `a superlative over a member-only population: "${even.title}" / ${even.description}`
  );
});
