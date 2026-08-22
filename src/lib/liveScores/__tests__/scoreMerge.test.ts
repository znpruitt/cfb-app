import assert from 'node:assert/strict';
import test from 'node:test';

import type { CacheEntry } from '@/lib/scores/cache';
import type { ScorePack } from '@/lib/scores/types';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '@/lib/server/appStateStore';

import { mergeScoreRow, mergeScoresIntoPartition } from '../scoreMerge';

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

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

function pack(id: string, status: string, hs: number | null, as: number | null): ScorePack {
  return {
    id,
    seasonType: 'regular',
    startDate: '2025-09-01T18:00:00.000Z',
    week: 3,
    status,
    home: { team: 'Alabama', score: hs },
    away: { team: 'Georgia', score: as },
    time: '2025-09-01T18:00:00.000Z',
  };
}

async function seed(
  week: number,
  entry: Partial<CacheEntry> & { items: ScorePack[] }
): Promise<void> {
  await setAppState('scores', `2025-${week}-regular`, {
    at: 1000,
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    ...entry,
  });
}

async function read(week: number): Promise<CacheEntry | null> {
  return (await getAppState<CacheEntry>('scores', `2025-${week}-regular`))?.value ?? null;
}

// ---- Pure monotonic row merge (prompt case 14) ----------------------------

test('mergeScoreRow enforces monotonic state protection', () => {
  const inprogress = pack('a', 'Q2 5:00', 7, 3);
  const final = pack('a', 'final', 21, 17);
  const scheduled = pack('a', 'scheduled', null, null);

  // scheduled must not replace in-progress or final
  assert.equal(mergeScoreRow(inprogress, scheduled).rejected, true);
  assert.equal(mergeScoreRow(final, scheduled).rejected, true);
  // in-progress must not replace final
  assert.equal(mergeScoreRow(final, pack('a', 'Q4 1:00', 20, 17)).rejected, true);
  // final may replace in-progress
  const promote = mergeScoreRow(inprogress, final);
  assert.equal(promote.rejected, false);
  if (!promote.rejected) assert.equal(promote.changed, true);
  // same-state score correction is allowed
  const correct = mergeScoreRow(final, pack('a', 'final', 24, 17));
  assert.equal(correct.rejected, false);
  if (!correct.rejected) assert.equal(correct.changed, true);
});

test('mergeScoreRow preserves a present prior score against a transient null', () => {
  const prior = pack('a', 'Q3 5:00', 14, 7);
  const next = pack('a', 'final', null, 21); // home score momentarily missing
  const result = mergeScoreRow(prior, next);
  assert.equal(result.rejected, false);
  if (result.rejected) return;
  assert.equal(result.row.home.score, 14); // preserved
  assert.equal(result.row.away.score, 21); // updated
  assert.equal(result.row.status, 'final');
});

// ---- Durable partition merge ----------------------------------------------

test('a monotonic regression preserves the prior-good durable row and does not write', async () => {
  await seed(3, { items: [pack('a', 'Q2 5:00', 7, 3)] });
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'scheduled', null, null), provisionalFinal: false }],
    now: 2000,
  });
  assert.equal(result.wrote, false);
  assert.equal(result.committed, 0);
  const entry = await read(3);
  assert.equal(entry!.items[0]!.status, 'Q2 5:00');
  assert.equal(entry!.at, 1000);
});

test('unrelated prior-good rows are preserved when another game updates', async () => {
  await seed(3, { items: [pack('a', 'Q2 5:00', 7, 3), pack('b', 'scheduled', null, null)] });
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'final', 21, 17), provisionalFinal: false }],
    now: 2000,
  });
  assert.equal(result.committed, 1);
  const entry = await read(3);
  const byId = new Map(entry!.items.map((i) => [i.id, i]));
  assert.equal(byId.get('a')!.status, 'final');
  assert.equal(byId.get('b')!.status, 'scheduled'); // preserved
});

test('a live merge stamps only the touched row; preserved rows keep their prior effective timestamp', async () => {
  await seed(3, { items: [pack('a', 'Q2 5:00', 7, 3), pack('b', 'Q1 10:00', 3, 0)] });
  await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'final', 21, 17), provisionalFinal: false }],
    now: 2000,
  });
  const entry = await read(3);
  assert.equal(entry!.at, 2000); // a real change advances the entry timestamp
  assert.equal(entry!.itemUpdatedAtById!['a'], 2000); // touched
  assert.equal(entry!.itemUpdatedAtById!['b'], 1000); // preserved prior effective (entry.at fallback)
});

test('a scoreboard final is recorded pending /games confirmation', async () => {
  await seed(3, { items: [pack('a', 'Q4 0:30', 21, 17)] });
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'final', 24, 17), provisionalFinal: true }],
    now: 2000,
  });
  assert.equal(result.committed, 1);
  const entry = await read(3);
  assert.deepEqual(entry!.pendingFinalConfirmationIds, ['a']);
});

test('a confirmation clear is a metadata-only write: committed 0, entry timestamp unchanged, pending cleared', async () => {
  await seed(3, {
    at: 1000,
    items: [pack('a', 'final', 24, 17)],
    itemUpdatedAtById: { a: 1000 },
    pendingFinalConfirmationIds: ['a'],
  });
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'final', 24, 17), provisionalFinal: false }], // same score
    confirmFinalIds: ['a'],
    now: 2000,
  });
  assert.equal(result.wrote, true);
  assert.equal(result.committed, 0); // no score/status change
  const entry = await read(3);
  assert.equal(entry!.at, 1000); // metadata-only change does NOT advance the entry timestamp
  assert.equal(entry!.itemUpdatedAtById!['a'], 1000); // row timestamp preserved
  assert.equal(entry!.pendingFinalConfirmationIds, undefined); // cleared
});

test('an unchanged score with no metadata change is a no-op (no write)', async () => {
  await seed(3, { items: [pack('a', 'final', 24, 17)] });
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'final', 24, 17), provisionalFinal: false }],
    now: 2000,
  });
  assert.equal(result.wrote, false);
  assert.equal(result.committed, 0);
});

test('a brand-new partition entry is created from the first update', async () => {
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 7,
    seasonType: 'regular',
    updates: [{ pack: pack('z', 'Q1 12:00', 0, 0), provisionalFinal: false }],
    now: 3000,
  });
  assert.equal(result.committed, 1);
  const entry = await read(7);
  assert.equal(entry!.items.length, 1);
  assert.equal(entry!.at, 3000);
});

test('empty updates against no prior data never publish an empty entry', async () => {
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 9,
    seasonType: 'regular',
    updates: [],
    now: 3000,
  });
  assert.equal(result.wrote, false);
  assert.equal(await read(9), null);
});

// ---- Reconciled-baseline protection (Codex round 1, P1) -------------------

test('a scoreboard row cannot regress a better aggregate baseline the child key lacks', async () => {
  // No child row for 'a'; the reconciled baseline (from the season-wide aggregate)
  // says in-progress 14-7. A transient scheduled scoreboard row must be rejected.
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [
      {
        pack: pack('a', 'scheduled', null, null),
        provisionalFinal: false,
        baseline: pack('a', 'Q2 5:00', 14, 7),
      },
    ],
    now: 2000,
  });
  assert.equal(result.wrote, false);
  assert.equal(result.committed, 0);
  assert.equal(await read(3), null);
});

test('a null-score scoreboard row preserves the aggregate baseline scores', async () => {
  await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [
      {
        pack: pack('a', 'In Progress', null, null),
        provisionalFinal: false,
        baseline: pack('a', 'Q2 5:00', 14, 7),
      },
    ],
    now: 2000,
  });
  const entry = await read(3);
  assert.equal(entry!.items[0]!.home.score, 14); // preserved from the baseline
  assert.equal(entry!.items[0]!.away.score, 7);
});

// ---- Observation ordering across overlapping runs (Codex round 1, P2) -----

test('an observation older than the child row is skipped', async () => {
  await seed(3, {
    at: 5000,
    items: [pack('a', 'Q3 2:00', 21, 14)],
    itemUpdatedAtById: { a: 5000 },
  });
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'Q2 5:00', 14, 7), provisionalFinal: false }],
    now: 3000, // older run than the child's effective 5000
  });
  assert.equal(result.wrote, false);
  const entry = await read(3);
  assert.equal(entry!.items[0]!.status, 'Q3 2:00'); // newer child row preserved
  assert.equal(entry!.items[0]!.home.score, 21);
});

// ---- Write-free confirmation (Codex round 1, P2) --------------------------

test('confirming an already-cleared pending id with an unchanged score is a no-op (wrote false)', async () => {
  // Child final 24-17 with NO pending metadata (a concurrent op already cleared it).
  await seed(3, { at: 1000, items: [pack('a', 'final', 24, 17)], itemUpdatedAtById: { a: 1000 } });
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [
      {
        pack: pack('a', 'final', 24, 17),
        provisionalFinal: false,
        baseline: pack('a', 'final', 24, 17),
      },
    ],
    confirmFinalIds: ['a'],
    now: 2000,
  });
  assert.equal(result.wrote, false);
  assert.equal(result.committed, 0);
});

test('an equal-state staler child does not win null-score preservation over the fresher baseline', async () => {
  // Child holds a STALE in-progress 14-7 (effective 1000); the reconciled baseline
  // (the season-wide aggregate) is the fresher served 21-14 (effective 3000). A
  // transient null-score scoreboard row must preserve from the FRESHER baseline.
  await seed(3, { at: 1000, items: [pack('a', 'Q2 5:00', 14, 7)], itemUpdatedAtById: { a: 1000 } });
  await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [
      {
        pack: pack('a', 'Q4 2:00', null, null),
        provisionalFinal: false,
        baseline: pack('a', 'Q3 8:14', 21, 14),
        baselineAt: 3000,
      },
    ],
    now: 5000,
  });
  const entry = await read(3);
  assert.equal(entry!.items[0]!.home.score, 21); // preserved from the fresher baseline, not stale 14
  assert.equal(entry!.items[0]!.away.score, 14);
});

test('a touched write does not re-stamp a retained ID-less row (keeps prior entry `at`)', async () => {
  const idless: ScorePack = {
    seasonType: 'regular',
    startDate: null,
    week: 3,
    status: 'final',
    home: { team: 'Xavier', score: 7 },
    away: { team: 'Yale', score: 3 },
    time: null,
  };
  await seed(3, {
    at: 1000,
    items: [idless, pack('a', 'Q1 10:00', 3, 0)],
    itemUpdatedAtById: { a: 1000 },
  });
  await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'final', 21, 14), provisionalFinal: false }],
    now: 5000,
  });
  const entry = await read(3);
  assert.equal(entry!.at, 1000); // NOT re-stamped to 5000 — protects the ID-less row's effective ts
  assert.equal(entry!.itemUpdatedAtById!['a'], 5000); // the keyed touched row is still fresh
});

test('a gap-fill update cannot replace a final that reached the child after its cache scan', async () => {
  await seed(3, { at: 4000, items: [pack('a', 'final', 24, 17)] });

  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [
      {
        pack: pack('a', 'final', 99, 0),
        provisionalFinal: false,
        // The sweeper's earlier snapshot saw only an in-progress row. The final
        // now in the child simulates the intervening live-score commit.
        baseline: pack('a', 'Q4 1:00', 21, 17),
        baselineAt: 3000,
      },
    ],
    onlyIfMissingUsableFinal: true,
    now: 5000,
  });

  assert.deepEqual(result, { wrote: false, committed: 0 });
  const entry = await read(3);
  assert.equal(entry!.items[0]!.home.score, 24);
  assert.equal(entry!.items[0]!.away.score, 17);
});

test('a gap-fill update cannot replace a final that reached the aggregate after its cache scan', async () => {
  await setAppState('scores', '2025-all-regular', {
    at: 4000,
    items: [pack('a', 'final', 24, 17)],
    source: 'cfbd',
    cfbdFallbackReason: 'none',
  });

  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [
      {
        pack: pack('a', 'final', 99, 0),
        provisionalFinal: false,
        // The sweeper snapshot predates a manual season-wide repair; only the
        // transaction-fresh aggregate read can observe this intervening final.
        baseline: pack('a', 'Q4 1:00', 21, 17),
        baselineAt: 3000,
      },
    ],
    onlyIfMissingUsableFinal: true,
    now: 5000,
  });

  assert.deepEqual(result, { wrote: false, committed: 0 });
  assert.equal(await read(3), null, 'no child row can restate the aggregate final');
  const aggregate = await getAppState<CacheEntry>('scores', '2025-all-regular');
  assert.equal(aggregate?.value.items[0]?.home.score, 24);
  assert.equal(aggregate?.value.items[0]?.away.score, 17);
});
