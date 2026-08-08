import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLastSeasonFraming } from '../insights/framing';
import {
  clearGenerators,
  getRegisteredGenerators,
  registerGenerator,
  runInsightsEngine,
} from '../insights/engine';
import { championshipRaceGenerator, seasonWrapGenerator } from '../insights/generators/existing';
import {
  neverFinishedLastGenerator,
  rookieBenchmarkGenerator,
  titleChaserGenerator,
  trendingGenerator,
  volatilityGenerator,
} from '../insights/generators/career';
import { ballSecurityGenerator } from '../insights/generators/stats';
import type {
  InsightContext,
  LifecycleState,
  OwnerCareerStats,
  OwnerSeasonStats,
} from '../insights/types';
import {
  deriveLeagueInsights,
  deriveTightClusterInsight,
  deriveTightRaceInsight,
  type Insight,
} from '../selectors/insights';
import type { OwnerStandingsRow } from '../standings';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function row(
  owner: string,
  wins: number,
  losses: number,
  gamesBack: number,
  pointDifferential = 0
): OwnerStandingsRow {
  const games = wins + losses;
  return {
    owner,
    wins,
    losses,
    winPct: games > 0 ? wins / games : 0,
    pointsFor: 100 + wins * 10,
    pointsAgainst: 100 + losses * 10,
    pointDifferential,
    gamesBack,
    finalGames: games,
  };
}

function careerStats(overrides: Partial<OwnerCareerStats> & { owner: string }): OwnerCareerStats {
  return {
    owner: overrides.owner,
    seasons: overrides.seasons ?? 4,
    totalWins: overrides.totalWins ?? 100,
    totalLosses: overrides.totalLosses ?? 100,
    totalPoints: overrides.totalPoints ?? 5000,
    totalPointsAgainst: overrides.totalPointsAgainst ?? 5000,
    totalYards: overrides.totalYards ?? 0,
    totalTurnovers: overrides.totalTurnovers ?? 0,
    totalTurnoversForced: overrides.totalTurnoversForced ?? 0,
    totalTurnoverMargin: overrides.totalTurnoverMargin ?? 0,
    titles: overrides.titles ?? 0,
    titleYears: overrides.titleYears ?? [],
    finishHistory: overrides.finishHistory ?? [
      { year: 2022, rank: 1 },
      { year: 2023, rank: 8 },
      { year: 2024, rank: 2 },
      { year: 2025, rank: 7 },
    ],
    firstSeason: overrides.firstSeason ?? 2022,
    isRookie: overrides.isRookie ?? false,
  };
}

function seasonStats(overrides: Partial<OwnerSeasonStats> & { owner: string }): OwnerSeasonStats {
  return {
    owner: overrides.owner,
    season: overrides.season ?? 2025,
    gamesPlayed: overrides.gamesPlayed ?? 100,
    points: overrides.points ?? 0,
    pointsAgainst: overrides.pointsAgainst ?? 0,
    totalYards: overrides.totalYards ?? 0,
    rushingYards: overrides.rushingYards ?? 0,
    passingYards: overrides.passingYards ?? 0,
    turnovers: overrides.turnovers ?? 50,
    turnoversForced: overrides.turnoversForced ?? 0,
    turnoverMargin: overrides.turnoverMargin ?? 0,
    thirdDownConversions: overrides.thirdDownConversions ?? 0,
    thirdDownAttempts: overrides.thirdDownAttempts ?? 0,
    thirdDownPct: overrides.thirdDownPct ?? 0,
    possessionSeconds: overrides.possessionSeconds ?? 0,
  };
}

function makeContext(overrides: Partial<InsightContext> = {}): InsightContext {
  return {
    leagueSlug: overrides.leagueSlug ?? 'test',
    currentYear: overrides.currentYear ?? 2026,
    lifecycleState: overrides.lifecycleState ?? 'fresh_offseason',
    seasonContext: overrides.seasonContext ?? 'in-season',
    currentWeek: overrides.currentWeek ?? null,
    currentStandings: overrides.currentStandings ?? [],
    weeklyStandings: overrides.weeklyStandings ?? [],
    games: overrides.games ?? [],
    ownerGameStats: overrides.ownerGameStats ?? null,
    ownerCareerStats: overrides.ownerCareerStats ?? [],
    archives: overrides.archives ?? [],
    historicalRosters: overrides.historicalRosters ?? {},
    rankings: overrides.rankings ?? null,
    currentRoster: overrides.currentRoster ?? new Map(),
    usingArchivedRoster: overrides.usingArchivedRoster ?? false,
    records: overrides.records ?? { career: [], season: [], rivalry: [], event: [] },
  };
}

// ---------------------------------------------------------------------------
// Framing helpers
// ---------------------------------------------------------------------------

function fakeInsight(overrides: Partial<Insight> = {}): Insight {
  return {
    id: overrides.id ?? 'fake-id',
    type: overrides.type ?? 'movement',
    title: overrides.title ?? 'Toilet bowl leader',
    description: overrides.description ?? 'Alex recorded 7 last-place weeks.',
    owner: overrides.owner ?? 'Alex',
    relatedOwners: overrides.relatedOwners ?? [],
    priorityScore: overrides.priorityScore ?? 50,
    newsHook: overrides.newsHook ?? 'snapshot',
    statValue: overrides.statValue ?? 7,
    score: overrides.score,
    owners: overrides.owners,
  };
}

test('applyLastSeasonFraming prepends "Last season\'s" to the title with lowercase first letter', () => {
  const framed = applyLastSeasonFraming(fakeInsight({ title: 'Toilet bowl leader' }));
  assert.equal(framed.title, "Last season's toilet bowl leader");
});

test('applyLastSeasonFraming is idempotent', () => {
  const once = applyLastSeasonFraming(fakeInsight({ title: 'Champion margin' }));
  const twice = applyLastSeasonFraming(once);
  assert.equal(once.title, twice.title);
});

test('applyLastSeasonFraming preserves description and other fields', () => {
  const original = fakeInsight({
    title: 'Late collapse',
    description: 'Alex dropped 4 spots over the final 3 weeks.',
    priorityScore: 100,
  });
  const framed = applyLastSeasonFraming(original);
  assert.equal(framed.description, original.description);
  assert.equal(framed.priorityScore, 100);
});

// ---------------------------------------------------------------------------
// Legacy path: deriveLeagueInsights zero-game guard
// ---------------------------------------------------------------------------

test('deriveLeagueInsights returns empty when no owner has played a game', () => {
  const insights = deriveLeagueInsights({
    rows: [
      row('Alex', 0, 0, 0),
      row('Blake', 0, 0, 0),
      row('Casey', 0, 0, 0),
      row('Drew', 0, 0, 0),
    ],
    standingsHistory: null,
    seasonContext: 'in-season',
  });
  assert.deepEqual(insights, []);
});

test('deriveLeagueInsights still fires when at least one owner has games', () => {
  const insights = deriveLeagueInsights({
    rows: [row('Alex', 1, 0, 0, 10), row('Blake', 0, 1, 1, -10)],
    standingsHistory: null,
    seasonContext: 'in-season',
  });
  // tight race fires at gap=1
  assert.equal(
    insights.some((i) => i.type === 'race'),
    true
  );
});

test('deriveLeagueInsights ignores NoClaim rows when computing hasGames', () => {
  // NoClaim has games (synthetic catch-all) but real owners do not.
  // Without the eligible-only filter, we'd let dead-heat insights through.
  const insights = deriveLeagueInsights({
    rows: [
      row('NoClaim', 5, 5, 0),
      row('Alex', 0, 0, 0),
      row('Blake', 0, 0, 0),
      row('Casey', 0, 0, 0),
    ],
    standingsHistory: null,
    seasonContext: 'in-season',
  });
  assert.deepEqual(insights, []);
});

test('deriveTightRaceInsight returns null when all rows are 0-0', () => {
  const insight = deriveTightRaceInsight({
    rows: [row('Alex', 0, 0, 0), row('Blake', 0, 0, 0)],
    seasonContext: 'in-season',
  });
  assert.equal(insight, null);
});

test('deriveTightClusterInsight returns null when all eligible rows are 0-0', () => {
  const insight = deriveTightClusterInsight([
    row('Alex', 0, 0, 0),
    row('Blake', 0, 0, 0),
    row('Casey', 0, 0, 0),
  ]);
  assert.equal(insight, null);
});

// ---------------------------------------------------------------------------
// championshipRaceGenerator: row-content guard
// ---------------------------------------------------------------------------

test('championshipRaceGenerator returns empty when no owner has played a game', () => {
  const context = makeContext({
    lifecycleState: 'early_season',
    currentStandings: [
      row('Alex', 0, 0, 0),
      row('Blake', 0, 0, 0),
      row('Casey', 0, 0, 0),
      row('Drew', 0, 0, 0),
    ],
  });
  const insights = championshipRaceGenerator.generate(context);
  assert.deepEqual(insights, []);
});

test('championshipRaceGenerator fires normally when rows have games', () => {
  const context = makeContext({
    lifecycleState: 'mid_season',
    currentStandings: [row('Alex', 5, 1, 0), row('Blake', 4, 2, 1), row('Casey', 3, 3, 2)],
  });
  const insights = championshipRaceGenerator.generate(context);
  assert.equal(insights.length > 0, true);
});

// ---------------------------------------------------------------------------
// seasonWrapGenerator: "Last season's" framing in rollover window
// ---------------------------------------------------------------------------

test('seasonWrapGenerator applies "Last season\'s" framing when usingArchivedRoster=true', () => {
  const rows = [row('Alex', 12, 0, 0, 100), row('Blake', 8, 4, 4, 30)];
  const context = makeContext({
    lifecycleState: 'fresh_offseason',
    seasonContext: 'final',
    currentStandings: rows,
    usingArchivedRoster: true,
  });
  const insights = seasonWrapGenerator.generate(context);
  // At minimum, champion_margin should fire on a 12-0 vs 8-4 row set.
  assert.equal(insights.length > 0, true);
  for (const insight of insights) {
    assert.equal(
      insight.title.toLowerCase().startsWith("last season's "),
      true,
      `Expected "Last season's" prefix on insight title, got: ${insight.title}`
    );
  }
});

test('seasonWrapGenerator does NOT apply framing when usingArchivedRoster=false', () => {
  const rows = [row('Alex', 12, 0, 0, 100), row('Blake', 8, 4, 4, 30)];
  const context = makeContext({
    lifecycleState: 'postseason',
    seasonContext: 'final',
    currentStandings: rows,
    usingArchivedRoster: false,
  });
  const insights = seasonWrapGenerator.generate(context);
  assert.equal(insights.length > 0, true);
  for (const insight of insights) {
    assert.equal(
      insight.title.toLowerCase().startsWith("last season's "),
      false,
      `Did not expect "Last season's" prefix on insight title: ${insight.title}`
    );
  }
});

// ---------------------------------------------------------------------------
// INSIGHTS-022 — career generators keep NEUTRAL descriptions on a borrowed roster.
//
// These four used to be prefixed "Returning owner …" whenever the roster came
// from an archive. A borrowed roster proves someone PLAYED; it never proves they
// will play again, so the prefix asserted a future fact from past data — and it
// fired hardest in exactly the window where the upcoming roster is least known.
// Identifying who is actually returning needs a FINALIZED upcoming roster
// compared against league history, which is a separate feature. Until then the
// neutral description is the honest one.
// ---------------------------------------------------------------------------

const RETURNING_OWNER_PREFIX = /^Returning owner\b/;

// An eight-owner field for each of the four seasons the fixtures reference.
// `never_last` reads field SIZE per year from the archives to decide what
// "bottom three" means, so without archives it can never qualify and the
// no-prefix assertion below would pass on an empty list.
const CAREER_FIELD = ['Alex', 'Blake', 'Casey', 'Devon', 'Erin', 'Frankie', 'Gray', 'Harper'];

function careerArchives() {
  return [2022, 2023, 2024, 2025].map((year) => ({
    leagueSlug: 'test',
    year,
    archivedAt: new Date().toISOString(),
    ownerRosterSnapshot: '',
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: CAREER_FIELD.map((owner) => ({ ...row(owner, 5, 5, 0), ties: 0 })),
    games: [],
    scoresByKey: {},
  }));
}

function archivedRosterContext(
  owner: string,
  stats: OwnerCareerStats,
  lifecycleState: LifecycleState
) {
  return makeContext({
    lifecycleState,
    ownerCareerStats: [stats],
    currentRoster: new Map([['team', owner]]),
    usingArchivedRoster: true,
    archives: careerArchives(),
  });
}

// REGRESSION TEST — reinstating the framing in ANY of the four fails here by
// name. Each generator is asserted to produce output first, so a generator that
// silently stops firing cannot pass this by emitting nothing.
test('no career generator calls anyone a returning owner on a borrowed roster', () => {
  const volatilityStats = careerStats({
    owner: 'Alex',
    seasons: 4,
    finishHistory: [
      { year: 2022, rank: 1 },
      { year: 2023, rank: 8 },
      { year: 2024, rank: 2 },
      { year: 2025, rank: 7 },
    ],
  });
  const titleStats = careerStats({
    owner: 'Blake',
    seasons: 4,
    titles: 0,
    finishHistory: [
      { year: 2022, rank: 2 },
      { year: 2023, rank: 3 },
      { year: 2024, rank: 2 },
      { year: 2025, rank: 4 },
    ],
  });
  const trendingStats = careerStats({
    owner: 'Casey',
    seasons: 4,
    finishHistory: [
      { year: 2022, rank: 8 },
      { year: 2023, rank: 6 },
      { year: 2024, rank: 4 },
      { year: 2025, rank: 1 },
    ],
  });
  const neverLastStats = careerStats({
    owner: 'Devon',
    seasons: 4,
    finishHistory: [
      { year: 2022, rank: 2 },
      { year: 2023, rank: 3 },
      { year: 2024, rank: 2 },
      { year: 2025, rank: 3 },
    ],
  });

  const cases = [
    { name: 'volatility', gen: volatilityGenerator, owner: 'Alex', stats: volatilityStats },
    { name: 'never_last', gen: neverFinishedLastGenerator, owner: 'Devon', stats: neverLastStats },
    { name: 'title_chaser', gen: titleChaserGenerator, owner: 'Blake', stats: titleStats },
    { name: 'trending', gen: trendingGenerator, owner: 'Casey', stats: trendingStats },
  ];

  for (const { name, gen, owner, stats } of cases) {
    // `preseason` is where the framing used to be unconditional for all four.
    const insights = gen.generate(archivedRosterContext(owner, stats, 'preseason'));
    assert.ok(insights.length > 0, `${name} must produce an insight for this fixture`);
    for (const insight of insights) {
      assert.ok(
        !RETURNING_OWNER_PREFIX.test(insight.description),
        `${name} must not claim a returning owner; got: ${insight.description}`
      );
      assert.ok(
        insight.description.startsWith(owner),
        `${name} keeps its neutral description opening with the owner name; got: ${insight.description}`
      );
    }
  }
});

// CONTRACT PIN — trending was ALWAYS eligible in ordinary offseason; only its
// framing was lifecycle-gated. The backlog claimed this content went dark, which
// was wrong, and the correction is worth pinning so it is not "restored".
test('trending still runs in ordinary offseason, framed or not', () => {
  const stats = careerStats({
    owner: 'Casey',
    seasons: 4,
    finishHistory: [
      { year: 2022, rank: 8 },
      { year: 2023, rank: 6 },
      { year: 2024, rank: 4 },
      { year: 2025, rank: 1 },
    ],
  });

  const insights = trendingGenerator.generate(archivedRosterContext('Casey', stats, 'offseason'));
  assert.ok(insights.length > 0, 'trending was never gated out of ordinary offseason');
  assert.ok(!RETURNING_OWNER_PREFIX.test(insights[0]!.description));
});

// ---------------------------------------------------------------------------
// INSIGHTS-022 — the rookie benchmark stays available through ORDINARY offseason.
//
// It is retrospective: it reports how an owner's first ARCHIVED season went. That
// is a fact about a completed season, and it does not stop being true when the
// fresh-offseason window closes. Gating it to `fresh_offseason` + `preseason`
// made it vanish for the whole stretch in between.
//
// Driven through `runInsightsEngine` rather than calling `generate()` directly,
// because `generate()` does not consult `supportedLifecycles` — only the engine
// does. A direct call would pass with `offseason` removed from the list and prove
// nothing about the gate this slice changes.
// ---------------------------------------------------------------------------

function rookieArchive(year: number, owners: string[]) {
  return {
    leagueSlug: 'test',
    year,
    archivedAt: new Date().toISOString(),
    ownerRosterSnapshot: '',
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: owners.map((owner) => ({ ...row(owner, 5, 5, 0), ties: 0 })),
    games: [],
    scoresByKey: {},
  };
}

async function runRookieOnly(lifecycleState: LifecycleState, usingArchivedRoster = false) {
  const original = [...getRegisteredGenerators()];
  clearGenerators();
  registerGenerator(rookieBenchmarkGenerator);
  try {
    const ctx = makeContext({
      lifecycleState,
      usingArchivedRoster,
      ownerCareerStats: [
        careerStats({
          owner: 'NewOwner',
          seasons: 1,
          isRookie: true,
          finishHistory: [{ year: 2025, rank: 4 }],
        }),
      ],
      currentRoster: new Map([['team', 'NewOwner']]),
      archives: [rookieArchive(2025, ['NewOwner', 'Alex', 'Blake', 'Casey'])],
    });
    return await runInsightsEngine(ctx);
  } finally {
    clearGenerators();
    for (const g of original) registerGenerator(g);
  }
}

test('the rookie benchmark is produced in ordinary offseason', async () => {
  const insights = await runRookieOnly('offseason');
  assert.ok(
    insights.some((i) => i.type === 'rookie_benchmark'),
    `expected a rookie benchmark in ordinary offseason; got ${JSON.stringify(insights.map((i) => i.type))}`
  );
});

// POSITIVE CONTROL — the same fixture in `fresh_offseason`, which was always
// supported. If this ever fails, the fixture stopped producing an insight and the
// assertion above would be passing for the wrong reason.
test('the same fixture still produces the benchmark in fresh_offseason', async () => {
  const insights = await runRookieOnly('fresh_offseason');
  assert.ok(insights.some((i) => i.type === 'rookie_benchmark'));
});

// REGRESSION TEST — the borrowed-roster block is GONE, and this is the change
// that makes the card actually visible during offseason. The old rule assumed a
// borrowed roster would mislabel someone; it cannot. `isRookie` compares against
// `context.currentYear` (== `league.year`), which stays on the COMPLETED season
// through offseason — the same season the borrowed roster comes from — so the
// two agree, and the description names the year explicitly.
test('the rookie benchmark survives a borrowed roster in ordinary offseason', async () => {
  const insights = await runRookieOnly('offseason', true);
  const rookie = insights.find((i) => i.type === 'rookie_benchmark');
  assert.ok(rookie, 'a borrowed roster no longer hides the card');
  assert.match(
    rookie.description,
    /as a rookie in 2025\b/,
    `the claim must name the season it is about; got: ${rookie.description}`
  );
});

// ---------------------------------------------------------------------------
// INSIGHTS-022 — the generator's own borrowed-roster guard is gone too. It
// duplicated the engine rule, so leaving it would have made the engine change
// invisible.
// ---------------------------------------------------------------------------

test('rookieBenchmarkGenerator still produces its insight when usingArchivedRoster=true', () => {
  const owner = 'NewOwner';
  const stats = careerStats({
    owner,
    seasons: 1,
    isRookie: true,
    finishHistory: [{ year: 2025, rank: 4 }],
  });
  const context = makeContext({
    lifecycleState: 'preseason',
    ownerCareerStats: [stats],
    currentRoster: new Map([['team', owner]]),
    usingArchivedRoster: true,
    archives: [
      {
        leagueSlug: 'test',
        year: 2025,
        archivedAt: new Date().toISOString(),
        ownerRosterSnapshot: '',
        standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
        finalStandings: [],
        games: [],
        scoresByKey: {},
      },
    ],
  });
  const insights = rookieBenchmarkGenerator.generate(context);
  assert.equal(insights.length, 1, 'a borrowed roster is no longer a reason to hide it');
  assert.equal(insights[0]!.type, 'rookie_benchmark');
});

// ---------------------------------------------------------------------------
// Stats generators: "Last season's" framing in fresh_offseason rollover
// ---------------------------------------------------------------------------

test('ballSecurityGenerator applies "Last season\'s" framing in fresh_offseason with usingArchivedRoster', () => {
  const owner = 'Alex';
  const stats = seasonStats({
    owner,
    gamesPlayed: 100,
    turnovers: 50,
  });
  const otherStats = seasonStats({
    owner: 'Blake',
    gamesPlayed: 100,
    turnovers: 80,
  });
  const context = makeContext({
    lifecycleState: 'fresh_offseason',
    ownerGameStats: [stats, otherStats],
    currentRoster: new Map([
      ['t1', owner],
      ['t2', 'Blake'],
    ]),
    usingArchivedRoster: true,
  });
  const insights = ballSecurityGenerator.generate(context);
  assert.equal(insights.length, 1);
  assert.equal(insights[0]!.title.toLowerCase().startsWith("last season's "), true);
});

test('ballSecurityGenerator does NOT apply framing in mid_season even with usingArchivedRoster', () => {
  // mid_season + usingArchivedRoster shouldn't realistically happen, but the
  // framing helper is gated on lifecycleState specifically to avoid past-tense
  // copy bleeding into active-season surfaces.
  const owner = 'Alex';
  const stats = seasonStats({ owner, gamesPlayed: 80, turnovers: 30 });
  const otherStats = seasonStats({ owner: 'Blake', gamesPlayed: 80, turnovers: 60 });
  const context = makeContext({
    lifecycleState: 'mid_season',
    ownerGameStats: [stats, otherStats],
    currentRoster: new Map([
      ['t1', owner],
      ['t2', 'Blake'],
    ]),
    usingArchivedRoster: true,
  });
  const insights = ballSecurityGenerator.generate(context);
  assert.equal(insights.length, 1);
  assert.equal(insights[0]!.title.toLowerCase().startsWith("last season's "), false);
});

// ---------------------------------------------------------------------------
// Lifecycle assertions — guards for the supportedLifecycles config we rely on
// ---------------------------------------------------------------------------

test('seasonWrapGenerator declares only post-current-season lifecycles', () => {
  const allowed: LifecycleState[] = ['postseason', 'fresh_offseason'];
  for (const lc of seasonWrapGenerator.supportedLifecycles) {
    assert.equal(allowed.includes(lc), true, `seasonWrapGenerator should not run in ${lc}`);
  }
});

// CONTRACT PIN — INSIGHTS-022 added `offseason`. The card reports a COMPLETED
// season and names the year in its own text, so it does not go stale when the
// fresh-offseason window closes.
test('rookieBenchmarkGenerator runs across both offseason states and preseason', () => {
  const expected: LifecycleState[] = ['fresh_offseason', 'offseason', 'preseason'];
  assert.deepEqual(
    [...rookieBenchmarkGenerator.supportedLifecycles].sort(),
    [...expected].sort(),
    'the rookie benchmark must cover the whole offseason, and nothing in-season'
  );
});

// ---------------------------------------------------------------------------
// INSIGHTS-022 — the generator-level `bypassSuppression` test was REMOVED with
// the filter it covered. It worked by registering a fake generator under the id
// `career:rookie_benchmark` to trip the one rule that existed; with no rules,
// there is nothing for it to assert.
//
// `bypassSuppression` itself is NOT gone and is not weakened: on
// `runInsightsEngine` it still decides whether the durable suppression records
// are applied and written (`applySuppression`), which is its substantive job and
// is covered by `insights-cache.test.ts`.
// ---------------------------------------------------------------------------
