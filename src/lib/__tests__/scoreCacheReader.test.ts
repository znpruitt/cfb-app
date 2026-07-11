import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadReconciledSeasonScores,
  loadReconciledSeasonScoresByType,
} from '../server/scoreCacheReader.ts';
import type { CacheEntry } from '../scores/cache.ts';
import type { ScorePack } from '../scores/types.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../server/appStateStore.ts';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

function restoreDatabaseUrl(): void {
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete MUTABLE_ENV.DATABASE_URL;
  } else {
    MUTABLE_ENV.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
}

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  restoreDatabaseUrl();
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  restoreDatabaseUrl();
});

function forceStoreReadFailure(): void {
  MUTABLE_ENV.NODE_ENV = 'production';
  delete MUTABLE_ENV.DATABASE_URL;
  __resetAppStateForTests();
}

function pack(id: string, home: string, away: string, hs: number, as: number): ScorePack {
  return {
    id,
    seasonType: 'regular',
    startDate: '2027-09-01T18:00:00.000Z',
    week: 1,
    status: 'final',
    home: { team: home, score: hs },
    away: { team: away, score: as },
    time: null,
  };
}

async function seedEntry(key: string, at: number, items: ScorePack[]): Promise<void> {
  const entry: CacheEntry = { at, items, source: 'cfbd', cfbdFallbackReason: 'none' };
  await setAppState('scores', key, entry);
}

// Identity resolution is exercised by the /api/scores route tests; here we pass
// an empty catalog so rows key by their stable `id:` fallback — enough to prove
// the read/merge/dedup/filter/failure behavior of the shared reader.
const NO_TEAMS = { teams: [], aliasMap: {} };

// ---------------------------------------------------------------------------
// PLATFORM-084B — shared cache-only season score reconciler. Canonical
// consumers and public /api/scores must read the SAME reconciled view of the
// season-wide + per-week score cache entries.
// ---------------------------------------------------------------------------

test('reconciles season-wide and per-week entries into one row set', async () => {
  await seedEntry('2027-all-regular', 1000, [pack('a', 'Alabama', 'Georgia', 21, 7)]);
  await seedEntry('2027-3-regular', 2000, [pack('b', 'Texas', 'Baylor', 35, 10)]);

  const { items, contributorCount } = await loadReconciledSeasonScores({
    year: 2027,
    seasonType: 'regular',
    ...NO_TEAMS,
  });

  assert.equal(contributorCount, 2);
  const ids = items.map((i) => i.id).sort();
  assert.deepEqual(ids, ['a', 'b']);
});

test('a game present only in a per-week key is included (the core 084B fix)', async () => {
  await seedEntry('2027-7-regular', 5000, [pack('week-only', 'Ohio State', 'Michigan', 30, 27)]);

  const { items } = await loadReconciledSeasonScores({
    year: 2027,
    seasonType: 'regular',
    ...NO_TEAMS,
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, 'week-only');
  assert.equal(items[0]!.home.score, 30);
});

test('a game in both season-wide and per-week keys does not double-count; newest wins', async () => {
  // Same game id in both keys, week entry newer with an updated (final) score.
  await seedEntry('2027-all-regular', 1000, [pack('dup', 'Alabama', 'Georgia', 14, 14)]);
  await seedEntry('2027-3-regular', 9000, [pack('dup', 'Alabama', 'Georgia', 21, 17)]);

  const { items } = await loadReconciledSeasonScores({
    year: 2027,
    seasonType: 'regular',
    ...NO_TEAMS,
  });

  assert.equal(items.length, 1, 'game counted once, not duplicated');
  assert.equal(items[0]!.home.score, 21, 'newest cache entry wins');
  assert.equal(items[0]!.away.score, 17);
});

test('an empty newer week entry cannot erase a populated season row', async () => {
  await seedEntry('2027-all-regular', 1000, [pack('g', 'Alabama', 'Georgia', 21, 7)]);
  await seedEntry('2027-4-regular', 9000, []);

  const { items } = await loadReconciledSeasonScores({
    year: 2027,
    seasonType: 'regular',
    ...NO_TEAMS,
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]!.id, 'g');
});

test('filters by seasonType (a postseason key is not read on a regular request)', async () => {
  await seedEntry('2027-all-regular', 1000, [pack('reg', 'Alabama', 'Georgia', 21, 7)]);
  await seedEntry('2027-1-postseason', 2000, [pack('post', 'Texas', 'Baylor', 35, 10)]);

  const regular = await loadReconciledSeasonScores({
    year: 2027,
    seasonType: 'regular',
    ...NO_TEAMS,
  });
  const postseason = await loadReconciledSeasonScores({
    year: 2027,
    seasonType: 'postseason',
    ...NO_TEAMS,
  });

  assert.deepEqual(
    regular.items.map((i) => i.id),
    ['reg']
  );
  assert.deepEqual(
    postseason.items.map((i) => i.id),
    ['post']
  );
});

test('genuine absence returns contributorCount 0 and no rows (valid, cacheable)', async () => {
  const result = await loadReconciledSeasonScores({
    year: 2027,
    seasonType: 'regular',
    ...NO_TEAMS,
  });
  assert.equal(result.contributorCount, 0);
  assert.deepEqual(result.items, []);
  assert.equal(result.newest, null);
});

test('a store read failure propagates and is not swallowed to empty (PLATFORM-084A)', async () => {
  forceStoreReadFailure();
  await assert.rejects(() =>
    loadReconciledSeasonScores({ year: 2027, seasonType: 'regular', ...NO_TEAMS })
  );
});

// ---------------------------------------------------------------------------
// loadReconciledSeasonScoresByType — one prefix read, partitioned in memory,
// so canonical standings / archive get both season types without a second scan.
// ---------------------------------------------------------------------------

test('byType partitions regular and postseason from a single read', async () => {
  await seedEntry('2027-all-regular', 1000, [pack('reg-a', 'Alabama', 'Georgia', 21, 7)]);
  await seedEntry('2027-3-regular', 2000, [pack('reg-b', 'Texas', 'Baylor', 35, 10)]);
  await seedEntry('2027-1-postseason', 3000, [pack('post-a', 'Ohio State', 'Michigan', 30, 27)]);

  const { regular, postseason } = await loadReconciledSeasonScoresByType({
    year: 2027,
    ...NO_TEAMS,
  });

  assert.deepEqual(regular.items.map((i) => i.id).sort(), ['reg-a', 'reg-b']);
  assert.deepEqual(
    postseason.items.map((i) => i.id),
    ['post-a']
  );
});

test('byType includes per-week entries for both season types (the core 084B fix)', async () => {
  // Both finals live ONLY in per-week keys, never in a `-all-*` key.
  await seedEntry('2027-7-regular', 5000, [pack('rw', 'Ohio State', 'Michigan', 30, 27)]);
  await seedEntry('2027-2-postseason', 6000, [pack('pw', 'Texas', 'Baylor', 42, 3)]);

  const { regular, postseason } = await loadReconciledSeasonScoresByType({
    year: 2027,
    ...NO_TEAMS,
  });

  assert.deepEqual(
    regular.items.map((i) => i.id),
    ['rw']
  );
  assert.deepEqual(
    postseason.items.map((i) => i.id),
    ['pw']
  );
});

test('byType returns empty per season type on genuine absence', async () => {
  const { regular, postseason } = await loadReconciledSeasonScoresByType({
    year: 2027,
    ...NO_TEAMS,
  });
  assert.equal(regular.contributorCount, 0);
  assert.deepEqual(regular.items, []);
  assert.equal(postseason.contributorCount, 0);
  assert.deepEqual(postseason.items, []);
});

test('byType propagates a store read failure (PLATFORM-084A)', async () => {
  forceStoreReadFailure();
  await assert.rejects(() => loadReconciledSeasonScoresByType({ year: 2027, ...NO_TEAMS }));
});
