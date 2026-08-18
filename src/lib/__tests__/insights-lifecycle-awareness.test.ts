import assert from 'node:assert/strict';
import test from 'node:test';

import { applyLastSeasonFraming } from '../insights/framing';
import { decayFactor } from '../insights/variants';
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
import type { SeasonArchive } from '../seasonArchive';
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
    // Honours `overrides`, unlike an earlier version that hardcoded the
    // membership field while honouring every other one — a test written to
    // exercise the withheld path would have passed vacuously. (This comment was
    // itself two paragraphs pasted over each other, the first still naming the
    // field v5 deleted.)
    seasonOwners:
      overrides.seasonOwners !== undefined
        ? overrides.seasonOwners
        : { year: overrides.currentYear ?? 2026, owners: ['Alice', 'Bob'] },
    membershipDisagreement: overrides.membershipDisagreement ?? [],
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
    // INSIGHTS-023a — membership defaults to the owners in the roster map so
    // these fixtures keep meaning what they meant: they were written when
    // generators derived membership from `currentRoster`, and the point of the
    // slice is that PRODUCTION no longer does, not that these cases changed.
    leagueMembers:
      overrides.leagueMembers ??
      new Set([...(overrides.currentRoster ?? new Map()).values()].filter((o) => o !== 'NoClaim')),
    leagueMembersSource: overrides.leagueMembersSource ?? 'previous-roster',
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

test('seasonWrapGenerator STATES the season year on every recap title', () => {
  // INSIGHTS-032 (owner ruling, 2026-08-18) replaced the "Last season's" prefix
  // with the year itself — "it's clear and leaves no ambiguity about the year
  // being referenced". A stated year is also stronger framing than a relative
  // prefix because it survives being read out of context, which is what
  // AGENTS.md Insights invariant 5 leans on when it exempts these cards from the
  // departed-owner rule.
  const rows = [row('Alex', 12, 0, 0, 100), row('Blake', 8, 4, 4, 30)];
  const context = makeContext({
    lifecycleState: 'fresh_offseason',
    seasonContext: 'final',
    currentYear: 2026,
    currentStandings: rows,
    usingArchivedRoster: true,
  });
  const insights = seasonWrapGenerator.generate(context);
  // At minimum, champion_margin should fire on a 12-0 vs 8-4 row set.
  assert.equal(insights.length > 0, true);
  for (const insight of insights) {
    assert.match(
      insight.title,
      /2026/,
      `every recap title must name the season it describes, got: ${insight.title}`
    );
    assert.doesNotMatch(
      insight.title.toLowerCase(),
      /last season/,
      `the relative prefix was replaced, not layered on: ${insight.title}`
    );
  }
});

test('seasonWrapGenerator names the CURRENT year when the season just finished', () => {
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
    // In postseason the CURRENT year is the season being described, so the same
    // rule produces the current year rather than the prior one.
    assert.match(insight.title, /2026/, `expected the current season named: ${insight.title}`);
  }
});

// ---------------------------------------------------------------------------
// INSIGHTS-032 — the season wrap survives rollover by reading the ARCHIVE.
//
// Before this slice the wrap ran only in `postseason` and `fresh_offseason`,
// where `context.currentStandings` still holds the finished season's finals. The
// rollover advances the league to the new year, the wrap went dark, and members
// arriving in preseason found no record of how the year they just played ended.
//
// The fix is a data-source change, not a wider gate: in preseason the current
// standings belong to the season about to start. These tests exist to keep those
// two halves attached to each other.
// ---------------------------------------------------------------------------

function wrapArchive(year: number, rows: OwnerStandingsRow[]): SeasonArchive {
  return {
    leagueSlug: 'test',
    year,
    archivedAt: `${year + 1}-01-05T00:00:00.000Z`,
    ownerRosterSnapshot: 'team,owner\n' + rows.map((r, i) => `Team${i}, ${r.owner}`).join('\n'),
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: rows.map((r) => ({ ...r, ties: 0 })),
    games: [],
    scoresByKey: {},
  };
}

/** The season just played: Zoe took it, Yuri finished four back. */
const ARCHIVED_2025 = [row('Zoe', 12, 0, 0, 140), row('Yuri', 8, 4, 4, 40)];

/**
 * What the NEW season's table looks like on the day the draft ends: every owner
 * present, nobody has played. Deliberately led by a different owner than the
 * archive, so "which table did it read" is answerable from the copy alone.
 */
const UNPLAYED_2026 = [row('Aaron', 0, 0, 0, 0), row('Bex', 0, 0, 0, 0)];

/**
 * The post-draft preseason state: rollover done, roster confirmed, nobody has
 * played. `leagueMembers` carries BOTH archived owners, so the membership gate
 * is satisfied and these fixtures test source selection rather than it.
 */
function preseasonWrapContext(overrides: Partial<InsightContext> = {}): InsightContext {
  return makeContext({
    lifecycleState: 'preseason',
    currentYear: 2026,
    currentStandings: UNPLAYED_2026,
    archives: [wrapArchive(2025, ARCHIVED_2025)],
    usingArchivedRoster: false,
    leagueMembers: new Set(['Zoe', 'Yuri']),
    leagueMembersSource: 'confirmed',
    ...overrides,
  });
}

test('INSIGHTS-032: in preseason the wrap describes the ARCHIVE, not the new table', () => {
  const insights = seasonWrapGenerator.generate(preseasonWrapContext());

  const champion = insights.find((i) => i.type === 'champion_margin');
  assert.ok(
    champion,
    `champion_margin must fire from the archive; saw ${insights.length} insights`
  );
  // Names the archive's finishers, not the new season's. This is the assertion
  // that fails if the source silently reverts to `currentStandings`: that table
  // is led by Aaron, and every margin in it is zero.
  assert.match(champion.description, /Zoe/, 'the archived champion must be the one named');
  assert.match(champion.description, /Yuri/, 'the archived runner-up must be the one named');
  assert.doesNotMatch(champion.description, /Aaron|Bex/, 'the new season has not been played');
  assert.equal(champion.statValue, 4, 'the margin must come from the archived table');
});

test('INSIGHTS-032: preseason frames the wrap as last season WITHOUT usingArchivedRoster', () => {
  // The trap this test exists for. Framing used to hang on `usingArchivedRoster`,
  // which is FALSE the moment the draft is confirmed and a current roster
  // exists — precisely the preseason state most members will be looking at. An
  // unframed "Toilet bowl leader" on the Overview of a season whose first game
  // has not kicked off is a current-year claim.
  const insights = seasonWrapGenerator.generate(
    preseasonWrapContext({ usingArchivedRoster: false })
  );

  assert.ok(insights.length > 0, 'the fixture must produce something to frame');
  for (const insight of insights) {
    // The ARCHIVED year (2025), not the current one (2026) — naming the wrong
    // year would be worse than naming none.
    assert.match(
      insight.title,
      /2025/,
      `preseason recap titles must self-frame; got: ${insight.title}`
    );
    assert.doesNotMatch(
      insight.title,
      /2026/,
      `that is the season about to start: ${insight.title}`
    );
  }
});

test('INSIGHTS-032: preseason requires the ADJACENT archive, not merely the newest', () => {
  // A league that skipped 2025 has 2024 as its newest archive. "Last season's
  // champion" would then name a champion from two years ago.
  const stale = seasonWrapGenerator.generate(
    preseasonWrapContext({ archives: [wrapArchive(2024, ARCHIVED_2025)] })
  );
  assert.equal(stale.length, 0, `a non-adjacent archive must produce nothing; got ${stale.length}`);

  // Anti-vacuity: the ONLY difference is the year, so the zero above is the
  // adjacency rule and not a fixture that could never produce anything.
  const adjacent = seasonWrapGenerator.generate(
    preseasonWrapContext({ archives: [wrapArchive(2025, ARCHIVED_2025)] })
  );
  assert.ok(adjacent.length > 0, 'the same archive one year later must produce the wrap');
});

test('INSIGHTS-032: a STALE year projection withholds rather than mislabels', () => {
  // `context.currentYear` is `league.year` — the synchronized projection, not
  // the lifecycle authority. A legacy record left at 2025 while the league is
  // actually in preseason for 2026 would make `currentYear - 1` select 2024 and
  // present a two-year-old champion as last season's.
  //
  // The archive set contradicts the stale year: 2025 is already archived, which
  // cannot be true of a league still IN 2025.
  const stale = seasonWrapGenerator.generate(
    preseasonWrapContext({
      currentYear: 2025,
      archives: [wrapArchive(2024, ARCHIVED_2025), wrapArchive(2025, ARCHIVED_2025)],
    })
  );
  assert.equal(stale.length, 0, `a stale projection must withhold; got ${stale.length}`);

  // Anti-vacuity: the SAME archive set one year forward is a consistent record,
  // and produces the wrap from 2025.
  const consistent = seasonWrapGenerator.generate(
    preseasonWrapContext({
      currentYear: 2026,
      archives: [wrapArchive(2024, ARCHIVED_2025), wrapArchive(2025, ARCHIVED_2025)],
    })
  );
  assert.ok(consistent.length > 0, 'a consistent year and archive set must produce the wrap');
});

test('INSIGHTS-032: a season nobody played produces no wrap, from either source', () => {
  // Reachable both ways: an archive can be written for a league created and
  // rolled straight over, and a live postseason table reads 0-0 across the board
  // when score attachment has failed. "Title secured by X over Y by 0 games" is
  // a fabricated result in both.
  const unplayedArchive = seasonWrapGenerator.generate(
    preseasonWrapContext({ archives: [wrapArchive(2025, UNPLAYED_2026)] })
  );
  assert.equal(unplayedArchive.length, 0, 'an unplayed archive must produce nothing');

  const unplayedLive = seasonWrapGenerator.generate(
    makeContext({
      lifecycleState: 'postseason',
      seasonContext: 'final',
      currentStandings: UNPLAYED_2026,
    })
  );
  assert.equal(unplayedLive.length, 0, 'an unplayed live table must produce nothing');

  // Anti-vacuity for both: the guard reads records, so the identical fixture
  // with games played must produce the wrap.
  assert.ok(
    seasonWrapGenerator.generate(preseasonWrapContext()).length > 0,
    'the archive path must fire once the rows show play'
  );
  assert.ok(
    seasonWrapGenerator.generate(
      makeContext({
        lifecycleState: 'postseason',
        seasonContext: 'final',
        currentStandings: ARCHIVED_2025,
      })
    ).length > 0,
    'the live path must fire once the rows show play'
  );
});

test('INSIGHTS-032: the recap NAMES a departed owner, framed as last season', () => {
  // Owner ruling, 2026-08-18. An earlier revision withheld any card naming an
  // owner who had left, which made the recap dark until owners were confirmed
  // and silently deleted the champion card whenever last season's champion did
  // not come back. A framed report of a COMPLETED season asserts nothing about
  // who is playing — AGENTS.md Insights invariant 5 clause (b) — so it ships.
  //
  // Zoe won last season and is NOT in this season's member set.
  const insights = seasonWrapGenerator.generate(
    preseasonWrapContext({ leagueMembers: new Set(['Yuri']), leagueMembersSource: 'confirmed' })
  );

  const champion = insights.find((i) => i.type === 'champion_margin');
  assert.ok(champion, 'the champion card must survive its champion leaving the league');
  assert.match(champion.description, /Zoe/, 'the departed champion is still the champion');

  // The framing is what makes naming her safe, so it is asserted HERE and not
  // taken on trust from the filter's absence.
  assert.match(
    champion.title,
    /2025/,
    `naming a departed owner is only safe when the season is named; got: ${champion.title}`
  );
});

test('INSIGHTS-032: an UNKNOWN membership does not withhold the recap', () => {
  // Before the draft, membership resolves to `previous-roster`. The recap makes
  // no participation claim, so it does not wait for confirmation — this is what
  // makes the feature visible in the window between rollover and the draft.
  const unknown = seasonWrapGenerator.generate(
    preseasonWrapContext({ leagueMembers: new Set(), leagueMembersSource: 'previous-roster' })
  );
  assert.ok(unknown.length > 0, 'the recap must not depend on knowing who is playing this season');
});

test('INSIGHTS-032: the recap declares season_recap decay and fades in preseason', () => {
  // The generator DECLARES the policy; `applyInsightDecay` applies it at request
  // time. A score decayed inside the generator would be cached and freeze at
  // whatever lifecycle warmed the entry.
  const insights = seasonWrapGenerator.generate(preseasonWrapContext());
  assert.ok(insights.length > 0, 'fixture must produce cards to tag');
  for (const insight of insights) {
    assert.equal(insight.decay, 'season_recap', `${insight.type} must declare its decay policy`);
  }

  // Full strength while the finished season is the most recent thing that
  // happened; reduced once the next one is being set up.
  assert.equal(decayFactor('season_recap', 'postseason'), 1);
  assert.equal(decayFactor('season_recap', 'fresh_offseason'), 1);
  const preseasonFactor = decayFactor('season_recap', 'preseason');
  assert.ok(
    preseasonFactor < 1,
    `the recap must fade once preseason arrives; got ${preseasonFactor}`
  );

  // The ruling was that DRAFT results outrank the recap once they exist. The
  // membership cards that report the draft score 80-84, so a typical champion
  // margin must land below that band after decay.
  const champion = insights.find((i) => i.type === 'champion_margin');
  assert.ok(champion, 'champion margin must be present to measure');
  const decayed = Math.round(champion.priorityScore * preseasonFactor);
  assert.ok(
    decayed < 80,
    `the recap must rank below the draft-result cards (80-84); got ${decayed}`
  );
});

test('INSIGHTS-032: outside preseason the wrap still reads the CURRENT standings', () => {
  // The refactor routed every lifecycle through one selector, so the untouched
  // branch needs its own pin: with BOTH a live table and an archive present,
  // postseason must describe the live one.
  const insights = seasonWrapGenerator.generate(
    makeContext({
      lifecycleState: 'postseason',
      seasonContext: 'final',
      currentYear: 2026,
      currentStandings: [row('Alex', 12, 0, 0, 100), row('Blake', 8, 4, 4, 30)],
      archives: [wrapArchive(2025, ARCHIVED_2025)],
    })
  );

  const champion = insights.find((i) => i.type === 'champion_margin');
  assert.ok(champion, 'postseason must still produce a champion margin');
  assert.match(champion.description, /Alex/, 'postseason describes the season just finished');
  assert.doesNotMatch(champion.description, /Zoe/, 'the archive must not win over the live table');

  // `season` marks a card as describing a season OTHER than the one on screen.
  // On the live path they are the same, so it must stay absent or navigation
  // would redirect a current-season card into the history view.
  for (const insight of insights) {
    assert.equal(
      insight.season,
      undefined,
      `${insight.type} describes the season being viewed and must not be redirected`
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
      // `currentYear` MUST match the archive year. Production computes
      // `isRookie` as `firstSeason === currentYear`, and `currentYear` is
      // `league.year`, which through offseason is still the COMPLETED season —
      // 2025 here, the same season the archive and the debut come from. Leaving
      // the 2026 default while forcing `isRookie: true` would pin a combination
      // the real system cannot produce, and the test would prove nothing about
      // the state this slice actually makes visible.
      currentYear: 2025,
      ownerCareerStats: [
        careerStats({
          owner: 'NewOwner',
          seasons: 1,
          firstSeason: 2025,
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

// REGRESSION TEST — widening the lifecycle list must NOT reach the borrowed-roster
// safeguard. AGENTS.md invariant 5 requires the rookie card to be suppressed
// there outright, because there is no valid framing for a first-archive-owner
// comparison drawn from someone else's roster.
//
// This does not cost the offseason visibility this slice is for: `league.year`
// stays on the COMPLETED season through offseason and that season's owners CSV is
// never deleted, so `usingArchivedRoster` is false for that whole stretch and the
// guard never fires there.
test('the rookie benchmark is still suppressed on a borrowed roster', async () => {
  const insights = await runRookieOnly('offseason', true);
  assert.ok(
    !insights.some((i) => i.type === 'rookie_benchmark'),
    'the borrowed-roster safeguard survives the lifecycle widening'
  );
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

// CONTRACT PIN — INSIGHTS-032 added `preseason`, and that addition is only safe
// alongside the archive source below. `preseason` is the one state in this list
// where the CURRENT standings are not the season being described, so a future
// change that widens this gate without touching `selectSeasonWrapSource` would
// wrap a table nobody has played in. The two halves ship together or not at all.
test('seasonWrapGenerator declares only lifecycles where a finished season exists', () => {
  const allowed: LifecycleState[] = ['preseason', 'postseason', 'fresh_offseason'];
  for (const lc of seasonWrapGenerator.supportedLifecycles) {
    assert.equal(allowed.includes(lc), true, `seasonWrapGenerator should not run in ${lc}`);
  }
  // Asserted positively too: the loop above passes on an EMPTY gate, so it can
  // never catch preseason being removed again.
  assert.ok(
    seasonWrapGenerator.supportedLifecycles.includes('preseason'),
    'preseason is the whole point of INSIGHTS-032 — the wrap must survive rollover'
  );

  // `postseason` is SUPPORTED, but finality is enforced inside the generator —
  // see the two tests below. Removing the lifecycle was the first attempt and it
  // blanked the recap for the seven-plus days between the championship and
  // rollover, when the season IS over.
  assert.ok(
    seasonWrapGenerator.supportedLifecycles.includes('postseason'),
    'the completed-season window before rollover lives in the postseason lifecycle'
  );
});

test('INSIGHTS-032: the recap is silent while the postseason is STILL RUNNING', () => {
  // `deriveLifecycleState` maps both `seasonContext` values onto lifecycle
  // `postseason`, so the lifecycle alone cannot tell a finished season from one
  // mid-bracket. Announcing "How 2026 finished" and naming a champion while
  // games remain is the P1 this guards.
  const rows = [row('Alex', 12, 0, 0, 100), row('Blake', 8, 4, 4, 30)];
  const running = seasonWrapGenerator.generate(
    makeContext({
      lifecycleState: 'postseason',
      seasonContext: 'postseason',
      currentYear: 2026,
      currentStandings: rows,
    })
  );
  assert.equal(
    running.length,
    0,
    `a season still being played has no recap; got ${running.length}`
  );
});

test('INSIGHTS-032: the recap DOES serve the completed season before rollover', () => {
  // The window the first fix destroyed. `resolveNationalChampionshipRollover`
  // waits ROLLOVER_DELAY_MS (seven days) after the championship kickoff before
  // flipping the league to offseason, so for that whole stretch the league is
  // still `season` with `seasonContext === 'final'` — lifecycle `postseason`.
  // That is exactly when members go looking for the recap.
  const rows = [row('Alex', 12, 0, 0, 100), row('Blake', 8, 4, 4, 30)];
  const settled = seasonWrapGenerator.generate(
    makeContext({
      lifecycleState: 'postseason',
      seasonContext: 'final',
      currentYear: 2026,
      currentStandings: rows,
    })
  );
  assert.ok(settled.length > 0, 'a finished season must have a recap before rollover runs');
  for (const insight of settled) {
    assert.match(insight.title, /2026/, `the completed season is named: ${insight.title}`);
  }
});

test('INSIGHTS-032: a title decided level on wins EXPLAINS the deciding factor', () => {
  // `gamesBack` is `leaderWins - wins`, so two owners level on wins produce a
  // margin of zero and the copy read "took it by 0 games". Owner ruling
  // (2026-08-18): "we should explain what the winning factor was." The standings
  // sort is the authority — wins, win percentage, point differential, points
  // scored — so the first criterion they actually differ on is the answer.
  const leader = { ...row('Zoe', 10, 2, 0, 90), pointsFor: 400 };
  const runnerUp = { ...row('Yuri', 10, 2, 0, 40), pointsFor: 380 };
  const insights = seasonWrapGenerator.generate(
    preseasonWrapContext({
      archives: [wrapArchive(2025, [leader, runnerUp])],
      leagueMembers: new Set(['Zoe', 'Yuri']),
    })
  );

  const champion = insights.find((i) => i.type === 'champion_margin');
  assert.ok(champion, 'a level finish still has a champion');
  assert.doesNotMatch(champion.description, /by 0 games/, champion.description);
  assert.match(champion.description, /level on wins/, champion.description);
  assert.match(
    champion.description,
    /point differential/,
    `the deciding factor must be named; got: ${champion.description}`
  );
});

test('INSIGHTS-032: a title separated ONLY by owner name is withheld', () => {
  // Level on every ranked criterion: the standings sort falls back to the owner
  // NAME. That is a deterministic tiebreak for display, not a reason anyone won,
  // so there is no honest champion to report.
  const a = { ...row('Zoe', 10, 2, 0, 50), pointsFor: 400 };
  const b = { ...row('Yuri', 10, 2, 0, 50), pointsFor: 400 };
  const insights = seasonWrapGenerator.generate(
    preseasonWrapContext({
      archives: [wrapArchive(2025, [a, b])],
      leagueMembers: new Set(['Zoe', 'Yuri']),
    })
  );
  assert.ok(
    !insights.some((i) => i.type === 'champion_margin'),
    'an alphabetical tiebreak is not a winning factor'
  );
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

test('ANTI-VACUITY: makeContext honours a seasonOwners override', () => {
  // This helper hardcoded the membership field while honouring every other
  // override, so any test written to exercise the WITHHELD path would have passed
  // vacuously — in the file that would be used to regression-test that gate.
  assert.equal(makeContext({ seasonOwners: null }).seasonOwners, null);
  assert.deepEqual(makeContext({}).seasonOwners?.owners, ['Alice', 'Bob']);
});
