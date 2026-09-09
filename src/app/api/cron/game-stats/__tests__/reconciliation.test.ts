import assert from 'node:assert/strict';
import test from 'node:test';

import { GET as cronGet } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { getCachedGameStats } from '../../../../../lib/gameStats/cache.ts';
import { ingestGameStatsPartitionResponse } from '../../../../../lib/gameStats/ingestionCoordinator.ts';
import {
  RECONCILIATION_LEDGER_SCOPE,
  readReconciliationLedger,
  reconciliationLedgerKey,
  reserveReconciliationAttempt,
  settleReconciliationAttempt,
  type ReconciliationLedgerEntry,
} from '../../../../../lib/gameStats/reconciliationLedger.ts';
import { RECONCILIATION_MAX_ATTEMPTS } from '../../../../../lib/gameStats/reconciliationTarget.ts';
import {
  seedActiveWriterControl,
  seedWriterControlState,
} from '../../../../../lib/gameStats/__tests__/writerControlSeed.ts';
import { wireGame } from '../../../../../lib/gameStats/__tests__/fixtures.ts';
import {
  beginProviderRefreshAttempt,
  getProviderRefreshStatus,
  recordProviderRefreshNoop,
} from '../../../../../lib/server/providerRefreshStatus.ts';
import { readProviderRefreshHealth } from '../../../../../lib/server/providerRefreshHealth.ts';
import {
  providerRefreshScopeKey,
  weekPartitionScope,
  weekReconciliationScope,
} from '../../../../../lib/providerRefreshScope.ts';
import type { GameStatsCronExecutionEvent } from '../../../../../lib/gameStats/cronExecutionLog.ts';
import { installSchedulerReceiptDeferrer } from '../../../../../lib/server/__tests__/schedulerReceiptTestHarness.ts';

// PLATFORM-110B — bounded correction reconciliation, wired into the game-stats
// cron's existing run slot. Ordinary polling always wins; reconciliation takes
// the slot only when polling has nothing, only over a SATISFIED partition, and
// only after reserving its attempt durably — a store that cannot record must not
// be able to spend.

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  CRON_SECRET: process.env.CRON_SECRET,
  CFBD_API_KEY: process.env.CFBD_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
};
const ORIGINAL_FETCH = globalThis.fetch;
const CRON_SECRET = 'test-cron-secret';
const NO_TARGET_SKIP = 'no partition inside the polling window';
const H = 60 * 60 * 1000;
const GAME_ID = 9001;
const WEEK = 3;

const YEAR = (() => {
  const d = new Date();
  const m = d.getUTCMonth();
  const y = d.getUTCFullYear();
  return m >= 6 ? y : y - 1;
})();

function cronRequest(): Request {
  return new Request('https://example.com/api/cron/game-stats', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

type GameSeed = { id: number; week: number; ageHours: number };

async function seedSchedule(seeds: GameSeed[]) {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: seeds.map((seed) => ({
      id: String(seed.id),
      week: seed.week,
      seasonType: 'regular',
      startDate: new Date(Date.now() - seed.ageHours * H).toISOString(),
      neutralSite: false,
      conferenceGame: false,
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
      homeId: seed.id * 10 + 1,
      awayId: seed.id * 10 + 2,
      homeConference: 'SEC',
      awayConference: 'Big Ten',
      status: 'STATUS_FINAL',
    })),
  });
}

/** The wire row for a seeded game, with optional home-side stat overrides. */
function payloadFor(id = GAME_ID, homeTotalYards?: string) {
  return wireGame({
    id,
    home: {
      school: 'Alpha',
      teamId: id * 10 + 1,
      ...(homeTotalYards === undefined ? {} : { statOverrides: { totalYards: homeTotalYards } }),
    },
    away: { school: 'Beta', teamId: id * 10 + 2 },
  });
}

/**
 * Write a genuine v2 partition through the production ingestion authority at an
 * explicit observation fence — the only honest way to produce the prior-good
 * state a reconciliation pass is supposed to find.
 */
async function ingestAt(fetchStartedAt: string, payload: unknown, week = WEEK) {
  return ingestGameStatsPartitionResponse({
    year: YEAR,
    week,
    seasonType: 'regular',
    fetchStartedAt,
    payload,
  });
}

async function storedHomeTotalYards(week = WEEK): Promise<number | undefined> {
  const stored = await getCachedGameStats(YEAR, week, 'regular');
  return stored?.games.find((g) => g.providerGameId === GAME_ID)?.home.totalYards;
}

function stubProvider(
  payload: unknown,
  options: { remainingCalls?: number; beforeStatsResponse?: () => Promise<void> } = {}
): { statsCalls: number } {
  const calls = { statsCalls: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/info')) {
      return new Response(
        JSON.stringify({ patronLevel: 1, remainingCalls: options.remainingCalls ?? 4000 }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    calls.statsCalls += 1;
    // The seam that makes the concurrency test REAL: another writer commits to
    // this exact partition while THIS request is in flight, which is the
    // interleaving production actually has. A pre-seeded future fence tests the
    // fence arithmetic; only this tests the race.
    if (options.beforeStatsResponse) await options.beforeStatsResponse();
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

function stubProviderTransportFailure(): { statsCalls: number } {
  const calls = { statsCalls: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('/info')) {
      return new Response(JSON.stringify({ patronLevel: 1, remainingCalls: 4000 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    calls.statsCalls += 1;
    throw new Error('provider unreachable');
  }) as typeof fetch;
  return calls;
}

function installLogCapture(): { raw: string[]; restore: () => void } {
  const raw: string[] = [];
  const original = console.log;
  console.log = ((...args: unknown[]) => {
    raw.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }) as typeof console.log;
  return { raw, restore: () => void (console.log = original) };
}

type ReconciliationBlock = {
  pass: 'p1' | 'p2';
  dueAt: string;
  anchorKickoff: string;
  corrected: number | null;
  reservation: string;
  settlement: string;
};

type CronBody = {
  outcome?: string;
  reason?: string;
  committedGames?: number;
  skipped?: string;
  reconciliation?: ReconciliationBlock;
};

async function runCron(): Promise<{
  res: Response;
  body: CronBody;
  event: GameStatsCronExecutionEvent;
}> {
  const cap = installLogCapture();
  let res: Response;
  try {
    res = await cronGet(cronRequest());
  } finally {
    cap.restore();
  }
  const events = cap.raw
    .map((line) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        return null;
      }
    })
    .filter(
      (p): p is GameStatsCronExecutionEvent =>
        !!p && typeof p === 'object' && (p as { event?: unknown }).event === 'game-stats-cron'
    );
  assert.equal(events.length, 1, 'exactly one execution event per invocation');
  return { res, body: (await res.json()) as CronBody, event: events[0]! };
}

async function ledgerEntries(): Promise<ReconciliationLedgerEntry[]> {
  const read = await readReconciliationLedger(YEAR);
  return read.status === 'ok' ? read.ledger.entries : [];
}

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

test.beforeEach(async () => {
  deferrer = installSchedulerReceiptDeferrer();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  globalThis.fetch = ORIGINAL_FETCH;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedActiveWriterControl();
});

test.afterEach(() => {
  deferrer.restore();
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
});

test.after(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete MUTABLE_ENV[key];
    else MUTABLE_ENV[key] = value;
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

/**
 * The ordinary starting state: a week-3 game played 60 hours ago (past its
 * polling window, past its +48h due time) whose SATISFIED stored partition holds
 * a stale home total-yards figure the provider has since revised.
 */
async function seedDuePartitionWithStaleStats() {
  await seedSchedule([{ id: GAME_ID, week: WEEK, ageHours: 60 }]);
  const result = await ingestAt(new Date(Date.now() - 58 * H).toISOString(), [
    payloadFor(GAME_ID, '300'),
  ]);
  assert.equal(result.kind, 'merge-result', 'prior-good partition seeded through the authority');
  assert.equal(await storedHomeTotalYards(), 300);
}

// === The pass itself ===

test('a due, satisfied partition is reconciled: one call, the correction lands, the ledger records it', async () => {
  await seedDuePartitionWithStaleStats();
  const calls = stubProvider([payloadFor(GAME_ID, '412')]);

  const { res, body, event } = await runCron();

  assert.equal(res.status, 200);
  assert.equal(body.outcome, 'success');
  assert.equal(body.reason, 'written-clean');
  assert.equal(body.committedGames, 1);
  assert.equal(calls.statsCalls, 1, 'exactly ONE partition fetch');

  assert.equal(event.mode, 'reconcile');
  assert.equal(event.week, WEEK);
  assert.equal(event.correctedGames, 1);

  assert.equal(body.reconciliation?.pass, 'p1');
  assert.equal(body.reconciliation?.corrected, 1);
  assert.equal(body.reconciliation?.reservation, 'reserved');
  assert.equal(body.reconciliation?.settlement, 'settled');

  assert.equal(await storedHomeTotalYards(), 412, 'the correction is durable');

  const entries = await ledgerEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.reachedVerdict, true);
  assert.equal(entries[0]!.outcome, 'success');
  assert.equal(entries[0]!.reason, 'written-clean');
  assert.equal(entries[0]!.corrected, 1);
  assert.equal(entries[0]!.partitionKey, `${YEAR}:${WEEK}:regular`);

  // The durable receipt names WHICH job ran. Without it System Health shows
  // game-stats targeting week 1 during week 10 and an operator cannot tell a
  // correction pass from a polling run that regressed to a stale partition.
  await deferrer.flush();
  const receipt = await getAppState<{ target?: { mode?: string; week?: number } }>(
    'scheduler-execution-status',
    'game-stats'
  );
  assert.equal(receipt?.value.target?.mode, 'reconcile');
  assert.equal(receipt?.value.target?.week, WEEK);
});

test('the status record lands on the RECONCILIATION scope and can never be latest activity', async () => {
  await seedDuePartitionWithStaleStats();
  stubProvider([payloadFor(GAME_ID, '412')]);
  await runCron();

  const reconciliationStatus = await getProviderRefreshStatus(
    'game-stats',
    weekReconciliationScope(YEAR, WEEK, 'regular')
  );
  assert.equal(reconciliationStatus.latestAttemptOutcome, 'succeeded', 'recorded and readable');

  const weekStatus = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(
    weekStatus.latestAttemptOutcome,
    null,
    'the ordinary week-partition record is untouched'
  );

  // The point of the separate kind: game-stats does not own it, so a correction
  // pass over a long-settled partition can never become the dataset's latest
  // activity and report its health from the least current data it touches.
  const health = await readProviderRefreshHealth({ year: YEAR });
  assert.equal(
    health.subsystem,
    'available',
    'the health read itself must work, or this proves nothing'
  );
  const row = health.rows.find((r) => r.dataset === 'game-stats');
  assert.ok(row);
  // The reconciliation record is the ONLY game-stats status record here, so if
  // the kind were owned it would necessarily be selected. `absent` is therefore
  // the sharp assertion: no eligible activity exists at all.
  assert.equal(
    row.latestScopedActivity.state,
    'absent',
    'a reconciliation record must never be selected as latestScopedActivity — it ' +
      'describes a partition that settled weeks ago'
  );

  // POSITIVE CONTROL for that `absent`. On its own it is also what an
  // UNPARSEABLE record would produce, so it cannot distinguish "parsed but not
  // owned" from "not parsed at all". Writing an OWNED week-partition record for
  // the same year proves the reader does select game-stats week records here —
  // so the absence above is the ownership map doing its job, not the reader
  // being inert. (Nothing in production observes whether the reconciliation
  // record itself parsed; its `parseScope` case is deliberate defensive code so
  // the year-match branch stays correct if the kind is ever owned.)
  const ownedScope = weekPartitionScope(YEAR, 9, 'regular');
  const ownedAttempt = await beginProviderRefreshAttempt('game-stats', ownedScope, {
    startedAt: new Date().toISOString(),
  });
  await recordProviderRefreshNoop('game-stats', ownedScope, {
    attempt: ownedAttempt,
    source: 'cfbd',
  });
  const withOwned = await readProviderRefreshHealth({ year: YEAR });
  const ownedRow = withOwned.rows.find((r) => r.dataset === 'game-stats');
  assert.equal(
    ownedRow?.latestScopedActivity.state,
    'available',
    'an OWNED week-partition record IS selected — the reader is not inert'
  );
  assert.equal(
    ownedRow?.latestScopedActivity.state === 'available'
      ? ownedRow.latestScopedActivity.status.scopeKey
      : null,
    providerRefreshScopeKey('game-stats', ownedScope),
    'and it is the owned record that wins, never the reconciliation one'
  );
});

test('a pass that finds nothing wrong commits a fence advance and reports corrected 0', async () => {
  await seedSchedule([{ id: GAME_ID, week: WEEK, ageHours: 60 }]);
  await ingestAt(new Date(Date.now() - 58 * H).toISOString(), [payloadFor(GAME_ID)]);
  stubProvider([payloadFor(GAME_ID)]);

  const { body, event } = await runCron();

  assert.equal(body.reason, 'written-clean');
  assert.equal(body.committedGames, 1, 'the newer observation is persisted as freshness evidence');
  assert.equal(body.reconciliation?.corrected, 0, 'and nothing was corrected');
  assert.equal(event.correctedGames, 0);
});

test('a closed pass is never fetched again; p2 falls due at +7d and then the horizon closes', async () => {
  await seedDuePartitionWithStaleStats();
  stubProvider([payloadFor(GAME_ID, '412')]);
  await runCron();

  const second = stubProvider([payloadFor(GAME_ID, '999')]);
  const { body, event } = await runCron();
  assert.equal(second.statsCalls, 0, 'no second call for a pass that already ran');
  assert.equal(body.skipped, NO_TARGET_SKIP);
  assert.equal(event.mode, 'poll', 'a run that reconciles nothing is not a reconciliation run');
  assert.equal(await storedHomeTotalYards(), 412);

  await seedSchedule([{ id: GAME_ID, week: WEEK, ageHours: 200 }]);
  const p2 = stubProvider([payloadFor(GAME_ID, '450')]);
  const { body: p2Body } = await runCron();
  assert.equal(p2.statsCalls, 1);
  assert.equal(p2Body.reconciliation?.pass, 'p2');
  assert.equal(await storedHomeTotalYards(), 450);

  const third = stubProvider([payloadFor(GAME_ID, '999')]);
  const { body: thirdBody } = await runCron();
  assert.equal(third.statsCalls, 0, 'two passes, then never again');
  assert.equal(thirdBody.skipped, NO_TARGET_SKIP);
  assert.deepEqual(
    (await ledgerEntries()).map((e) => e.pass),
    ['p1', 'p2']
  );
});

// === The satisfaction gate (owner ruling, 2026-09-09) ===

test('an UNSATISFIED partition is never reconciled — the collection gap stays visible', async () => {
  // A partition ordinary polling never filled. Reconciliation must not quietly
  // collect it: that would MASK the gap instead of surfacing it.
  await seedSchedule([{ id: GAME_ID, week: WEEK, ageHours: 60 }]);
  await setAppState('game-stats', `${YEAR}:${WEEK}:regular`, {
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: new Date(Date.now() - 58 * H).toISOString(),
    games: [],
  });
  const calls = stubProvider([payloadFor(GAME_ID)]);

  const { body, event } = await runCron();

  assert.equal(calls.statsCalls, 0, 'no correction pass over a partition with nothing to correct');
  assert.equal(body.skipped, NO_TARGET_SKIP);
  assert.equal(event.mode, 'poll');
  assert.deepEqual(await ledgerEntries(), []);

  // Positive control: the SAME schedule and timing, with satisfied evidence,
  // does reconcile — so the refusal above is the coverage gate, not the clock.
  await ingestAt(new Date(Date.now() - 58 * H).toISOString(), [payloadFor(GAME_ID, '300')]);
  const armed = stubProvider([payloadFor(GAME_ID, '412')]);
  const { body: ok } = await runCron();
  assert.equal(armed.statsCalls, 1);
  assert.equal(ok.reconciliation?.corrected, 1);
});

test('an absent partition record is never reconciled either', async () => {
  await seedSchedule([{ id: GAME_ID, week: WEEK, ageHours: 60 }]);
  const calls = stubProvider([payloadFor(GAME_ID)]);
  const { body } = await runCron();
  assert.equal(calls.statsCalls, 0, 'initial collection belongs to polling, not to correction');
  assert.equal(body.skipped, NO_TARGET_SKIP);
});

// === Ordinary polling always wins ===

test('a live polling target takes the run slot; the due partition waits', async () => {
  await seedSchedule([
    { id: GAME_ID, week: WEEK, ageHours: 60 },
    { id: 9002, week: 4, ageHours: 5 },
  ]);
  await ingestAt(new Date(Date.now() - 58 * H).toISOString(), [payloadFor(GAME_ID, '300')]);
  const calls = stubProvider([payloadFor(9002)]);

  const { body, event } = await runCron();

  assert.equal(event.mode, 'poll');
  assert.equal(event.week, 4, 'the kickoff-window partition is the target');
  assert.equal(calls.statsCalls, 1, 'still at most ONE call per run');
  assert.equal(body.reconciliation, undefined, 'a polling run carries no reconciliation block');
  assert.deepEqual(await ledgerEntries(), []);
  assert.equal(await storedHomeTotalYards(), 300, 'the reconcilable partition is untouched');
});

// === Only a MERGE VERDICT closes a pass ===

test('an `unavailable` merge does NOT close the pass — a writer-control transition costs no correction', async () => {
  // Observed live during verification: a control refusal returns a typed
  // merge-result while comparing nothing. Treating that as closure would consume
  // every due pass for the length of a maintenance window.
  await seedDuePartitionWithStaleStats();
  await seedWriterControlState('read-only-safe');
  const refused = stubProvider([payloadFor(GAME_ID, '412')]);

  const { body } = await runCron();
  assert.equal(refused.statsCalls, 1);
  assert.equal(body.reason, 'unavailable');
  assert.equal(body.reconciliation?.corrected, null, 'nothing compared, so nothing claimed');

  const entries = await ledgerEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0]!.reachedVerdict, false, 'the pass stays OPEN');

  // And the next healthy run performs it.
  await seedActiveWriterControl();
  const healthy = stubProvider([payloadFor(GAME_ID, '412')]);
  const { body: recovered } = await runCron();
  assert.equal(healthy.statsCalls, 1);
  assert.equal(recovered.reconciliation?.corrected, 1);
  assert.equal(await storedHomeTotalYards(), 412);
});

test('an unusable payload does NOT close the pass either', async () => {
  await seedDuePartitionWithStaleStats();
  stubProvider({ not: 'an array' });

  const { body } = await runCron();
  assert.equal(body.reason, 'invalid-payload');
  assert.equal((await ledgerEntries())[0]!.reachedVerdict, false);

  const healthy = stubProvider([payloadFor(GAME_ID, '412')]);
  await runCron();
  assert.equal(healthy.statsCalls, 1, 'the pass was still due');
});

test('MUTATION — a writer committing MID-FETCH is not clobbered; the fence refuses our merge', async () => {
  // The completeness contract asks for this specific proof: the fence or lock
  // rejects a concurrent writer, with a positive control showing the same call
  // commits when the contention is gone. A pre-seeded future fence would test
  // the arithmetic; this tests the interleaving.
  await seedDuePartitionWithStaleStats();

  let interloperRan = false;
  const calls = stubProvider([payloadFor(GAME_ID, '412')], {
    beforeStatsResponse: async () => {
      const result = await ingestAt(new Date(Date.now() + 60_000).toISOString(), [
        payloadFor(GAME_ID, '777'),
      ]);
      assert.equal(result.kind, 'merge-result');
      interloperRan = true;
    },
  });

  const { body, event } = await runCron();

  assert.ok(interloperRan, 'the concurrent write really happened DURING the fetch');
  assert.equal(calls.statsCalls, 1);
  assert.equal(body.reason, 'stale-clean', 'our observation is older than the durable fence');
  assert.equal(body.committedGames, 0);
  assert.equal(event.correctedGames, 0);
  assert.equal(
    await storedHomeTotalYards(),
    777,
    'the concurrent writer’s newer value stands — never last-writer-wins'
  );
  // The merge authority ruled, so the pass closes rather than retrying into the
  // same contention.
  assert.equal((await ledgerEntries())[0]!.reachedVerdict, true, 'a verdict is a verdict');
});

test('POSITIVE CONTROL — the same call commits once the contention is gone', async () => {
  await seedDuePartitionWithStaleStats();
  const calls = stubProvider([payloadFor(GAME_ID, '412')]);

  const { body } = await runCron();

  assert.equal(calls.statsCalls, 1, 'the identical single request');
  assert.equal(body.reason, 'written-clean', 'and with no concurrent writer it COMMITS');
  assert.equal(body.reconciliation?.corrected, 1);
  assert.equal(await storedHomeTotalYards(), 412);
});

// === Reserve before the spend ===

test('a ledger that cannot record REFUSES to spend', async () => {
  await seedDuePartitionWithStaleStats();
  __setAppStateWriteFailureForTests(new Error('write refused'), RECONCILIATION_LEDGER_SCOPE);
  const calls = stubProvider([payloadFor(GAME_ID, '412')]);

  const { body, event } = await runCron();

  assert.equal(calls.statsCalls, 0, 'no CFBD call when the attempt cannot be recorded');
  assert.equal(body.reason, 'reconciliation-unreserved');
  assert.equal(body.reconciliation?.reservation, 'write-failed');
  assert.equal(event.providerCallAttempted, false);
  assert.equal(await storedHomeTotalYards(), 300, 'prior-good untouched');

  // Positive control: the identical run spends once the store can record.
  __setAppStateWriteFailureForTests(null);
  const healthy = stubProvider([payloadFor(GAME_ID, '412')]);
  const { body: ok } = await runCron();
  assert.equal(healthy.statsCalls, 1);
  assert.equal(ok.reconciliation?.corrected, 1);
});

test('a FULL season row refuses to spend rather than refetching forever', async () => {
  await seedDuePartitionWithStaleStats();
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), {
    year: YEAR,
    // Disjoint partitions, so the refusal is the ceiling and not a closed pass.
    entries: Array.from({ length: 400 }, (_, i) => ({
      attemptId: `f${i}`,
      partitionKey: `${YEAR}:${i}:postseason`,
      pass: 'p1',
      dueAt: '2025-09-10T00:00:00.000Z',
      reservedAt: '2025-09-10T00:00:00.000Z',
      observedAt: '2025-09-10T00:00:00.000Z',
      reachedVerdict: true,
      outcome: 'success',
      reason: 'written-clean',
      corrected: 0,
      refreshed: 0,
      inserted: 0,
      conflicts: 0,
      stale: 0,
      notObserved: 0,
    })),
  });
  const calls = stubProvider([payloadFor(GAME_ID, '412')]);

  const { body } = await runCron();
  assert.equal(calls.statsCalls, 0, 'a full row must stop the spend, not start a loop');
  assert.equal(body.reconciliation?.reservation, 'ledger-full');
});

test('a transport failure leaves the pass OPEN and the cap ends the retries', async () => {
  await seedDuePartitionWithStaleStats();

  for (let attempt = 1; attempt <= RECONCILIATION_MAX_ATTEMPTS; attempt += 1) {
    const failing = stubProviderTransportFailure();
    const { body } = await runCron();
    assert.equal(failing.statsCalls, 1, `attempt ${attempt} issued its request`);
    assert.equal(body.reason, 'provider-fetch-failed');
    assert.equal(
      body.reconciliation?.corrected,
      null,
      'a transport failure corrected nothing — reporting 0 would claim a clean comparison'
    );
    assert.equal(body.reconciliation?.settlement, 'settled');
  }

  const entries = await ledgerEntries();
  assert.equal(entries.length, RECONCILIATION_MAX_ATTEMPTS);
  assert.ok(entries.every((e) => e.reachedVerdict === false));

  const capped = stubProviderTransportFailure();
  const { body: cappedBody } = await runCron();
  assert.equal(capped.statsCalls, 0, 'p1 is abandoned at the attempt cap');
  assert.equal(cappedBody.skipped, NO_TARGET_SKIP);
});

// === Pre-provider refusals burn no attempt ===

test('a quota refusal spends nothing, reserves nothing, and leaves the pass due', async () => {
  await seedDuePartitionWithStaleStats();
  const refused = stubProvider([payloadFor(GAME_ID, '412')], { remainingCalls: 5 });

  const { body, event } = await runCron();

  assert.equal(body.reason, 'quota-below-reserve');
  assert.equal(refused.statsCalls, 0);
  assert.equal(event.mode, 'reconcile', 'the run still reports which job it was refusing');
  assert.equal(body.reconciliation?.reservation, 'not-attempted');
  assert.equal(body.reconciliation?.corrected, null);
  assert.deepEqual(await ledgerEntries(), [], 'a quota-starved month must burn no passes');

  const healthy = stubProvider([payloadFor(GAME_ID, '412')]);
  const { body: recovered } = await runCron();
  assert.equal(healthy.statsCalls, 1);
  assert.equal(recovered.reconciliation?.corrected, 1);
});

test('a missing credential is refused by the QUOTA gate first, and also burns nothing', async () => {
  // NOT the route's `cfbd-api-key-missing` branch: the `/info` probe needs the
  // same key and runs first, so it throws, usage is unavailable, and the reserve
  // is never reached. The property under test is that nothing is spent and
  // nothing is burned — which holds whichever gate refuses.
  await seedDuePartitionWithStaleStats();
  delete MUTABLE_ENV.CFBD_API_KEY;
  const calls = stubProvider([payloadFor(GAME_ID, '412')]);

  const { body } = await runCron();
  assert.equal(body.reason, 'quota-usage-unavailable');
  assert.equal(calls.statsCalls, 0);
  assert.deepEqual(await ledgerEntries(), []);

  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  const healthy = stubProvider([payloadFor(GAME_ID, '412')]);
  await runCron();
  assert.equal(healthy.statsCalls, 1, 'the pass was still due');
});

// === The ledger read fails closed ===

test('a MALFORMED ledger suppresses the pass, spends nothing, and is VISIBLE', async () => {
  await seedDuePartitionWithStaleStats();
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), {
    year: YEAR,
    entries: 'not an array',
  });
  const calls = stubProvider([payloadFor(GAME_ID, '412')]);

  const { res, body, event } = await runCron();

  // `failure`, not `skipped`: a skip reads as healthy, so a corrupt ledger would
  // disable every correction for the season while System Health showed a quiet
  // job and the only trace was one log line.
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'reconciliation-ledger-unavailable');
  assert.equal(body.reason, 'reconciliation-ledger-unavailable');
  assert.equal(res.status, 503);
  assert.equal(calls.statsCalls, 0);
  assert.equal(await storedHomeTotalYards(), 300, 'prior-good untouched');
});

test('a ledger READ FAILURE also suppresses the pass — distinct from a malformed value', async () => {
  // Without this, deleting `read-failed` from the resolver would leave the
  // malformed-value test above green while a real store fault re-ran every pass.
  await seedDuePartitionWithStaleStats();
  __setAppStateReadFailureForTests(new Error('store down'), RECONCILIATION_LEDGER_SCOPE);
  const calls = stubProvider([payloadFor(GAME_ID, '412')]);

  const { body, event } = await runCron();

  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'reconciliation-ledger-unavailable');
  assert.equal(body.reason, 'reconciliation-ledger-unavailable');
  assert.equal(calls.statsCalls, 0);

  // Positive control: the identical run reconciles once the store reads again.
  __setAppStateReadFailureForTests(null);
  const healthy = stubProvider([payloadFor(GAME_ID, '412')]);
  const { body: ok } = await runCron();
  assert.equal(healthy.statsCalls, 1);
  assert.equal(ok.reconciliation?.corrected, 1);
});

// === The closure ruling, and its binding condition ===

test('an EMPTY provider response does not close the pass — it contradicts proven coverage', async () => {
  // Reconciliation only runs over `complete` coverage, so the partition
  // demonstrably HAS satisfied rows. An empty array is a provider anomaly, and
  // the coordinator returns it before the merge is ever called — nothing was
  // compared.
  await seedDuePartitionWithStaleStats();
  const empty = stubProvider([]);

  const { body } = await runCron();
  assert.equal(empty.statsCalls, 1);
  assert.equal(body.reason, 'empty-response');
  assert.equal((await ledgerEntries())[0]!.reachedVerdict, false, 'the pass stays OPEN');

  const healthy = stubProvider([payloadFor(GAME_ID, '412')]);
  const { body: recovered } = await runCron();
  assert.equal(healthy.statsCalls, 1, 'the pass was still due');
  assert.equal(recovered.reconciliation?.corrected, 1);
});

test('a response omitting an expected game still closes p1 — and p2 runs REGARDLESS', async () => {
  // Owner ruling: closing is right BECAUSE p2 re-observes seven days later, so
  // retrying inside p1 would pay extra calls to duplicate the second pass. That
  // argument collapses if closing p1 suppresses p2, so THIS is the condition
  // under test, not the closing.
  await seedSchedule([
    { id: GAME_ID, week: WEEK, ageHours: 60 },
    { id: 9003, week: WEEK, ageHours: 61 },
  ]);
  await ingestAt(new Date(Date.now() - 58 * H).toISOString(), [
    payloadFor(GAME_ID, '300'),
    payloadFor(9003),
  ]);

  // The response carries only ONE of the two expected games.
  const partial = stubProvider([payloadFor(GAME_ID, '412')]);
  const { body } = await runCron();
  assert.equal(partial.statsCalls, 1);
  assert.equal(body.reconciliation?.pass, 'p1');
  const p1 = (await ledgerEntries())[0]!;
  assert.equal(p1.reachedVerdict, true, 'the merge ruled, so p1 closes');
  assert.equal(p1.notObserved, 1, 'and the omission is RECORDED rather than chased');

  // The binding condition: p2 must still fall due and run.
  await seedSchedule([
    { id: GAME_ID, week: WEEK, ageHours: 200 },
    { id: 9003, week: WEEK, ageHours: 201 },
  ]);
  const secondPass = stubProvider([payloadFor(GAME_ID, '450'), payloadFor(9003)]);
  const { body: p2Body } = await runCron();
  assert.equal(secondPass.statsCalls, 1, 'p2 runs regardless of how p1 ended');
  assert.equal(p2Body.reconciliation?.pass, 'p2');
  assert.equal(await storedHomeTotalYards(), 450, 'and it re-observes the partition');
});

// === Benign refusals are not faults ===

test('a concurrently CLOSED pass resolves as a NO-OP, not a false failure', async () => {
  // The real interleaving: a QStash redelivery resolves the same due target,
  // and another run closes the pass before this one reserves. The `/info` quota
  // probe sits exactly between resolution and reservation, so closing the pass
  // from inside it reproduces the race without a second process.
  await seedDuePartitionWithStaleStats();

  const calls = { statsCalls: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/info')) {
      // Another invocation completes the pass while this run is mid-quota-check.
      const reserved = await reserveReconciliationAttempt({
        year: YEAR,
        partitionKey: `${YEAR}:${WEEK}:regular`,
        pass: 'p1',
        dueAt: new Date().toISOString(),
        attemptId: 'concurrent-run',
        reservedAt: new Date().toISOString(),
      });
      if (reserved.status === 'reserved') {
        await settleReconciliationAttempt(YEAR, 'concurrent-run', {
          reachedVerdict: true,
          outcome: 'success',
          reason: 'written-clean',
          observedAt: new Date().toISOString(),
          corrected: 1,
          refreshed: 0,
          inserted: 0,
          conflicts: 0,
          stale: 0,
          notObserved: 0,
        });
      }
      return new Response(JSON.stringify({ patronLevel: 1, remainingCalls: 4000 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    calls.statsCalls += 1;
    return new Response(JSON.stringify([payloadFor(GAME_ID, '412')]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const { res, body, event } = await runCron();

  assert.equal(calls.statsCalls, 0, 'the second run must not spend a call on finished work');
  assert.equal(body.reconciliation?.reservation, 'already-closed');
  assert.equal(res.status, 200, 'benign, so not a 503');
  assert.equal(event.result, 'no-op');
  assert.equal(
    event.reason,
    'reconciliation-already-done',
    'a redelivery must not overwrite the successful run’s evidence with a false failure'
  );
});

test('a settlement failure after a committed merge reports PARTIAL, never success', async () => {
  await seedDuePartitionWithStaleStats();
  const calls = stubProvider([payloadFor(GAME_ID, '412')]);

  // Let the reservation commit, then break the store so only the settlement
  // fails. The merge still lands; the bookkeeping does not.
  let settled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const res = await originalFetch(input as RequestInfo);
    if (!String(input).includes('/info') && !settled) {
      settled = true;
      __setAppStateWriteFailureForTests(new Error('settle boom'), RECONCILIATION_LEDGER_SCOPE);
    }
    return res;
  }) as typeof fetch;

  const { body, event } = await runCron();
  __setAppStateWriteFailureForTests(null);

  assert.equal(calls.statsCalls, 1);
  assert.equal(body.outcome, 'success', 'the DATA outcome is the interpreter’s, verbatim');
  assert.equal(body.reconciliation?.settlement, 'write-failed');
  assert.equal(event.result, 'partial', 'but the RUN is partial — a fault must not read healthy');
  assert.equal(event.reason, 'reconciliation-settlement-failed');
  assert.equal(await storedHomeTotalYards(), 412, 'the merge did commit');
});

// === A partition read failure is not a quiet day ===

test('an unreadable PARTITION is reported, not silently read as nothing due', async () => {
  await seedDuePartitionWithStaleStats();
  __setAppStateReadFailureForTests(new Error('partition read boom'), 'game-stats');
  const calls = stubProvider([payloadFor(GAME_ID, '412')]);

  const { body, event } = await runCron();

  assert.equal(calls.statsCalls, 0, 'nothing is spent on an unprovable state');
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'reconciliation-ledger-unavailable');
  assert.notEqual(body.skipped, NO_TARGET_SKIP, 'a store fault must not read as a quiet day');

  // Positive control: the identical run reconciles once the store reads again.
  __setAppStateReadFailureForTests(null);
  const healthy = stubProvider([payloadFor(GAME_ID, '412')]);
  const { body: ok } = await runCron();
  assert.equal(healthy.statsCalls, 1);
  assert.equal(ok.reconciliation?.corrected, 1);
});
