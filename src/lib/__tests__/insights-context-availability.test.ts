import assert from 'node:assert/strict';
import test from 'node:test';

import { setCachedGameStats } from '../gameStats/cache.ts';
import {
  completeLegacyRow,
  prototypeNamedCategoryLegacyRow,
  statlessLegacyRow,
} from '../gameStats/__tests__/fixtures.ts';
import { buildOwnerCareerStats, loadOwnerSeasonStats } from '../insights/context.ts';
import type { SeasonArchive } from '../seasonArchive.ts';
import { __deleteAppStateFileForTests, __resetAppStateForTests } from '../server/appStateStore.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

async function seedWeek(year: number, games: Parameters<typeof setCachedGameStats>[0]['games']) {
  await setCachedGameStats({
    year,
    week: 1,
    seasonType: 'regular',
    fetchedAt: `${year}-09-02T00:00:00.000Z`,
    games,
  });
}

const roster = new Map<string, string>([
  ['Alpha State', 'Alice'],
  ['Beta Tech', 'Bob'],
]);

// PLATFORM-086H1: analytics availability must distinguish the four internal
// states — a cached week key alone is NOT healthy availability, and zero
// eligible games must never surface as an empty-but-"available" aggregate.

test('no cached partitions → cache-unavailable', async () => {
  const result = await loadOwnerSeasonStats('avail-none', 2024, roster, []);
  assert.deepEqual(result, { state: 'cache-unavailable' });
});

test('cache exists with zero eligible games → no-eligible-games, not available', async () => {
  // An empty partition (the known pre-086H empty-write shape)…
  await seedWeek(2024, []);
  const empty = await loadOwnerSeasonStats('avail-empty', 2024, roster, []);
  assert.deepEqual(empty, { state: 'no-eligible-games' });

  // …and a partition whose every row is analytics-INELIGIBLE behave the same.
  await seedWeek(2023, [statlessLegacyRow(50)]);
  const ineligible = await loadOwnerSeasonStats('avail-ineligible', 2023, roster, []);
  assert.deepEqual(ineligible, { state: 'no-eligible-games' });
});

test('eligible games that map to no rostered owner → no-owner-mapping, distinct from no-eligible', async () => {
  await seedWeek(2024, [completeLegacyRow(60)]);
  const unmapped = await loadOwnerSeasonStats(
    'avail-unmapped',
    2024,
    new Map([['Unrelated College', 'Zoe']]),
    []
  );
  assert.deepEqual(unmapped, { state: 'no-owner-mapping' });
});

test('eligible owner aggregates → available with stats', async () => {
  await seedWeek(2024, [completeLegacyRow(70)]);
  const result = await loadOwnerSeasonStats('avail-ok', 2024, roster, []);
  assert.equal(result.state, 'available');
  const stats = result.state === 'available' ? result.stats : [];
  const alice = stats.find((s) => s.owner === 'Alice');
  assert.ok(alice);
  assert.equal(alice!.gamesPlayed, 1);
  assert.equal(alice!.totalYards, 412);
});

test('a prototype-named category row does not suppress Insights availability', async () => {
  // One poisoned row in the same partition must neither crash owner-stat
  // loading nor degrade the season to unavailable.
  await seedWeek(2024, [completeLegacyRow(75), prototypeNamedCategoryLegacyRow(76)]);
  const result = await loadOwnerSeasonStats('avail-proto', 2024, roster, []);
  assert.equal(result.state, 'available');
  const stats = result.state === 'available' ? result.stats : [];
  assert.equal(stats.find((s) => s.owner === 'Alice')?.gamesPlayed, 1);
});

function minimalArchive(year: number, rosterCsv: string): SeasonArchive {
  return {
    leagueSlug: 'avail-career',
    year,
    archivedAt: `${year}-12-15T00:00:00.000Z`,
    ownerRosterSnapshot: rosterCsv,
    standingsHistory: { weeks: [] },
    finalStandings: [],
    games: [],
    scoresByKey: {},
  } as unknown as SeasonArchive;
}

test('career totals: compatible years contribute; zero-eligible years read as cache-unavailable diagnostics', async () => {
  // 2023: only an analytics-ineligible (statless) row — cache key exists but
  // must NOT be reported as available, and must contribute no totals.
  await seedWeek(2023, [statlessLegacyRow(80)]);
  // 2024: a compatible legacy row that must keep contributing career yards —
  // alongside a prototype-named-category row that must not knock the whole
  // historical season out of career aggregation.
  await seedWeek(2024, [completeLegacyRow(81), prototypeNamedCategoryLegacyRow(82)]);

  const rosterCsv = 'Team,Owner\nAlpha State,Alice\nBeta Tech,Bob';
  const { ownerCareerStats, diagnosticsByYear } = await buildOwnerCareerStats({
    leagueSlug: 'avail-career',
    currentYear: 2025,
    archives: [minimalArchive(2023, rosterCsv), minimalArchive(2024, rosterCsv)],
    historicalRosters: {
      2023: roster,
      2024: roster,
    },
    currentRoster: roster,
  });

  const alice = ownerCareerStats.find((s) => s.owner === 'Alice');
  assert.ok(alice, 'Alice has career stats');
  // Historical career totals do not silently collapse: the compatible year's
  // yards survive the contract rollout.
  assert.equal(alice!.totalYards, 412);
  assert.equal(diagnosticsByYear[2024]!.gameStatsCacheAvailable, true);
  // The ineligible-only year is truthfully NOT available analytics.
  assert.equal(diagnosticsByYear[2023]!.gameStatsCacheAvailable, false);
});
