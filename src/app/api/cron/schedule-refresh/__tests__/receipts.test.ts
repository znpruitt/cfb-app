import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the E1A authority's `revalidateTag` (via invalidateStandings) runs under node:test.
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { GET } from '../route';
import { TEST_LEAGUE_SLUG, type League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { resetScheduleRouteCacheForTests } from '../../../schedule/cache.ts';
import { __resetSchedulePresentationMemoForTests } from '../../../../../lib/schedule/schedulePresentationJoin.ts';
import {
  buildSchedulerExecutionReceipt,
  recordSchedulerExecutionReceipt,
} from '../../../../../lib/server/schedulerExecutionStatus.ts';
import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
  RECEIPT_KEYS,
} from '../../../../../lib/server/__tests__/schedulerReceiptTestHarness.ts';
import type { ScheduleRefreshCronExecutionEvent } from '../../../../../lib/schedule/cronExecutionLog.ts';

// PLATFORM-086F2E1 — durable execution receipts for the weekly schedule cron.
// The runtime event, responses, aggregation, and provider semantics stay pinned
// by route.test.ts unchanged; this suite proves ONLY the receipt contract,
// including the bounded multi-year target and provider-attempt aggregation.

const CRON_SECRET = 'test-cron-secret';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;

// A past latest-regular kickoff makes each year lifecycle-critical
// (postseason-boundary) so it runs regardless of the operator gate — the
// simplest way to drive a real provider-attempting success in this suite.
const CRITICAL_KICKOFF = '2020-11-28T20:00:00.000Z';

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

function makeLeague(slug: string, status: League['status'], year = 2031): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  };
}

async function seedSeasonLeague(year: number, slug = `league-${year}`): Promise<void> {
  const existing = (await getLeaguesRegistry()) ?? [];
  await setAppState('leagues', 'registry', [
    ...existing,
    makeLeague(slug, { state: 'season', year }, year),
  ]);
}

async function getLeaguesRegistry(): Promise<League[] | null> {
  const { getAppState } = await import('../../../../../lib/server/appStateStore.ts');
  return (await getAppState<League[]>('leagues', 'registry'))?.value ?? null;
}

async function seedSchedule(year: number, kickoff: string): Promise<void> {
  await setAppState('schedule', `${year}-all-all`, {
    at: 1,
    items: [
      {
        id: `${year}-1`,
        week: 1,
        startDate: '2020-09-01T00:00:00.000Z',
        homeTeam: 'Texas',
        awayTeam: 'Rice',
        status: 'scheduled',
        seasonType: 'regular',
      },
      {
        id: `${year}-2`,
        week: 14,
        startDate: kickoff,
        homeTeam: 'Ohio State',
        awayTeam: 'Michigan',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
}

const fetchLog: string[] = [];
function stubProvider(perYear: Record<number, string>): void {
  globalThis.fetch = (async (input: URL | string | Request) => {
    // Resolve the URL from every input shape. `String(new Request(u))` is
    // '[object Request]', which `new URL()` rejects — and a throw before the
    // `fetchLog` push would leave the log empty while a call WAS attempted,
    // making this suite's zero-call assertion vacuous.
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    if (url.pathname === '/games/media') return new Response('[]', { status: 200 });
    if (url.pathname === '/venues') return new Response('[]', { status: 200 });
    const year = Number(url.searchParams.get('year'));
    const seasonType = url.searchParams.get('seasonType') ?? '';
    fetchLog.push(`${year}:${seasonType}`);
    const body = seasonType === 'postseason' ? '[]' : perYear[year];
    if (body === undefined) throw new Error('stub: network down');
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function gameBody(year: number): string {
  return JSON.stringify([
    {
      id: year * 10 + 1,
      week: 1,
      home_team: 'Texas',
      away_team: 'Rice',
      start_date: `${year}-09-01T00:00:00Z`,
      home_conference: 'Big 12',
      away_conference: 'American',
    },
  ]);
}

function cronRequest(secret: string | null = CRON_SECRET): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://example.com/api/cron/schedule-refresh', { headers });
}

async function runRoute(req: Request = cronRequest()): Promise<{
  res: Response;
  event: ScheduleRefreshCronExecutionEvent;
}> {
  const events: ScheduleRefreshCronExecutionEvent[] = [];
  console.log = ((...args: unknown[]) => {
    const line = args.map((a) => String(a)).join(' ');
    try {
      const parsed = JSON.parse(line) as { event?: string };
      if (parsed?.event === 'schedule-refresh-cron') {
        events.push(parsed as ScheduleRefreshCronExecutionEvent);
      }
    } catch {
      // Non-JSON console output — ignored.
    }
  }) as typeof console.log;
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  try {
    const res = await workAsyncStorage.run(store as never, () => GET(req));
    assert.equal(
      events.length,
      1,
      `exactly one schedule-refresh-cron event (got ${events.length})`
    );
    return { res, event: events[0]! };
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  __resetSchedulePresentationMemoForTests();
  fetchLog.length = 0;
  __setAppStateWriteFailureForTests(null);
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubProvider({});
  deferrer = installSchedulerReceiptDeferrer();
});

test.afterEach(() => {
  deferrer.restore();
  __setAppStateWriteFailureForTests(null);
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
    job: 'schedule-refresh',
    invocationId: '66666666-6666-4666-8666-666666666666',
    startedAtMs: Date.now() - 60_000,
    completedAtMs: Date.now() - 59_000,
    result: 'success',
    reason: 'year-results',
    providerCallAttempted: true,
    target: {
      kind: 'schedule-years',
      totalYears: 1,
      truncated: false,
      years: [{ year: 2031, operation: 'ordinary-maintenance' }],
    },
  });
  assert.ok(receipt);
  await recordSchedulerExecutionReceipt(receipt);
  const stored = await readSchedulerReceipt('schedule-refresh');
  assert.ok(stored);
  return stored;
}

test('missing and invalid cron authorization never create or advance a receipt', async () => {
  const before = await seedPriorReceipt();

  delete MUTABLE_ENV.CRON_SECRET;
  const missing = await runRoute(cronRequest(null));
  assert.equal(missing.res.status, 401);

  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  const invalid = await runRoute(cronRequest('wrong'));
  assert.equal(invalid.res.status, 401);

  assert.equal(deferrer.count(), 0, 'no receipt scheduled on auth failure');
  await deferrer.flush();
  const after = await readSchedulerReceipt('schedule-refresh');
  assert.deepEqual(after, before, 'the seeded prior receipt is preserved byte-equivalent');
});

test('a no-maintenance-target run writes a healthy provider-free skip receipt', async () => {
  await setAppState('leagues', 'registry', []);
  const { res, event } = await runRoute();
  assert.equal(res.status, 200);
  assert.equal(event.reason, 'no-maintenance-target');

  await deferrer.flush();
  const stored = await readSchedulerReceipt('schedule-refresh');
  assert.ok(stored);
  assert.deepEqual(Object.keys(stored.value).slice().sort(), RECEIPT_KEYS);
  assert.equal(stored.value.result, 'skipped');
  assert.equal(stored.value.reason, 'no-maintenance-target');
  assert.equal(stored.value.providerCallAttempted, false);
  assert.deepEqual(stored.value.target, {
    kind: 'schedule-years',
    totalYears: 0,
    truncated: false,
    years: [],
  });
});

test('a multi-year provider-attempting run records the bounded target and provider truth', async () => {
  await seedSeasonLeague(2021, 'later');
  await seedSchedule(2021, CRITICAL_KICKOFF);
  await seedSeasonLeague(2020, 'earlier');
  await seedSchedule(2020, CRITICAL_KICKOFF);
  stubProvider({ 2020: gameBody(2020), 2021: gameBody(2021) });

  const { res, event } = await runRoute();
  assert.equal(res.status, 200);
  assert.equal(event.result, 'success');

  await deferrer.flush();
  const stored = await readSchedulerReceipt('schedule-refresh');
  assert.ok(stored);
  assert.equal(stored.value.result, 'success');
  assert.equal(stored.value.providerCallAttempted, true, 'a year reached the provider');
  // POSITIVE CONTROL for `fetchLog` — this suite's provider observer. The
  // demo-only test below asserts it is EMPTY; that claim is worthless unless
  // the same harness is shown recording real calls, with their years, here.
  assert.deepEqual(fetchLog, [
    '2020:regular',
    '2020:postseason',
    '2021:regular',
    '2021:postseason',
  ]);
  const target = stored.value.target as {
    kind: string;
    totalYears: number;
    truncated: boolean;
    years: Array<{ year: number; operation: string | null }>;
  };
  assert.equal(target.kind, 'schedule-years');
  assert.equal(target.totalYears, 2);
  assert.equal(target.truncated, false);
  assert.deepEqual(
    target.years.map((entry) => entry.year),
    [2020, 2021],
    'ascending year order preserved'
  );
  assert.ok(
    target.years.every((entry) => entry.operation === 'postseason-boundary'),
    'each entry carries its classified operation'
  );
});

// PLATFORM-086F2H1T3 — REGRESSION TEST. A demo-only active registry writes a
// truthful zero-target, provider-free receipt under the NEW reason. Verified
// failing with the exclusion removed: the run classified 2031 as a target and
// reported `success` instead of `skipped`.
test('a demo-only active registry writes a zero-target provider-free receipt', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague(TEST_LEAGUE_SLUG, { state: 'season', year: 2031 }, 2031),
  ]);
  // A lifecycle-critical schedule: were the demo league a target, this year
  // would reach the provider REGARDLESS of the operator pause gate.
  await seedSchedule(2031, CRITICAL_KICKOFF);
  stubProvider({ 2031: gameBody(2031) });

  const { res, event } = await runRoute();
  assert.equal(res.status, 200);
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'no-automatic-maintenance-target');
  assert.deepEqual(fetchLog, [], 'no provider request');

  await deferrer.flush();
  const stored = await readSchedulerReceipt('schedule-refresh');
  assert.ok(stored);
  assert.deepEqual(Object.keys(stored.value).slice().sort(), RECEIPT_KEYS, 'schema unchanged');
  assert.equal(stored.value.result, 'skipped');
  assert.equal(stored.value.reason, 'no-automatic-maintenance-target');
  assert.equal(stored.value.providerCallAttempted, false);
  assert.deepEqual(stored.value.target, {
    kind: 'schedule-years',
    totalYears: 0,
    truncated: false,
    years: [],
  });
});

test('a receipt-store failure leaves the route response and runtime event unchanged', async () => {
  await setAppState('leagues', 'registry', []);
  __setAppStateWriteFailureForTests(new Error('receipt write boom'), 'scheduler-execution-status');
  const { res, event } = await runRoute();
  assert.equal(res.status, 200);
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'no-maintenance-target');
  await deferrer.flush();
  __setAppStateWriteFailureForTests(null);
  assert.equal(await readSchedulerReceipt('schedule-refresh'), null);
});

test('a pre-authentication throw schedules no receipt (auth gating)', async () => {
  // A malformed Request throws inside verifyCronSecret BEFORE authentication
  // succeeds, so no receipt identity is created and none is scheduled.
  const events: ScheduleRefreshCronExecutionEvent[] = [];
  console.log = ((...args: unknown[]) => {
    try {
      const parsed = JSON.parse(args.map((a) => String(a)).join(' ')) as { event?: string };
      if (parsed?.event === 'schedule-refresh-cron') {
        events.push(parsed as ScheduleRefreshCronExecutionEvent);
      }
    } catch {
      /* ignore */
    }
  }) as typeof console.log;
  try {
    await assert.rejects(() => GET({} as unknown as Request));
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }
  assert.equal(events.length, 1);
  assert.equal(events[0]!.result, 'failure');
  assert.equal(events[0]!.reason, 'unexpected-error');
  assert.equal(deferrer.count(), 0, 'a pre-auth throw never schedules a receipt');
  await deferrer.flush();
  assert.equal(await readSchedulerReceipt('schedule-refresh'), null);
});

// The route is fully guarded after authentication (registry read, per-year
// classification, settings, lease, and E1A all resolve to typed results rather
// than throwing), so the `failure / unexpected-error` receipt mapping is an
// unreachable-at-runtime defensive backstop. As with the game-stats defensive
// branch pins, a static source-pin guards its mapping and the exec.years
// early-alias correction against silent drift.
test('the route pins the receipt finally wiring and the exec.years early-alias correction', () => {
  const routeSrc = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'route.ts'),
    'utf8'
  );
  // The receipt is scheduled only for an authenticated invocation, from the finally.
  assert.match(routeSrc, /if \(receiptInvocationId !== null\) \{/);
  assert.match(routeSrc, /job: 'schedule-refresh'/);
  assert.match(
    routeSrc,
    /providerCallAttempted: exec\.years\.some\(\(entry\) => entry\.providerCallAttempted\)/
  );
  // The per-year alias is assigned BEFORE the execution loop (matching rankings),
  // so an authenticated defensive throw retains completed per-year/provider truth.
  const aliasIdx = routeSrc.indexOf('exec.years = entries;');
  const loopIdx = routeSrc.indexOf('for (const candidate of candidates) {');
  assert.ok(
    aliasIdx > 0 && loopIdx > 0 && aliasIdx < loopIdx,
    'exec.years is aliased before the loop'
  );
});
