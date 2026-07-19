import assert from 'node:assert/strict';
import test from 'node:test';

import {
  claimAndRevalidateNextCandidate,
  GAME_STATS_RECOVERY_METADATA_FAILURE_CODE,
  GameStatsRecoveryRevalidationError,
  runManualGameStatsRefresh,
  runScheduledGameStatsRefresh,
} from '../refreshOrchestration.ts';
import { loadGameStatsIdentityResolver } from '../identityContext.ts';
import { ingestGameStatsObservations } from '../ingestion.ts';
import { planGameStatsRecovery } from '../recovery.ts';
import { loadSlateExpectationContext } from '../readAvailability.ts';
import { getCachedGameStats } from '../cache.ts';
import { readGameStatsRecoveryDisposition } from '../recoveryDisposition.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
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
  assert.equal(statusAfterFirst.lastSuccessRevision, 1, 'durable partition revision propagated');

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
  assert.equal(
    statusAfterSecond.lastSuccessRevision,
    2,
    'the second commit advanced the durable revision'
  );
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

// === Post-claim authoritative revalidation (the stale-plan race) ===

test('stale-plan race: a plan snapshot cannot trigger a fetch after another writer satisfies P', async () => {
  await seedSchedule([{ id: '5001' }]);
  // A plans while P is ABSENT.
  const resolver = await loadGameStatsIdentityResolver();
  const stalePlan = planGameStatsRecovery({
    year: YEAR,
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
    ],
    resolver,
    records: [],
    now: NOW,
    seasonRelation: 'current',
  });
  assert.equal(stalePlan.candidates.length, 1, 'the stale plan lists P as recoverable');

  // B claims, fills, and finalizes P (manual override flow).
  const fill = await runManualGameStatsRefresh({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: NOW,
    providerConfigured: true,
    fetchPayload: async () => [wireGame({ id: 5001 })],
  });
  assert.equal(fill.kind, 'executed');
  assert.equal(await readGameStatsRecoveryDisposition(YEAR, WEEK, 'regular'), null, 'B cleared P');

  // A later claims FROM ITS STALE PLAN: the post-claim authoritative reread
  // sees P satisfied → zero provider calls, claim released (cleared), no
  // durable change.
  const before = await getCachedGameStats(YEAR, WEEK, 'regular');
  const selection = await claimAndRevalidateNextCandidate({
    year: YEAR,
    now: NOW + 1000,
    candidates: stalePlan.candidates,
  });
  assert.equal(selection.target, null, 'no fetchable target from the stale plan');
  assert.deepEqual(selection.staleClaims, [{ week: WEEK, seasonType: 'regular' }]);
  assert.deepEqual(selection.recoveryFailures, []);
  assert.equal(
    await readGameStatsRecoveryDisposition(YEAR, WEEK, 'regular'),
    null,
    'the stale claim was token-conditionally cleared'
  );
  assert.deepEqual(await getCachedGameStats(YEAR, WEEK, 'regular'), before, 'evidence untouched');
});

test('stale-plan rotation: stale P is released and older eligible Q is selected — one fetch total', async () => {
  await seedSchedule([
    { id: '5001', week: 3, startDate: COMPLETED },
    { id: '2001', week: 2, startDate: new Date(NOW - 11 * 24 * 60 * 60 * 1000).toISOString() },
  ]);
  const resolver = await loadGameStatsIdentityResolver();
  const scheduleItems = [
    {
      id: '5001',
      week: 3,
      seasonType: 'regular' as const,
      startDate: COMPLETED,
      status: 'STATUS_FINAL',
      homeTeam: 'Alpha State',
      awayTeam: 'Beta Tech',
    },
    {
      id: '2001',
      week: 2,
      seasonType: 'regular' as const,
      startDate: new Date(NOW - 11 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'STATUS_FINAL',
      homeTeam: 'Alpha State',
      awayTeam: 'Beta Tech',
    },
  ];
  const stalePlan = planGameStatsRecovery({
    year: YEAR,
    scheduleItems,
    resolver,
    records: [],
    now: NOW,
    seasonRelation: 'current',
  });
  assert.deepEqual(
    stalePlan.candidates.map((c) => c.week),
    [3, 2]
  );

  // Another writer satisfies P (week 3) after the plan.
  const fill = await runManualGameStatsRefresh({
    year: YEAR,
    week: 3,
    seasonType: 'regular',
    now: NOW,
    providerConfigured: true,
    fetchPayload: async () => [wireGame({ id: 5001 })],
  });
  assert.equal(fill.kind, 'executed');

  // Selection from the stale plan: P is claimed, revalidated, released;
  // rotation lands on Q (week 2) WITHOUT any provider call spent so far.
  const selection = await claimAndRevalidateNextCandidate({
    year: YEAR,
    now: NOW + 1000,
    candidates: stalePlan.candidates,
  });
  assert.ok(selection.target, 'the older eligible candidate is selected');
  assert.equal(selection.target!.week, 2, 'rotation reached Q');
  assert.deepEqual(selection.staleClaims, [{ week: 3, seasonType: 'regular' }]);
  assert.equal(
    await getCachedGameStats(YEAR, 2, 'regular'),
    null,
    'no fetch happened during selection'
  );
});

test('post-claim revalidation preserves token fencing: the released claim cannot be double-finalized', async () => {
  await seedSchedule([{ id: '5001' }]);
  const resolver = await loadGameStatsIdentityResolver();
  const context = await loadSlateExpectationContext({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: NOW,
  });
  assert.ok(context.ok);
  void resolver;

  // Satisfy P first, leaving a STALE disposition so the planner still lists it.
  const ingestion = await ingestGameStatsObservations({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchStartedAt: new Date(NOW - 1000).toISOString(),
    payload: [wireGame({ id: 5001 })],
    expectation: context.ok ? context.expectation : (null as never),
    resolver: context.ok ? context.resolver : (null as never),
  });
  assert.equal(ingestion.kind, 'merged');

  const stalePlanCandidates = [
    {
      week: WEEK,
      seasonType: 'regular' as const,
      latestCompletedKickoff: 0,
      expectation: context.ok ? context.expectation : (null as never),
      coverage: {
        state: 'absent' as const,
        expected: [5001],
        satisfied: [],
        recoverable: [],
        manualOnly: [],
        blocked: [],
        absent: [5001],
        unmatchedStored: [],
        deferredPlaceholders: 0,
        excludedByClassification: 0,
        pending: [],
      },
      eligible: true,
      disposition: null,
    },
  ];
  const selection = await claimAndRevalidateNextCandidate({
    year: YEAR,
    now: NOW,
    candidates: stalePlanCandidates,
  });
  assert.equal(selection.target, null);
  assert.deepEqual(selection.staleClaims, [{ week: WEEK, seasonType: 'regular' }]);
  // The claim is gone (cleared) — a duplicate finalization of the released
  // token would be stale (fenced), proven by the disposition state.
  assert.equal(await readGameStatsRecoveryDisposition(YEAR, WEEK, 'regular'), null);
});

// === Recovery-metadata failure visibility (failure injection) ===

test('failure injection: manual provider failure + disposition-finalization failure keep BOTH causes', async () => {
  await seedSchedule([{ id: '5001' }]);
  let fetches = 0;
  const result = await runManualGameStatsRefresh({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: NOW,
    providerConfigured: true,
    fetchPayload: async () => {
      fetches += 1;
      // Break ONLY the recovery-metadata scope AFTER the claim was persisted —
      // the finalization that follows the provider failure will fail too.
      __setAppStateWriteFailureForTests(new Error('disposition store down'), 'game-stats-recovery');
      throw new Error('provider connection refused');
    },
  });
  __setAppStateWriteFailureForTests(null);
  assert.equal(fetches, 1);
  assert.equal(result.kind, 'provider-failure');
  if (result.kind === 'provider-failure') {
    assert.match(String(result.error), /provider connection refused/, 'primary cause preserved');
    assert.equal(result.recovery.outcome, 'failed', 'secondary cause preserved');
    assert.match(result.recovery.detail ?? '', /disposition store down/);
  }
  assert.equal(await getCachedGameStats(YEAR, WEEK, 'regular'), null, 'no evidence mutation');
});

test('failure injection: scheduled retirement failure is surfaced on the result, not just logged', async () => {
  await seedSchedule([{ id: '5001' }]);
  // Satisfied partition with a lingering disposition → planner retires it.
  const fill = await runManualGameStatsRefresh({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: NOW,
    providerConfigured: true,
    fetchPayload: async () => [wireGame({ id: 5001 })],
  });
  assert.equal(fill.kind, 'executed');
  // Recreate a lingering disposition manually (claim without finalize, lease expired).
  const lingering = await runManualGameStatsRefresh({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    now: NOW + 1000,
    providerConfigured: true,
    fetchPayload: async () => {
      throw new Error('leave a disposition behind');
    },
  });
  assert.equal(lingering.kind, 'provider-failure');
  assert.ok(await readGameStatsRecoveryDisposition(YEAR, WEEK, 'regular'), 'disposition lingers');

  __setAppStateWriteFailureForTests(new Error('retirement store down'), 'game-stats-recovery');
  let scheduled;
  try {
    scheduled = await runScheduledGameStatsRefresh({
      year: YEAR,
      now: NOW + 2000,
      providerConfigured: true,
      fetchPayload: async () => {
        throw new Error('satisfied partitions must not be fetched');
      },
    });
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
  assert.equal(scheduled.kind, 'skipped');
  assert.ok(
    scheduled.recoveryFailures && scheduled.recoveryFailures.length > 0,
    'failure surfaced'
  );
  assert.equal(scheduled.recoveryFailures![0]!.operation, 'retire');
  assert.match(scheduled.recoveryFailures![0]!.detail, /retirement store down/);
});

// === Post-claim DUAL failures: primary revalidation cause + release-finalization cause ===

function planSingleCandidate(resolver: Awaited<ReturnType<typeof loadGameStatsIdentityResolver>>) {
  return planGameStatsRecovery({
    year: YEAR,
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
    ],
    resolver,
    records: [],
    now: NOW,
    seasonRelation: 'current',
  });
}

test('dual failure: schedule-context reread AND release finalization both fail — both causes survive, stable code', async () => {
  await seedSchedule([{ id: '5001' }]);
  const resolver = await loadGameStatsIdentityResolver();
  const plan = planSingleCandidate(resolver);
  assert.equal(plan.candidates.length, 1);

  // The claim commits (first recovery-scope write allowed), the post-claim
  // schedule reread fails, and the token-conditional release ALSO fails.
  __setAppStateReadFailureForTests(new Error('schedule store down'), 'schedule');
  __setAppStateWriteFailureForTests(
    new Error('recovery release store down'),
    'game-stats-recovery',
    { afterWrites: 1 }
  );
  try {
    await assert.rejects(
      claimAndRevalidateNextCandidate({
        year: YEAR,
        now: NOW + 1000,
        candidates: plan.candidates,
      }),
      (err: unknown) => {
        assert.ok(err instanceof GameStatsRecoveryRevalidationError, String(err));
        // Stage-specific stable primary code; the raw cause is internal only.
        assert.equal(err.primary.stage, 'schedule-context');
        assert.equal(err.primary.code, 'game-stats-revalidation-schedule-context-failed');
        assert.match(
          String(err.internalCause),
          /schedule store down/,
          'raw cause retained internally'
        );
        assert.ok(!err.primary.summary.includes('schedule store down'), 'summary is sanitized');
        // A recovery-metadata op actually failed → both causes preserved.
        assert.equal(err.recoveryMetadataFailed, true);
        assert.equal(err.recoveryFailures.length, 1, 'secondary cause preserved');
        assert.equal(err.recoveryFailures[0]!.operation, 'stale-claim-finalize');
        assert.equal(err.leaseMayRemainActive, true, 'uncertain release stays truthful');
        assert.equal(err.providerAccessOccurred, false, 'zero provider access');
        // The PUBLIC projection carries the metadata code and sanitized secondary.
        const pub = err.toPublic();
        assert.equal(pub.code, 'game-stats-revalidation-schedule-context-failed');
        assert.equal(pub.recoveryFailureCode, GAME_STATS_RECOVERY_METADATA_FAILURE_CODE);
        assert.equal(pub.recoveryFailures?.[0]?.dispositionPersistence, 'uncertain');
        assert.ok(!JSON.stringify(pub).includes('schedule store down'), 'no raw cause on the wire');
        assert.ok(!JSON.stringify(pub).includes('recovery release store down'));
        return true;
      }
    );
  } finally {
    __setAppStateReadFailureForTests(null);
    __setAppStateWriteFailureForTests(null);
  }
  assert.equal(await getCachedGameStats(YEAR, WEEK, 'regular'), null, 'no evidence mutation');
});

test('dual failure: durable-reread AND release finalization both fail — both causes survive, stable code', async () => {
  await seedSchedule([{ id: '5001' }]);
  const resolver = await loadGameStatsIdentityResolver();
  const plan = planSingleCandidate(resolver);
  assert.equal(plan.candidates.length, 1);

  // Schedule context succeeds; the committed-partition reread fails; the
  // release finalization fails too (claim write already spent the grace).
  __setAppStateReadFailureForTests(new Error('game-stats partition store down'), 'game-stats');
  __setAppStateWriteFailureForTests(
    new Error('recovery release store down'),
    'game-stats-recovery',
    { afterWrites: 1 }
  );
  try {
    await assert.rejects(
      claimAndRevalidateNextCandidate({
        year: YEAR,
        now: NOW + 1000,
        candidates: plan.candidates,
      }),
      (err: unknown) => {
        assert.ok(err instanceof GameStatsRecoveryRevalidationError, String(err));
        assert.equal(err.primary.stage, 'durable-reread');
        assert.equal(err.primary.code, 'game-stats-revalidation-durable-reread-failed');
        assert.match(String(err.internalCause), /partition store down/, 'raw cause internal only');
        assert.equal(err.recoveryMetadataFailed, true);
        assert.equal(err.recoveryFailures.length, 1, 'secondary cause preserved');
        assert.equal(err.recoveryFailures[0]!.operation, 'stale-claim-finalize');
        assert.equal(err.leaseMayRemainActive, true);
        assert.equal(err.providerAccessOccurred, false);
        const pub = err.toPublic();
        assert.equal(pub.recoveryFailureCode, GAME_STATS_RECOVERY_METADATA_FAILURE_CODE);
        assert.ok(!JSON.stringify(pub).includes('partition store down'));
        return true;
      }
    );
  } finally {
    __setAppStateReadFailureForTests(null);
    __setAppStateWriteFailureForTests(null);
  }
});

test('primary-only: a schedule-context failure whose claim release SUCCEEDS carries no recovery-metadata code', async () => {
  await seedSchedule([{ id: '5001' }]);
  const resolver = await loadGameStatsIdentityResolver();
  const plan = planSingleCandidate(resolver);

  // Only the schedule reread fails; the token-conditional release persists.
  __setAppStateReadFailureForTests(new Error('schedule store down'), 'schedule');
  try {
    await assert.rejects(
      claimAndRevalidateNextCandidate({ year: YEAR, now: NOW + 1000, candidates: plan.candidates }),
      (err: unknown) => {
        assert.ok(err instanceof GameStatsRecoveryRevalidationError, String(err));
        assert.equal(err.primary.stage, 'schedule-context');
        assert.equal(err.recoveryMetadataFailed, false, 'no recovery op failed');
        assert.equal(err.leaseMayRemainActive, false, 'claim was released');
        const pub = err.toPublic();
        assert.equal(pub.code, 'game-stats-revalidation-schedule-context-failed');
        assert.equal(
          pub.recoveryFailureCode,
          undefined,
          'metadata code omitted when nothing failed'
        );
        assert.equal(pub.recoveryFailures, undefined);
        assert.equal(pub.providerAccessOccurred, false);
        return true;
      }
    );
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});

test('primary-only: a durable-reread failure whose release SUCCEEDS carries no recovery-metadata code', async () => {
  await seedSchedule([{ id: '5001' }]);
  const resolver = await loadGameStatsIdentityResolver();
  const plan = planSingleCandidate(resolver);

  __setAppStateReadFailureForTests(new Error('partition store down'), 'game-stats');
  try {
    await assert.rejects(
      claimAndRevalidateNextCandidate({ year: YEAR, now: NOW + 1000, candidates: plan.candidates }),
      (err: unknown) => {
        assert.ok(err instanceof GameStatsRecoveryRevalidationError, String(err));
        assert.equal(err.primary.stage, 'durable-reread');
        assert.equal(err.recoveryMetadataFailed, false);
        assert.equal(err.toPublic().recoveryFailureCode, undefined);
        return true;
      }
    );
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});

test('redaction: injected SQL/paths/tokens/secrets in the raw cause never reach the public projection', async () => {
  await seedSchedule([{ id: '5001' }]);
  const resolver = await loadGameStatsIdentityResolver();
  const plan = planSingleCandidate(resolver);

  const nasty =
    "select * from app_state where key='/var/secrets/app.json'; token=abcd-SECRET-1234\n" +
    'at Object.<anonymous> (/Users/zach/cfb-app/src/lib/server/appStateStore.ts:640:11)';
  __setAppStateReadFailureForTests(new Error(nasty), 'schedule');
  try {
    await assert.rejects(
      claimAndRevalidateNextCandidate({ year: YEAR, now: NOW + 1000, candidates: plan.candidates }),
      (err: unknown) => {
        assert.ok(err instanceof GameStatsRecoveryRevalidationError, String(err));
        const serialized = JSON.stringify(err.toPublic());
        for (const secret of [
          'select * from',
          '/var/secrets',
          'SECRET',
          'appStateStore.ts',
          'token=',
        ]) {
          assert.ok(!serialized.includes(secret), `"${secret}" must not reach the wire`);
        }
        // The raw cause is still available INTERNALLY for server logs.
        assert.match(String(err.internalCause), /SECRET/);
        return true;
      }
    );
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});
