import assert from 'node:assert/strict';
import test from 'node:test';

import { getSafeScoreboardTeamColorById } from '../teamColors.ts';
import {
  __deleteTeamDatabaseStoreFileForTests,
  __getTeamDatabaseStoreFilePathForTests,
  __resetTeamDatabaseStoreForTests,
  __setTeamDatabaseWriteImplForTests,
  getTeamDatabaseFile,
  setTeamDatabaseFile,
} from '../server/teamDatabaseStore.ts';

const persistedFile = {
  source: 'cfbd' as const,
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
};

test.beforeEach(async () => {
  __resetTeamDatabaseStoreForTests();
  await __deleteTeamDatabaseStoreFileForTests();
});

test('persists and reloads durable team database store', async () => {
  await setTeamDatabaseFile(persistedFile);

  __resetTeamDatabaseStoreForTests();

  const loaded = await getTeamDatabaseFile();
  assert.equal(loaded.updatedAt, '2026-03-23T12:00:00.000Z');
  assert.equal(loaded.items[0]?.id, 'texas');
  assert.equal(loaded.items[0]?.color, '#BF5700');
  assert.equal(loaded.items[0]?.altColor, '#FFFFFF');
  assert.match(__getTeamDatabaseStoreFilePathForTests(), /data\/team-database\.json$/);
});

test('write queue recovers after a failed persistence attempt', async () => {
  let attempt = 0;
  __setTeamDatabaseWriteImplForTests(async () => {
    attempt += 1;
    if (attempt === 1) {
      throw new Error('disk full');
    }
  });

  await assert.rejects(
    setTeamDatabaseFile({
      source: 'cfbd',
      updatedAt: '2026-03-24T00:00:00.000Z',
      items: [{ id: 'rice', school: 'Rice', alts: [] }],
    }),
    /disk full/
  );

  await assert.doesNotReject(
    setTeamDatabaseFile({
      source: 'cfbd',
      updatedAt: '2026-03-24T01:00:00.000Z',
      items: [{ id: 'baylor', school: 'Baylor', alts: [] }],
    })
  );

  const loaded = await getTeamDatabaseFile();
  assert.equal(attempt, 2);
  assert.equal(loaded.items[0]?.id, 'baylor');
});

test('memory store only updates after persistence succeeds', async () => {
  await setTeamDatabaseFile(persistedFile);

  let shouldFail = true;
  __setTeamDatabaseWriteImplForTests(async () => {
    if (shouldFail) throw new Error('permissions');
  });

  await assert.rejects(
    setTeamDatabaseFile({
      source: 'cfbd',
      updatedAt: '2026-03-24T05:00:00.000Z',
      items: [{ id: 'rice', school: 'Rice', alts: [] }],
    }),
    /permissions/
  );

  const afterFailure = await getTeamDatabaseFile();
  assert.equal(afterFailure.items[0]?.id, 'texas');
  assert.equal(afterFailure.updatedAt, persistedFile.updatedAt);

  shouldFail = false;
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: '2026-03-24T06:00:00.000Z',
    items: [{ id: 'rice', school: 'Rice', alts: [] }],
  });

  const afterSuccess = await getTeamDatabaseFile();
  assert.equal(afterSuccess.items[0]?.id, 'rice');
  assert.equal(afterSuccess.updatedAt, '2026-03-24T06:00:00.000Z');
});

test('fallback catalog derives stable ids before first sync and supports id-based color lookup', async () => {
  const fallback = await getTeamDatabaseFile();
  const ids = fallback.items.map((item) => item.id).filter((id): id is string => Boolean(id));
  const teamCatalogById = new Map(
    fallback.items
      .filter((item): item is typeof item & { id: string } => Boolean(item.id))
      .map((item) => [item.id, item])
  );

  assert.ok(ids.length > 0);
  assert.ok(teamCatalogById.has('alabama'));
  assert.equal(teamCatalogById.get('alabama')?.school, 'Alabama');
  assert.equal(getSafeScoreboardTeamColorById('alabama', teamCatalogById).source, 'fallback');
});
