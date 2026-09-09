import assert from 'node:assert/strict';
import test from 'node:test';

import { GET as cronGet } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { getCachedGameStats } from '../../../../../lib/gameStats/cache.ts';
import { ingestGameStatsPartitionResponse } from '../../../../../lib/gameStats/ingestionCoordinator.ts';
import {
  RECONCILIATION_LEDGER_SCOPE,
  readReconciliationLedger,
  reconciliationLedgerKey,
} from '../../../../../lib/gameStats/reconciliationLedger.ts';
import { RECONCILIATION_MAX_ATTEMPTS } from '../../../../../lib/gameStats/reconciliationTarget.ts';
import { seedActiveWriterControl } from '../../../../../lib/gameStats/__tests__/writerControlSeed.ts';
import { wireGame } from '../../../../../lib/gameStats/__tests__/fixtures.ts';
import { getProviderRefreshStatus } from '../../../../../lib/server/providerRefreshStatus.ts';
import { weekPartitionScope } from '../../../../../lib/providerRefreshScope.ts';
import type { GameStatsCronExecutionEvent } from '../../../../../lib/gameStats/cronExecutionLog.ts';

// PLATFORM-110B — bounded correction reconciliation, wired into the game-stats
// cron's existing run slot. Ordinary polling always wins; reconciliation takes
// the slot only when polling has nothing, and then at most one partition per run
// through the SAME ingestion authority, quota gate and writer fence.

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

/** The wire row for the seeded game, with optional home-side stat overrides. */
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
  const row = stored?.games.find((g) => g.providerGameId === GAME_ID);
  return row?.home.totalYards;
}

/** Stub CFBD: healthy `/info` usage + `payload` for `/games/teams`. */
function stubProvider(
  payload: unknown,
  options: { remainingCalls?: number; beforeStatsResponse?: () => Promise<void> } = {}
): { statsCalls: number; urls: string[] } {
  const calls = { statsCalls: 0, urls: [] as string[] };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.urls.push(url);
    if (url.includes('/info')) {
      return new Response(
        JSON.stringify({ patronLevel: 1, remainingCalls: options.remainingCalls ?? 4000 }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    calls.statsCalls += 1;
    // The seam that makes a concurrent-writer test real: another writer commits
    // while THIS request is in flight, exactly as it would in production.
    if (options.beforeStatsResponse) await options.beforeStatsResponse();
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

function stubProviderTransportFailure(remainingCalls = 4000): { statsCalls: number } {
  const calls = { statsCalls: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/info')) {
      return new Response(JSON.stringify({ patronLevel: 1, remainingCalls }), {
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
  ledger: string;
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

async function ledgerEntries() {
  const read = await readReconciliationLedger(YEAR);
  return read.status === 'ok' ? read.ledger.entries : [];
}

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  globalThis.fetch = ORIGINAL_FETCH;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedActiveWriterControl();
});

test.afterEach(() => {
  __setAppStateReadFailureForTests(null);
});

test.after(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete MUTABLE_ENV[key];
    else MUTABLE_ENV[key] = value;
  }
  globalThis.fetch = ORIGINAL_FETCH;
});

/**
 * The ordinary starting state for these tests: a week-3 game played 60 hours ago
 * (past its polling window, past its +48h reconciliation due time) whose stored
 * partition holds a STALE home total-yards figure the provider has since revised.
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

test('a due partition is reconciled: one call, the correction lands, the ledger records it', async () => {
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
  assert.equal(body.reconciliation?.ledger, 'appended');

  assert.equal(await storedHomeTotalYards(), 412, 'the correction is durable');

  // A reconciliation is a game-stats refresh of that week partition, so it
  // records the SAME scoped status the poll path does — no out-of-band writer
  // leaving `provider-refresh-status` describing a state that no longer exists
  // (the Item 194 failure mode).
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'succeeded');
  assert.equal(status.rowsCommitted, 1);

  const entries = await ledgerEntries();
  assert.equal(entries.length, 1);
  assert.deepEqual(
    {
      partitionKey: entries[0]!.partitionKey,
      pass: entries[0]!.pass,
      reachedIngestion: entries[0]!.reachedIngestion,
      outcome: entries[0]!.outcome,
      reason: entries[0]!.reason,
      corrected: entries[0]!.corrected,
    },
    {
      partitionKey: `${YEAR}:${WEEK}:regular`,
      pass: 'p1',
      reachedIngestion: true,
      outcome: 'success',
      reason: 'written-clean',
      corrected: 1,
    }
  );
});

test('a pass that finds nothing wrong commits a fence advance and reports corrected 0', async () => {
  // The distinction the +7d pass will be retired on: `committedGames` counts the
  // fence-only refresh, `corrected` counts games whose CONTENT changed. Collapsing
  // the two would make a clean pass indistinguishable from a repair.
  await seedSchedule([{ id: GAME_ID, week: WEEK, ageHours: 60 }]);
  await ingestAt(new Date(Date.now() - 58 * H).toISOString(), [payloadFor(GAME_ID)]);
  stubProvider([payloadFor(GAME_ID)]);

  const { body, event } = await runCron();

  assert.equal(body.outcome, 'success');
  assert.equal(body.reason, 'written-clean');
  assert.equal(body.committedGames, 1, 'the newer observation is persisted as freshness evidence');
  assert.equal(body.reconciliation?.corrected, 0, 'and nothing was corrected');
  assert.equal(event.correctedGames, 0);
  assert.equal((await ledgerEntries())[0]?.corrected, 0);
});

test('a closed pass is never fetched again', async () => {
  await seedDuePartitionWithStaleStats();
  stubProvider([payloadFor(GAME_ID, '412')]);
  await runCron();

  const second = stubProvider([payloadFor(GAME_ID, '999')]);
  const { body, event } = await runCron();

  assert.equal(second.statsCalls, 0, 'no second call for a pass that already ran');
  assert.equal(body.skipped, NO_TARGET_SKIP);
  assert.equal(event.reason, 'no-polling-target');
  assert.equal(event.mode, 'poll', 'a run that reconciles nothing is not a reconciliation run');
  assert.equal(await storedHomeTotalYards(), 412, 'and the partition is untouched');
  assert.equal((await ledgerEntries()).length, 1);
});

test('p2 falls due at +7d and takes exactly one more pass, then the horizon closes', async () => {
  await seedDuePartitionWithStaleStats();
  stubProvider([payloadFor(GAME_ID, '412')]);
  await runCron();

  // Age the same game past the +7d boundary; p1 is closed, so p2 is what is due.
  await seedSchedule([{ id: GAME_ID, week: WEEK, ageHours: 200 }]);
  const secondPass = stubProvider([payloadFor(GAME_ID, '450')]);
  const { body } = await runCron();

  assert.equal(secondPass.statsCalls, 1);
  assert.equal(body.reconciliation?.pass, 'p2');
  assert.equal(body.reconciliation?.corrected, 1);
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

// === Ordinary polling always wins ===

test('a live polling target takes the run slot; the due partition waits', async () => {
  await seedSchedule([
    { id: GAME_ID, week: WEEK, ageHours: 60 }, // reconcilable
    { id: 9002, week: 4, ageHours: 5 }, // inside the polling window, unsatisfied
  ]);
  await ingestAt(new Date(Date.now() - 58 * H).toISOString(), [payloadFor(GAME_ID, '300')]);
  const calls = stubProvider([payloadFor(9002)]);

  const { body, event } = await runCron();

  assert.equal(event.mode, 'poll');
  assert.equal(event.week, 4, 'the kickoff-window partition is the target');
  assert.equal(calls.statsCalls, 1, 'still at most ONE call per run');
  assert.equal(body.reconciliation, undefined, 'a polling run carries no reconciliation block');
  assert.deepEqual(await ledgerEntries(), [], 'and appends nothing to the ledger');
  assert.equal(await storedHomeTotalYards(), 300, 'the reconcilable partition is untouched');
});

// === Missed-run recovery, and the quota reserve ===

test('a quota refusal spends nothing, records nothing, and leaves the pass due', async () => {
  await seedDuePartitionWithStaleStats();
  const refused = stubProvider([payloadFor(GAME_ID, '412')], { remainingCalls: 5 });

  const { body, event } = await runCron();

  assert.equal(body.outcome, 'failure');
  assert.equal(body.reason, 'quota-below-reserve');
  assert.equal(refused.statsCalls, 0, 'the reserve refused before the billed request');
  assert.equal(event.mode, 'reconcile', 'the run still reports which job it was refusing');
  assert.equal(body.reconciliation?.ledger, 'not-attempted');
  assert.equal(body.reconciliation?.corrected, null);
  assert.deepEqual(await ledgerEntries(), [], 'a quota-starved month must burn no passes');

  // Missed-run recovery: the very next healthy run performs the skipped pass.
  const healthy = stubProvider([payloadFor(GAME_ID, '412')]);
  const { body: recovered } = await runCron();
  assert.equal(healthy.statsCalls, 1);
  assert.equal(recovered.reconciliation?.corrected, 1);
  assert.equal(await storedHomeTotalYards(), 412);
});

test('a missing credential also leaves the pass due', async () => {
  await seedDuePartitionWithStaleStats();
  delete MUTABLE_ENV.CFBD_API_KEY;
  stubProvider([payloadFor(GAME_ID, '412')]);

  const { body } = await runCron();
  // Reported reason is the QUOTA gate's, not `cfbd-api-key-missing`: on this
  // route the `/info` probe needs the same key and runs first, so it throws,
  // usage is unavailable, and the reserve refuses before the credential branch
  // is reached. Pre-existing and safe — both refusals fail closed and spend
  // nothing — but the credential branch is unreachable from the cron.
  assert.equal(body.reason, 'quota-usage-unavailable');
  assert.deepEqual(await ledgerEntries(), []);

  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  const healthy = stubProvider([payloadFor(GAME_ID, '412')]);
  await runCron();
  assert.equal(healthy.statsCalls, 1, 'the pass was still due');
});

test('a transport failure records an OPEN attempt, retries, and is abandoned at the cap', async () => {
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
    assert.equal(body.reconciliation?.ledger, 'appended');
  }

  const entries = await ledgerEntries();
  assert.equal(entries.length, RECONCILIATION_MAX_ATTEMPTS);
  assert.ok(
    entries.every((e) => e.reachedIngestion === false && e.outcome === 'failure'),
    'none of them reached ingestion, so none of them closed the pass'
  );

  // The cap is what stops a permanently failing partition refetching forever.
  const capped = stubProviderTransportFailure();
  const { body: cappedBody } = await runCron();
  assert.equal(capped.statsCalls, 0, 'p1 is abandoned at the attempt cap');
  assert.equal(cappedBody.skipped, NO_TARGET_SKIP);
});

test('an unreadable ledger suppresses the pass and spends nothing', async () => {
  await seedDuePartitionWithStaleStats();
  await setAppState(RECONCILIATION_LEDGER_SCOPE, reconciliationLedgerKey(YEAR), {
    year: YEAR,
    entries: 'not an array',
  });
  const calls = stubProvider([payloadFor(GAME_ID, '412')]);

  const { body, event } = await runCron();

  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'reconciliation-ledger-unavailable');
  assert.equal(body.skipped, 'correction-reconciliation ledger is unreadable');
  assert.equal(calls.statsCalls, 0, 'reading a corrupt record as empty would re-run every pass');
  assert.equal(await storedHomeTotalYards(), 300, 'prior-good untouched');
});

// === The collision property: a concurrent writer wins, and our write is refused ===

test('MUTATION — a writer committing mid-fetch is not clobbered; the fence refuses our merge', async () => {
  await seedDuePartitionWithStaleStats();

  // Another writer commits to this exact partition while the reconciliation's
  // `/games/teams` request is in flight, at an observation fence NEWER than the
  // one this run captured before it fetched. Its content wins.
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

  assert.ok(interloperRan, 'the concurrent write really happened during the fetch');
  assert.equal(calls.statsCalls, 1);
  assert.equal(body.reason, 'stale-clean', 'our observation is older than the durable fence');
  assert.equal(body.committedGames, 0);
  assert.equal(body.reconciliation?.corrected, 0);
  assert.equal(event.correctedGames, 0);
  assert.equal(
    await storedHomeTotalYards(),
    777,
    'the concurrent writer’s newer value stands — never last-writer-wins'
  );
  // The merge authority ruled, so the pass is closed rather than retried into
  // the same contention.
  assert.equal((await ledgerEntries())[0]?.reachedIngestion, true);
});

test('POSITIVE CONTROL — the same call commits once the contention is gone', async () => {
  await seedDuePartitionWithStaleStats();
  const calls = stubProvider([payloadFor(GAME_ID, '412')]);

  const { body } = await runCron();

  assert.equal(calls.statsCalls, 1, 'the identical single request');
  assert.equal(body.reason, 'written-clean', 'and with no concurrent writer it COMMITS');
  assert.equal(body.committedGames, 1);
  assert.equal(body.reconciliation?.corrected, 1);
  assert.equal(await storedHomeTotalYards(), 412);
});
