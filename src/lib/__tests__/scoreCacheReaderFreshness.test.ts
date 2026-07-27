import assert from 'node:assert/strict';
import test from 'node:test';

import { loadReconciledSeasonScores } from '../server/scoreCacheReader.ts';
import type { CacheEntry } from '../scores/cache.ts';
import type { ScorePack } from '../scores/types.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../server/appStateStore.ts';

// PLATFORM-086B1 — per-provider-game-id effective-timestamp reconciliation. A
// live merge rewrites a child entry to preserve untouched rows; those preserved
// rows must NOT be re-stamped with the entry's new `at`, or they would out-rank a
// genuinely newer copy of the same game in another entry.

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const NO_TEAMS = { teams: [], aliasMap: {} };

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  if (ORIGINAL_DATABASE_URL === undefined) delete MUTABLE_ENV.DATABASE_URL;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_DATABASE_URL === undefined) delete MUTABLE_ENV.DATABASE_URL;
  else MUTABLE_ENV.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

function pack(id: string, homeScore: number): ScorePack {
  return {
    id,
    seasonType: 'regular',
    startDate: '2025-09-01T18:00:00.000Z',
    week: 3,
    status: 'final',
    home: { team: `Home ${id}`, score: homeScore },
    away: { team: `Away ${id}`, score: 0 },
    time: null,
  };
}

async function seed(
  key: string,
  entry: Partial<CacheEntry> & { items: ScorePack[] }
): Promise<void> {
  await setAppState('scores', key, {
    at: 1000,
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    ...entry,
  });
}

test('a preserved old child row does not override a newer season-wide row; a touched row does', async () => {
  // Child entry rewritten at 2000: X preserved from 1000, Y touched at 2000.
  await seed('2025-3-regular', {
    at: 2000,
    items: [pack('x', 21), pack('y', 30)],
    itemUpdatedAtById: { x: 1000, y: 2000 },
  });
  // Season-wide entry at 1500: a NEWER X (score 24) and an OLDER Y (score 28).
  await seed('2025-all-regular', { at: 1500, items: [pack('x', 24), pack('y', 28)] });

  const { items, newestEffectiveAt } = await loadReconciledSeasonScores({
    year: 2025,
    seasonType: 'regular',
    ...NO_TEAMS,
  });
  const byId = new Map(items.map((i) => [i.id, i]));
  // X: child effective 1000 < season effective 1500 → season's newer X wins.
  assert.equal(byId.get('x')!.home.score, 24);
  // Y: child effective 2000 > season effective 1500 → child's touched Y wins.
  assert.equal(byId.get('y')!.home.score, 30);
  // Freshness = newest effective winning-row timestamp.
  assert.equal(newestEffectiveAt, 2000);
});

test('legacy entries without per-row metadata reconcile exactly as before (newest entry wins)', async () => {
  await seed('2025-all-regular', { at: 1000, items: [pack('x', 14)] });
  await seed('2025-3-regular', { at: 2000, items: [pack('x', 21)] }); // no itemUpdatedAtById

  const { items, newestEffectiveAt } = await loadReconciledSeasonScores({
    year: 2025,
    seasonType: 'regular',
    ...NO_TEAMS,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.home.score, 21); // newest entry wins (effective === entry.at)
  assert.equal(newestEffectiveAt, 2000);
});

test('a metadata-only rewrite with a fresh entry `at` does not advance served-score freshness', async () => {
  // Same game in two entries, both with effective timestamp 1000, but the second
  // entry carries a fresh `at` of 5000 (a confirmation-metadata rewrite). Freshness
  // must stay at 1000 — no row actually changed.
  await seed('2025-all-regular', {
    at: 1000,
    items: [pack('x', 21)],
    itemUpdatedAtById: { x: 1000 },
  });
  await seed('2025-3-regular', {
    at: 5000,
    items: [pack('x', 21)],
    itemUpdatedAtById: { x: 1000 },
  });

  const { newestEffectiveAt } = await loadReconciledSeasonScores({
    year: 2025,
    seasonType: 'regular',
    ...NO_TEAMS,
  });
  assert.equal(newestEffectiveAt, 1000);
});
