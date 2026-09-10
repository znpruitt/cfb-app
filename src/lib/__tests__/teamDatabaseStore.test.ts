import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TEAM_DATABASE_DELETE_SEAM_REFUSAL,
  __deleteTeamDatabaseStoreFileForTests,
  __getTeamDatabaseStoreFilePathForTests,
  __resetTeamDatabaseStoreForTests,
  __setTeamDatabaseWriteImplForTests,
  getTeamDatabaseFile,
  setTeamDatabaseFile,
} from '../server/teamDatabaseStore.ts';
import { assertDurableStoreUntouched, withSeamSandbox } from '@/test/appStateSeamSandbox';

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

test('write implementation override hook is a no-op in app-state durability mode', async () => {
  let attempt = 0;
  __setTeamDatabaseWriteImplForTests(async () => {
    attempt += 1;
    throw new Error('disk full');
  });

  await assert.doesNotReject(
    setTeamDatabaseFile({
      source: 'cfbd',
      updatedAt: '2026-03-24T00:00:00.000Z',
      items: [{ id: 'rice', school: 'Rice', alts: [] }],
    })
  );

  await assert.doesNotReject(
    setTeamDatabaseFile({
      source: 'cfbd',
      updatedAt: '2026-03-24T01:00:00.000Z',
      items: [{ id: 'baylor', school: 'Baylor', alts: [] }],
    })
  );

  const loaded = await getTeamDatabaseFile();
  assert.equal(attempt, 0);
  assert.equal(loaded.items[0]?.id, 'baylor');
});

test('memory store updates on successive successful writes', async () => {
  await setTeamDatabaseFile(persistedFile);

  let attempt = 0;
  __setTeamDatabaseWriteImplForTests(async () => {
    attempt += 1;
    throw new Error('permissions');
  });

  await assert.doesNotReject(
    setTeamDatabaseFile({
      source: 'cfbd',
      updatedAt: '2026-03-24T05:00:00.000Z',
      items: [{ id: 'rice', school: 'Rice', alts: [] }],
    })
  );

  const afterFirstWrite = await getTeamDatabaseFile();
  assert.equal(afterFirstWrite.items[0]?.id, 'rice');
  assert.equal(afterFirstWrite.updatedAt, '2026-03-24T05:00:00.000Z');

  await assert.doesNotReject(
    setTeamDatabaseFile({
      source: 'cfbd',
      updatedAt: '2026-03-24T06:00:00.000Z',
      items: [{ id: 'rice', school: 'Rice', alts: [] }],
    })
  );

  const afterSuccess = await getTeamDatabaseFile();
  assert.equal(attempt, 0);
  assert.equal(afterSuccess.items[0]?.id, 'rice');
  assert.equal(afterSuccess.updatedAt, '2026-03-24T06:00:00.000Z');
});

test('fallback catalog derives stable ids before first sync', async () => {
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
});

// ---------------------------------------------------------------------------
// PLATFORM-211 — this seam is destructive outside an isolated test process.
//
// Item 210's guard 1 refuses a real pool, but only while isolation is ON. A bare
// `node --test src/...` leaves APP_STATE_TEST_ISOLATION unset, guard 1 cannot
// tell that run from ordinary application startup, and this seam then deletes
// real rows for its scope. The condition asserted here is the inverse one, which
// is why it is a separate assertion rather than a restatement.
//
// Both tests run inside `withSeamSandbox` — the pinned unreachable DATABASE_URL
// and the relocated cwd. See `appStateSeamSandbox.ts` for why BOTH are needed;
// the short version is that pinning selects a branch rather than disabling a
// write, so it is one regression away from the real store.
// ---------------------------------------------------------------------------

test('__deleteTeamDatabaseStoreFileForTests refuses to run outside an isolated test process', async () => {
  // The MESSAGE is the assertion, not merely that it rejected. Without the guard
  // this still rejects — with ECONNREFUSED from the pinned URL — so a bare
  // `assert.rejects` would pass on the very defect it exists to catch.
  await withSeamSandbox({ APP_STATE_TEST_ISOLATION: undefined }, async () => {
    await assert.rejects(
      () => __deleteTeamDatabaseStoreFileForTests(),
      (error: unknown) =>
        error instanceof Error && error.message === TEAM_DATABASE_DELETE_SEAM_REFUSAL
    );
  });
});

test('under isolation the team-database delete seam still deletes the persisted catalog', async () => {
  await setTeamDatabaseFile(persistedFile);
  __resetTeamDatabaseStoreForTests();
  const persisted = await getTeamDatabaseFile();
  assert.equal(persisted.items.length, 1);
  assert.equal(persisted.items[0]?.id, 'texas');

  await __deleteTeamDatabaseStoreFileForTests();
  __resetTeamDatabaseStoreForTests();

  // With nothing persisted the reader falls back to the seed catalog, so the
  // discriminator is that the one-team persisted file is GONE — not that the
  // read came back empty, which it never does.
  const afterDelete = await getTeamDatabaseFile();
  assert.ok(afterDelete.items.length > 1);
  assert.ok(afterDelete.items.some((item) => item.id === 'alabama'));
});

test('the suite left the durable data/app-state.json untouched', () => {
  assertDurableStoreUntouched();
});
