import assert from 'node:assert/strict';
import test from 'node:test';

import type { DurableMergeOutcome, DurableMergeResult } from '../durableMerge.ts';
import type { GameStatsIngestionResult } from '../ingestionCoordinator.ts';
import { reachedMergeVerdict } from '../reconciliationRun.ts';

// PLATFORM-110B — the predicate that decides whether a correction pass may be
// closed. Exhaustive over the ingestion result space, because "ingestion
// returned a typed result" is NOT the same as "the merge compared the
// partition", and conflating them let one writer-control transition consume
// every due correction in a season.

function mergeResult(outcome: DurableMergeOutcome): GameStatsIngestionResult {
  const merge: DurableMergeResult = {
    outcome,
    partitionKey: 'game-stats/2026:1:regular',
    inserted: [],
    updated: [],
    refreshed: [],
    unchanged: [],
    stale: [],
    conflicts: [],
    retainedExisting: [],
    skippedNonPersistable: 0,
  };
  return {
    kind: 'merge-result',
    merge,
    diagnostics: {
      rawRowCount: 1,
      parsedRowCount: 1,
      persistableRowCount: 1,
      nonPersistableParsedRowCount: 0,
      parseFailureCounts: {},
      rowAcceptance: 'clean',
    },
  };
}

test('the merge outcomes that ARE a verdict close a pass', () => {
  for (const outcome of [
    'written',
    'partially-merged',
    'unchanged',
    'stale',
    'conflict',
  ] as const) {
    assert.equal(
      reachedMergeVerdict(mergeResult(outcome)),
      true,
      `${outcome}: the merge read the partition under its lock and ruled`
    );
  }
});

test('everything that compared NOTHING leaves the pass open', () => {
  for (const outcome of ['unavailable', 'indeterminate'] as const) {
    assert.equal(
      reachedMergeVerdict(mergeResult(outcome)),
      false,
      `${outcome}: no comparison happened, so the pass must survive`
    );
  }

  // An exactly-empty response never reaches the merge at all, and coverage
  // proved the partition HAS rows — so it contradicts known-good state.
  assert.equal(reachedMergeVerdict({ kind: 'no-op', reason: 'empty-response' }), false);

  for (const reason of [
    'invalid-payload',
    'no-persistable-observations',
    'empty-restriction',
    'invalid-restriction-id',
    'restriction-matched-nothing',
  ] as const) {
    assert.equal(
      reachedMergeVerdict({ kind: 'rejected', reason }),
      false,
      `${reason}: the coordinator refused before H2 was called`
    );
  }
});

test('the truth table covers every member of the result space', () => {
  // Coverage of the sweep is part of its result: 7 merge outcomes + 1 no-op + 5
  // rejections. If the unions grow, this count fails and the table gets updated
  // rather than silently missing a branch.
  const mergeOutcomes: DurableMergeOutcome[] = [
    'written',
    'unchanged',
    'partially-merged',
    'stale',
    'conflict',
    'unavailable',
    'indeterminate',
  ];
  assert.equal(mergeOutcomes.length, 7);
  const verdicts = mergeOutcomes.filter((o) => reachedMergeVerdict(mergeResult(o)));
  assert.equal(verdicts.length, 5, 'exactly five merge outcomes are verdicts');
});
