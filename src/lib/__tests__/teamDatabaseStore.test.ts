import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteTeamDatabaseStoreFileForTests,
  __getTeamDatabaseStoreFilePathForTests,
  __resetTeamDatabaseStoreForTests,
  getTeamDatabaseFile,
  setTeamDatabaseFile,
} from '../server/teamDatabaseStore.ts';

test.beforeEach(async () => {
  __resetTeamDatabaseStoreForTests();
  await __deleteTeamDatabaseStoreFileForTests();
});

test('persists and reloads durable team database store', async () => {
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: '2026-03-23T12:00:00.000Z',
    items: [
      {
        id: 'texas',
        providerId: 42,
        school: 'Texas',
        abbreviation: 'TEX',
        mascot: 'Longhorns',
        conference: 'SEC',
        color: '#BF5700',
        altColor: '#FFFFFF',
        logos: ['https://example.com/texas.svg'],
        alts: ['texas', 'texas longhorns'],
      },
    ],
  });

  __resetTeamDatabaseStoreForTests();

  const loaded = await getTeamDatabaseFile();
  assert.equal(loaded.updatedAt, '2026-03-23T12:00:00.000Z');
  assert.equal(loaded.items[0]?.id, 'texas');
  assert.equal(loaded.items[0]?.color, '#BF5700');
  assert.equal(loaded.items[0]?.altColor, '#FFFFFF');
  assert.match(__getTeamDatabaseStoreFilePathForTests(), /data\/team-database\.json$/);
});
