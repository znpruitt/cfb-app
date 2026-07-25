import assert from 'node:assert/strict';
import test from 'node:test';

import type { DurableMergeOutcome, DurableMergeResult } from '../durableMerge.ts';
import type {
  GameStatsBatchRowAcceptance,
  GameStatsIngestionResult,
} from '../ingestionCoordinator.ts';
import {
  interpretGameStatsRefreshOutcome,
  type GameStatsRefreshInterpretation,
} from '../refreshOutcome.ts';

// PLATFORM-086H3E2: the ONE interpreter's mapping is the locked activation
// contract — every C2/H2 variant is asserted against its COMPLETE
// interpretation object so no field can drift silently.

function mergeResult(outcome: DurableMergeOutcome): DurableMergeResult {
  return {
    outcome,
    partitionKey: '2025:3:regular',
    inserted: [],
    updated: [],
    refreshed: [],
    unchanged: [],
    stale: [],
    conflicts: [],
    retainedExisting: [],
    skippedNonPersistable: 0,
    ...(outcome === 'indeterminate'
      ? {
          indeterminate: {
            reason: 'transaction-finalize-failed' as const,
            durability: 'unknown' as const,
            partitionKey: '2025:3:regular',
          },
        }
      : {}),
  };
}

function ingested(
  outcome: DurableMergeOutcome,
  rowAcceptance: GameStatsBatchRowAcceptance
): GameStatsIngestionResult {
  return {
    kind: 'merge-result',
    merge: mergeResult(outcome),
    diagnostics: {
      rawRowCount: 4,
      parsedRowCount: rowAcceptance === 'clean' ? 4 : 3,
      persistableRowCount: 3,
      nonPersistableParsedRowCount: rowAcceptance === 'clean' ? 0 : 1,
      parseFailureCounts: {},
      rowAcceptance,
    },
  };
}

function expected(
  overrides: Partial<GameStatsRefreshInterpretation> &
    Pick<GameStatsRefreshInterpretation, 'kind' | 'reason' | 'httpStatus'>
): GameStatsRefreshInterpretation {
  return {
    advanceLastSuccess: false,
    partialFailure: false,
    knownUnchanged: false,
    durabilityUnknown: false,
    ...overrides,
  };
}

test('interpreter: exact empty response is a no-op that never advances last-success', () => {
  assert.deepEqual(
    interpretGameStatsRefreshOutcome({ kind: 'no-op', reason: 'empty-response' }),
    expected({ kind: 'no-op', reason: 'empty-response', httpStatus: 200, knownUnchanged: true })
  );
});

test('interpreter: rejections fail with prior-good preserved', () => {
  assert.deepEqual(
    interpretGameStatsRefreshOutcome({ kind: 'rejected', reason: 'invalid-payload' }),
    expected({ kind: 'failure', reason: 'invalid-payload', httpStatus: 502, knownUnchanged: true })
  );
  assert.deepEqual(
    interpretGameStatsRefreshOutcome({ kind: 'rejected', reason: 'no-persistable-observations' }),
    expected({
      kind: 'failure',
      reason: 'no-persistable-observations',
      httpStatus: 502,
      knownUnchanged: true,
    })
  );
});

test('interpreter: written + clean is the only unqualified success', () => {
  assert.deepEqual(
    interpretGameStatsRefreshOutcome(ingested('written', 'clean')),
    expected({
      kind: 'success',
      reason: 'written-clean',
      httpStatus: 200,
      advanceLastSuccess: true,
    })
  );
});

test('interpreter: written + mixed is partial with a confirmed commit', () => {
  assert.deepEqual(
    interpretGameStatsRefreshOutcome(ingested('written', 'mixed')),
    expected({
      kind: 'partial',
      reason: 'written-mixed',
      httpStatus: 200,
      advanceLastSuccess: true,
      partialFailure: true,
    })
  );
});

test('interpreter: partially-merged is partial regardless of batch acceptance', () => {
  for (const acceptance of ['clean', 'mixed'] as const) {
    assert.deepEqual(
      interpretGameStatsRefreshOutcome(ingested('partially-merged', acceptance)),
      expected({
        kind: 'partial',
        reason: 'partially-merged',
        httpStatus: 200,
        advanceLastSuccess: true,
        partialFailure: true,
      }),
      acceptance
    );
  }
});

test('interpreter: clean unchanged/stale are no-ops that never advance last-success', () => {
  assert.deepEqual(
    interpretGameStatsRefreshOutcome(ingested('unchanged', 'clean')),
    expected({ kind: 'no-op', reason: 'unchanged-clean', httpStatus: 200, knownUnchanged: true })
  );
  assert.deepEqual(
    interpretGameStatsRefreshOutcome(ingested('stale', 'clean')),
    expected({ kind: 'no-op', reason: 'stale-clean', httpStatus: 200, knownUnchanged: true })
  );
});

test('interpreter: mixed unchanged/stale FAIL — invalid rows were ignored and nothing repaired', () => {
  assert.deepEqual(
    interpretGameStatsRefreshOutcome(ingested('unchanged', 'mixed')),
    expected({ kind: 'failure', reason: 'unchanged-mixed', httpStatus: 502, knownUnchanged: true })
  );
  assert.deepEqual(
    interpretGameStatsRefreshOutcome(ingested('stale', 'mixed')),
    expected({ kind: 'failure', reason: 'stale-mixed', httpStatus: 502, knownUnchanged: true })
  );
});

test('interpreter: conflict is an explicit failure with HTTP 409', () => {
  for (const acceptance of ['clean', 'mixed'] as const) {
    assert.deepEqual(
      interpretGameStatsRefreshOutcome(ingested('conflict', acceptance)),
      expected({ kind: 'failure', reason: 'conflict', httpStatus: 409, knownUnchanged: true }),
      acceptance
    );
  }
});

test('interpreter: unavailable is a known-unchanged failure with a safe 503', () => {
  for (const acceptance of ['clean', 'mixed'] as const) {
    assert.deepEqual(
      interpretGameStatsRefreshOutcome(ingested('unavailable', acceptance)),
      expected({ kind: 'failure', reason: 'unavailable', httpStatus: 503, knownUnchanged: true }),
      acceptance
    );
  }
});

test('interpreter: indeterminate fails with durability UNKNOWN — never known-unchanged', () => {
  for (const acceptance of ['clean', 'mixed'] as const) {
    assert.deepEqual(
      interpretGameStatsRefreshOutcome(ingested('indeterminate', acceptance)),
      expected({
        kind: 'failure',
        reason: 'indeterminate',
        httpStatus: 503,
        durabilityUnknown: true,
      }),
      acceptance
    );
  }
});

test('interpreter: success metadata may advance ONLY on confirmed durable commits', () => {
  // Sweep the full matrix: advanceLastSuccess must be exactly the
  // written/partially-merged rows and nothing else, and a failure/no-op must
  // never carry partialFailure.
  const outcomes: DurableMergeOutcome[] = [
    'written',
    'partially-merged',
    'unchanged',
    'stale',
    'conflict',
    'unavailable',
    'indeterminate',
  ];
  for (const outcome of outcomes) {
    for (const acceptance of ['clean', 'mixed'] as const) {
      const interpretation = interpretGameStatsRefreshOutcome(ingested(outcome, acceptance));
      const committed = outcome === 'written' || outcome === 'partially-merged';
      assert.equal(interpretation.advanceLastSuccess, committed, `${outcome}/${acceptance}`);
      if (!committed) {
        assert.equal(interpretation.partialFailure, false, `${outcome}/${acceptance}`);
        assert.notEqual(interpretation.kind, 'success', `${outcome}/${acceptance}`);
        assert.notEqual(interpretation.kind, 'partial', `${outcome}/${acceptance}`);
      }
    }
  }
});

test('interpreter: knownUnchanged and durabilityUnknown are mutually exclusive everywhere', () => {
  const all: GameStatsIngestionResult[] = [
    { kind: 'no-op', reason: 'empty-response' },
    { kind: 'rejected', reason: 'invalid-payload' },
    { kind: 'rejected', reason: 'no-persistable-observations' },
  ];
  for (const outcome of [
    'written',
    'partially-merged',
    'unchanged',
    'stale',
    'conflict',
    'unavailable',
    'indeterminate',
  ] as const) {
    for (const acceptance of ['clean', 'mixed'] as const) {
      all.push(ingested(outcome, acceptance));
    }
  }
  for (const result of all) {
    const interpretation = interpretGameStatsRefreshOutcome(result);
    assert.ok(
      !(interpretation.knownUnchanged && interpretation.durabilityUnknown),
      JSON.stringify(result)
    );
  }
});

test('interpreter: an outcome outside the closed union throws (programming error)', () => {
  const poisoned = ingested('written', 'clean');
  (poisoned as { merge: { outcome: string } }).merge.outcome = 'exploded';
  assert.throws(() => interpretGameStatsRefreshOutcome(poisoned), /unknown durable merge outcome/);
});
