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
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
  withAppStateKeyTransaction,
} from '../../server/appStateStore.ts';
import {
  beginProviderRefreshAttempt,
  getProviderRefreshStatus,
  recordProviderRefreshFailure,
  recordProviderRefreshNoop,
  recordProviderRefreshSuccess,
} from '../../server/providerRefreshStatus.ts';
import { providerRefreshScopeKey, weekPartitionScope } from '../../providerRefreshScope.ts';
import { legacyRowFromWire, seedGameStatsPartitionForTests, wireGame } from './fixtures.ts';

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
  assert.equal(publication.acceptedGames, 1);
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
      canonicalUnresolved: 0,
      classificationUnknown: 0,
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
  assert.equal(publication.acceptedGames, 1, 'the merge may have committed — preserved');
  assert.match(publication.detail, /may have committed|merge committed/i);
  const statusAfterFailure = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(statusAfterFailure.lastSuccessAt, null, 'no success before verified coverage');

  // Retry: a full re-ingest of the same input is idempotent against the
  // committed state (unchanged at the equal fence) and now publishes truthfully.
  const retry = await finalize(await ingest([GAME_A()]));
  assert.equal(retry.recorded, 'noop');
  assert.equal(retry.coverage?.state, 'complete');
});

test('commit-order authority: an OLDER commit publishing LAST cannot overwrite newer last-success metadata', async () => {
  // Two writers commit in order A(older) → B(newer), but their FINALIZERS
  // publish in the reverse order (B first, then a stalled A). The status
  // ledger orders by the merge authority's commit stamp — captured at COMMIT,
  // never regenerated at publication — so A's late publication cannot roll
  // last-success metadata backward.
  await finalize(await ingest([GAME_A()])); // durable partition exists

  const older: Awaited<ReturnType<typeof ingest>> = syntheticMerged({
    outcome: 'written',
    inserted: [5001],
    commit: { committedAt: '2026-10-15T11:00:00.000Z', commitRevision: 7 },
  });
  const newer: Awaited<ReturnType<typeof ingest>> = syntheticMerged({
    outcome: 'written',
    inserted: [5001],
    commit: { committedAt: '2026-10-15T11:05:00.000Z', commitRevision: 8 },
  });

  // B (newer durable revision) publishes FIRST.
  const newerPublication = await finalize(newer);
  assert.equal(newerPublication.recorded, 'success');
  const afterNewer = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(afterNewer.lastSuccessAt, '2026-10-15T11:05:00.000Z');
  assert.equal(afterNewer.lastSuccessRevision, 8);

  // A (older durable revision) publishes LAST — a stalled finalizer resuming.
  const stalePublication = await finalize(older);
  assert.equal(stalePublication.recorded, 'success', 'the stalled writer still resolves');
  const final = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(final.lastSuccessAt, '2026-10-15T11:05:00.000Z', 'newer commit owns last-success');
  assert.equal(final.lastSuccessRevision, 8, 'durable revision not rolled back');
});

test('durable revision rules: duplicates are idempotent and malformed legacy status yields', async () => {
  await finalize(await ingest([GAME_A()])); // real committed baseline (revision 1)
  const statusAfterReal = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(statusAfterReal.lastSuccessRevision, 1, 'merge-allocated revision propagated');

  // Retry publication of the SAME commit (equal revision): idempotent no-advance.
  const duplicate: Awaited<ReturnType<typeof ingest>> = syntheticMerged({
    outcome: 'written',
    inserted: [5001],
    commit: { committedAt: '2026-10-15T12:30:00.000Z', commitRevision: 1 },
  });
  await finalize(duplicate);
  const afterDuplicate = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(
    afterDuplicate.lastSuccessAt,
    statusAfterReal.lastSuccessAt,
    'duplicate did not advance'
  );

  // A status row with a MALFORMED revision yields to revision-carrying evidence.
  const scopeKey = afterDuplicate.scopeKey;
  await setAppState('provider-refresh-status', scopeKey, {
    ...afterDuplicate,
    lastSuccessRevision: 'not-a-number',
  });
  const next: Awaited<ReturnType<typeof ingest>> = syntheticMerged({
    outcome: 'written',
    inserted: [5001],
    commit: { committedAt: '2026-10-15T13:00:00.000Z', commitRevision: 2 },
  });
  await finalize(next);
  const final = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(
    final.lastSuccessRevision,
    2,
    'malformed legacy status never defeats newer evidence'
  );
  assert.equal(final.lastSuccessAt, '2026-10-15T13:00:00.000Z');
});

test('restart/multi-instance ordering: durable revisions order publishers with NO shared process state', async () => {
  // Publisher 1 commits revision 1 through the real merge, then the process
  // "restarts" (module counters reset). Publisher 2 commits revision 2. A
  // stale publisher then re-publishes revision 1 after another reset. The
  // durable revision — never process memory — decides throughout.
  await finalize(await ingest([GAME_A()]));
  __resetAppStateForTests(); // clears process-local counters; durable file survives? (reset clears failures only)

  const later = new Date(Date.parse(FENCE) + 60_000).toISOString();
  const secondIngest = await ingest(
    [wireGame({ id: 5001, home: { points: 28 } })],
    slate([5001]),
    later
  );
  assert.equal(secondIngest.kind, 'merged');
  if (secondIngest.kind === 'merged') {
    assert.equal(
      secondIngest.merge.commit?.commitRevision,
      2,
      'revision continued from durable state'
    );
  }
  await finalize(secondIngest);
  __resetAppStateForTests();

  const stale: Awaited<ReturnType<typeof ingest>> = syntheticMerged({
    outcome: 'written',
    inserted: [5001],
    commit: { committedAt: '2026-10-15T14:00:00.000Z', commitRevision: 1 },
  });
  await finalize(stale);
  const final = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(final.lastSuccessRevision, 2, 'ordering survives restarts without shared memory');
});

// === Mixed-payload degradation matrix (every bucket stays visible) ===

test('degradation matrix: every provider-boundary bucket flips degraded while coverage stays complete', async () => {
  // Slate expects ONLY game A (5001); B variants are extraneous degradation.
  const expectation = slate([5001]);
  const statlessB = {
    id: 5002,
    teams: [
      { teamId: 303, team: 'Gamma Poly', conference: 'X', homeAway: 'home', points: 21, stats: [] },
      {
        teamId: 404,
        team: 'Delta Agricultural',
        conference: 'Y',
        homeAway: 'away',
        points: 14,
        stats: [],
      },
    ],
  };
  const scenarios: Array<{
    name: string;
    extra: unknown;
    bucket: (attempt: Awaited<ReturnType<typeof finalize>>['attempt']) => number;
  }> = [
    {
      name: 'unscheduled id',
      extra: wireGame({ id: 999_999 }),
      bucket: (a) => a.attachment?.unscheduledId ?? 0,
    },
    {
      name: 'unresolved participant',
      extra: wireGame({ id: 5001, home: { school: 'TBD' } }),
      bucket: (a) => a.attachment?.unresolvedParticipant ?? 0,
    },
    {
      name: 'malformed row (parse failure)',
      extra: { garbage: true },
      bucket: (a) => a.parseFailures['unaddressable-game-id'] ?? 0,
    },
  ];
  for (const scenario of scenarios) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    const publication = await finalize(
      await ingest([GAME_A(), scenario.extra], expectation),
      expectation
    );
    assert.equal(publication.coverage?.state, 'complete', scenario.name);
    assert.equal(
      publication.recorded,
      'partial-success',
      `${scenario.name}: degraded attempt recorded partial, availability NOT downgraded`
    );
    assert.equal(publication.attempt.degraded, true, scenario.name);
    assert.ok(scenario.bucket(publication.attempt) > 0, `${scenario.name}: typed count visible`);
  }

  // Matched-but-non-persistable B (statless): skipped by the merge, counted.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  const twoGameSlate = slate([5001, 5002]);
  const withStatless = await finalize(
    await ingest([GAME_A(), statlessB], twoGameSlate),
    twoGameSlate
  );
  assert.equal(withStatless.attempt.degraded, true, 'skipped non-persistable flips degraded');
  assert.equal(withStatless.attempt.skippedNonPersistable, 1);

  // Multiple buckets together.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  const multi = await finalize(
    await ingest([GAME_A(), { garbage: true }, wireGame({ id: 999_999 })], expectation),
    expectation
  );
  assert.equal(multi.attempt.degraded, true);
  assert.equal(multi.attempt.parseFailures['unaddressable-game-id'], 1);
  assert.equal(multi.attempt.attachment?.unscheduledId, 1);
  assert.equal(multi.coverage?.state, 'complete');
});

// === Durable revision authority: non-reset floor + atomic status writers ===

test('revision floor: a partition RESTORED without its revision cannot reset ordering below status history', async () => {
  // Commit revision 1 normally.
  await finalize(await ingest([GAME_A()]));
  let status = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(status.lastSuccessRevision, 1);

  // Simulate a legacy restoration: the partition AND ledger lose their
  // revisions, while status history remembers revision 10.
  const stored = await getCachedGameStats(YEAR, WEEK, 'regular');
  const restored = { ...stored! } as Record<string, unknown>;
  delete restored.commitRevision;
  await setAppState('game-stats', `${YEAR}:${WEEK}:regular`, restored);
  await setAppState('game-stats-revision', `${YEAR}:${WEEK}:regular`, null);
  await setAppState('provider-refresh-status', status.scopeKey, {
    ...status,
    lastSuccessRevision: 10,
  });

  // The next committed write allocates ABOVE the status floor — never 1.
  const later = new Date(Date.parse(FENCE) + 120_000).toISOString();
  const next = await ingest([wireGame({ id: 5001, home: { points: 42 } })], slate([5001]), later);
  assert.equal(next.kind, 'merged');
  if (next.kind === 'merged') {
    assert.equal(next.merge.commit?.commitRevision, 11, 'floor over ALL valid sources + 1');
  }
  await finalize(next);
  status = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(status.lastSuccessRevision, 11, 'ordering never reuses historical revisions');
});

test('revision floor: a MALFORMED partition revision contributes nothing and never resets to 1', async () => {
  await finalize(await ingest([GAME_A()]));
  const later1 = new Date(Date.parse(FENCE) + 60_000).toISOString();
  const second = await ingest(
    [wireGame({ id: 5001, home: { points: 28 } })],
    slate([5001]),
    later1
  );
  await finalize(second); // revision 2 in ledger + status

  const stored = await getCachedGameStats(YEAR, WEEK, 'regular');
  await setAppState('game-stats', `${YEAR}:${WEEK}:regular`, {
    ...stored!,
    commitRevision: 'corrupted',
  });
  const later2 = new Date(Date.parse(FENCE) + 180_000).toISOString();
  const third = await ingest([wireGame({ id: 5001, home: { points: 35 } })], slate([5001]), later2);
  assert.equal(third.kind, 'merged');
  if (third.kind === 'merged') {
    assert.equal(third.merge.commit?.commitRevision, 3, 'the durable ledger keeps the floor');
  }
});

test('atomic status writers: begin/failure/no-op racing a NEWER success never regress its metadata', async () => {
  // Establish committed success metadata (revision 1).
  const publication = await finalize(await ingest([GAME_A()]));
  assert.deepEqual(publication.statusPublication, {
    begin: 'persisted',
    terminal: 'persisted',
    complete: true,
  });
  const afterSuccess = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(afterSuccess.lastSuccessRevision, 1);

  // A STALE publisher (attempt begun before the success) resolves failure,
  // then no-op, then a stale-revision success — each rereads transactionally
  // and none may roll back the committed-success fields.
  const staleAttempt = await beginProviderRefreshAttempt('game-stats', SCOPE, {
    startedAt: new Date(NOW - 60_000).toISOString(),
  });
  assert.equal(staleAttempt.persistence, 'persisted');
  const failureResult = await recordProviderRefreshFailure('game-stats', SCOPE, {
    attempt: staleAttempt,
    error: 'late provider failure',
    code: 'late-failure',
  });
  assert.equal(failureResult, 'persisted', 'the failure owns attempt chronology');
  let status = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(status.latestAttemptOutcome, 'failed', 'attempt chronology updated');
  assert.equal(status.lastSuccessRevision, 1, 'success metadata untouched by the failure');
  assert.equal(status.lastSuccessAt, afterSuccess.lastSuccessAt);
  assert.equal(status.rowsCommitted, afterSuccess.rowsCommitted);

  const noopResult = await recordProviderRefreshNoop('game-stats', SCOPE, {
    attempt: staleAttempt,
  });
  assert.equal(noopResult, 'persisted');
  status = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(status.lastSuccessRevision, 1, 'success metadata untouched by the no-op');

  const staleSuccess = await recordProviderRefreshSuccess('game-stats', SCOPE, {
    attempt: staleAttempt,
    committedAt: new Date(NOW - 30_000).toISOString(),
    commitRevision: 1, // duplicate of the already-published revision
  });
  assert.equal(staleSuccess, 'idempotent', 'equal revision is an idempotent duplicate');
  status = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(status.lastSuccessRevision, 1);

  const olderSuccess = await recordProviderRefreshSuccess('game-stats', SCOPE, {
    committedAt: new Date(NOW - 30_000).toISOString(),
    commitRevision: 0, // invalid → legacy path; older committedAt loses
  });
  void olderSuccess;
  status = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(status.lastSuccessRevision, 1, 'no stale writer regressed committed metadata');
});

test('typed status results: a broken status store yields failed publication — evidence still committed', async () => {
  const ingestion = await ingest([GAME_A()]);
  assert.equal(ingestion.kind, 'merged');
  __setAppStateWriteFailureForTests(new Error('status store down'), 'provider-refresh-status');
  let publication;
  try {
    publication = await finalize(ingestion);
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
  assert.equal(
    publication.statusPublication.terminal,
    'failed',
    'publication failure is typed, not void'
  );
  assert.equal(publication.statusPublication.complete, false);
  assert.equal(
    publication.recorded,
    'partial-success',
    'never recorded:success when the ledger was not updated'
  );
  assert.match(publication.detail, /status publication FAILED/i);
  assert.ok(publication.committed, 'the evidence itself IS committed');
});

test('diagnostics persist in the status ledger with the latest attempt', async () => {
  const publication = await finalize(
    await ingest([GAME_A(), { garbage: true }, wireGame({ id: 999_999 })])
  );
  assert.equal(publication.attempt.degraded, true);
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  const persisted = status.lastAttemptDiagnostics as {
    parseFailures?: Record<string, number>;
    attachment?: { unscheduledId?: number };
    degraded?: boolean;
  } | null;
  assert.ok(persisted, 'the typed summary is durably inspectable');
  assert.equal(persisted!.degraded, true);
  assert.equal(persisted!.attachment?.unscheduledId, 1);
  assert.equal(persisted!.parseFailures?.['unaddressable-game-id'], 1);
});

// === Isolated NEW-bucket degradation (canonical-unresolved / classification-unknown) ===

test('degradation: canonical-unresolved and classification-unknown observations are DISTINCT typed buckets persisted in status', async () => {
  // 'Unknown Northern' is outside the catalog (registry-unresolved identity);
  // 'Grass Valley' is catalogued WITHOUT a level and plays in an unknown
  // conference (classification UNKNOWN). Both slate games defer — neither is
  // expected, excluded, nor a placeholder.
  const localResolver = createTeamIdentityResolver({
    teams: [
      { school: 'Alpha State', level: 'FBS' },
      { school: 'Beta Tech', level: 'FBS' },
      { school: 'Grass Valley' },
    ],
    aliasMap: {},
  });
  const expectation = deriveSlateExpectation({
    scheduleItems: [
      {
        id: '5001',
        week: WEEK,
        seasonType: 'regular',
        startDate: COMPLETED,
        status: 'STATUS_FINAL',
        homeTeam: 'Alpha State',
        awayTeam: 'Beta Tech',
      },
      {
        id: '5003',
        week: WEEK,
        seasonType: 'regular',
        startDate: COMPLETED,
        status: 'STATUS_FINAL',
        homeTeam: 'Alpha State',
        awayTeam: 'Unknown Northern',
      },
      {
        id: '5004',
        week: WEEK,
        seasonType: 'regular',
        startDate: COMPLETED,
        status: 'STATUS_FINAL',
        homeTeam: 'Alpha State',
        awayTeam: 'Grass Valley',
        awayConference: 'Mystery League',
      },
    ],
    resolver: localResolver,
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: NOW,
  });
  assert.deepEqual([...expectation.expectedIds], [5001], 'both deferred games are unexpected');
  assert.deepEqual([...expectation.unresolvedIds], [5003]);
  assert.deepEqual([...expectation.classificationUnknownIds], [5004]);

  const ingestion = await ingestGameStatsObservations({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchStartedAt: FENCE,
    payload: [GAME_A(), wireGame({ id: 5003 }), wireGame({ id: 5004 })],
    expectation,
    resolver: localResolver,
  });
  assert.equal(ingestion.kind, 'merged');
  if (ingestion.kind === 'merged') {
    assert.equal(ingestion.attachment.canonicalUnresolved, 1, 'distinct bucket, not folded');
    assert.equal(ingestion.attachment.classificationUnknown, 1, 'distinct bucket, not folded');
    assert.equal(ingestion.attachment.placeholderDeferred, 0, 'never collapsed into placeholder');
  }

  const publication = await finalize(ingestion, expectation);
  assert.equal(publication.coverage?.state, 'complete', 'expected game 5001 committed');
  assert.equal(publication.recorded, 'partial-success', 'degradation downgrades the attempt');
  assert.equal(publication.attempt.degraded, true);
  assert.equal(publication.attempt.attachment?.canonicalUnresolved, 1);
  assert.equal(publication.attempt.attachment?.classificationUnknown, 1);

  // The typed counts survive DURABLY in the status ledger, not only in the
  // in-process response.
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  const persisted = status.lastAttemptDiagnostics as {
    attachment?: { canonicalUnresolved?: number; classificationUnknown?: number };
    degraded?: boolean;
  };
  assert.ok(persisted, 'attempt diagnostics persisted in status');
  assert.equal(persisted.attachment?.canonicalUnresolved, 1);
  assert.equal(persisted.attachment?.classificationUnknown, 1);
  assert.equal(persisted.degraded, true);
});

test('degradation: a payload with ZERO persistable observations is typed noPersistableObservations, never a silent noop', async () => {
  // The only observation MATCHES the expected game but carries no persistable
  // category evidence — nothing reaches the merge authority, and the attempt
  // records the typed no-persistable failure rather than a quiet no-op.
  const expectation = slate([5001]);
  const statless5001 = {
    id: 5001,
    teams: [
      {
        teamId: 101,
        team: 'Alpha State',
        conference: 'X',
        homeAway: 'home',
        points: 21,
        stats: [],
      },
      { teamId: 202, team: 'Beta Tech', conference: 'Y', homeAway: 'away', points: 14, stats: [] },
    ],
  };
  const ingestion = await ingest([statless5001], expectation);
  assert.equal(ingestion.kind, 'no-persistable-observations');
  const publication = await finalize(ingestion, expectation);
  assert.equal(
    publication.recorded,
    'failure',
    'nothing committed against a non-empty expectation'
  );
  assert.equal(publication.code, 'game-stats-no-persistable-observations');
  assert.equal(publication.attempt.noPersistableObservations, 1);
  assert.equal(publication.attempt.degraded, true);
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  const persisted = status.lastAttemptDiagnostics as { noPersistableObservations?: number };
  assert.equal(persisted?.noPersistableObservations, 1, 'typed count persisted durably');
});

// === Enduring revision-ledger authority (round 5): initialization states,
// bootstrap floors, ambiguous-history blocking, locked status consultation ===

const LEDGER_KEY = `${YEAR}:${WEEK}:regular`;
const STATUS_SCOPE_KEY = providerRefreshScopeKey('game-stats', SCOPE);

async function readLedger() {
  return (await getAppState<Record<string, unknown>>('game-stats-revision', LEDGER_KEY))?.value;
}

test('ledger: a brand-new scope initializes at revision 1 with a durable initialization marker', async () => {
  const ingestion = await ingest([GAME_A()]);
  assert.equal(ingestion.kind, 'merged');
  if (ingestion.kind === 'merged') assert.equal(ingestion.merge.commit?.commitRevision, 1);
  const ledger = await readLedger();
  assert.equal(ledger?.schemaVersion, 1);
  assert.equal(ledger?.revision, 1);
  assert.equal(ledger?.initializedFrom, 'new');
});

test('ledger: a RECOGNIZED pre-revision legacy partition bootstraps safely at revision 1', async () => {
  // Only legacy-shaped rows, no commitRevision — the explicitly recognized
  // pre-revision shape (never inferred from missing fields alone).
  await seedGameStatsPartitionForTests({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: '2026-10-14T00:00:00.000Z',
    games: [legacyRowFromWire(wireGame({ id: 5001 }))],
  });
  const ingestion = await ingest([wireGame({ id: 5001, home: { points: 30 } })]);
  assert.equal(ingestion.kind, 'merged');
  if (ingestion.kind === 'merged') assert.equal(ingestion.merge.commit?.commitRevision, 1);
  assert.equal((await readLedger())?.initializedFrom, 'legacy');
});

test('ledger: once initialized, the ledger is the SOLE ordinary allocator (status never consulted)', async () => {
  await finalize(await ingest([GAME_A()])); // ledger initialized at 1
  await setAppState('game-stats-revision', LEDGER_KEY, {
    schemaVersion: 1,
    revision: 10,
    initializedFrom: 'new',
    initializedAt: '2026-01-01T00:00:00.000Z',
  });
  // A status floor ABOVE the ledger must be irrelevant on the ordinary path.
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  await setAppState('provider-refresh-status', status.scopeKey, {
    ...status,
    lastSuccessRevision: 40,
  });
  const later = new Date(Date.parse(FENCE) + 60_000).toISOString();
  const next = await ingest([wireGame({ id: 5001, home: { points: 42 } })], slate([5001]), later);
  assert.equal(next.kind, 'merged');
  if (next.kind === 'merged') {
    assert.equal(next.merge.commit?.commitRevision, 11, 'ledger + 1, status ignored');
  }
});

test('ledger: conflicting VALID floors allocate above the maximum (defensive)', async () => {
  await finalize(await ingest([GAME_A()]));
  // Partition revision pushed ABOVE the ledger (a state the atomic co-commit
  // makes structurally impossible — handled defensively anyway).
  const stored = (await getCachedGameStats(YEAR, WEEK, 'regular'))!;
  await setAppState('game-stats', LEDGER_KEY, { ...stored, commitRevision: 12 });
  await setAppState('game-stats-revision', LEDGER_KEY, {
    schemaVersion: 1,
    revision: 5,
    initializedFrom: 'new',
    initializedAt: '2026-01-01T00:00:00.000Z',
  });
  const later = new Date(Date.parse(FENCE) + 60_000).toISOString();
  const next = await ingest([wireGame({ id: 5001, home: { points: 42 } })], slate([5001]), later);
  assert.equal(next.kind, 'merged');
  if (next.kind === 'merged') assert.equal(next.merge.commit?.commitRevision, 13);
});

test('ledger bootstrap: a valid revision-era partition with NO ledger and NO status floors above it', async () => {
  await finalize(await ingest([GAME_A()])); // commit revision 1 normally
  const stored = (await getCachedGameStats(YEAR, WEEK, 'regular'))!;
  await setAppState('game-stats', LEDGER_KEY, { ...stored, commitRevision: 10 });
  await setAppState('game-stats-revision', LEDGER_KEY, null); // ledger lost
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  const bare: Record<string, unknown> = { ...status };
  delete bare.lastSuccessRevision; // status carries no revision marker
  await setAppState('provider-refresh-status', status.scopeKey, bare);

  const later = new Date(Date.parse(FENCE) + 60_000).toISOString();
  const next = await ingest([wireGame({ id: 5001, home: { points: 42 } })], slate([5001]), later);
  assert.equal(next.kind, 'merged');
  if (next.kind === 'merged') assert.equal(next.merge.commit?.commitRevision, 11);
  assert.equal((await readLedger())?.initializedFrom, 'bootstrap');
});

test('ledger bootstrap: a MALFORMED ledger with a valid status floor rebootstraps above it', async () => {
  await finalize(await ingest([GAME_A()]));
  await setAppState('game-stats-revision', LEDGER_KEY, { corrupted: 'yes' });
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  await setAppState('provider-refresh-status', status.scopeKey, {
    ...status,
    lastSuccessRevision: 10,
  });
  const later = new Date(Date.parse(FENCE) + 60_000).toISOString();
  const next = await ingest([wireGame({ id: 5001, home: { points: 42 } })], slate([5001]), later);
  assert.equal(next.kind, 'merged');
  if (next.kind === 'merged') {
    assert.equal(next.merge.commit?.commitRevision, 11, 'floor from status; never reset to 1');
  }
});

test('ledger AMBIGUOUS: revision-era markers with NO usable source refuse the write (typed, untouched)', async () => {
  await finalize(await ingest([GAME_A()])); // revision-era: v2 rows committed
  const stored = (await getCachedGameStats(YEAR, WEEK, 'regular'))!;
  const restored = { ...stored } as Record<string, unknown>;
  delete restored.commitRevision; // v2 rows WITHOUT a partition revision = damage
  await setAppState('game-stats', LEDGER_KEY, restored);
  await setAppState('game-stats-revision', LEDGER_KEY, null); // ledger lost
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  const bare: Record<string, unknown> = { ...status };
  delete bare.lastSuccessRevision;
  await setAppState('provider-refresh-status', status.scopeKey, bare);

  const later = new Date(Date.parse(FENCE) + 60_000).toISOString();
  const ingestion = await ingest(
    [wireGame({ id: 5001, home: { points: 42 } })],
    slate([5001]),
    later
  );
  assert.equal(ingestion.kind, 'merged');
  if (ingestion.kind === 'merged') {
    assert.equal(ingestion.merge.outcome, 'unavailable');
    assert.equal(ingestion.merge.unavailableReason, 'revision-history-ambiguous');
  }
  const publication = await finalize(ingestion);
  assert.equal(publication.recorded, 'failure');
  assert.equal(publication.code, 'game-stats-revision-history-ambiguous');
  // Durable evidence untouched: the damaged partition is preserved as-is.
  const after = await getAppState<Record<string, unknown>>('game-stats', LEDGER_KEY);
  assert.deepEqual(after?.value, restored, 'no evidence write happened');
  assert.equal(await readLedger(), null, 'no revision was allocated');
});

test('ledger AMBIGUOUS: every source malformed refuses the write', async () => {
  await finalize(await ingest([GAME_A()]));
  const stored = (await getCachedGameStats(YEAR, WEEK, 'regular'))!;
  await setAppState('game-stats', LEDGER_KEY, { ...stored, commitRevision: 'ten' });
  await setAppState('game-stats-revision', LEDGER_KEY, { revision: 'eleven' });
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  await setAppState('provider-refresh-status', status.scopeKey, {
    ...status,
    lastSuccessRevision: 'twelve',
  });
  const later = new Date(Date.parse(FENCE) + 60_000).toISOString();
  const ingestion = await ingest(
    [wireGame({ id: 5001, home: { points: 42 } })],
    slate([5001]),
    later
  );
  assert.equal(ingestion.kind, 'merged');
  if (ingestion.kind === 'merged') {
    assert.equal(ingestion.merge.unavailableReason, 'revision-history-ambiguous');
  }
});

test('ledger bootstrap RACE: a delayed status publisher is serialized by the status key lock', async () => {
  // No ledger; the bootstrap must consult status — while a status-key
  // transaction is MID-FLIGHT, about to advance the floor from 10 to 12. The
  // bootstrap's lockKey queues behind that transaction, so it can only ever
  // observe the COMMITTED 12 — allocating 13, never 11.
  await seedGameStatsPartitionForTests({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: '2026-10-14T00:00:00.000Z',
    games: [legacyRowFromWire(wireGame({ id: 5001 }))],
  });
  await setAppState('provider-refresh-status', STATUS_SCOPE_KEY, { lastSuccessRevision: 10 });

  let entered!: () => void;
  const enteredP = new Promise<void>((r) => (entered = r));
  let release!: () => void;
  const releaseP = new Promise<void>((r) => (release = r));
  const statusWriter = withAppStateKeyTransaction(
    'provider-refresh-status',
    STATUS_SCOPE_KEY,
    async (txn) => {
      entered();
      await releaseP;
      await txn.write({ lastSuccessRevision: 12 });
    }
  );
  await enteredP;

  const later = new Date(Date.parse(FENCE) + 60_000).toISOString();
  const mergePromise = ingest([wireGame({ id: 5001, home: { points: 42 } })], slate([5001]), later);
  // Give the merge time to reach the status lock, then let the writer commit.
  await new Promise((r) => setImmediate(r));
  release();
  await statusWriter;
  const ingestion = await mergePromise;
  assert.equal(ingestion.kind, 'merged');
  if (ingestion.kind === 'merged') {
    assert.equal(
      ingestion.merge.commit?.commitRevision,
      13,
      'bootstrap floor observed the COMMITTED status write, never the stale one'
    );
  }
});

// === Begin/terminal status lifecycle matrix (round 5): both mutation results
// are separate durable facts; a lost begin never blocks truthful terminal
// status and never silently reads as a complete lifecycle ===

async function finalizeWithAttempt(
  attempt: Awaited<ReturnType<typeof beginProviderRefreshAttempt>>,
  ingestion: Awaited<ReturnType<typeof ingest>>,
  expectation = slate([5001])
) {
  return finalizeGameStatsRefresh({
    ingestion,
    expectation,
    seasonRelation: 'current',
    scope: SCOPE,
    attempt,
    contextLabel: `week ${WEEK} regular`,
  });
}

async function beginWithFailedPersistence() {
  __setAppStateWriteFailureForTests(new Error('status store down'), 'provider-refresh-status');
  try {
    return await beginProviderRefreshAttempt('game-stats', SCOPE, {
      startedAt: new Date().toISOString(),
    });
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
}

test('lifecycle matrix: begin FAILS, terminal success persists — attempt identity and diagnostics still recorded', async () => {
  const attempt = await beginWithFailedPersistence();
  assert.equal(attempt.persistence, 'failed');
  const publication = await finalizeWithAttempt(attempt, await ingest([GAME_A()]));
  assert.equal(publication.recorded, 'success', 'evidence + terminal recorded truthfully');
  assert.deepEqual(publication.statusPublication, {
    begin: 'failed',
    terminal: 'persisted',
    complete: false,
  });
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(
    status.lastAttemptId,
    attempt.attemptId,
    'the terminal transaction owns its attempt identity without a durable begin row'
  );
  assert.equal(status.latestAttemptOutcome, 'succeeded');
  assert.equal(status.lastSuccessRevision, 1);
  assert.ok(status.lastAttemptDiagnostics, 'diagnostics persisted despite the lost begin');
});

test('lifecycle matrix: begin FAILS, terminal failure persists — failure code and diagnostics survive', async () => {
  const attempt = await beginWithFailedPersistence();
  const ingestion = await ingest([wireGame({ id: 999_999 })]); // nothing attaches
  const publication = await finalizeWithAttempt(attempt, ingestion);
  assert.equal(publication.recorded, 'failure');
  assert.equal(publication.statusPublication.begin, 'failed');
  assert.equal(publication.statusPublication.terminal, 'persisted');
  assert.equal(publication.statusPublication.complete, false);
  const status = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(status.lastAttemptId, attempt.attemptId);
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.ok(status.lastError?.code, 'typed failure code persisted');
  assert.ok(status.lastAttemptDiagnostics, 'diagnostics not null merely because begin failed');
});

test('lifecycle matrix: BOTH begin and terminal fail — composite reports both, evidence still committed', async () => {
  __setAppStateWriteFailureForTests(new Error('status store down'), 'provider-refresh-status');
  let publication;
  try {
    const attempt = await beginProviderRefreshAttempt('game-stats', SCOPE, {
      startedAt: new Date().toISOString(),
    });
    publication = await finalizeWithAttempt(attempt, await ingest([GAME_A()]));
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
  assert.equal(publication.recorded, 'partial-success', 'terminal failure downgrades success');
  assert.deepEqual(publication.statusPublication, {
    begin: 'failed',
    terminal: 'failed',
    complete: false,
  });
  assert.equal((await getCachedGameStats(YEAR, WEEK, 'regular'))?.games.length, 1);
});

test('lifecycle matrix: a genuinely STALE attempt still cannot overwrite a newer attempt (protection intact)', async () => {
  // Normal newer attempt resolves first.
  await finalize(await ingest([GAME_A()]));
  const newer = await getProviderRefreshStatus('game-stats', SCOPE);
  // A stale attempt (started BEFORE the recorded one) whose begin was lost:
  // chronology comparison refuses ownership — 'skipped-older', never a
  // begin-row requirement.
  const stale = {
    attemptId: 'stale-attempt',
    startedAt: new Date(Date.parse(newer.lastAttemptAt!) - 60_000).toISOString(),
    dataset: 'game-stats' as const,
    scopeKey: newer.scopeKey,
    persistence: 'failed' as const,
  };
  const terminal = await recordProviderRefreshFailure('game-stats', SCOPE, {
    attempt: stale,
    error: 'late stale failure',
  });
  assert.equal(terminal, 'skipped-older');
  const after = await getProviderRefreshStatus('game-stats', SCOPE);
  assert.equal(after.lastAttemptId, newer.lastAttemptId, 'newer attempt state untouched');
  assert.equal(after.latestAttemptOutcome, 'succeeded');
});

test('lifecycle matrix: failure-branch publications (unexpected empty) carry the composite result', async () => {
  const publication = await finalize(await ingest([]));
  assert.equal(publication.recorded, 'failure');
  assert.equal(publication.code, 'game-stats-empty-unexpected');
  assert.deepEqual(publication.statusPublication, {
    begin: 'persisted',
    terminal: 'persisted',
    complete: true,
  });
});
