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
