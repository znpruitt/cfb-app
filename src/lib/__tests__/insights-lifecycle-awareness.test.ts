import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyLastSeasonFraming,
  applyReturningOwnerFraming,
} from '../insights/framing';
import {
  clearGenerators,
  getRegisteredGenerators,
  registerGenerator,
  runInsightsEngine,
} from '../insights/engine';
import {
  championshipRaceGenerator,
  seasonWrapGenerator,
} from '../insights/generators/existing';
import {
  rookieBenchmarkGenerator,
  titleChaserGenerator,
  trendingGenerator,
  volatilityGenerator,
} from '../insights/generators/career';
import { ballSecurityGenerator } from '../insights/generators/stats';
import type {
  InsightContext,
  InsightGenerator,
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

test("applyLastSeasonFraming prepends \"Last season's\" to the title with lowercase first letter", () => {
  const framed = applyLastSeasonFraming(fakeInsight({ title: 'Toilet bowl leader' }));
  assert.equal(framed.title, "Last season's toilet bowl leader");
});

test('applyLastSeasonFraming is idempotent', () => {
  const once = applyLastSeasonFraming(fakeInsight({ title: 'Champion margin' }));
  const twice = applyLastSeasonFraming(once);
  assert.equal(once.title, twice.title);
});

test("applyLastSeasonFraming preserves description and other fields", () => {
  const original = fakeInsight({
    title: 'Late collapse',
    description: 'Alex dropped 4 spots over the final 3 weeks.',
    priorityScore: 100,
  });
  const framed = applyLastSeasonFraming(original);
  assert.equal(framed.description, original.description);
  assert.equal(framed.priorityScore, 100);
});

test('applyReturningOwnerFraming prepends "Returning owner" when description starts with the owner name', () => {
  const framed = applyReturningOwnerFraming(
    fakeInsight({
      owner: 'Alex',
      description: 'Alex has finished 4th, 7th, 2nd, 8th — pick a lane.',
    })
  );
  assert.equal(
    framed.description,
    'Returning owner Alex has finished 4th, 7th, 2nd, 8th — pick a lane.'
  );
});

test('applyReturningOwnerFraming is idempotent', () => {
  const once = applyReturningOwnerFraming(
    fakeInsight({ owner: 'Alex', description: 'Alex has finished 1st.' })
  );
  const twice = applyReturningOwnerFraming(once);
  assert.equal(once.description, twice.description);
});

test('applyReturningOwnerFraming skips multi-owner insights (relatedOwners present)', () => {
  const original = fakeInsight({
    owner: 'Alex',
    relatedOwners: ['Blake'],
    description: 'Alex and Blake share the lead.',
  });
  const framed = applyReturningOwnerFraming(original);
  assert.equal(framed.description, original.description);
});

test("applyReturningOwnerFraming skips when description doesn't start with the owner name", () => {
  const original = fakeInsight({
    owner: 'Alex',
    description: 'The race for first place is tight.',
  });
  const framed = applyReturningOwnerFraming(original);
  assert.equal(framed.description, original.description);
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
    currentStandings: [
      row('Alex', 5, 1, 0),
      row('Blake', 4, 2, 1),
      row('Casey', 3, 3, 2),
    ],
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
// Career generators: "Returning owner" framing
// ---------------------------------------------------------------------------

test('volatilityGenerator applies "Returning owner" framing when usingArchivedRoster=true', () => {
  const owner = 'Alex';
  const stats = careerStats({
    owner,
    seasons: 4,
    finishHistory: [
      { year: 2022, rank: 1 },
      { year: 2023, rank: 8 },
      { year: 2024, rank: 2 },
      { year: 2025, rank: 7 },
    ],
  });
  const context = makeContext({
    lifecycleState: 'fresh_offseason',
    ownerCareerStats: [stats],
    currentRoster: new Map([['team', owner]]),
    usingArchivedRoster: true,
  });
  const insights = volatilityGenerator.generate(context);
  assert.equal(insights.length, 1);
  assert.equal(insights[0]!.description.startsWith('Returning owner Alex'), true);
});

test('volatilityGenerator does NOT apply framing when usingArchivedRoster=false', () => {
  const owner = 'Alex';
  const stats = careerStats({
    owner,
    seasons: 4,
    finishHistory: [
      { year: 2022, rank: 1 },
      { year: 2023, rank: 8 },
      { year: 2024, rank: 2 },
      { year: 2025, rank: 7 },
    ],
  });
  const context = makeContext({
    lifecycleState: 'fresh_offseason',
    ownerCareerStats: [stats],
    currentRoster: new Map([['team', owner]]),
    usingArchivedRoster: false,
  });
  const insights = volatilityGenerator.generate(context);
  assert.equal(insights.length, 1);
  assert.equal(insights[0]!.description.startsWith('Returning owner'), false);
});

test('titleChaserGenerator applies "Returning owner" framing when usingArchivedRoster=true', () => {
  const owner = 'Blake';
  const stats = careerStats({
    owner,
    seasons: 4,
    titles: 0,
    finishHistory: [
      { year: 2022, rank: 2 },
      { year: 2023, rank: 3 },
      { year: 2024, rank: 2 },
      { year: 2025, rank: 4 },
    ],
  });
  const context = makeContext({
    lifecycleState: 'preseason',
    ownerCareerStats: [stats],
    currentRoster: new Map([['team', owner]]),
    usingArchivedRoster: true,
  });
  const insights = titleChaserGenerator.generate(context);
  assert.equal(insights.length, 1);
  assert.equal(
    insights[0]!.description.startsWith('Returning owner Blake'),
    true,
    `Expected "Returning owner Blake" prefix, got: ${insights[0]!.description}`
  );
});

test('trendingGenerator applies framing only in preseason / fresh_offseason with usingArchivedRoster', () => {
  const owner = 'Casey';
  const stats = careerStats({
    owner,
    seasons: 4,
    finishHistory: [
      { year: 2022, rank: 8 },
      { year: 2023, rank: 6 },
      { year: 2024, rank: 4 },
      { year: 2025, rank: 1 },
    ],
  });
  const baseCtx: Partial<InsightContext> = {
    ownerCareerStats: [stats],
    currentRoster: new Map([['team', owner]]),
    usingArchivedRoster: true,
  };

  const preseasonInsights = trendingGenerator.generate(
    makeContext({ ...baseCtx, lifecycleState: 'preseason' })
  );
  assert.equal(preseasonInsights.length > 0, true);
  assert.equal(preseasonInsights[0]!.description.startsWith('Returning owner Casey'), true);

  // early_season: framing should NOT apply (current-year context exists)
  const earlySeasonInsights = trendingGenerator.generate(
    makeContext({ ...baseCtx, lifecycleState: 'early_season' })
  );
  if (earlySeasonInsights.length > 0) {
    assert.equal(
      earlySeasonInsights[0]!.description.startsWith('Returning owner'),
      false,
      'Trending in early_season should not get returning-owner framing'
    );
  }
});

// ---------------------------------------------------------------------------
// rookieBenchmarkGenerator: skip when usingArchivedRoster
// ---------------------------------------------------------------------------

test('rookieBenchmarkGenerator returns empty when usingArchivedRoster=true', () => {
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
  assert.deepEqual(insights, []);
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
    assert.equal(
      allowed.includes(lc),
      true,
      `seasonWrapGenerator should not run in ${lc}`
    );
  }
});

test('rookieBenchmarkGenerator declares only preseason / fresh_offseason lifecycles', () => {
  const allowed: LifecycleState[] = ['preseason', 'fresh_offseason'];
  for (const lc of rookieBenchmarkGenerator.supportedLifecycles) {
    assert.equal(
      allowed.includes(lc),
      true,
      `rookieBenchmarkGenerator should not run in ${lc}`
    );
  }
});

// ---------------------------------------------------------------------------
// Engine: bypassSuppression must skip the new shouldSuppressGenerator filter
// (Phase 3 Codex remediation: admin diagnostic runs need every generator's
// output, including ones that are normally filtered for content reasons.)
// ---------------------------------------------------------------------------

test('runInsightsEngine respects bypassSuppression for the generator-level filter', async () => {
  // The shouldSuppressGenerator rule keys on `id === 'career:rookie_benchmark'`,
  // so the fake generator below must reuse that id to exercise the suppression
  // path. Save and restore the global generator registry so other tests in this
  // file (and in any other test file run in the same process) keep working.
  const original = [...getRegisteredGenerators()];
  clearGenerators();

  let invocations = 0;
  const fakeGenerator: InsightGenerator = {
    id: 'career:rookie_benchmark',
    category: 'historical',
    supportedLifecycles: ['fresh_offseason'],
    generate: () => {
      invocations += 1;
      return [
        {
          id: 'fake-suppress-target',
          type: 'rookie_benchmark',
          title: 'fake',
          description: 'fake',
          priorityScore: 100,
          newsHook: 'snapshot',
          statValue: 1,
        },
      ];
    },
  };
  registerGenerator(fakeGenerator);

  try {
    const ctx = makeContext({
      lifecycleState: 'fresh_offseason',
      usingArchivedRoster: true,
    });

    invocations = 0;
    const filtered = await runInsightsEngine(ctx, { bypassSuppression: false });
    assert.equal(invocations, 0, 'generator should be filtered out without bypass');
    assert.equal(
      filtered.some((i) => i.id === 'fake-suppress-target'),
      false
    );

    invocations = 0;
    const bypassed = await runInsightsEngine(ctx, { bypassSuppression: true });
    assert.equal(invocations, 1, 'generator should run when bypassSuppression=true');
    assert.equal(
      bypassed.some((i) => i.id === 'fake-suppress-target'),
      true
    );
  } finally {
    clearGenerators();
    for (const g of original) registerGenerator(g);
  }
});
