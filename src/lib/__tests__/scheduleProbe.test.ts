import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveFirstGameDate } from '../scheduleProbe.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../server/appStateStore.ts';
import { __resetTeamDatabaseStoreForTests } from '../server/teamDatabaseStore.ts';

const YEAR = 2026;

async function seedTeamCatalog(
  items: Array<{
    school: string;
    level?: string;
    conference?: string;
    alts?: string[];
  }>
): Promise<void> {
  await setAppState('team-database', 'current', {
    source: 'cfbd',
    updatedAt: '2026-08-01T00:00:00.000Z',
    items,
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
});

test('uses the earliest UTC date with an FBS catalog participant', async () => {
  await seedTeamCatalog([{ school: 'Texas', level: 'FBS' }]);

  const firstGameDate = await deriveFirstGameDate(YEAR, [
    {
      homeTeam: 'North Alabama',
      awayTeam: 'Mercer',
      startDate: '2026-08-27T18:00:00.000Z',
    },
    {
      homeTeam: 'Texas',
      awayTeam: 'North Texas',
      startDate: '2026-08-29T23:30:00-05:00',
    },
    {
      homeTeam: 'Texas',
      awayTeam: 'Rice',
      startDate: '2026-08-31T01:00:00.000Z',
    },
  ]);

  assert.equal(firstGameDate, '2026-08-30T00:00:00.000Z');
});

test('resolves a participant through the league-agnostic alias map', async () => {
  await seedTeamCatalog([{ school: 'Texas', level: 'FBS' }]);
  await setAppState('aliases:2026', 'map', { ut: 'Texas' });

  const firstGameDate = await deriveFirstGameDate(YEAR, [
    {
      homeTeam: 'FCS Alpha',
      awayTeam: 'FCS Beta',
      startDate: '2026-08-20T12:00:00.000Z',
    },
    {
      homeTeam: 'UT',
      awayTeam: 'FCS Alpha',
      startDate: '2026-08-28T19:00:00.000Z',
    },
  ]);

  assert.equal(firstGameDate, '2026-08-28T00:00:00.000Z');
});

test('does not promote provider-only observed names into catalog identities', async () => {
  await seedTeamCatalog([{ school: 'Texas', level: 'FBS' }]);

  const firstGameDate = await deriveFirstGameDate(YEAR, [
    {
      homeTeam: 'Provider-Only Alpha',
      awayTeam: 'Provider-Only Beta',
      startDate: '2026-08-22T22:15:00.000Z',
    },
    {
      homeTeam: 'Texas',
      awayTeam: 'Rice',
      startDate: '2026-08-29T18:00:00.000Z',
    },
  ]);

  assert.equal(firstGameDate, '2026-08-29T00:00:00.000Z');
});

test('does not treat a catalog-backed FCS participant as league-visible', async () => {
  await seedTeamCatalog([
    { school: 'Mercer', conference: 'Southern Conference' },
    { school: 'Texas', level: 'FBS' },
  ]);

  const firstGameDate = await deriveFirstGameDate(YEAR, [
    {
      homeTeam: 'Mercer',
      awayTeam: 'North Alabama',
      startDate: '2026-08-22T18:00:00.000Z',
    },
    {
      homeTeam: 'Texas',
      awayTeam: 'Rice',
      startDate: '2026-08-29T18:00:00.000Z',
    },
  ]);

  assert.equal(firstGameDate, '2026-08-29T00:00:00.000Z');
});

test('ignores kickoff precision and TBD confidence for the date anchor', async () => {
  await seedTeamCatalog([{ school: 'Texas', level: 'FBS' }]);

  const firstGameDate = await deriveFirstGameDate(YEAR, [
    {
      homeTeam: 'Texas',
      awayTeam: 'Rice',
      startDate: '2026-08-28T23:59:00.000Z',
      startTimeTBD: true,
    },
    {
      homeTeam: 'Texas',
      awayTeam: 'UTSA',
      startDate: '2026-08-29T00:01:00.000Z',
      startTimeTBD: false,
    },
  ]);

  assert.equal(firstGameDate, '2026-08-28T00:00:00.000Z');
});

test('falls back to the earliest parseable UTC date when no row is catalog-backed', async () => {
  await seedTeamCatalog([]);

  const firstGameDate = await deriveFirstGameDate(YEAR, [
    {
      homeTeam: 'Unknown Alpha',
      awayTeam: 'Unknown Beta',
      startDate: '2026-08-27T23:00:00-05:00',
    },
    {
      homeTeam: 'Unknown Gamma',
      awayTeam: 'Unknown Delta',
      startDate: '2026-08-26T15:00:00.000Z',
    },
  ]);

  assert.equal(firstGameDate, '2026-08-26T00:00:00.000Z');
});

test('returns null when no kickoff is parseable', async () => {
  const firstGameDate = await deriveFirstGameDate(YEAR, [
    { homeTeam: 'Texas', awayTeam: 'Rice', startDate: null },
    { homeTeam: 'Texas', awayTeam: 'UTSA', startDate: 'not-a-date' },
  ]);

  assert.equal(firstGameDate, null);
});
