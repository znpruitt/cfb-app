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
  assert.equal(result.finalized, 0);
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
  assert.equal(result.finalized, 1);
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
  assert.equal(result.finalized, 1);
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
  assert.equal(result.finalized, 0); // confirming an existing final is not a new finalisation
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

  assert.deepEqual(result, { wrote: false, committed: 0, finalized: 0 });
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

  assert.deepEqual(result, { wrote: false, committed: 0, finalized: 0 });
  assert.equal(await read(3), null, 'no child row can restate the aggregate final');
  const aggregate = await getAppState<CacheEntry>('scores', '2025-all-regular');
  assert.equal(aggregate?.value.items[0]?.home.score, 24);
  assert.equal(aggregate?.value.items[0]?.away.score, 17);
});

// ---- First-final observation stamp (PLATFORM-692 / #692) ------------------
//
// `firstFinalObservedAtById` records, per provider game id, the instant LIVE
// polling FIRST saw the provider report the score final. Three properties carry
// the whole item: only an opted-in caller writes one (so the weekly sweep's
// cron clock never enters the distribution), the first write wins permanently
// (so a later correction cannot move it), and it survives every subsequent
// write through each rebuilder (so it cannot silently vanish).

test('a live first-final transition stamps `now` when the caller opts in', async () => {
  await seed(3, { items: [pack('a', 'Q4 1:00', 21, 17)] });
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'final', 21, 17), provisionalFinal: true }],
    stampFirstFinalObservation: true,
    now: 2000,
  });
  assert.equal(result.finalized, 1);
  const entry = await read(3);
  assert.deepEqual(entry!.firstFinalObservedAtById, { a: 2000 });
});

test('the SAME transition writes NO stamp when the caller does not opt in', async () => {
  await seed(3, { items: [pack('a', 'Q4 1:00', 21, 17)] });
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'final', 21, 17), provisionalFinal: true }],
    // stampFirstFinalObservation omitted — the default.
    now: 2000,
  });
  // The transition is detected and counted exactly as before; only the stamp
  // is withheld. If these two assertions ever disagree the opt-in has become a
  // no-op and the sweep exclusion below is worthless.
  assert.equal(result.finalized, 1);
  const entry = await read(3);
  assert.equal(entry!.firstFinalObservedAtById, undefined);
  assert.equal(Object.hasOwn(entry!, 'firstFinalObservedAtById'), false);
});

test('THE SWEEP PATH COMMITS A FINAL AND WRITES NO STAMP', async () => {
  // `finalScoreSweep.ts` reaches this same merge with `/games` (no division
  // filter) and ONE fixed `observedAtMs` for the entire run, so its `finalized`
  // branch fires for every non-FBS game — 355 of 454 week-1 rows in production
  // on 2026-09-11. A stamp written here would be a weekly cron's clock, not an
  // observation of the game. This is the exclusion, at the seam that enforces it.
  await seed(3, { items: [pack('a', 'scheduled', null, null)] });
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [
      {
        pack: pack('a', 'final', 21, 17),
        provisionalFinal: false,
        baseline: pack('a', 'scheduled', null, null),
        baselineAt: 1000,
      },
    ],
    onlyIfMissingUsableFinal: true, // the sweep's own call shape
    now: 9_000,
  });
  assert.equal(result.committed, 1, 'the sweep still repairs the final');
  assert.equal(result.finalized, 1, 'and the branch still fires — only the stamp is withheld');
  const entry = await read(3);
  assert.equal(entry!.items[0]!.status, 'final');
  assert.equal(entry!.itemUpdatedAtById!['a'], 9_000, 'the sibling stamp IS written');
  assert.equal(
    entry!.firstFinalObservedAtById,
    undefined,
    'a swept row is present in itemUpdatedAtById and ABSENT here — the exclusion is self-describing'
  );
});

test('a later score correction advances `itemUpdatedAtById` and leaves the stamp alone', async () => {
  await seed(3, { items: [pack('a', 'Q4 1:00', 21, 17)] });
  await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'final', 21, 17), provisionalFinal: true }],
    stampFirstFinalObservation: true,
    now: 2000,
  });
  // A post-final score correction: `mergeScoreRow` rejects only a STATE
  // regression, so this is accepted and advances `itemUpdatedAtById`.
  const second = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'final', 24, 17), provisionalFinal: false }],
    stampFirstFinalObservation: true,
    now: 7000,
  });
  assert.equal(second.committed, 1);
  // This case does NOT exercise first-write-wins and must not be read as doing
  // so: with no baseline the protection reference is the already-final child, so
  // the `finalized` branch never re-fires and there is no competing write to
  // lose. What it proves is the OTHER half — a touching write carries the stamp
  // forward. The re-fire case below is the first-write-wins proof.
  assert.equal(second.finalized, 0, 'the branch did not re-fire here');
  const entry = await read(3);
  assert.equal(entry!.items[0]!.home.score, 24, 'the correction landed');
  assert.equal(entry!.itemUpdatedAtById!['a'], 7000, 'last-material-change DID advance');
  assert.equal(entry!.firstFinalObservedAtById!['a'], 2000, 'first-final did NOT');
});

test('FIRST WRITE WINS through a re-fired `finalized` branch (stale-aggregate protection reference)', async () => {
  // The `finalized` branch is not "this id has never been final" — it is "the
  // protection reference chosen THIS call is not final", and
  // `chooseProtectionBaseline` prefers the FRESHER row regardless of state. A
  // season-wide manual repair that lands a not-yet-final `/games` row for a
  // game the scoreboard already finalized makes the branch fire a SECOND time
  // for an already-stamped id. Nothing durable prevents that, so the merge rule
  // — not the detector — is what holds the stamp still.
  await seed(3, {
    at: 2000,
    items: [pack('a', 'final', 21, 17)],
    itemUpdatedAtById: { a: 2000 },
    firstFinalObservedAtById: { a: 2000 },
  });
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [
      {
        pack: pack('a', 'final', 24, 17),
        provisionalFinal: false,
        // The reconciled winner is a NEWER non-final aggregate row.
        baseline: pack('a', 'Q4 0:30', 21, 17),
        baselineAt: 5000,
      },
    ],
    stampFirstFinalObservation: true,
    now: 8000,
  });
  assert.equal(result.finalized, 1, 'the branch really does fire a second time for this id');
  const entry = await read(3);
  assert.equal(entry!.firstFinalObservedAtById!['a'], 2000, 'and the stamp is unmoved');
});

test('a stamp SURVIVES a later unrelated write through the live rebuilder', async () => {
  // `mergeScoresIntoPartition` rebuilds the whole entry on every write, so an
  // added field that is not explicitly carried is dropped with no error — the
  // failure mode is silence. Prove survival across a write that touches a
  // DIFFERENT game entirely.
  await seed(3, { items: [pack('a', 'Q4 1:00', 21, 17), pack('b', 'scheduled', null, null)] });
  await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'final', 21, 17), provisionalFinal: true }],
    stampFirstFinalObservation: true,
    now: 2000,
  });
  await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('b', 'Q1 12:00', 0, 0), provisionalFinal: false }],
    stampFirstFinalObservation: true,
    now: 3000,
  });
  const entry = await read(3);
  assert.deepEqual(entry!.firstFinalObservedAtById, { a: 2000 }, 'a survives; b never finalled');
});

test('a stamp survives a metadata-only confirmation write', async () => {
  // A `/games` confirmation commits 0 scores but still rewrites the entry.
  await seed(3, {
    at: 2000,
    items: [pack('a', 'final', 21, 17)],
    itemUpdatedAtById: { a: 2000 },
    pendingFinalConfirmationIds: ['a'],
    firstFinalObservedAtById: { a: 2000 },
  });
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [],
    confirmFinalIds: ['a'],
    stampFirstFinalObservation: true,
    now: 6000,
  });
  assert.equal(result.wrote, true);
  assert.equal(result.committed, 0);
  const entry = await read(3);
  assert.equal(entry!.pendingFinalConfirmationIds, undefined, 'pending cleared');
  assert.equal(entry!.firstFinalObservedAtById!['a'], 2000, 'stamp survives the rewrite');
});

test('a pre-692 legacy entry carries no map and gains one only on a first final', async () => {
  await seed(3, { items: [pack('a', 'Q2 5:00', 7, 3), pack('b', 'Q1 10:00', 3, 0)] });
  // An in-progress update on a legacy entry: nothing finals, nothing is stamped.
  await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'Q3 8:00', 14, 10), provisionalFinal: false }],
    stampFirstFinalObservation: true,
    now: 2000,
  });
  assert.equal((await read(3))!.firstFinalObservedAtById, undefined);
  await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'final', 21, 17), provisionalFinal: true }],
    stampFirstFinalObservation: true,
    now: 3000,
  });
  assert.deepEqual((await read(3))!.firstFinalObservedAtById, { a: 3000 });
});

test('a non-finite stored stamp is ignored rather than carried (durable JSON is untrusted)', async () => {
  await seed(3, {
    at: 2000,
    items: [pack('a', 'Q4 1:00', 21, 17)],
    itemUpdatedAtById: { a: 2000 },
    // `NaN`/`Infinity` cannot survive JSON, but a string or null can.
    firstFinalObservedAtById: { a: 'corrupt' } as unknown as Record<string, number>,
  });
  await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [{ pack: pack('a', 'final', 21, 17), provisionalFinal: true }],
    stampFirstFinalObservation: true,
    now: 4000,
  });
  const entry = await read(3);
  assert.deepEqual(entry!.firstFinalObservedAtById, { a: 4000 }, 'unreadable prior → this call');
});

test('the reconciliation call shape stamps when the /games final is the first one in the child', async () => {
  // Call site #2 (`live-scores/route.ts`, final reconciliation) passes the same
  // opt-in. Its `finalized` branch is NOT ordinarily reachable — the planner
  // only routes to that mode for ids whose RECONCILED cached status is already
  // final (`pollingTarget.ts:66-69`), so the detector does not fire. It becomes
  // reachable when the aggregate holds the final and the CHILD lags with a
  // newer non-final row, which is exactly this shape. Covered here because the
  // planner cannot be driven into it from the cron; the cron suite covers that
  // site's carry-forward instead.
  await seed(3, {
    at: 6000,
    items: [pack('a', 'Q4 0:30', 21, 17)],
    itemUpdatedAtById: { a: 6000 },
    pendingFinalConfirmationIds: ['a'],
  });
  const result = await mergeScoresIntoPartition({
    year: 2025,
    week: 3,
    seasonType: 'regular',
    updates: [
      {
        pack: pack('a', 'final', 21, 17),
        provisionalFinal: false,
        baseline: pack('a', 'final', 21, 17), // the aggregate's final…
        baselineAt: 2000, // …but STALER than the child, so the child protects
      },
    ],
    confirmFinalIds: ['a'],
    stampFirstFinalObservation: true,
    now: 9000,
  });
  assert.equal(result.finalized, 1);
  const entry = await read(3);
  assert.equal(entry!.pendingFinalConfirmationIds, undefined, 'confirmed and cleared');
  assert.deepEqual(entry!.firstFinalObservedAtById, { a: 9000 });
});
