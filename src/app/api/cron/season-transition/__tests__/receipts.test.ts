import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the route's `revalidateTag` (via invalidateStandings) runs under node:test.
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { GET } from '../route';
import type { League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
  RECEIPT_KEYS,
} from '../../../../../lib/server/__tests__/schedulerReceiptTestHarness.ts';
import {
  buildSchedulerExecutionReceipt,
  recordSchedulerExecutionReceipt,
} from '../../../../../lib/server/schedulerExecutionStatus.ts';
import type { SeasonTransitionCronExecutionEvent } from '../../../../../lib/lifecycleCronExecutionLog.ts';

// PLATFORM-086F2E2A — durable execution receipts + one secret-safe runtime event
// for the season-transition lifecycle cron. Existing lifecycle/probe/E1A behavior
// stays pinned by route.test.ts unchanged; this suite proves ONLY the new event +
// receipt contract, and that responses/mutations are unaffected.

const CRON_SECRET = 'test-cron-secret';
const YEAR = 2023;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

function stubFetchEmptySchedule(): void {
  globalThis.fetch = (async () =>
    new Response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

/** Regular/postseason bodies controlled by `?seasonType=`; 'throw' → 503. */
function stubFetchBySeasonType(regular: string | 'throw', postseason: string | 'throw'): void {
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body = url.searchParams.get('seasonType') === 'postseason' ? postseason : regular;
    if (body === 'throw') return new Response('upstream unavailable', { status: 503 });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function game(
  week: number,
  home: string,
  away: string,
  startDate: string
): Record<string, unknown> {
  return {
    id: `${week}-${home}-${away}`,
    week,
    home_team: home,
    away_team: away,
    start_date: startDate,
    completed: false,
  };
}

function makeLeague(slug: string, status: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: YEAR,
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  };
}

async function seedPreseason(slug = 'alpha'): Promise<void> {
  await setAppState('leagues', 'registry', [makeLeague(slug, { state: 'preseason', year: YEAR })]);
}

async function seedProbe(
  firstGameDate: string,
  baseCachedAt = '2023-01-01T00:00:00.000Z'
): Promise<void> {
  await setAppState('schedule-probe', String(YEAR), { year: YEAR, baseCachedAt, firstGameDate });
}

function cronRequest(secret: string | null = CRON_SECRET): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://example.com/api/cron/season-transition', { headers });
}

type RunResult = {
  res: Response | null;
  event: SeasonTransitionCronExecutionEvent;
  threw: unknown;
  raw: string[];
};

/** Run GET under the Next work store, capturing exactly one structured event. */
async function runRoute(req: Request = cronRequest()): Promise<RunResult> {
  const raw: string[] = [];
  console.log = ((...args: unknown[]) => {
    raw.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }) as typeof console.log;
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  let res: Response | null = null;
  let threw: unknown = null;
  try {
    res = await workAsyncStorage.run(store as never, () => GET(req));
  } catch (error) {
    threw = error;
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }
  const events: SeasonTransitionCronExecutionEvent[] = [];
  for (const line of raw) {
    try {
      const parsed = JSON.parse(line) as { event?: string };
      if (parsed?.event === 'season-transition-cron')
        events.push(parsed as SeasonTransitionCronExecutionEvent);
    } catch {
      /* not an event line */
    }
  }
  assert.equal(events.length, 1, `exactly one season-transition-cron event (got ${events.length})`);
  return { res, event: events[0]!, threw, raw };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubFetchEmptySchedule();
  deferrer = installSchedulerReceiptDeferrer();
});

test.afterEach(() => {
  deferrer.restore();
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE_LOG;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CRON_SECRET === undefined) delete MUTABLE_ENV.CRON_SECRET;
  else MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE_LOG;
});

async function seedPriorReceipt() {
  const receipt = buildSchedulerExecutionReceipt({
    job: 'season-transition',
    invocationId: '44444444-4444-4444-8444-444444444444',
    startedAtMs: Date.now() - 60_000,
    completedAtMs: Date.now() - 59_000,
    result: 'success',
    reason: 'season-transitioned',
    providerCallAttempted: true,
    target: {
      kind: 'season-transition-years',
      totalYears: 1,
      truncated: false,
      invalidLifecycleTargets: 0,
      years: [
        {
          year: YEAR,
          targetLeagues: 1,
          probed: true,
          transitionedLeagues: 1,
          alreadyInTargetSeasonLeagues: 0,
          removedLeagues: 0,
          refusedLeagues: 0,
        },
      ],
    },
  });
  assert.ok(receipt);
  await recordSchedulerExecutionReceipt(receipt);
  const stored = await readSchedulerReceipt('season-transition');
  assert.ok(stored);
  return stored;
}

// 1 — auth failures: unchanged 401, exactly one event, no receipt.
test('missing and invalid cron authorization: unchanged 401, one event, no receipt', async () => {
  const before = await seedPriorReceipt();

  delete MUTABLE_ENV.CRON_SECRET;
  const missing = await runRoute(cronRequest('anything'));
  assert.equal(missing.res!.status, 401);
  assert.equal(missing.event.result, 'failure');
  assert.equal(missing.event.reason, 'cron-secret-not-configured');
  assert.deepEqual(missing.event.years, []);

  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  const invalid = await runRoute(cronRequest('wrong'));
  assert.equal(invalid.res!.status, 401);
  assert.equal(invalid.event.reason, 'cron-authorization-invalid');

  assert.equal(deferrer.count(), 0, 'no receipt scheduled on an auth failure');
  await deferrer.flush();
  assert.deepEqual(
    await readSchedulerReceipt('season-transition'),
    before,
    'prior receipt preserved'
  );
});

// 2 — no preseason leagues: skipped event + receipt with zero years.
test('no preseason leagues: skipped/no-preseason-leagues event and receipt with zero years', async () => {
  await setAppState('leagues', 'registry', []);
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'no-preseason-leagues');
  assert.deepEqual(event.years, []);

  assert.equal(deferrer.count(), 1);
  await deferrer.flush();
  const stored = await readSchedulerReceipt('season-transition');
  assert.ok(stored);
  assert.deepEqual(Object.keys(stored.value).slice().sort(), RECEIPT_KEYS);
  assert.equal(stored.value.source, 'vercel-cron');
  assert.equal(stored.value.result, 'skipped');
  assert.equal(stored.value.reason, 'no-preseason-leagues');
  assert.equal(stored.value.providerCallAttempted, false);
  assert.deepEqual(stored.value.target, {
    kind: 'season-transition-years',
    totalYears: 0,
    truncated: false,
    invalidLifecycleTargets: 0,
    years: [],
  });
});

// 3 — probe not due: provider-free refresh-not-due.
test('a probe not due is a provider-free refresh-not-due year', async () => {
  await seedPreseason();
  await seedProbe('2099-09-01T00:00:00.000Z'); // far future → shouldFetch false, no transition
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'skipped');
  const year = event.years[0]!;
  assert.equal(year.result, 'skipped');
  assert.equal(year.reason, 'refresh-not-due');
  assert.equal(year.probed, false);
  assert.equal(year.providerCallAttempted, false);
  assert.equal(year.scheduleRefreshReason, null);

  await deferrer.flush();
  const stored = await readSchedulerReceipt('season-transition');
  assert.equal(stored?.value.providerCallAttempted, false);
  assert.deepEqual(stored?.value.target, {
    kind: 'season-transition-years',
    totalYears: 1,
    truncated: false,
    invalidLifecycleTargets: 0,
    years: [
      {
        year: YEAR,
        targetLeagues: 1,
        probed: false,
        transitionedLeagues: 0,
        alreadyInTargetSeasonLeagues: 0,
        removedLeagues: 0,
        refusedLeagues: 0,
      },
    ],
  });
});

// 4 — exact empty E1A response with no prior probe → no-op / empty-response.
test('an exact empty E1A response with no transition is no-op/empty-response', async () => {
  await seedPreseason();
  // No probe → shouldFetch true; empty stub → no-op empty-response; no firstGameDate → no transition.
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  const year = event.years[0]!;
  assert.equal(year.result, 'no-op');
  assert.equal(year.reason, 'empty-response');
  assert.equal(year.scheduleRefreshReason, 'empty-response');
  assert.equal(year.probed, true);
  assert.equal(year.transitionedLeagues, 0);
});

// 5 — clean refresh without transition → exact E1A success reason.
test('a clean refresh whose first game is far off transitions nothing and reports the E1A success reason', async () => {
  await seedPreseason();
  const farGame = JSON.stringify([game(1, 'Texas', 'Rice', '2099-09-01T00:00:00Z')]);
  stubFetchBySeasonType(farGame, '[]');
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  const year = event.years[0]!;
  assert.equal(year.result, 'success');
  assert.equal(year.reason, 'written-clean');
  assert.equal(year.scheduleRefreshReason, 'written-clean');
  assert.equal(year.cached, true);
  assert.equal(year.transitionedLeagues, 0);
  assert.equal(year.providerCallAttempted, true);
});

// 6 — completed transition → success / season-transitioned with truthful counts.
test('a completed transition is success/season-transitioned with truthful counts and receipt', async () => {
  await seedPreseason();
  await seedProbe('2023-08-26T00:00:00.000Z'); // past → transition gate satisfied
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'success');
  const year = event.years[0]!;
  assert.equal(year.result, 'success');
  assert.equal(year.reason, 'season-transitioned');
  assert.equal(year.targetLeagues, 1);
  assert.equal(year.transitionedLeagues, 1);

  await deferrer.flush();
  const stored = await readSchedulerReceipt('season-transition');
  assert.equal(stored?.value.result, 'success');
  assert.equal(stored?.value.reason, 'season-transitioned');
  assert.deepEqual(stored?.value.target, {
    kind: 'season-transition-years',
    totalYears: 1,
    truncated: false,
    invalidLifecycleTargets: 0,
    years: [
      {
        year: YEAR,
        targetLeagues: 1,
        probed: true,
        transitionedLeagues: 1,
        alreadyInTargetSeasonLeagues: 0,
        removedLeagues: 0,
        refusedLeagues: 0,
      },
    ],
  });
});

// 7 — partition/provider failure → exact E1A failure reason and provider-attempt truth.
test('a partition failure reports the exact E1A failure reason with providerCallAttempted true', async () => {
  await seedPreseason();
  stubFetchBySeasonType('{"not":"an-array"}', '[]'); // regular non-array → partition-invalid-payload
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200, 'a data/partition failure stays HTTP 200');
  const year = event.years[0]!;
  assert.equal(year.result, 'failure');
  assert.equal(year.providerCallAttempted, true);
  assert.ok(
    ['partition-invalid-payload', 'partition-schema-drift', 'partition-fetch-failed'].includes(
      year.reason
    ),
    `exact E1A failure reason (got ${year.reason})`
  );
  assert.equal(year.reason, year.scheduleRefreshReason);
});

// 8a — a probe-write failure after confirmed canonical work → partial/probe-write-failed, response unchanged.
test('a probe-write failure is partial/probe-write-failed and preserves the 500 response', async () => {
  await seedPreseason();
  const farGame = JSON.stringify([game(1, 'Texas', 'Rice', '2099-09-01T00:00:00Z')]);
  stubFetchBySeasonType(farGame, '[]');
  __setAppStateWriteFailureForTests(new Error('probe write boom'), 'schedule-probe');
  const { res, event } = await runRoute();
  __setAppStateWriteFailureForTests(null);
  assert.equal(res!.status, 500, 'the probe-write throw is the same 500 as before');
  assert.equal(event.result, 'partial');
  const year = event.years[0]!;
  assert.equal(year.result, 'partial');
  assert.equal(year.reason, 'probe-write-failed');
  assert.equal(year.cached, true);

  await deferrer.flush();
  assert.equal(
    (await readSchedulerReceipt('season-transition'))?.value.reason,
    'probe-write-failed'
  );
});

// 8b — a lifecycle-write failure with no prior success → failure/lifecycle-write-failed.
test('a lifecycle-write failure with no prior success is failure/lifecycle-write-failed', async () => {
  await seedPreseason();
  await seedProbe('2023-08-26T00:00:00.000Z');
  __setAppStateWriteFailureForTests(new Error('registry write boom'), 'leagues');
  const { res, event } = await runRoute();
  __setAppStateWriteFailureForTests(null);
  assert.equal(res!.status, 500);
  assert.equal(event.result, 'failure');
  const year = event.years[0]!;
  assert.equal(year.result, 'failure');
  assert.equal(year.reason, 'lifecycle-write-failed');
  assert.equal(year.transitionedLeagues, 0);
});

// 8c — a probe-read failure → failure/probe-state-unavailable.
test('a probe-read failure is failure/probe-state-unavailable', async () => {
  await seedPreseason();
  __setAppStateReadFailureForTests(new Error('probe read boom'), 'schedule-probe');
  const { res, event } = await runRoute();
  __setAppStateReadFailureForTests(null);
  assert.equal(res!.status, 500);
  assert.equal(event.years[0]!.result, 'failure');
  assert.equal(event.years[0]!.reason, 'probe-state-unavailable');
});

// 9 — presentation failure changes neither the event nor the receipt.
test('a presentation failure does not change the lifecycle event or receipt', async () => {
  await seedPreseason();
  await seedProbe('2023-08-26T00:00:00.000Z');
  // Empty canonical stub transitions off the prior probe; make the presentation
  // endpoints throw. The transition (and thus the event/receipt) must be unaffected.
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.pathname === '/games/media' || url.pathname === '/venues')
      throw new Error('presentation boom');
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'success');
  assert.equal(event.years[0]!.reason, 'season-transitioned');
  await deferrer.flush();
  assert.equal(
    (await readSchedulerReceipt('season-transition'))?.value.reason,
    'season-transitioned'
  );
});

// 10 — a throwing logger still allows the receipt and changes no response/mutation.
test('a throwing logger still schedules the receipt and changes no response', async () => {
  await seedPreseason();
  await seedProbe('2023-08-26T00:00:00.000Z');
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  console.log = (() => {
    throw new Error('logger boom');
  }) as typeof console.log;
  let res: Response;
  try {
    res = await workAsyncStorage.run(store as never, () => GET(cronRequest()));
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }
  assert.equal(res.status, 200, 'the response is unchanged by the logging failure');
  assert.equal(deferrer.count(), 1, 'the receipt was still scheduled');
  await deferrer.flush();
  assert.equal((await readSchedulerReceipt('season-transition'))?.value.result, 'success');
});

// 11 — a receipt-store failure changes no response or lifecycle mutation.
test('a receipt-store failure leaves the response, event, and transition unchanged', async () => {
  await seedPreseason();
  await seedProbe('2023-08-26T00:00:00.000Z');
  __setAppStateWriteFailureForTests(new Error('receipt write boom'), 'scheduler-execution-status');
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'success', 'the runtime event still emits truthfully');
  await deferrer.flush();
  __setAppStateWriteFailureForTests(null);
  assert.equal(await readSchedulerReceipt('season-transition'), null, 'nothing stored');
});

// Ordering — the receipt/event years are ASCENDING even when the league registry
// lists preseason years out of order (the `byYear` map preserves registry order).
test('receipt and event years are sorted ascending regardless of registry order', async () => {
  // Registry order is DESCENDING (2024 then 2023); no probes → both years probe
  // the empty stub (no-op/empty-response), no transition.
  await setAppState('leagues', 'registry', [
    {
      slug: 'later',
      displayName: 'later',
      year: 2024,
      createdAt: '2022-01-01T00:00:00.000Z',
      status: { state: 'preseason', year: 2024 },
    },
    {
      slug: 'earlier',
      displayName: 'earlier',
      year: 2023,
      createdAt: '2022-01-01T00:00:00.000Z',
      status: { state: 'preseason', year: 2023 },
    },
  ]);
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.deepEqual(
    event.years.map((y) => y.year),
    [2023, 2024],
    'event years ascending despite descending registry order'
  );

  await deferrer.flush();
  const stored = await readSchedulerReceipt('season-transition');
  const target = stored!.value.target as { years: Array<{ year: number }> };
  assert.deepEqual(
    target.years.map((y) => y.year),
    [2023, 2024],
    'receipt target years ascending'
  );
});

// 12 — no credential/marker/registry/provider-error leak in event or receipt.
test('no credential, registry, or provider-error marker leaks into the event or receipt', async () => {
  const CRON_MARKER = 'sekret-cron-MARKER';
  const CFBD_MARKER = 'sekret-cfbd-MARKER';
  MUTABLE_ENV.CRON_SECRET = CRON_MARKER;
  MUTABLE_ENV.CFBD_API_KEY = CFBD_MARKER;
  await setAppState('leagues', 'registry', [
    makeLeague('secret-league-MARKER', { state: 'preseason', year: YEAR }),
  ]);
  await seedProbe('2023-08-26T00:00:00.000Z');
  const { raw } = await runRoute(cronRequest(CRON_MARKER));
  await deferrer.flush();
  const stored = await readSchedulerReceipt('season-transition');
  assert.ok(stored);
  const serialized = raw.join('\n') + JSON.stringify(stored.value);
  for (const marker of [CRON_MARKER, CFBD_MARKER, 'secret-league-MARKER']) {
    assert.ok(!serialized.includes(marker), `no leak of ${marker}`);
  }
});
