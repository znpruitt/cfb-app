import assert from 'node:assert/strict';
import test from 'node:test';

import { GET as cronGet } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { getGameStatsKey } from '../../../../../lib/gameStats/cache.ts';
import { seedActiveWriterControl } from '../../../../../lib/gameStats/__tests__/writerControlSeed.ts';
import { wireGame } from '../../../../../lib/gameStats/__tests__/fixtures.ts';
import { setGlobalPause } from '../../../../../lib/server/providerRefreshSettings.ts';
import { getProviderRefreshStatus } from '../../../../../lib/server/providerRefreshStatus.ts';
import { weekPartitionScope } from '../../../../../lib/providerRefreshScope.ts';
import type { GameStatsCronExecutionEvent } from '../../../../../lib/gameStats/cronExecutionLog.ts';

// PLATFORM-086F1 — one secret-safe structured `game-stats-cron` event per
// invocation. These tests drive every route branch and assert the emitted event
// (result/reason/partition/call-flags/committed) without changing any HTTP
// response, provider behavior, refresh-status semantics, or attempt creation.
// The existing coverage.test.ts / pause.test.ts suites pin those behaviors and
// stay green unchanged.

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL = {
  CRON_SECRET: process.env.CRON_SECRET,
  CFBD_API_KEY: process.env.CFBD_API_KEY,
  NODE_ENV: process.env.NODE_ENV,
};
const ORIGINAL_FETCH = globalThis.fetch;
const CRON_SECRET = 'test-cron-secret';
const NO_TARGET_SKIP = 'no partition inside the polling window';
const PAUSE_SKIP = 'automatic game-stats refresh is paused or disabled';
const H = 60 * 60 * 1000;

// Season year the cron computes (seasonYearForToday).
const YEAR = (() => {
  const d = new Date();
  const m = d.getUTCMonth();
  const y = d.getUTCFullYear();
  return m >= 6 ? y : y - 1;
})();

const APPROVED_KEYS = [
  'event',
  'result',
  'reason',
  'year',
  'week',
  'seasonType',
  'quotaChecked',
  'providerCallAttempted',
  'committedGames',
  'durationMs',
]
  .slice()
  .sort();

function cronRequest(secret = CRON_SECRET): Request {
  return new Request('https://example.com/api/cron/game-stats', {
    headers: { authorization: `Bearer ${secret}` },
  });
}

/** Seed a stat-producing game inside the [3h, 24h) polling window. */
async function seedWindowGame(
  week: number,
  seasonType: 'regular' | 'postseason',
  ageHours = 5,
  status = 'STATUS_FINAL'
) {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: '9001',
        week,
        seasonType,
        startDate: new Date(Date.now() - ageHours * H).toISOString(),
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
        homeId: 90011,
        awayId: 90012,
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        status,
      },
    ],
  });
}

async function seedEmptyPartitionRecord(week: number, seasonType: 'regular' | 'postseason') {
  await setAppState('game-stats', getGameStatsKey(YEAR, week, seasonType), {
    year: YEAR,
    week,
    seasonType,
    fetchedAt: new Date().toISOString(),
    games: [],
  });
}

/** Stub CFBD: healthy `/info` usage + `payload` for `/games/teams`. */
function stubProvider(payload: unknown, remainingCalls = 4000): { urls: string[] } {
  const calls = { urls: [] as string[] };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.urls.push(url);
    const body = url.includes('/info') ? { patronLevel: 1, remainingCalls } : payload;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

/** A complete, participant-verified stored legacy row for the seeded game 9001. */
const persistableRow = () =>
  wireGame({
    id: 9001,
    home: { school: 'Alpha', teamId: 90011 },
    away: { school: 'Beta', teamId: 90012 },
  });

// ── console capture ─────────────────────────────────────────────────────────

function installLogCapture(): { raw: string[]; restore: () => void } {
  const raw: string[] = [];
  const original = console.log;
  console.log = ((...args: unknown[]) => {
    raw.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }) as typeof console.log;
  return { raw, restore: () => void (console.log = original) };
}

function parseCronEvents(raw: string[]): GameStatsCronExecutionEvent[] {
  const out: GameStatsCronExecutionEvent[] = [];
  for (const line of raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as { event?: unknown }).event === 'game-stats-cron'
    ) {
      out.push(parsed as GameStatsCronExecutionEvent);
    }
  }
  return out;
}

function assertApprovedSchema(event: GameStatsCronExecutionEvent) {
  assert.deepEqual(
    Object.keys(event).slice().sort(),
    APPROVED_KEYS,
    'event carries only the approved allowlisted keys'
  );
  assert.equal(event.event, 'game-stats-cron');
  assert.ok(
    Number.isInteger(event.durationMs) && event.durationMs >= 0,
    `durationMs is a nonnegative integer (got ${event.durationMs})`
  );
}

/** Run the cron once, capturing exactly one structured event. */
async function runCron(req = cronRequest()): Promise<{
  res: Response;
  event: GameStatsCronExecutionEvent;
}> {
  const cap = installLogCapture();
  let res: Response;
  try {
    res = await cronGet(req);
  } finally {
    cap.restore();
  }
  const events = parseCronEvents(cap.raw);
  assert.equal(
    events.length,
    1,
    `exactly one game-stats-cron event per invocation (got ${events.length})`
  );
  const event = events[0]!;
  assertApprovedSchema(event);
  return { res, event };
}

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  globalThis.fetch = ORIGINAL_FETCH;
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedActiveWriterControl();
});

test.after(() => {
  for (const [key, value] of Object.entries(ORIGINAL)) {
    if (value === undefined) delete MUTABLE_ENV[key];
    else MUTABLE_ENV[key] = value;
  }
  globalThis.fetch = ORIGINAL_FETCH;
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
});

// 1. Missing and invalid cron authorization → unchanged 401, one failure event,
//    null partition, both call flags false.
test('invalid cron authorization logs one failure/cron-authorization-invalid event', async () => {
  const { res, event } = await runCron(cronRequest('wrong'));
  assert.equal(res.status, 401);
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'cron-authorization-invalid');
  assert.equal(event.year, YEAR);
  assert.equal(event.week, null);
  assert.equal(event.seasonType, null);
  assert.equal(event.quotaChecked, false);
  assert.equal(event.providerCallAttempted, false);
  assert.equal(event.committedGames, 0);
});

test('missing CRON_SECRET logs one failure/cron-secret-not-configured event', async () => {
  delete MUTABLE_ENV.CRON_SECRET;
  const { res, event } = await runCron(cronRequest('anything'));
  assert.equal(res.status, 401);
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'cron-secret-not-configured');
  assert.equal(event.year, YEAR);
  assert.equal(event.quotaChecked, false);
  assert.equal(event.providerCallAttempted, false);
});

// 2. Paused automation → one skipped event, no quota/provider call, no attempt.
test('paused automation logs skipped/automation-paused-or-disabled and creates no attempt', async () => {
  await setGlobalPause(true);
  await seedWindowGame(3, 'regular');
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const { res, event } = await runCron();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { skipped?: string };
  assert.equal(body.skipped, PAUSE_SKIP);

  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'automation-paused-or-disabled');
  assert.equal(event.week, null);
  assert.equal(event.seasonType, null);
  assert.equal(event.quotaChecked, false);
  assert.equal(event.providerCallAttempted, false);
  assert.equal(fetchCalls, 0, 'no usage or provider call while paused');

  const week = await getProviderRefreshStatus('game-stats', weekPartitionScope(YEAR, 3, 'regular'));
  assert.equal(week.latestAttemptOutcome, null, 'pause precedes any scoped attempt');
});

// 3. No polling target → one skipped/no-polling-target event, no call, no attempt.
test('no polling target logs skipped/no-polling-target with no call or fabricated attempt', async () => {
  // A too-fresh (<3h) game: the slate loads fine but yields no in-window target.
  await seedWindowGame(3, 'regular', 2);
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const { res, event } = await runCron();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { skipped?: string };
  assert.equal(body.skipped, NO_TARGET_SKIP);

  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'no-polling-target');
  assert.equal(event.week, null);
  assert.equal(event.quotaChecked, false);
  assert.equal(event.providerCallAttempted, false);
  assert.equal(fetchCalls, 0, 'no usage or provider call without a resolved target');

  const week = await getProviderRefreshStatus('game-stats', weekPartitionScope(YEAR, 3, 'regular'));
  assert.equal(week.latestAttemptOutcome, null, 'no fabricated attempt without a target');
});

// 4. Targeted quota refusal → exact target fields, quotaChecked true, no provider call.
test('below-reserve quota refusal logs failure/quota-below-reserve with the exact target', async () => {
  await seedWindowGame(3, 'regular');
  const calls = stubProvider([], 900); // below reserve

  const { res, event } = await runCron();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { outcome?: string; reason?: string };
  assert.equal(body.outcome, 'failure');
  assert.equal(body.reason, 'quota-below-reserve');

  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'quota-below-reserve');
  assert.equal(event.week, 3);
  assert.equal(event.seasonType, 'regular');
  assert.equal(event.quotaChecked, true);
  assert.equal(event.providerCallAttempted, false, 'a refusal never bills a provider data call');
  assert.equal(event.committedGames, 0);
  assert.equal(
    calls.urls.filter((u) => !u.includes('/info')).length,
    0,
    'no /games/teams call on refusal'
  );
});

// 5. Provider transport failure → both flags true, stable generic reason, no secret leak.
test('provider transport failure logs failure/provider-fetch-failed and never the thrown message', async () => {
  await seedWindowGame(3, 'regular');
  const MARKER = 'transport-error-MARKER';
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/info')) {
      return new Response(JSON.stringify({ patronLevel: 1, remainingCalls: 4000 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(MARKER);
  }) as typeof fetch;

  const cap = installLogCapture();
  let res: Response;
  try {
    res = await cronGet(cronRequest());
  } finally {
    cap.restore();
  }
  const events = parseCronEvents(cap.raw);
  assert.equal(events.length, 1);
  const event = events[0]!;
  assertApprovedSchema(event);

  assert.equal(res.status, 500);
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'provider-fetch-failed');
  assert.equal(event.week, 3);
  assert.equal(event.quotaChecked, true);
  assert.equal(event.providerCallAttempted, true);
  assert.equal(event.committedGames, 0);
  assert.ok(
    cap.raw.every((line) => !line.includes(MARKER)),
    'the thrown transport message never appears in the serialized event'
  );
});

// 6. Exact empty response → no-op / empty-response, both flags true, zero commits.
test('an exact empty response logs no-op/empty-response', async () => {
  await seedWindowGame(3, 'regular');
  stubProvider([]);

  const { res, event } = await runCron();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { outcome?: string; reason?: string };
  assert.equal(body.outcome, 'no-op');
  assert.equal(body.reason, 'empty-response');

  assert.equal(event.result, 'no-op');
  assert.equal(event.reason, 'empty-response');
  assert.equal(event.week, 3);
  assert.equal(event.quotaChecked, true);
  assert.equal(event.providerCallAttempted, true);
  assert.equal(event.committedGames, 0);
});

// 7. Clean durable write → success / written-clean with the confirmed count.
test('a clean durable write logs success/written-clean with the committed count', async () => {
  await seedWindowGame(3, 'regular');
  await seedEmptyPartitionRecord(3, 'regular'); // unresolved → the cron fetches
  stubProvider([persistableRow()]);

  const { res, event } = await runCron();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { outcome?: string; committedGames?: number };
  assert.equal(body.outcome, 'success');
  assert.equal(body.committedGames, 1);

  assert.equal(event.result, 'success');
  assert.equal(event.reason, 'written-clean');
  assert.equal(event.week, 3);
  assert.equal(event.seasonType, 'regular');
  assert.equal(event.quotaChecked, true);
  assert.equal(event.providerCallAttempted, true);
  assert.equal(event.committedGames, 1);
});

// 8. Mixed confirmed write → partial with the interpreter's exact reason + count.
test('a mixed batch that still commits logs partial/written-mixed (never collapsed to success)', async () => {
  await seedWindowGame(3, 'regular');
  await seedEmptyPartitionRecord(3, 'regular');
  // One persistable row (writes clean) + one unparseable junk row (mixed batch).
  stubProvider([persistableRow(), { garbage: 'not-a-game' }]);

  const { res, event } = await runCron();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { outcome?: string; reason?: string; committedGames?: number };
  assert.equal(body.outcome, 'partial');
  assert.equal(body.reason, 'written-mixed');

  assert.equal(event.result, 'partial');
  assert.equal(event.reason, 'written-mixed');
  assert.equal(event.committedGames, 1, 'the confirmed commit count survives the partial');
  assert.equal(event.providerCallAttempted, true);
});

// 9. Interpreter failure (invalid payload) → failure with the exact interpreter reason.
test('a non-array payload logs failure/invalid-payload (the exact interpreter reason)', async () => {
  await seedWindowGame(3, 'regular');
  stubProvider({ error: 'not an array' }); // top-level non-array → invalid-payload

  const { res, event } = await runCron();
  assert.equal(res.status, 502);
  const body = (await res.json()) as { outcome?: string; reason?: string };
  assert.equal(body.outcome, 'failure');
  assert.equal(body.reason, 'invalid-payload');

  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'invalid-payload');
  assert.equal(event.providerCallAttempted, true);
  assert.equal(event.committedGames, 0);
});

// 10. Unexpected pre-response exception → exactly one failure/unexpected-error event
//     while the original exception still propagates.
test('an unexpected throw still emits one failure/unexpected-error event and propagates', async () => {
  // A read failure on the settings scope makes isAutoRefreshAllowed throw — an
  // unhandled path (outside the provider/ingestion try blocks) that reaches the
  // outer finally with the pessimistic default tracker still in place.
  __setAppStateReadFailureForTests(new Error('settings read boom'), 'provider-refresh-settings');

  const cap = installLogCapture();
  await assert.rejects(async () => {
    await cronGet(cronRequest());
  });
  cap.restore();
  __setAppStateReadFailureForTests(null);

  const events = parseCronEvents(cap.raw);
  assert.equal(events.length, 1, 'exactly one event even on an unhandled throw');
  const event = events[0]!;
  assertApprovedSchema(event);
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'unexpected-error');
  assert.equal(event.year, YEAR);
  assert.equal(event.week, null);
  assert.equal(event.quotaChecked, false);
  assert.equal(event.providerCallAttempted, false);
});

// 11. Logger failure → a throwing console sink does not change the response.
test('a throwing console sink never changes the cron response or behavior', async () => {
  await seedWindowGame(3, 'regular', 2); // no in-window target → skip path
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const original = console.log;
  console.log = (() => {
    throw new Error('console sink boom');
  }) as typeof console.log;
  let res: Response;
  try {
    res = await cronGet(cronRequest()); // must NOT throw despite the failing sink
  } finally {
    console.log = original;
  }

  assert.equal(res.status, 200);
  const body = (await res.json()) as { skipped?: string };
  assert.equal(body.skipped, NO_TARGET_SKIP, 'the response is unchanged by the logging failure');
  assert.equal(fetchCalls, 0, 'provider behavior unaffected');
  const week = await getProviderRefreshStatus('game-stats', weekPartitionScope(YEAR, 3, 'regular'));
  assert.equal(week.latestAttemptOutcome, null, 'status behavior unaffected');
});

// 12. Schema + secrecy → every event parses, carries only approved keys, has a
//     nonnegative integer duration, and leaks no marker placed in a credential,
//     authorization header, provider error, or payload.
test('events are schema-clean and never leak credentials, auth, provider errors, or payloads', async () => {
  const CRON_MARKER = 'sekret-cron-MARKER';
  const CFBD_MARKER = 'sekret-cfbd-MARKER';
  const PAYLOAD_MARKER = 'payload-MARKER';
  const PROVIDER_ERROR_MARKER = 'provider-error-MARKER';
  MUTABLE_ENV.CRON_SECRET = CRON_MARKER;
  MUTABLE_ENV.CFBD_API_KEY = CFBD_MARKER;
  await seedWindowGame(3, 'regular');

  const cap = installLogCapture();
  try {
    // Sub-run A: a payload carrying a marker (reaches ingestion via the auth
    // header + credential markers). Non-persistable → interpreter failure.
    stubProvider([{ marker: PAYLOAD_MARKER }]);
    await cronGet(cronRequest(CRON_MARKER));

    // Sub-run B: a provider transport error whose message carries a marker.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/info')) {
        return new Response(JSON.stringify({ patronLevel: 1, remainingCalls: 4000 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(PROVIDER_ERROR_MARKER);
    }) as typeof fetch;
    await cronGet(cronRequest(CRON_MARKER));
  } finally {
    cap.restore();
  }

  const events = parseCronEvents(cap.raw);
  assert.equal(events.length, 2, 'one event per invocation');
  for (const event of events) {
    assertApprovedSchema(event);
    assert.equal(event.result, 'failure');
  }
  for (const marker of [CRON_MARKER, CFBD_MARKER, PAYLOAD_MARKER, PROVIDER_ERROR_MARKER]) {
    assert.ok(
      cap.raw.every((line) => !line.includes(marker)),
      `no serialized event leaks ${marker}`
    );
  }
});
