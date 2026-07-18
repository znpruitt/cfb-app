import assert from 'node:assert/strict';
import test from 'node:test';

import { finalizeGameStatsRefresh } from '../refreshPublication.ts';
import { deriveSlateExpectation, ingestGameStatsObservations } from '../ingestion.ts';
import type { DurableMergeResult } from '../durableMerge.ts';
import { getCachedGameStats } from '../cache.ts';
import { createTeamIdentityResolver } from '../../teamIdentity.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
} from '../../server/appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  getProviderRefreshStatus,
} from '../../server/providerRefreshStatus.ts';
import { weekPartitionScope } from '../../providerRefreshScope.ts';
import { wireGame } from './fixtures.ts';

// PLATFORM-086H3 — the committed-state finalize matrix. Every confirmed merge
// outcome rereads durable state and evaluates schedule-relative coverage
// BEFORE any status publication; coverage — not the outcome label — decides.

const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const COMPLETED = '2026-10-11T20:00:00.000Z';
const FENCE = '2026-10-15T10:00:00.000Z';
const YEAR = 2026;
const WEEK = 3;
const SCOPE = weekPartitionScope(YEAR, WEEK, 'regular');

const RESOLVER = createTeamIdentityResolver({
  teams: [
    { school: 'Alpha State', level: 'FBS' },
    { school: 'Beta Tech', level: 'FBS' },
    { school: 'Gamma Poly', level: 'FBS' },
    { school: 'Delta Agricultural', level: 'FBS' },
  ],
  aliasMap: {},
});

const GAME_A = () => wireGame({ id: 5001 });

function slate(ids: number[]) {
  return deriveSlateExpectation({
    scheduleItems: ids.map((id) => ({
      id: String(id),
      week: WEEK,
      seasonType: 'regular',
      startDate: COMPLETED,
      status: 'STATUS_FINAL',
      homeTeam: id === 5002 ? 'Gamma Poly' : 'Alpha State',
      awayTeam: id === 5002 ? 'Delta Agricultural' : 'Beta Tech',
    })),
    resolver: RESOLVER,
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: NOW,
  });
}

async function ingest(payload: unknown, expectation = slate([5001]), fence = FENCE) {
  return ingestGameStatsObservations({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchStartedAt: fence,
    payload,
    expectation,
    resolver: RESOLVER,
  });
}

async function finalize(
  ingestion: Awaited<ReturnType<typeof ingest>>,
  expectation = slate([5001])
) {
  const attempt = await beginProviderRefreshAttempt('game-stats', SCOPE, {
    startedAt: new Date().toISOString(),
  });
  return finalizeGameStatsRefresh({
    ingestion,
    expectation,
    seasonRelation: 'current',
    scope: SCOPE,
    attempt,
    contextLabel: `week ${WEEK} regular`,
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('written + complete committed coverage → full success after reread', async () => {
  const publication = await finalize(await ingest([GAME_A()]));
  assert.equal(publication.recorded, 'success');
  assert.equal(publication.reread, 'ok');
  assert.equal(publication.coverage?.state, 'complete');
  assert.equal(publication.meaningfulChange, true);
  assert.equal(publication.dispositionReason, 'satisfied');
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(status.latestAttemptOutcome, 'succeeded');
  assert.equal(status.rowsCommitted, 1);
});

test('written + PARTIAL committed coverage → partial success, never full', async () => {
  const expectation = slate([5001, 5002]);
  const publication = await finalize(await ingest([GAME_A()], expectation), expectation);
  assert.equal(publication.recorded, 'partial-success');
  assert.equal(publication.coverage?.state, 'partial');
  assert.deepEqual(publication.coverage?.absent, [5002]);
  assert.equal(publication.dispositionReason, 'partial-coverage');
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(
    status.latestAttemptOutcome,
    'partial',
    'a partial partition never reads as full success'
  );
});

test('mixed valid + malformed payload: the valid game commits, parse failures survive, coverage stays partial', async () => {
  const expectation = slate([5001, 5002]);
  const ingestion = await ingest([GAME_A(), { garbage: true }], expectation);
  assert.equal(ingestion.kind, 'merged');
  if (ingestion.kind === 'merged') {
    assert.equal(
      ingestion.parseFailures['unaddressable-game-id'],
      1,
      'parse-failure diagnostics preserved'
    );
  }
  const publication = await finalize(ingestion, expectation);
  assert.equal(publication.recorded, 'partial-success');
});

test('fence-only refresh is a confirmed durable change: success, freshness advanced, no forced re-recovery', async () => {
  await finalize(await ingest([GAME_A()]));
  const before = (await getCachedGameStats(YEAR, WEEK, 'regular'))!.games[0]!.fetchStartedAt!;
  const laterFence = new Date(Date.parse(FENCE) + 60_000).toISOString();
  const ingestion = await ingest([GAME_A()], slate([5001]), laterFence);
  assert.equal(ingestion.kind, 'merged');
  if (ingestion.kind === 'merged') assert.deepEqual(ingestion.merge.refreshed, [5001]);
  const publication = await finalize(ingestion);
  assert.equal(publication.recorded, 'success');
  assert.equal(
    publication.dispositionReason,
    'satisfied',
    'a satisfied partition does not re-enter recovery'
  );
  const after = (await getCachedGameStats(YEAR, WEEK, 'regular'))!.games[0]!.fetchStartedAt!;
  assert.ok(after > before, 'freshness evidence advanced durably');
});

test('unchanged at an equal fence + complete coverage → truthful no-op', async () => {
  await finalize(await ingest([GAME_A()]));
  const ingestion = await ingest([GAME_A()]); // same fence, identical content
  assert.equal(ingestion.kind, 'merged');
  if (ingestion.kind === 'merged') assert.equal(ingestion.merge.outcome, 'unchanged');
  const publication = await finalize(ingestion);
  assert.equal(publication.recorded, 'noop');
  assert.equal(publication.dispositionReason, 'satisfied');
});

test('stale observation + SUFFICIENT durable state → truthful no-op, no rollback', async () => {
  await finalize(await ingest([GAME_A()]));
  const older = new Date(Date.parse(FENCE) - 60_000).toISOString();
  const ingestion = await ingest([GAME_A()], slate([5001]), older);
  assert.equal(ingestion.kind, 'merged');
  if (ingestion.kind === 'merged') assert.equal(ingestion.merge.outcome, 'stale');
  const publication = await finalize(ingestion);
  assert.equal(publication.recorded, 'noop');
  assert.equal(publication.coverage?.state, 'complete');
});

test('stale observation + INCOMPLETE durable state → failure, no error clearing', async () => {
  const expectation = slate([5001, 5002]);
  await finalize(await ingest([GAME_A()], expectation)); // partial baseline
  const older = new Date(Date.parse(FENCE) - 60_000).toISOString();
  const ingestion = await ingest([GAME_A()], expectation, older);
  assert.equal(ingestion.kind, 'merged');
  if (ingestion.kind === 'merged') assert.equal(ingestion.merge.outcome, 'stale');
  const publication = await finalize(ingestion, expectation);
  assert.equal(publication.recorded, 'failure');
  assert.equal(publication.code, 'game-stats-stale-insufficient');
  assert.equal(publication.coverage?.state, 'partial');
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(status.latestAttemptOutcome, 'failed');
});

test('unchanged observation + incomplete coverage → failure, prior evidence preserved', async () => {
  const expectation = slate([5001, 5002]);
  await finalize(await ingest([GAME_A()], expectation));
  const ingestion = await ingest([GAME_A()], expectation); // equal fence, identical → unchanged
  const publication = await finalize(ingestion, expectation);
  assert.equal(publication.recorded, 'failure');
  assert.equal(publication.code, 'game-stats-unchanged-insufficient');
  assert.equal((await getCachedGameStats(YEAR, WEEK, 'regular'))!.games.length, 1);
});

test('unexpected empty → stable failure, prior-good preserved, no success advance', async () => {
  const expectation = slate([5001, 5002]);
  await finalize(await ingest([GAME_A()], expectation));
  const statusBefore = await getProviderRefreshStatus('game-stats', SCOPE);
  const publication = await finalize(await ingest([], expectation), expectation);
  assert.equal(publication.recorded, 'failure');
  assert.equal(publication.code, 'game-stats-empty-unexpected');
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastSuccessAt, statusBefore.lastSuccessAt, 'last-success untouched');
  assert.equal(
    (await getCachedGameStats(YEAR, WEEK, 'regular'))!.games.length,
    1,
    'prior-good intact'
  );
});

test('expected empty → no-op (nothing expected for the slate)', async () => {
  const expectation = deriveSlateExpectation({
    scheduleItems: [],
    resolver: RESOLVER,
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: NOW,
  });
  const publication = await finalize(await ingest([], expectation), expectation);
  assert.equal(publication.recorded, 'noop');
  assert.equal(publication.dispositionReason, 'empty-expected');
});

test('participant mismatch and unresolved identity publish DISTINCT failure codes', async () => {
  const expectation = slate([5001]);
  const mismatch = await finalize(
    await ingest(
      [wireGame({ id: 5001, home: { school: 'Gamma Poly', teamId: 303 } })],
      expectation
    ),
    expectation
  );
  assert.equal(mismatch.code, 'game-stats-participant-mismatch');

  const unresolved = await finalize(
    await ingest([wireGame({ id: 5001, home: { school: 'TBD' } })], expectation),
    expectation
  );
  assert.equal(unresolved.code, 'game-stats-unresolved-participant');

  const unscheduled = await finalize(
    await ingest([wireGame({ id: 999_999 })], expectation),
    expectation
  );
  assert.equal(unscheduled.code, 'game-stats-unmatched-observations');
});

// Synthetic merge results exercise the conflict/unavailable/indeterminate rows
// of the matrix without contriving storage failures.
function syntheticMerged(merge: Partial<DurableMergeResult>): Awaited<ReturnType<typeof ingest>> {
  return {
    kind: 'merged',
    merge: {
      outcome: 'conflict',
      partitionKey: 'game-stats/2026:3:regular',
      inserted: [],
      updated: [],
      refreshed: [],
      unchanged: [],
      stale: [],
      conflicts: [],
      retainedExisting: [],
      skippedNonPersistable: 0,
      ...merge,
    },
    attachment: {
      matched: 1,
      participantMismatch: 0,
      unresolvedParticipant: 0,
      excludedClassification: 0,
      placeholderDeferred: 0,
      unscheduledId: 0,
    },
    parseFailures: {},
    unresolvedIdentity: 0,
  };
}

test('conflict → failure with stored rows preserved semantics', async () => {
  const publication = await finalize(
    syntheticMerged({
      outcome: 'conflict',
      conflicts: [{ providerGameId: 5001, reason: 'same-fence-divergent' }],
    })
  );
  assert.equal(publication.recorded, 'failure');
  assert.equal(publication.code, 'game-stats-merge-conflict');
  assert.equal(publication.reread, 'skipped');
});

test('unavailable → failure, durable untouched, no coverage claim', async () => {
  const publication = await finalize(
    syntheticMerged({ outcome: 'unavailable', unavailableReason: 'durable-write-failed' })
  );
  assert.equal(publication.code, 'game-stats-durable-unavailable');
  assert.equal(publication.coverage, null);
});

test('indeterminate → failure, NO success and NO definitive post-write coverage', async () => {
  const publication = await finalize(
    syntheticMerged({
      outcome: 'indeterminate',
      indeterminate: {
        reason: 'transaction-finalize-failed',
        durability: 'unknown',
        partitionKey: 'game-stats/2026:3:regular',
      },
    })
  );
  assert.equal(publication.recorded, 'failure');
  assert.equal(publication.code, 'game-stats-durable-indeterminate');
  assert.equal(publication.coverage, null, 'no post-write coverage is published');
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(status.lastSuccessAt, null);
});

test('a post-commit reread failure never reports the partition as available; retry recovers', async () => {
  const ingestion = await ingest([GAME_A()]);
  assert.equal(ingestion.kind, 'merged');
  __setAppStateReadFailureForTests(new Error('reread down'), 'game-stats');
  let publication;
  try {
    publication = await finalize(ingestion);
  } finally {
    __setAppStateReadFailureForTests(null);
  }
  assert.equal(publication.recorded, 'failure');
  assert.equal(publication.code, 'game-stats-postcommit-reread-failed');
  assert.equal(publication.reread, 'failed');
  assert.equal(publication.meaningfulChange, true, 'the merge may have committed — preserved');
  assert.match(publication.detail, /may have committed|merge committed/i);
  const statusAfterFailure = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(statusAfterFailure.lastSuccessAt, null, 'no success before verified coverage');

  // Retry: a full re-ingest of the same input is idempotent against the
  // committed state (unchanged at the equal fence) and now publishes truthfully.
  const retry = await finalize(await ingest([GAME_A()]));
  assert.equal(retry.recorded, 'noop');
  assert.equal(retry.coverage?.state, 'complete');
});
