import assert from 'node:assert/strict';
import test from 'node:test';

import { loadOwnerSeasonStats } from '../insights/context.ts';
import { setCachedGameStats } from '../gameStats/cache.ts';
import { seedLegacyWriterControl } from '../gameStats/__tests__/writerControlSeed.ts';
import { legacyRowFromWire, wireGame } from '../gameStats/__tests__/fixtures.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../server/appStateStore.ts';
import {
  __resetTeamDatabaseStoreForTests,
  setTeamDatabaseFile,
} from '../server/teamDatabaseStore.ts';

// PLATFORM-055 remediation P2 (re-pinned through the PLATFORM-086H3E3 live
// paired-provenance path): Insights stat aggregation must resolve team
// identity through the same effective alias map (global > year > SEED_ALIASES)
// as canonical standings. Per PLATFORM-067, league-scoped aliases are ignored
// at runtime, so the global mapping wins. The load now runs the FULL live
// pipeline: one scored season build, slate derived from that exact build,
// final-score + complete-evidence projection, then owner aggregation.

const SLUG = 'insights-alias-precedence';
const YEAR = 2025;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  await seedLegacyWriterControl();
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
});

async function seedSeason(): Promise<void> {
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: '2025-01-01T00:00:00.000Z',
    items: [
      { school: 'Texas', conference: 'SEC' },
      { school: 'Georgia', conference: 'SEC' },
      { school: 'Rival Tech', conference: 'Mountain West' },
    ],
  });
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      {
        id: '1',
        week: 1,
        startDate: `${YEAR}-09-01T18:00:00.000Z`,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Gulf Coast Tech',
        awayTeam: 'Rival Tech',
        homeId: 9101,
        awayId: 9102,
        homeConference: 'SEC',
        awayConference: 'Mountain West',
        status: 'final',
        seasonType: 'regular',
      },
    ],
  });
  await setAppState('scores', `${YEAR}-all-regular`, {
    items: [
      {
        id: '1',
        seasonType: 'regular',
        startDate: `${YEAR}-09-01T18:00:00.000Z`,
        week: 1,
        status: 'final',
        home: { team: 'Gulf Coast Tech', score: 31 },
        away: { team: 'Rival Tech', score: 10 },
        time: null,
      },
    ],
  });
  // Complete, participant-id-bearing legacy row through the REAL legacy writer.
  await setCachedGameStats({
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: `${YEAR}-09-02T00:00:00.000Z`,
    games: [
      legacyRowFromWire(
        wireGame({
          id: 1,
          home: { school: 'Gulf Coast Tech', teamId: 9101 },
          away: { school: 'Rival Tech', teamId: 9102 },
        }),
        1
      ),
    ],
  });
}

test('insights context resolves owner stats with global-first alias precedence', async () => {
  // Global maps the provider label to Texas (Alice); a league scope maps it to
  // Georgia (Bob) but is IGNORED, so global (Texas/Alice) must win.
  await setAppState('aliases:global', 'map', { 'gulf coast tech': 'Texas' });
  await setAppState(`aliases:${SLUG}:${YEAR}`, 'map', { 'gulf coast tech': 'Georgia' });
  await seedSeason();

  const roster = new Map<string, string>([
    ['Texas', 'Alice'],
    ['Georgia', 'Bob'],
    ['Rival Tech', 'Carol'],
  ]);

  const load = await loadOwnerSeasonStats(SLUG, YEAR, roster, { kind: 'live' });
  assert.equal(load.status, 'available');
  const stats = load.status === 'available' ? load.stats : [];
  const owners = stats.map((s) => s.owner);
  assert.ok(owners.includes('Alice'), 'global target (Texas/Alice) credited the stats');
  assert.ok(!owners.includes('Bob'), 'league target (Georgia/Bob) NOT credited');
  assert.ok(owners.includes('Carol'), 'the opponent owner aggregated too');
});

test('the live path fails closed when the schedule cache is unavailable', async () => {
  await setAppState('aliases:global', 'map', {});
  const load = await loadOwnerSeasonStats(SLUG, YEAR, new Map(), { kind: 'live' });
  assert.deepEqual(load, { status: 'unavailable', reason: 'schedule-cache-unavailable' });
});
