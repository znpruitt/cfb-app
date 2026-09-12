import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '@/lib/server/appStateStore';
import {
  POLLING_PLANNER_RECORD_SCOPE,
  pollingPlannerHoldRecordKey,
  readPollingPlannerHoldRuns,
  readPollingPlannerRuns,
} from '@/lib/server/pollingPlannerRecord';
import {
  __setSchedulerReceiptDeferrerForTests,
  SCHEDULER_EXECUTION_STATUS_SCOPE,
  type SchedulerExecutionReceipt,
} from '@/lib/server/schedulerExecutionStatus';

import { buildUpsertRequest } from '../../../../../../scripts/lib/qstashSchedule';
import {
  GAME_STATS_DENSE_CONTRACT,
  GAME_STATS_SLOW_CONTRACT,
  LIVE_SCORES_DENSE_CONTRACT,
  LIVE_SCORES_SLOW_CONTRACT,
} from '../../../../../../scripts/lib/plannerScheduleContracts';

import { GET } from '../route';

/**
 * PLATFORM-102 slice 4 — the planner route. THIS SLICE IS NOT DORMANT: these
 * tests drive the first thing in the campaign that writes a durable planner
 * record and mutates a live QStash schedule.
 */

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_SECRET = process.env.CRON_SECRET;
const ORIGINAL_TOKEN = process.env.QSTASH_TOKEN;

const CRON_SECRET = 'cron-secret-SECRET-VALUE';
const QSTASH_TOKEN = 'qstash-token-SECRET-VALUE';
const REDACTED_AUTH = 'REDACTED:9f2c-opaque-digest-value';

const ALL_CONTRACTS = [
  LIVE_SCORES_DENSE_CONTRACT,
  LIVE_SCORES_SLOW_CONTRACT,
  GAME_STATS_DENSE_CONTRACT,
  GAME_STATS_SLOW_CONTRACT,
];

type Call = { url: string; method: string; headers: Record<string, string> };

async function reset(): Promise<void> {
  globalThis.fetch = ORIGINAL_FETCH;
  process.env.CRON_SECRET = CRON_SECRET;
  process.env.QSTASH_TOKEN = QSTASH_TOKEN;
  // DELETE THE BACKING FILE, do not merely reset the seams. PLATFORM-207:
  // `__resetAppStateForTests` clears pools and seams but NOT the file, and under
  // `APP_STATE_TEST_ISOLATION` that file is keyed by `process.pid` and never
  // removed — so a process whose pid was recycled from an earlier suite run starts
  // life owning that run's durable store. An inherited
  // `provider-refresh-settings::global` carrying `globalPause: true` holds both
  // planner jobs, and the four plan-deriving tests below then fail on `plan-held`
  // with nothing in THIS file to explain it. Reproduced 20/20 by planting exactly
  // that file; the per-key nulls this replaced could not reach the settings scope.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await assertPlannerInputsAreClean();
}

/**
 * The planner's THREE durable inputs, asserted absent at the top of every test.
 *
 * WHAT THIS CAN AND CANNOT CATCH, stated precisely because the first version of
 * this comment overclaimed. It runs AFTER the delete above, and `getAppState` has
 * no in-memory cache — every call re-reads the backing file — so by the time these
 * assertions run an INHERITED store has already been unlinked and cannot fail
 * them. This is not inheritance detection; the delete is what handles inheritance,
 * and asserting before it would instead fail on the ~24% of runs where a recycled
 * pid hands this process a perfectly harmless store.
 *
 * What it does catch: the delete not reaching the store these tests actually read
 * — someone removing the call (mutation-proven: all 11 tests then fail HERE on the
 * settings scope, on test 1, instead of on test 3's `pauses.length 0 !== 2`), a
 * pool left installed by a previous test so the two resolve to different backends,
 * or a durable write from a previous test landing after the reset. Each of those
 * ends with the same four tests reading `plan-held` for a reason nothing in the
 * assertion trail explains, which is the failure mode worth naming at its cause.
 */
async function assertPlannerInputsAreClean(): Promise<void> {
  for (const job of ['live-scores', 'game-stats'] as const) {
    assert.equal(
      await getAppState(POLLING_PLANNER_RECORD_SCOPE, job),
      null,
      `${job}: a planner record survived reset()`
    );
    // PLATFORM-732 — the HELD series is a second key under the same scope, and it
    // inherits the same recycled-pid hazard the applied one does. Left unasserted,
    // an inherited trace would make the hold tests below pass on a previous run's
    // row rather than on one this run wrote.
    assert.equal(
      await getAppState(POLLING_PLANNER_RECORD_SCOPE, pollingPlannerHoldRecordKey(job)),
      null,
      `${job}: a held planner trace survived reset()`
    );
  }
  const { PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY } = await import(
    '@/lib/server/providerRefreshSettings'
  );
  assert.equal(
    await getAppState(PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY),
    null,
    'an operator hold survived reset() — every job would be held and every plan test would read plan-held'
  );
  const year = planningSeasonYear();
  for (const suffix of ['all-all', 'all-regular', 'all-postseason']) {
    assert.equal(
      await getAppState('schedule', `${year}-${suffix}`),
      null,
      `schedule/${year}-${suffix} survived reset() — "absence sends nothing" would read a neighbour's season`
    );
  }
}

/** The season year the route will ask for, derived the same way the route does. */
function planningSeasonYear(): number {
  const planned = new Date(Math.floor((Date.now() + 60 * 60 * 1000) / 86_400_000) * 86_400_000);
  return planned.getUTCMonth() >= 6 ? planned.getUTCFullYear() : planned.getUTCFullYear() - 1;
}

function restore(): void {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_TOKEN === undefined) delete process.env.QSTASH_TOKEN;
  else process.env.QSTASH_TOKEN = ORIGINAL_TOKEN;
}

function installReceiptDeferrer(): { flush: () => Promise<void>; restore: () => void } {
  const callbacks: Array<() => Promise<void>> = [];
  __setSchedulerReceiptDeferrerForTests((callback) => callbacks.push(callback));
  return {
    flush: async () => {
      while (callbacks.length > 0) await callbacks.shift()!();
    },
    restore: () => __setSchedulerReceiptDeferrerForTests(null),
  };
}

/** A QStash stand-in over global fetch, recording every real request. */
function installQstash(options: {
  scheduleFor?: (scheduleId: string) => Record<string, unknown> | null;
  mutationStatus?: number;
}): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? 'GET';
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: href, method, headers });
    if (method === 'GET') {
      const scheduleId = href.split('/v2/schedules/')[1] ?? '';
      const body = options.scheduleFor?.(scheduleId) ?? null;
      return body === null
        ? { status: 404, json: async () => ({}) }
        : { status: 200, json: async () => body };
    }
    const scheduleId =
      decodeURIComponent(href.split('/v2/schedules/')[1] ?? '').split('/')[0] ?? '';
    return {
      status: options.mutationStatus ?? 200,
      json: async () => ({
        // The upsert URL carries the DESTINATION; the confirm predicate reads the
        // schedule id out of the response body, so echo the pinned header.
        scheduleId: headers['Upstash-Schedule-Id'] ?? scheduleId,
      }),
    };
  }) as unknown as typeof fetch;
  return calls;
}

function readbackFor(scheduleId: string, overrides: Record<string, unknown> = {}) {
  const contract = ALL_CONTRACTS.find((entry) => entry.scheduleId === scheduleId);
  if (!contract) return null;
  return {
    scheduleId: contract.scheduleId,
    destination: contract.destination,
    cron: contract.cron,
    method: contract.method,
    retries: contract.retries,
    isPaused: false,
    header: { Authorization: [REDACTED_AUTH] },
    ...overrides,
  };
}

const request = (auth = `Bearer ${CRON_SECRET}`): Request =>
  new Request('https://turfwar.games/api/cron/polling-planner', {
    headers: { authorization: auth },
  });

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test('an unauthenticated run touches NOTHING — no QStash call, no record, no receipt', async () => {
  await reset();
  const deferrer = installReceiptDeferrer();
  const calls = installQstash({});
  try {
    const res = await GET(request('Bearer wrong'));
    assert.equal(res.status, 401);
    await deferrer.flush();

    assert.equal(calls.length, 0, 'no management request before authentication');
    assert.deepEqual(await readPollingPlannerRuns('live-scores'), { kind: 'absent' });
    // Identity is created only after authentication, so no receipt is advanced.
    const receipt = await readReceipt();
    assert.equal(receipt, null);
  } finally {
    deferrer.restore();
    restore();
  }
});

test('an unconfigured CRON_SECRET fails closed rather than running unauthenticated', async () => {
  await reset();
  delete process.env.CRON_SECRET;
  const calls = installQstash({});
  try {
    const res = await GET(request());
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function readReceipt(): Promise<SchedulerExecutionReceipt | null> {
  const row = await getAppState<SchedulerExecutionReceipt>(
    SCHEDULER_EXECUTION_STATUS_SCOPE,
    'polling-planner'
  );
  return row?.value ?? null;
}

/** Seed the canonical schedule cache for the season year the planner will read. */
async function seedSchedule(items: Array<Record<string, unknown>>): Promise<number> {
  const dayStartMs = Math.floor((Date.now() + 60 * 60 * 1000) / 86_400_000) * 86_400_000;
  await setAppState('schedule', `${planningSeasonYear()}-all-all`, { items });
  return dayStartMs;
}

/** A season record that is READABLE and whose games are nowhere near the planning day. */
async function seedDeadDaySeason(): Promise<void> {
  const dayStartMs = await seedDay();
  // Sixty days behind the planning day: a real, parseable kickoff, so the season
  // record is established — and no window of it reaches the day being planned.
  await seedSchedule([
    { startDate: new Date(dayStartMs - 60 * 86_400_000).toISOString(), startTimeTBD: false },
  ]);
}

test('a dead day PAUSES both dense schedules and records what it did', async () => {
  await reset();
  const deferrer = installReceiptDeferrer();
  const calls = installQstash({ scheduleFor: (id) => readbackFor(id) });
  try {
    await seedDeadDaySeason();
    const res = await GET(request());
    assert.equal(res.status, 200);
    await deferrer.flush();

    // Both dense schedules were PAUSED, not deleted and not left running.
    const pauses = calls.filter((call) => call.url.endsWith('/pause'));
    assert.equal(pauses.length, 2);
    assert.ok(pauses.some((call) => call.url.includes(LIVE_SCORES_DENSE_CONTRACT.scheduleId)));
    assert.ok(pauses.some((call) => call.url.includes(GAME_STATS_DENSE_CONTRACT.scheduleId)));
    for (const call of calls) assert.notEqual(call.method, 'DELETE');

    // The record for each job carries a `dense: null` — the store's one encoding
    // of "not expected to fire", which contributes no required slot.
    for (const job of ['live-scores', 'game-stats'] as const) {
      const record = await readPollingPlannerRuns(job);
      assert.equal(record.kind, 'ok', job);
      const newest = record.kind === 'ok' ? record.series.runs.at(-1) : null;
      assert.ok(newest, `${job} recorded a run`);
      assert.equal(newest!.dense, null, `${job}: dense is silent`);
      assert.equal(newest!.slow.intent.cron, '1 0 * * *', `${job}: one wakeup a day`);
    }

    const receipt = await readReceipt();
    assert.equal(receipt?.job, 'polling-planner');
    assert.equal(receipt?.result, 'success');
    assert.equal(receipt?.target.kind, 'polling-planner');
  } finally {
    deferrer.restore();
    restore();
  }
});

test('a game day ARMS both dense schedules with the derived expression', async () => {
  await reset();
  const deferrer = installReceiptDeferrer();
  const calls = installQstash({ scheduleFor: (id) => readbackFor(id) });
  try {
    const dayStartMs = await seedSchedule([
      { startDate: new Date(dayHour(await seedDay(), 19)).toISOString(), startTimeTBD: false },
    ]);
    void dayStartMs;
    const res = await GET(request());
    assert.equal(res.status, 200);
    await deferrer.flush();

    const upserts = calls.filter((call) => call.method === 'POST' && !call.url.includes('/pause'));
    const denseUpsert = upserts.find(
      (call) => call.headers['Upstash-Schedule-Id'] === LIVE_SCORES_DENSE_CONTRACT.scheduleId
    );
    assert.ok(denseUpsert, 'the dense schedule was written');
    assert.match(denseUpsert!.headers['Upstash-Cron']!, /^\*\/3 \d/);
    assert.notEqual(denseUpsert!.headers['Upstash-Cron'], LIVE_SCORES_DENSE_CONTRACT.cron);
    // No pause on a day with games.
    assert.equal(calls.filter((call) => call.url.endsWith('/pause')).length, 0);

    const record = await readPollingPlannerRuns('live-scores');
    const newest = record.kind === 'ok' ? record.series.runs.at(-1) : null;
    assert.ok(newest?.dense, 'dense is recorded, not silent');
    assert.equal(newest!.dense!.outcome, 'confirmed');
  } finally {
    deferrer.restore();
    restore();
  }
});

/** Midnight UTC of the day the planner will plan, from the same rule the route uses. */
async function seedDay(): Promise<number> {
  return Math.floor((Date.now() + 60 * 60 * 1000) / 86_400_000) * 86_400_000;
}
const dayHour = (dayStartMs: number, hour: number): number => dayStartMs + hour * 3_600_000;

test('an ABSENT or EMPTY season record sends nothing — absence is not a dead day', async () => {
  // The defect all three reviewers found. `loadCachedScheduleItems` returns `[]`
  // for a missing key and never throws, so the original guard — a try/catch —
  // never fired for the failure that actually happens, and an unpopulated cache
  // was byte-identical to a verified dead day: both dense schedules PAUSED on the
  // strength of a record the planner had never read. Measured 2026-09-07:
  // `schedule/2027-all-all` does not exist, so this is a live state.
  //
  // Mutation target: treat a zero-kickoff read as usable and the pause assertions
  // in the positive control below start firing here too.
  await reset();
  const deferrer = installReceiptDeferrer();
  const calls = installQstash({ scheduleFor: (id) => readbackFor(id) });
  try {
    // No season key at all.
    const absent = await GET(request());
    assert.equal(absent.status, 200);
    assert.equal(calls.length, 0, 'nothing is sent when the season record is absent');

    // Present but empty — `AGENTS.md`: a schedule is never committed empty, so
    // this means the cache was never populated, not that the season has no games.
    await seedSchedule([]);
    await GET(request());
    assert.equal(calls.length, 0, 'nothing is sent when the season record is empty');

    // Present but with no parseable kickoff — same reading.
    await seedSchedule([{ startDate: 'not a date', startTimeTBD: false }]);
    await GET(request());
    await deferrer.flush();
    assert.equal(calls.length, 0, 'nothing is sent when no kickoff can be read');

    const receipt = await readReceipt();
    assert.equal(receipt?.result, 'failure');
    assert.equal(receipt?.reason, 'schedule-unreadable');

    // POSITIVE CONTROL: a READABLE season whose games miss the day does pause. So
    // the silence above is the fail-closed branch, not a run with nothing to do.
    await reset();
    const openCalls = installQstash({ scheduleFor: (id) => readbackFor(id) });
    await seedDeadDaySeason();
    await GET(request());
    assert.ok(
      openCalls.some((call) => call.url.endsWith('/pause')),
      'an established dead day pauses; an unestablished one must not'
    );
  } finally {
    deferrer.restore();
    restore();
  }
});

test('a THROWN schedule read is retried inside the invocation before giving up', async () => {
  // The planner runs once a day with `retries: 0`, and `AGENTS.md` forbids
  // answering a controlled outcome with a non-200 on a QStash-delivered route — so
  // the delivery layer cannot retry this. A transient store blip would otherwise
  // cost a whole day of planning.
  await reset();
  const deferrer = installReceiptDeferrer();
  const calls = installQstash({ scheduleFor: (id) => readbackFor(id) });
  const { __setAppStateReadFailureForTests } = await import('@/lib/server/appStateStore');
  try {
    await seedDeadDaySeason();
    // Only the `schedule` scope fails, so the receipt and record writes still work
    // and the assertions below are about the plan, not about a dead store.
    __setAppStateReadFailureForTests(new Error('schedule scope unavailable'), 'schedule');
    const res = await GET(request());
    __setAppStateReadFailureForTests(null);
    await deferrer.flush();

    assert.equal(res.status, 200);
    assert.equal(calls.length, 0, 'nothing is sent when no plan could be derived');
    const receipt = await readReceipt();
    assert.equal(receipt?.result, 'failure');
    assert.equal(receipt?.reason, 'schedule-unreadable');
  } finally {
    __setAppStateReadFailureForTests(null);
    deferrer.restore();
    restore();
  }
});

test('the durable record stores only the PLANNING DAY’s windows', async () => {
  // Measured on production: the season yields 479 windows and 46,014 bytes per
  // run, which at the store's 400-run bound is ~18 MB per job key — rewritten in a
  // transaction daily and re-parsed on every System Health render, of a field no
  // consumer reads. The derivation still runs over the whole season (a pre-filter
  // would move cluster boundaries); only the RECORD is narrowed.
  await reset();
  const deferrer = installReceiptDeferrer();
  installQstash({ scheduleFor: (id) => readbackFor(id) });
  try {
    const dayStartMs = await seedDay();
    await seedSchedule([
      { startDate: new Date(dayHour(dayStartMs, 19)).toISOString(), startTimeTBD: false },
      // Far-away games: real windows, none of them touching the planned day.
      { startDate: new Date(dayStartMs - 40 * 86_400_000).toISOString(), startTimeTBD: false },
      { startDate: new Date(dayStartMs + 40 * 86_400_000).toISOString(), startTimeTBD: false },
      { startDate: new Date(dayStartMs + 80 * 86_400_000).toISOString(), startTimeTBD: false },
    ]);
    await GET(request());
    await deferrer.flush();

    const record = await readPollingPlannerRuns('live-scores');
    const newest = record.kind === 'ok' ? record.series.runs.at(-1) : null;
    assert.ok(newest, 'a run was recorded');
    assert.equal(newest!.windows.length, 1, 'only the window covering the planned day');
    for (const window of newest!.windows) {
      assert.ok(window.startMs < dayStartMs + 86_400_000);
      assert.ok(window.slowEndMs > dayStartMs);
    }
    // Mutation target: record `allWindows` and this bound fails.
    assert.ok(JSON.stringify(newest!.windows).length < 1_000);
  } finally {
    deferrer.restore();
    restore();
  }
});

// ---------------------------------------------------------------------------
// No secret escapes
// ---------------------------------------------------------------------------

test('POSITIVE CONTROL: the real header block contains both secrets, and the record contains neither', async () => {
  // The scan is proven able to SEE a credential before it is used to assert one
  // is absent. `buildUpsertRequest` is the exact builder the planner drives.
  const real = buildUpsertRequest(LIVE_SCORES_DENSE_CONTRACT, {
    base: 'https://qstash.upstash.io',
    qstashToken: QSTASH_TOKEN,
    cronSecret: CRON_SECRET,
  });
  const headerBlock = JSON.stringify(real);
  assert.ok(headerBlock.includes(QSTASH_TOKEN), 'the scan can see the management token');
  assert.ok(headerBlock.includes(CRON_SECRET), 'the scan can see the forwarded route secret');

  await reset();
  const deferrer = installReceiptDeferrer();
  const logged: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => logged.push(args.map(String).join(' '));
  const calls = installQstash({ scheduleFor: (id) => readbackFor(id) });
  try {
    await seedSchedule([
      { startDate: new Date(dayHour(await seedDay(), 19)).toISOString(), startTimeTBD: false },
    ]);
    const res = await GET(request());
    const body = JSON.stringify(await res.json());
    await deferrer.flush();

    const record = await readPollingPlannerRuns('live-scores');
    const serialized = JSON.stringify(record);
    const receipt = JSON.stringify(await readReceipt());
    const runtimeEvent = logged.join('\n');

    // THIS RUN CARRIED THE CREDENTIALS. Every assertion below is an ABSENCE, and a
    // run that sent nothing satisfies all of them for free — which is precisely
    // what happened under PLATFORM-207: an inherited operator hold made this run a
    // no-op and this control stayed green while the four plan tests around it went
    // red. A control that cannot fail is worse than no control, so prove the four
    // scanned artifacts are artifacts of a run that really put both secrets on the
    // wire, before concluding that neither secret survived into them.
    const mutations = calls.filter((call) => call.method === 'POST');
    assert.ok(mutations.length > 0, 'the run sent QStash mutations to scan the output of');
    const inFlight = JSON.stringify(mutations.map((call) => call.headers));
    assert.ok(inFlight.includes(QSTASH_TOKEN), 'this run put the management token on the wire');
    assert.ok(
      inFlight.includes(CRON_SECRET),
      'this run put the forwarded route secret on the wire'
    );
    const newest = record.kind === 'ok' ? record.series.runs.at(-1) : null;
    assert.ok(newest?.dense, 'the scanned record describes an armed day, not a held no-op');

    for (const [name, text] of [
      ['the durable record', serialized],
      ['the receipt', receipt],
      ['the runtime event', runtimeEvent],
      ['the HTTP response', body],
    ] as const) {
      assert.ok(!text.includes(QSTASH_TOKEN), `${name} leaked QSTASH_TOKEN`);
      assert.ok(!text.includes(CRON_SECRET), `${name} leaked CRON_SECRET`);
      assert.ok(!text.includes('Authorization'), `${name} carried a header name`);
      assert.ok(!text.includes('Bearer'), `${name} carried a bearer credential`);
    }
    // And the runtime event really was emitted, so the scan above ran on content.
    assert.ok(runtimeEvent.includes('polling-planner-cron'), 'the event was emitted');
  } finally {
    console.log = originalLog;
    deferrer.restore();
    restore();
  }
});

// ---------------------------------------------------------------------------
// Remediation round 3 — the durable operator hold
// ---------------------------------------------------------------------------

/** Put a job under the operator hold the runbook's emergency stop already writes. */
async function holdJob(dataset: 'scores' | 'game-stats'): Promise<void> {
  const { setDatasetAutoRefreshEnabled } = await import('@/lib/server/providerRefreshSettings');
  await setDatasetAutoRefreshEnabled(dataset, false);
}
async function clearHolds(): Promise<void> {
  const { PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY } = await import(
    '@/lib/server/providerRefreshSettings'
  );
  await setAppState(PROVIDER_REFRESH_SETTINGS_SCOPE, PROVIDER_REFRESH_SETTINGS_KEY, null);
}

test('a HELD job is skipped ENTIRELY — not read, not paused, not resumed', async () => {
  // The runbook's single-job stop is "enable global pause, disable its dataset,
  // pause its schedule, and inspect". Before the hold, the planner's next run saw
  // a paused schedule on an armed day, failed its contract check, and
  // upserted-then-resumed — silently removing a stop an operator had deliberately
  // put in place. It cannot tell its own pause from an operator's by looking at
  // QStash, so the hold has to be explicit state.
  //
  // Mutation target: drop the `jobIsHeld` guard and `live-scores` gets four
  // requests here instead of zero.
  await reset();
  await clearHolds();
  const deferrer = installReceiptDeferrer();
  const calls = installQstash({ scheduleFor: (id) => readbackFor(id) });
  try {
    const dayStartMs = await seedDay();
    await seedSchedule([
      { startDate: new Date(dayHour(dayStartMs, 19)).toISOString(), startTimeTBD: false },
    ]);
    await holdJob('scores');
    await GET(request());
    await deferrer.flush();

    // NOTHING about live-scores was touched — including the GET.
    const liveCalls = calls.filter(
      (call) =>
        call.url.includes(LIVE_SCORES_DENSE_CONTRACT.scheduleId) ||
        call.url.includes(LIVE_SCORES_SLOW_CONTRACT.scheduleId) ||
        call.url.includes(encodeURIComponent(LIVE_SCORES_DENSE_CONTRACT.destination)) ||
        call.url.includes(LIVE_SCORES_DENSE_CONTRACT.destination)
    );
    assert.equal(liveCalls.length, 0, 'a held job is not read, paused, resumed or upserted');

    // POSITIVE CONTROL: game-stats is NOT held, so the same run did act on it.
    const statsCalls = calls.filter((call) =>
      call.url.includes(GAME_STATS_DENSE_CONTRACT.scheduleId)
    );
    assert.ok(statsCalls.length > 0, 'the unheld job still runs');

    // And no planner record was written for the held job, because nothing was
    // observed and nothing changed — the previous record still describes reality.
    assert.deepEqual(await readPollingPlannerRuns('live-scores'), { kind: 'absent' });
  } finally {
    await clearHolds();
    deferrer.restore();
    restore();
  }
});

test('the receipt reports HELD separately — never as succeeded and never as failed', async () => {
  // The distinction is the point: delivery health must be able to tell a
  // deliberately stopped job from a broken one. `no-op` because
  // `schedulerExecutionIssues` raises nothing for it — a deliberate stop must not
  // page anyone — and the count is what separates it from a quiet success.
  await reset();
  await clearHolds();
  const deferrer = installReceiptDeferrer();
  const calls = installQstash({ scheduleFor: (id) => readbackFor(id) });
  try {
    const dayStartMs = await seedDay();
    await seedSchedule([
      { startDate: new Date(dayHour(dayStartMs, 19)).toISOString(), startTimeTBD: false },
    ]);
    await holdJob('scores');
    await holdJob('game-stats');
    await GET(request());
    await deferrer.flush();

    assert.equal(calls.length, 0, 'both held: the planner touches nothing at all');
    const receipt = await readReceipt();
    assert.equal(receipt?.result, 'no-op', 'a held run is not a failure');
    assert.equal(receipt?.reason, 'plan-held');
    const target = receipt?.target as {
      jobsHeld: number;
      schedulesFailed: number;
      schedulesApplied: number;
    };
    assert.equal(target.jobsHeld, 2);
    // Held is counted in NEITHER of the other buckets.
    assert.equal(target.schedulesFailed, 0, 'held is not failed');
    assert.equal(target.schedulesApplied, 0, 'held is not applied');
  } finally {
    await clearHolds();
    deferrer.restore();
    restore();
  }
});

test('an unreadable settings store holds everything AND REPORTS A FAILURE', async () => {
  // Fail closed. A settings read failure is not permission to undo an operator's
  // stop, and `providerRefreshSettings` documents noncritical callers failing
  // closed for exactly this reason. THE HOLDING IS UNCHANGED.
  //
  // WHAT CHANGED, AND THIS TEST USED TO ASSERT THE DEFECT (#619, Item 189 before
  // it): it read `reason === 'plan-held'`, which is paired with `no-op`, and
  // `schedulerExecutionIssues` raises nothing for `no-op` by design so a deliberate
  // operator stop never pages anyone. So a transient settings-read failure stopped
  // the planner silently, in a state indistinguishable from an intentional pause,
  // with the alerting built to ignore it — and the suite pinned that.
  //
  // Mutation target: put the classifier's settings branch back after the all-held
  // branch and this returns to `no-op` / `plan-held`, which is the defect.
  await reset();
  await clearHolds();
  const deferrer = installReceiptDeferrer();
  const calls = installQstash({ scheduleFor: (id) => readbackFor(id) });
  const { __setAppStateReadFailureForTests } = await import('@/lib/server/appStateStore');
  try {
    const dayStartMs = await seedDay();
    await seedSchedule([
      { startDate: new Date(dayHour(dayStartMs, 19)).toISOString(), startTimeTBD: false },
    ]);
    __setAppStateReadFailureForTests(
      new Error('settings scope unavailable'),
      'provider-refresh-settings'
    );
    await GET(request());
    __setAppStateReadFailureForTests(null);
    await deferrer.flush();

    assert.equal(calls.length, 0, 'nothing is sent when the hold cannot be read');
    const receipt = await readReceipt();
    assert.equal(receipt?.result, 'failure', 'an unreadable store is not a quiet no-op');
    assert.equal(receipt?.reason, 'settings-unavailable');
    // The behaviour this must NOT change: every job still held, nothing applied,
    // nothing failed at the schedule level — identical to a genuine hold.
    const target = receipt?.target as {
      jobsHeld: number;
      schedulesApplied: number;
      schedulesFailed: number;
    };
    assert.equal(target.jobsHeld, 2);
    assert.equal(target.schedulesApplied, 0);
    assert.equal(target.schedulesFailed, 0);
  } finally {
    __setAppStateReadFailureForTests(null);
    await clearHolds();
    deferrer.restore();
    restore();
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-732 — the durable trace of a run that planned nothing
// ---------------------------------------------------------------------------

test('an operator hold leaves a durable trace naming the cause and the invocation', async () => {
  // Before this, a held job reached no writer at all: `planOneJob` is the only
  // caller of `recordPollingPlannerRun` and the loop `continue`s past it. The
  // receipt did carry `reason` and `jobsHeld` — but latest-only, so it answers
  // "did the LAST run hold" and never "has one ever", which is the gap (#732).
  await reset();
  await clearHolds();
  const deferrer = installReceiptDeferrer();
  installQstash({ scheduleFor: (id) => readbackFor(id) });
  try {
    const dayStartMs = await seedDay();
    await seedSchedule([
      { startDate: new Date(dayHour(dayStartMs, 19)).toISOString(), startTimeTBD: false },
    ]);
    await holdJob('scores');
    await GET(request());
    await deferrer.flush();

    const held = await readPollingPlannerHoldRuns('live-scores');
    assert.equal(held.kind, 'ok');
    const runs = held.kind === 'ok' ? held.series.runs : [];
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.reason, 'plan-held', 'an operator chose this one');
    assert.equal(runs[0]?.dayStartMs, dayStartMs, 'the day that was NOT planned');

    // ITEM 126 TIER A CORRELATION. The trace carries the receipt's own id, so the
    // durable history and the latest-only receipt describe one run rather than
    // two accounts nobody can join.
    const receipt = await readReceipt();
    assert.equal(typeof receipt?.invocationId, 'string');
    assert.equal(runs[0]?.invocationId, receipt?.invocationId);

    // The UNHELD job gets an applied record and NO trace. The two series never
    // describe the same job on the same run.
    assert.equal((await readPollingPlannerHoldRuns('game-stats')).kind, 'absent');
    assert.equal((await readPollingPlannerRuns('game-stats')).kind, 'ok');
    // And the held job's APPLIED series stays absent — nothing was observed, so
    // there is nothing to record there.
    assert.deepEqual(await readPollingPlannerRuns('live-scores'), { kind: 'absent' });
  } finally {
    await clearHolds();
    deferrer.restore();
    restore();
  }
});

test('an unreadable settings store traces settings-unavailable, not an operator hold', async () => {
  // THE QUESTION #732 EXISTS TO MAKE ANSWERABLE. Both causes hold every job and
  // send nothing, and only one of them is something somebody chose — the
  // distinction #619 established one layer up, now durable rather than latest-only.
  //
  // Mutation target: write a single constant reason instead of branching on
  // `settings === null` and this reads `plan-held`, which is the state an operator
  // would then read as a deliberate stop nobody made.
  await reset();
  await clearHolds();
  const deferrer = installReceiptDeferrer();
  const calls = installQstash({ scheduleFor: (id) => readbackFor(id) });
  const { __setAppStateReadFailureForTests } = await import('@/lib/server/appStateStore');
  try {
    const dayStartMs = await seedDay();
    await seedSchedule([
      { startDate: new Date(dayHour(dayStartMs, 19)).toISOString(), startTimeTBD: false },
    ]);
    __setAppStateReadFailureForTests(
      new Error('settings scope unavailable'),
      'provider-refresh-settings'
    );
    await GET(request());
    __setAppStateReadFailureForTests(null);
    await deferrer.flush();

    assert.equal(calls.length, 0, 'nothing is sent when the hold cannot be read');
    for (const job of ['live-scores', 'game-stats'] as const) {
      const held = await readPollingPlannerHoldRuns(job);
      assert.equal(held.kind, 'ok', `${job}: every held job is traced, not just the first`);
      const runs = held.kind === 'ok' ? held.series.runs : [];
      assert.equal(runs.length, 1);
      assert.equal(
        runs[0]?.reason,
        'settings-unavailable',
        `${job}: nobody chose this, and reading it as an operator hold is the defect`
      );
    }
  } finally {
    __setAppStateReadFailureForTests(null);
    await clearHolds();
    deferrer.restore();
    restore();
  }
});

test('a trace that CANNOT be written does not cost the unheld job its day', async () => {
  // THE HAZARD THIS WHOLE SHAPE IS ARRANGED AROUND. The held write sits on the
  // `continue` branch inside the per-job loop: anything that escapes there reaches
  // the route's outer catch, and the job that was NOT held is never planned —
  // an observability write costing a planning run, which is strictly worse than
  // the gap it closes.
  //
  // Driven by a permanently-unreadable held key, which is the realistic form:
  // `readPollingPlannerHoldRunsForWrite` refuses a present value that yields
  // nothing, so this key can never be written again. The totality guard itself is
  // mutation-proven in `pollingPlannerHoldRecord.test.ts` with an injected
  // throwing writer, because the store catches everything a seam can produce.
  await reset();
  await clearHolds();
  const deferrer = installReceiptDeferrer();
  const calls = installQstash({ scheduleFor: (id) => readbackFor(id) });
  try {
    const dayStartMs = await seedDay();
    await seedSchedule([
      { startDate: new Date(dayHour(dayStartMs, 19)).toISOString(), startTimeTBD: false },
    ]);
    await setAppState(POLLING_PLANNER_RECORD_SCOPE, pollingPlannerHoldRecordKey('live-scores'), {
      runs: [{ at: 'not-a-date' }],
    });
    await holdJob('scores');
    const response = await GET(request());
    await deferrer.flush();

    // POSITIVE CONTROL: the trace really was refused, so this test is not passing
    // because the failure never happened.
    assert.equal(
      (await readPollingPlannerHoldRuns('live-scores')).kind,
      'unreadable',
      'the held write must actually have failed for this test to mean anything'
    );

    // The un-held job was planned, its schedules were sent, and its record landed.
    assert.ok(
      calls.some((call) => call.url.includes(GAME_STATS_DENSE_CONTRACT.scheduleId)),
      'the unheld job still reached QStash'
    );
    assert.equal((await readPollingPlannerRuns('game-stats')).kind, 'ok');

    // 200 and a receipt, never a 5xx: QStash must not read a controlled outcome
    // as a transport fault.
    assert.equal(response.status, 200);
    const receipt = await readReceipt();
    // SUCCESS, NOT `partial`, and this assertion is the remediation. The first
    // version let a failed TRACE feed `failed`, which gates this branch — so a run
    // in which every schedule reached its planned state reported `partial`, and
    // `schedulerExecutionIssues` raised a warning with a repair link for it. On a
    // permanently-unreadable held key that is a warning every day, forever, for an
    // observability row nothing consumes. A lost PLANNER record still downgrades
    // the run, because its absence really does blind delivery health.
    // AND THIS IS THE ORDERING CONTROL TOO. `success` is reachable only if the
    // hold failure is counted AFTER `failed` is computed — so moving the
    // `recordHeldJobs` call back inside the job loop, which is the edit that
    // reintroduces the unbounded write ahead of an unplanned job, reds this test.
    assert.equal(receipt?.result, 'success');
    const target = receipt?.target as { recordsNotWritten: number; jobsHeld: number };
    // VISIBLE WITHOUT MOVING THE CLASSIFICATION: the count still lands on the
    // receipt, and System Health renders it on the planner row regardless of
    // result. That is what the first version claimed and this one is.
    assert.equal(target.recordsNotWritten, 1);
    assert.equal(target.jobsHeld, 1);
  } finally {
    await clearHolds();
    deferrer.restore();
    restore();
  }
});

test('an all-held run stays a silent no-op even when its traces are lost', async () => {
  // THE BRANCH ORDER IS DELIBERATELY UNTOUCHED. A deliberate operator stop must
  // not page anyone — `schedulerExecutionIssues` raises nothing for `no-op` — so a
  // failed trace must not promote a held run to `partial`. The loss is still
  // visible: `recordsNotWritten` is non-zero on the receipt, and System Health
  // renders it on the planner row regardless of result.
  await reset();
  await clearHolds();
  const deferrer = installReceiptDeferrer();
  try {
    const dayStartMs = await seedDay();
    await seedSchedule([
      { startDate: new Date(dayHour(dayStartMs, 19)).toISOString(), startTimeTBD: false },
    ]);
    for (const job of ['live-scores', 'game-stats'] as const) {
      await setAppState(POLLING_PLANNER_RECORD_SCOPE, pollingPlannerHoldRecordKey(job), {
        runs: [{ at: 'not-a-date' }],
      });
    }
    await holdJob('scores');
    await holdJob('game-stats');
    await GET(request());
    await deferrer.flush();

    const receipt = await readReceipt();
    assert.equal(receipt?.result, 'no-op', 'a deliberate stop must not start paging');
    assert.equal(receipt?.reason, 'plan-held');
    const target = receipt?.target as { recordsNotWritten: number; jobsHeld: number };
    assert.equal(target.jobsHeld, 2);
    assert.equal(target.recordsNotWritten, 2, 'the loss is counted even though it raises nothing');
  } finally {
    await clearHolds();
    deferrer.restore();
    restore();
  }
});
