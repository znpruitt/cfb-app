import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSeasonArchive } from '../seasonRollover.ts';
import { getCanonicalStandings } from '../selectors/leagueStandings.ts';
import type { TeamCatalogItem } from '../teamIdentity.ts';
import type { League } from '../league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../server/appStateStore.ts';
import {
  __resetTeamDatabaseStoreForTests,
  setTeamDatabaseFile,
} from '../server/teamDatabaseStore.ts';

const SLUG = 'archive-league';
const YEAR = 2025;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
});

// Controlled team DB so provider labels resolve ONLY via the alias map (not via
// the real catalog fallback). FBS conference so roster/identity resolution works.
async function seedTeamDb(schools: string[]): Promise<void> {
  const items: TeamCatalogItem[] = schools.map((school) => ({
    school,
    conference: 'Mountain West',
  }));
  await setTeamDatabaseFile({ source: 'cfbd', updatedAt: '2025-01-01T00:00:00.000Z', items });
}

async function seedScoredGame(params: {
  homeProvider: string;
  awayProvider: string;
  homeScore: number;
  awayScore: number;
}): Promise<void> {
  const { homeProvider, awayProvider, homeScore, awayScore } = params;
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      {
        id: 'game-1',
        week: 1,
        startDate: `${YEAR}-09-01T18:00:00.000Z`,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: homeProvider,
        awayTeam: awayProvider,
        homeConference: 'Mountain West',
        awayConference: 'Mountain West',
        status: 'final',
        seasonType: 'regular',
      },
    ],
  });
  await setAppState('scores', `${YEAR}-all-regular`, {
    items: [
      {
        id: 'game-1',
        seasonType: 'regular',
        startDate: `${YEAR}-09-01T18:00:00.000Z`,
        week: 1,
        status: 'final',
        home: { team: homeProvider, score: homeScore },
        away: { team: awayProvider, score: awayScore },
        time: null,
      },
    ],
  });
}

async function seedOwners(csv: string): Promise<void> {
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', csv);
}

function makeLeague(): League {
  return {
    slug: SLUG,
    displayName: 'Archive League',
    year: YEAR,
    createdAt: '2024-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  };
}

function winsFor(rows: Array<{ owner: string; wins: number }>, owner: string): number {
  return rows.find((r) => r.owner === owner)?.wins ?? 0;
}

test('buildSeasonArchive: resolves a game via a global-only alias', async () => {
  await seedTeamDb(['Texas', 'Rival Tech']);
  await seedAlias('aliases:global', { 'gulf coast tech': 'Texas' });
  await seedOwners(['team,owner', 'Texas,Alice', 'Rival Tech,Bob'].join('\n'));
  await seedScoredGame({
    homeProvider: 'Gulf Coast Tech',
    awayProvider: 'Rival Tech',
    homeScore: 31,
    awayScore: 10,
  });

  const archive = await buildSeasonArchive(SLUG, YEAR);
  assert.equal(winsFor(archive.finalStandings, 'Alice'), 1, 'global-only alias credits Alice');
});

test('buildSeasonArchive: resolves a game via a year-only alias fallback', async () => {
  await seedTeamDb(['Texas', 'Rival Tech']);
  await seedAlias(`aliases:${YEAR}`, { 'gulf coast tech': 'Texas' });
  await seedOwners(['team,owner', 'Texas,Alice', 'Rival Tech,Bob'].join('\n'));
  await seedScoredGame({
    homeProvider: 'Gulf Coast Tech',
    awayProvider: 'Rival Tech',
    homeScore: 24,
    awayScore: 3,
  });

  const archive = await buildSeasonArchive(SLUG, YEAR);
  assert.equal(winsFor(archive.finalStandings, 'Alice'), 1, 'year-only alias credits Alice');
});

test('buildSeasonArchive: resolves a game via a SEED_ALIASES fallback', async () => {
  // `byu` → `brigham young` is a static seed; team DB has Brigham Young (no BYU
  // alt), so the provider label `byu` resolves only through the seed default.
  await seedTeamDb(['Brigham Young', 'Rival Tech']);
  await seedOwners(['team,owner', 'Brigham Young,Alice', 'Rival Tech,Bob'].join('\n'));
  await seedScoredGame({
    homeProvider: 'byu',
    awayProvider: 'Rival Tech',
    homeScore: 28,
    awayScore: 14,
  });

  const archive = await buildSeasonArchive(SLUG, YEAR);
  assert.equal(winsFor(archive.finalStandings, 'Alice'), 1, 'seed fallback credits Alice');
});

test('buildSeasonArchive: a league+year repair beats the seed fallback', async () => {
  // Seed `byu`→brigham young; a league repair maps `byu`→Texas. The repair wins,
  // so the game credits the Texas owner, not the Brigham Young owner.
  await seedTeamDb(['Texas', 'Brigham Young', 'Rival Tech']);
  await seedAlias(`aliases:${SLUG}:${YEAR}`, { byu: 'Texas' });
  await seedOwners(
    ['team,owner', 'Texas,Alice', 'Brigham Young,Carol', 'Rival Tech,Bob'].join('\n')
  );
  await seedScoredGame({
    homeProvider: 'byu',
    awayProvider: 'Rival Tech',
    homeScore: 20,
    awayScore: 17,
  });

  const archive = await buildSeasonArchive(SLUG, YEAR);
  assert.equal(winsFor(archive.finalStandings, 'Alice'), 1, 'league repair (Texas) credited');
  assert.equal(
    winsFor(archive.finalStandings, 'Carol'),
    0,
    'seed target (Brigham Young) NOT credited'
  );
});

test('buildSeasonArchive: archived standings agree with live canonical for a global alias', async () => {
  await seedTeamDb(['Texas', 'Rival Tech']);
  await setAppState('leagues', 'registry', [makeLeague()]);
  await seedAlias('aliases:global', { 'gulf coast tech': 'Texas' });
  await seedOwners(['team,owner', 'Texas,Alice', 'Rival Tech,Bob'].join('\n'));
  await seedScoredGame({
    homeProvider: 'Gulf Coast Tech',
    awayProvider: 'Rival Tech',
    homeScore: 31,
    awayScore: 10,
  });

  const archive = await buildSeasonArchive(SLUG, YEAR);
  const canonical = await getCanonicalStandings({
    slug: SLUG,
    leagueStatusOverride: { state: 'season', year: YEAR },
  });

  assert.equal(winsFor(archive.finalStandings, 'Alice'), 1);
  assert.equal(
    winsFor(archive.finalStandings, 'Alice'),
    winsFor(canonical.rows, 'Alice'),
    'archive credits the same owner as live canonical'
  );
});

async function seedAlias(scope: string, map: Record<string, string>): Promise<void> {
  await setAppState(scope, 'map', map);
}
