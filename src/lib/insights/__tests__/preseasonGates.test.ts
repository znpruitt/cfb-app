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

test('the two opened gates produce insights in preseason', async () => {
  // Both were dark. They are archive facts — no current-season evidence — so
  // question 1 says nothing blocks them and question 2 says they belong. They
  // are also the two whose record comparisons INSIGHTS-030 actually converted,
  // which is why they are the two that ship.
  const types = await preseasonTypes({ confirmed: CONFIRMED_2026 });

  assert.ok(
    types.has('career_points_leader'),
    `career:points_leader must run in preseason; saw ${[...types].join(', ')}`
  );
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

  // The initializer must be a LITERAL array. This pin reads the gate TEXTUALLY,
  // so `= [...POINTS_LEADER_LIFECYCLES]` would contain no literal `preseason`
  // and the assertion above would pass while the gate is in fact open — green on
  // the exact regression it exists to catch. A spread is a fine thing to write;
  // it just has to fail HERE first, so the pin gets rewritten rather than
  // silently bypassed.
  assert.doesNotMatch(gate[1]!, /\.\.\./, 'a spread makes the check above vacuous');
  assert.match(
    gate[1]!.trim(),
    /^\[\s*'/,
    `the pin can only read a literal array; got ${gate[1]!.trim()}`
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
  // No TITLE assertion here any more, and that is a real narrowing rather than a
  // relaxation: the only participation-claiming titles were `drought`'s and
  // `dominance_streak`'s, and both generators were reverted out of this slice.
  // The guard below still reads titles, so a future opened generator that adds
  // one is caught — there is simply nothing licensed to assert today.
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

  // NARROWED to what this slice actually opens. `historical` and `rivalry` were
  // reverted: review found `consistency`, `improvement` and `even_rivalry` claim
  // league-wide records over member-only populations — the class INSIGHTS-030
  // fixed at four sites and did not convert here. Opening their gates exposes
  // that, so they wait for the conversion. See docs/next-tasks.md.
  const OPENED = new Set(['career_points_leader', 'greatest_season']);
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
  assert.ok(seen >= 1, `expected an opened insight to inspect, saw ${seen}`);

  // The points-leader race narration, asserted DIRECTLY rather than through the
  // phrase list. The list could not catch it — "is pulling away, 600 clear of
  // Bob" and "Bob is closing in" name a second owner who may have left, and
  // neither string was on it. Mutating the gate away sends control back into
  // that `switch`, so this is the assertion that fails.
  const points = insights.find((i) => i.type === 'career_points_leader');
  assert.ok(points, 'the points-leader insight must exist for this fixture');
  assert.match(
    points.description,
    /has [\d,]+ career league points\.$/,
    `race narration reached the card with membership unknown: ${points.description}`
  );

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

test('the points leader states a standing, not an archived event, in preseason', async () => {
  // Invariant 5(a): `usingArchivedRoster` is true throughout preseason, so the
  // hook narration — "reclaims", "takes the all-time scoring lead" — describes a
  // transition that happened when last season closed and reads in August as news.
  //
  // CONFIRMED membership, deliberately. The earlier guard covers the unknown
  // case; this path is reachable only when membership IS known and a current
  // member holds the record, which is the likely shape for a real league and the
  // one my HTTP verification missed by seeding a departed record holder.
  await seedPreseasonLeague({ confirmed: [...OWNERS, 'Ivy'] });
  const context = await buildLeagueInsightContext(SLUG, YEAR, new Date());
  assert.equal(context.leagueMembersSource, 'confirmed');
  assert.equal(context.usingArchivedRoster, true, 'the roster is borrowed in preseason');

  const points = generateRawInsights(context).find((i) => i.type === 'career_points_leader');
  assert.ok(points, 'the points-leader insight must exist for this fixture');
  assert.doesNotMatch(
    points.description,
    /(reclaims|takes the all-time|crosses|is pulling away|is closing in|extends the all-time)/i,
    `archived event narrated as current: ${points.description}`
  );

  // And no superlative over the eligibility-narrowed population.
  assert.doesNotMatch(
    points.description,
    /the most in league history/,
    `a league-record claim over a population narrowed by the seasons floor: ${points.description}`
  );
});
