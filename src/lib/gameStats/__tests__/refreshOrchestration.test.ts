import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runManualGameStatsRefresh,
  runScheduledGameStatsRefresh,
} from '../refreshOrchestration.ts';
import { getCachedGameStats } from '../cache.ts';
import { readGameStatsRecoveryDisposition } from '../recoveryDisposition.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '../../server/appStateStore.ts';
import { getProviderRefreshStatus } from '../../server/providerRefreshStatus.ts';
import { weekPartitionScope } from '../../providerRefreshScope.ts';
import { seedGameStatsTeamDatabaseForTests, wireGame } from './fixtures.ts';

// PLATFORM-086H3 — orchestration boundary: fenced claims BEFORE provider
// access, overlapping-run single-fetch behavior, commit-order-true status
// metadata under stalled finalizers, and manual participation in the bounded
// recovery lifecycle. Deterministic barriers (deferred promises), no sleeps.

const WEEK = 3;
// Wall-clock relative: the orchestration stamps dispositions with real
// Date.now(), so the planner's `now` must live on the same clock.
const NOW = Date.now();
const YEAR = (() => {
  const d = new Date(NOW);
  return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
})();
const COMPLETED = new Date(NOW - 4 * 24 * 60 * 60 * 1000).toISOString();

async function seedSchedule(
  items: Array<{ id: string; week?: number; home?: string; away?: string; startDate?: string }>
) {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: NOW,
    partialFailure: false,
    failedSeasonTypes: [],
    items: items.map((spec) => ({
      id: spec.id,
      week: spec.week ?? WEEK,
      seasonType: 'regular',
      startDate: spec.startDate ?? COMPLETED,
      neutralSite: false,
      conferenceGame: false,
      homeTeam: spec.home ?? 'Alpha State',
      awayTeam: spec.away ?? 'Beta Tech',
      homeConference: 'X',
      awayConference: 'Y',
      status: 'STATUS_FINAL',
    })),
  });
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedGameStatsTeamDatabaseForTests();
});

test('overlapping scheduled runs: exactly one claims partition P and fetches it once', async () => {
  await seedSchedule([{ id: '5001' }]);
  const gateA = deferred();
  let fetches = 0;
  const fetchLog: string[] = [];

  // Run A claims P, then BLOCKS inside its provider fetch until released.
  const runA = runScheduledGameStatsRefresh({
    year: YEAR,
    now: NOW,
    providerConfigured: true,
    fetchPayload: async () => {
      fetches += 1;
      fetchLog.push('A');
      await gateA.promise;
      return [wireGame({ id: 5001 })];
    },
  });
  // Give A's claim transaction time to commit (its fetch is now pending).
  // setImmediate yields the MACROTASK queue so file-store I/O can progress.
  while (fetchLog.length === 0) await new Promise((r) => setImmediate(r));

  // Run B starts BEFORE A finishes: P is claimed, no other candidate exists →
  // B spends ZERO provider calls and reports every candidate ineligible.
  const resultB = await runScheduledGameStatsRefresh({
    year: YEAR,
    now: NOW + 1000,
    providerConfigured: true,
    fetchPayload: async () => {
      fetches += 1;
      fetchLog.push('B');
      return [];
    },
  });
  assert.equal(resultB.kind, 'skipped');
  if (resultB.kind === 'skipped') assert.equal(resultB.reason, 'all-ineligible');

  gateA.resolve();
  const resultA = await runA;
  assert.equal(resultA.kind, 'executed');
  assert.equal(fetches, 1, 'only A contacted the provider for P');
  assert.deepEqual(fetchLog, ['A']);
  assert.equal((await getCachedGameStats(YEAR, WEEK, 'regular'))?.games.length, 1);
});

test('overlapping scheduled runs: B rotates to ANOTHER eligible partition while A holds P', async () => {
  await seedSchedule([
    { id: '5001', week: 3, startDate: COMPLETED },
    { id: '2001', week: 2, startDate: new Date(NOW - 11 * 24 * 60 * 60 * 1000).toISOString() },
  ]);
  const gateA = deferred();
  const fetchLog: Array<{ who: string; week: number }> = [];

  const runA = runScheduledGameStatsRefresh({
    year: YEAR,
    now: NOW,
    providerConfigured: true,
    fetchPayload: async (target) => {
      fetchLog.push({ who: 'A', week: target.week });
      await gateA.promise;
      return [wireGame({ id: 5001 })];
    },
  });
  while (fetchLog.length === 0) await new Promise((r) => setImmediate(r));
  assert.equal(fetchLog[0]!.week, 3, 'A claimed the newest candidate');

  // B cannot claim week 3 (A owns it) — it selects the older eligible week 2.
  const resultB = await runScheduledGameStatsRefresh({
    year: YEAR,
    now: NOW + 1000,
    providerConfigured: true,
    fetchPayload: async (target) => {
      fetchLog.push({ who: 'B', week: target.week });
      return [wireGame({ id: 2001 })];
    },
  });
  assert.equal(resultB.kind, 'executed');
  if (resultB.kind === 'executed')
    assert.equal(resultB.week, 2, 'B progressed the older candidate');

  gateA.resolve();
  await runA;
  assert.deepEqual(
    fetchLog.map((f) => `${f.who}:${f.week}`),
    ['A:3', 'B:2'],
    'one fetch per partition, no duplicates'
  );
});

test('commit stamps come from the merge authority at COMMIT, and successive commits order correctly', async () => {
  await seedSchedule([{ id: '5001' }]);
  const scope = weekPartitionScope(YEAR, WEEK, 'regular');

  const first = await runManualGameStatsRefresh({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: NOW,
    providerConfigured: true,
    fetchPayload: async () => [wireGame({ id: 5001, home: { points: 21 } })],
  });
  assert.equal(first.kind, 'executed');
  const statusAfterFirst = await getProviderRefreshStatus('game-stats', scope);
  assert.ok(statusAfterFirst.lastSuccessAt, 'first commit published');
  assert.ok(statusAfterFirst.lastSuccessSeq !== undefined, 'commit sequence propagated');

  // Second, NEWER commit (later fence, changed content) advances last-success.
  const second = await runManualGameStatsRefresh({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: NOW + 60_000,
    providerConfigured: true,
    fetchPayload: async () => [wireGame({ id: 5001, home: { points: 28 } })],
  });
  assert.equal(second.kind, 'executed');
  const statusAfterSecond = await getProviderRefreshStatus('game-stats', scope);
  assert.ok(statusAfterSecond.lastSuccessSeq! > statusAfterFirst.lastSuccessSeq!);
});

test('manual refresh participates in the bounded lifecycle: typed disposition + claim fencing', async () => {
  await seedSchedule([
    { id: '5001' },
    { id: '5002', home: 'Gamma Poly', away: 'Delta Agricultural' },
  ]);

  // A manual provider failure records a typed disposition (backoff for the
  // SCHEDULED path; manual override may still retry).
  const failed = await runManualGameStatsRefresh({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: NOW,
    providerConfigured: true,
    fetchPayload: async () => {
      throw new Error('provider connection refused');
    },
  });
  assert.equal(failed.kind, 'provider-failure');
  if (failed.kind === 'provider-failure') assert.equal(failed.recovery.outcome, 'finalized');
  const disposition = await readGameStatsRecoveryDisposition(YEAR, WEEK, 'regular');
  assert.ok(disposition, 'manual failures are not outside the bounded policy');
  assert.equal(disposition!.lastReason, 'provider-unavailable');
  assert.ok(disposition!.nextEligibleAt, 'bounded next-eligible recorded');

  // Scheduled recovery now backs off this partition…
  const scheduled = await runScheduledGameStatsRefresh({
    year: YEAR,
    now: NOW + 1000,
    providerConfigured: true,
    fetchPayload: async () => {
      throw new Error('must not fetch a backing-off partition');
    },
  });
  assert.equal(scheduled.kind, 'skipped');

  // …while a manual override retries, succeeds partially, and the disposition
  // reflects the typed partial-coverage outcome.
  const retried = await runManualGameStatsRefresh({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: NOW + 2000,
    providerConfigured: true,
    fetchPayload: async () => [wireGame({ id: 5001 })],
  });
  assert.equal(retried.kind, 'executed');
  if (retried.kind === 'executed') {
    assert.equal(retried.publication.recorded, 'partial-success');
    assert.equal(retried.recovery.outcome, 'finalized');
  }
  const after = await readGameStatsRecoveryDisposition(YEAR, WEEK, 'regular');
  assert.equal(after!.lastReason, 'partial-coverage');
  assert.equal(after!.backoffTier, 0, 'committed-coverage progress reset the tier');
});

test('claim persistence failure PREVENTS the provider request entirely', async () => {
  await seedSchedule([{ id: '5001' }]);
  let fetches = 0;
  __setAppStateWriteFailureForTests(new Error('recovery store down'), 'game-stats-recovery');
  try {
    await assert.rejects(() =>
      runManualGameStatsRefresh({
        year: YEAR,
        week: WEEK,
        seasonType: 'regular',
        now: NOW,
        providerConfigured: true,
        fetchPayload: async () => {
          fetches += 1;
          return [];
        },
      })
    );
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
  assert.equal(fetches, 0, 'no provider access without a durably committed claim');
});

test('config failure with a resolved scheduled target records against the exact partition, no claim consumed', async () => {
  await seedSchedule([{ id: '5001' }]);
  const result = await runScheduledGameStatsRefresh({
    year: YEAR,
    now: NOW,
    providerConfigured: false,
    fetchPayload: async () => {
      throw new Error('must not fetch without a credential');
    },
  });
  assert.equal(result.kind, 'config-failure');
  if (result.kind === 'config-failure') assert.equal(result.week, WEEK);
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'cfbd-api-key-missing');
  assert.equal(
    await readGameStatsRecoveryDisposition(YEAR, WEEK, 'regular'),
    null,
    'a configuration failure is not partition state'
  );
});

test('mixed-payload degradation stays observable on a successful commit (partial + diagnostics)', async () => {
  await seedSchedule([{ id: '5001' }]);
  const result = await runManualGameStatsRefresh({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: NOW,
    providerConfigured: true,
    fetchPayload: async () => [
      wireGame({ id: 5001 }),
      { garbage: true }, // parse failure
      wireGame({ id: 999_999 }), // unscheduled id
    ],
  });
  assert.equal(result.kind, 'executed');
  if (result.kind !== 'executed') return;
  const { publication } = result;
  assert.equal(publication.coverage?.state, 'complete', 'committed coverage IS complete');
  assert.equal(
    publication.recorded,
    'partial-success',
    'the degraded attempt is recorded partial, never laundered into full success'
  );
  assert.equal(publication.attempt.degraded, true);
  assert.equal(publication.attempt.parseFailures['unaddressable-game-id'], 1);
  assert.equal(publication.attempt.attachment?.unscheduledId, 1);
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'partial');
});
