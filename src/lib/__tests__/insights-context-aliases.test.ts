import assert from 'node:assert/strict';
import test from 'node:test';

import { loadOwnerSeasonStats } from '../insights/context.ts';
import { setCachedGameStats } from '../gameStats/cache.ts';
import type { TeamGameStats } from '../gameStats/types.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../server/appStateStore.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

function makeTeam(school: string, points: number, homeAway: 'home' | 'away'): TeamGameStats {
  return {
    school,
    schoolId: 0,
    conference: 'Test',
    homeAway,
    points,
    totalYards: points * 10,
    rushingYards: 0,
    passingYards: 0,
    rushingAttempts: 0,
    passingAttempts: 0,
    passingCompletions: 0,
    rushingTDs: 0,
    passingTDs: 0,
    firstDowns: 0,
    turnovers: 0,
    fumblesLost: 0,
    interceptionsThrown: 0,
    passesIntercepted: 0,
    fumblesRecovered: 0,
    thirdDownAttempts: 0,
    thirdDownConversions: 0,
    thirdDownPct: 0,
    fourthDownAttempts: 0,
    fourthDownConversions: 0,
    penaltyCount: 0,
    penaltyYards: 0,
    possessionSeconds: 0,
    interceptionReturnYards: 0,
    interceptionReturnTDs: 0,
    kickReturnYards: 0,
    kickReturnTDs: 0,
    puntReturnYards: 0,
    puntReturnTDs: 0,
    // All analytics-required categories present: analytics require COMPLETE
    // stat coverage (sparse or legacy identity-only rows are ignored).
    raw: {
      netPassingYards: '100',
      possessionTime: '30:00',
      rushingYards: '100',
      thirdDownEff: '5-12',
      totalYards: String(points * 10),
      turnovers: '1',
    },
  };
}

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

  await setCachedGameStats({
    year,
    week: 1,
    seasonType: 'regular',
    fetchedAt: `${year}-09-02T00:00:00.000Z`,
    games: [
      {
        providerGameId: 1,
        week: 1,
        seasonType: 'regular',
        home: makeTeam('Gulf Coast Tech', 31, 'home'),
        away: makeTeam('Rival Tech', 10, 'away'),
      },
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
