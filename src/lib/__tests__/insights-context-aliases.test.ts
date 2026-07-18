import assert from 'node:assert/strict';
import test from 'node:test';

import { loadOwnerSeasonStats } from '../insights/context.ts';
import {
  legacyRowFromWire,
  seedGameStatsPartitionForTests,
  wireGame,
} from '../gameStats/__tests__/fixtures.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../server/appStateStore.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

// PLATFORM-086H3: aggregation flows through the analytics projection, so the
// seeded row must be a real analytics-eligible legacy row (built through the
// legacy writer fixture), not a hand-rolled statless shape the projection
// would rightly exclude.

// PLATFORM-055 remediation P2: Insights stat aggregation must resolve team
// identity through the same effective alias map (global > year > SEED_ALIASES)
// as canonical standings. Before the fix, insights/context used a private
// league-first merge, so a conflicting global vs scoped alias could attribute a
// team's stats to a different owner than the standings show. Per PLATFORM-067,
// league-scoped aliases are ignored at runtime, so the global mapping wins.
test('insights context resolves owner stats with global-first alias precedence', async () => {
  const slug = 'insights-alias-precedence';
  const year = 2025;
  // Global maps the provider label to Texas (Alice); a league scope maps it to
  // Georgia (Bob) but is IGNORED, so global (Texas/Alice) must win.
  await setAppState('aliases:global', 'map', { 'gulf coast tech': 'Texas' });
  await setAppState(`aliases:${slug}:${year}`, 'map', { 'gulf coast tech': 'Georgia' });

  await seedGameStatsPartitionForTests({
    year,
    week: 1,
    seasonType: 'regular',
    fetchedAt: `${year}-09-02T00:00:00.000Z`,
    games: [
      legacyRowFromWire(
        wireGame({
          id: 1,
          home: { school: 'Gulf Coast Tech', points: 31 },
          away: { school: 'Rival Tech', points: 10 },
        }),
        1
      ),
    ],
  });

  const roster = new Map<string, string>([
    ['Texas', 'Alice'],
    ['Georgia', 'Bob'],
    ['Rival Tech', 'Carol'],
  ]);

  const stats = await loadOwnerSeasonStats(slug, year, roster, []);
  assert.ok(stats, 'owner season stats produced');
  const owners = stats!.map((s) => s.owner);
  assert.ok(owners.includes('Alice'), 'global target (Texas/Alice) credited the stats');
  assert.ok(!owners.includes('Bob'), 'league target (Georgia/Bob) NOT credited');
});
