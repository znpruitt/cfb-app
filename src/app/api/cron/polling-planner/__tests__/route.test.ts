import assert from 'node:assert/strict';
import test from 'node:test';

import { __resetAppStateForTests, setAppState } from '@/lib/server/appStateStore';
import {
  POLLING_PLANNER_RECORD_SCOPE,
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
  __resetAppStateForTests();
  for (const job of ['live-scores', 'game-stats']) {
    await setAppState(POLLING_PLANNER_RECORD_SCOPE, job, null);
    await setAppState(SCHEDULER_EXECUTION_STATUS_SCOPE, job, null);
  }
  await setAppState(SCHEDULER_EXECUTION_STATUS_SCOPE, 'polling-planner', null);
  // `__resetAppStateForTests` clears pools and seams but NOT the backing file, so
  // a season seeded by an earlier test survives — and a test asserting that an
  // ABSENT record sends nothing would then pass or fail on its neighbour's data.
  const year = planningSeasonYear();
  for (const suffix of ['all-all', 'all-regular', 'all-postseason']) {
    await setAppState('schedule', `${year}-${suffix}`, null);
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
  const { getAppState } = await import('@/lib/server/appStateStore');
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
  installQstash({ scheduleFor: (id) => readbackFor(id) });
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

test('an unreadable settings store HOLDS EVERYTHING rather than rewriting schedules', async () => {
  // Fail closed. A settings read failure is not permission to undo an operator's
  // stop, and `providerRefreshSettings` documents noncritical callers failing
  // closed for exactly this reason.
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
    assert.equal(receipt?.reason, 'plan-held');
  } finally {
    __setAppStateReadFailureForTests(null);
    await clearHolds();
    deferrer.restore();
    restore();
  }
});
