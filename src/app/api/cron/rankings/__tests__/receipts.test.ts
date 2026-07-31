import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GET } from '../route';
import type { League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { setGlobalPause } from '../../../../../lib/server/providerRefreshSettings.ts';
import { __resetSeasonRankingsCacheForTests } from '../../../../../lib/server/rankings.ts';
import { __resetUpstreamPacingForTests } from '../../../../../lib/api/fetchUpstream.ts';
import {
  buildSchedulerExecutionReceipt,
  recordSchedulerExecutionReceipt,
} from '../../../../../lib/server/schedulerExecutionStatus.ts';
import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
  RECEIPT_KEYS,
} from '../../../../../lib/server/__tests__/schedulerReceiptTestHarness.ts';
import type { RankingsCronExecutionEvent } from '../../../../../lib/rankings/cronExecutionLog.ts';

// PLATFORM-086F2E1 — durable execution receipts for the rankings publication
// cron. The runtime event, responses, window control, quota, and provider
// semantics stay pinned by route.test.ts unchanged; this suite proves ONLY the
// receipt contract, including the bounded rankings-years target.

const CRON_SECRET = 'test-cron-secret';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;

const YEAR = 2031;
const SLOT_WEEKLY_MS = Date.parse('2031-10-05T22:00:00.000Z'); // Sunday 22:00
const FIRST_KICKOFF = '2031-08-30T18:00:00.000Z';

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

function makeLeague(slug: string, status: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: 2005,
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  } as League;
}

async function seedLeague(year: number, state: 'season' | 'preseason' = 'season'): Promise<void> {
  const existing = (await getAppState<League[]>('leagues', 'registry'))?.value ?? [];
  await setAppState('leagues', 'registry', [
    ...existing,
    makeLeague(`league-${year}-${state}`, { state, year }),
  ]);
}

async function seedSchedule(year: number, firstKickoff: string): Promise<void> {
  await setAppState('schedule', `${year}-all-all`, {
    at: 1,
    items: [
      {
        id: `${year}01`,
        week: 1,
        startDate: firstKickoff,
        homeTeam: 'Georgia',
        awayTeam: 'Michigan',
        status: 'scheduled',
        seasonType: 'regular',
      },
    ],
    partialFailure: false,
    failedSeasonTypes: [],
  });
}

function usablePayload(year: number, school = 'Georgia'): unknown[] {
  return [
    {
      season: year,
      seasonType: 'regular',
      week: 6,
      polls: [{ poll: 'AP Top 25', ranks: [{ rank: 1, school, conference: null }] }],
    },
  ];
}

function stubProvider(
  rankings?: Record<number, { regular: unknown[]; postseason: unknown[] }>
): void {
  globalThis.fetch = (async (input: URL | string | Request) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    if (url.pathname === '/info') {
      return new Response(JSON.stringify({ remainingCalls: 4000, patronLevel: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/rankings') {
      const year = Number(url.searchParams.get('year'));
      const seasonType =
        url.searchParams.get('seasonType') === 'postseason' ? 'postseason' : 'regular';
      const body = rankings?.[year]?.[seasonType] ?? [];
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unexpected provider request: ${url.pathname}`);
  }) as typeof fetch;
}

const eventLines: RankingsCronExecutionEvent[] = [];
function captureEvents(): void {
  eventLines.length = 0;
  console.log = ((...args: unknown[]) => {
    const line = typeof args[0] === 'string' ? args[0] : '';
    try {
      const parsed = JSON.parse(line) as { event?: string };
      if (parsed.event === 'rankings-cron') eventLines.push(parsed as RankingsCronExecutionEvent);
    } catch {
      // Non-JSON output — ignore.
    }
  }) as typeof console.log;
}

function request(auth: string | null = `Bearer ${CRON_SECRET}`): Request {
  return new Request(
    'http://localhost/api/cron/rankings',
    auth ? { headers: { authorization: auth } } : undefined
  );
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetSeasonRankingsCacheForTests();
  __resetUpstreamPacingForTests();
  __setAppStateWriteFailureForTests(null);
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubProvider();
  captureEvents();
  deferrer = installSchedulerReceiptDeferrer();
});

test.afterEach(() => {
  deferrer.restore();
  console.log = ORIGINAL_CONSOLE_LOG;
  __setAppStateWriteFailureForTests(null);
});

test.after(() => {
  if (ORIGINAL_CRON_SECRET === undefined) delete MUTABLE_ENV.CRON_SECRET;
  else MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE_LOG;
});

async function seedPriorReceipt() {
  const receipt = buildSchedulerExecutionReceipt({
    job: 'rankings',
    invocationId: '55555555-5555-4555-8555-555555555555',
    startedAtMs: Date.now() - 60_000,
    completedAtMs: Date.now() - 59_000,
    result: 'success',
    reason: 'year-results',
    providerCallAttempted: true,
    target: {
      kind: 'rankings-years',
      totalYears: 1,
      truncated: false,
      years: [{ year: YEAR, publicationWindow: 'weekly-ap-coaches' }],
    },
  });
  assert.ok(receipt);
  await recordSchedulerExecutionReceipt(receipt);
  const stored = await readSchedulerReceipt('rankings');
  assert.ok(stored);
  return stored;
}

test('missing and invalid cron authorization never create or advance a receipt', async () => {
  const before = await seedPriorReceipt();

  delete MUTABLE_ENV.CRON_SECRET;
  await seedLeague(YEAR);
  assert.equal((await GET(request())).status, 401);

  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  assert.equal((await GET(request('Bearer wrong'))).status, 401);

  assert.equal(deferrer.count(), 0, 'no receipt scheduled on auth failure');
  await deferrer.flush();
  const after = await readSchedulerReceipt('rankings');
  assert.deepEqual(after, before, 'the seeded prior receipt is preserved byte-equivalent');
});

test('an authenticated paused invocation writes the exact provider-free skip receipt', async () => {
  await setGlobalPause(true);
  await seedLeague(YEAR);
  const res = await GET(request());
  assert.equal(res.status, 200);
  assert.equal(eventLines[0]?.reason, 'automation-paused-or-disabled');

  assert.equal(deferrer.count(), 1);
  await deferrer.flush();
  const stored = await readSchedulerReceipt('rankings');
  assert.ok(stored);
  assert.deepEqual(Object.keys(stored.value).slice().sort(), RECEIPT_KEYS);
  assert.equal(stored.value.result, 'skipped');
  assert.equal(stored.value.reason, 'automation-paused-or-disabled');
  assert.equal(stored.value.providerCallAttempted, false);
  assert.deepEqual(stored.value.target, {
    kind: 'rankings-years',
    totalYears: 0,
    truncated: false,
    years: [],
  });
});

test('a due window provider refresh records success with the bounded rankings-years target', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ [YEAR]: { regular: usablePayload(YEAR), postseason: [] } });

  const res = await GET(request());
  assert.equal(res.status, 200);
  assert.equal(eventLines[0]?.result, 'success');

  await deferrer.flush();
  const stored = await readSchedulerReceipt('rankings');
  assert.ok(stored);
  assert.equal(stored.value.result, 'success');
  assert.equal(stored.value.providerCallAttempted, true);
  assert.deepEqual(stored.value.target, {
    kind: 'rankings-years',
    totalYears: 1,
    truncated: false,
    years: [{ year: YEAR, publicationWindow: 'weekly-ap-coaches' }],
  });
  // The window durably completed (unchanged behavior) and the receipt exists.
  assert.ok((await getAppState('rankings', String(YEAR))) !== null);
});

test('a receipt-store failure leaves the route response and runtime event unchanged', async () => {
  await setGlobalPause(true);
  await seedLeague(YEAR);
  __setAppStateWriteFailureForTests(new Error('receipt write boom'), 'scheduler-execution-status');
  const res = await GET(request());
  assert.equal(res.status, 200);
  assert.equal(eventLines[0]?.result, 'skipped');
  assert.equal(eventLines[0]?.reason, 'automation-paused-or-disabled');
  await deferrer.flush();
  __setAppStateWriteFailureForTests(null);
  assert.equal(await readSchedulerReceipt('rankings'), null);
});

test('a pre-authentication throw schedules no receipt (auth gating)', async () => {
  await assert.rejects(() => GET({} as unknown as Request));
  assert.equal(eventLines.length, 1);
  assert.equal(eventLines[0]?.result, 'failure');
  assert.equal(eventLines[0]?.reason, 'unexpected-error');
  assert.equal(deferrer.count(), 0, 'a pre-auth throw never schedules a receipt');
  await deferrer.flush();
  assert.equal(await readSchedulerReceipt('rankings'), null);
});

test('no credential canary leaks into the receipt', async (t) => {
  const CRON_MARKER = 'sekret-cron-MARKER';
  const CFBD_MARKER = 'sekret-cfbd-MARKER';
  MUTABLE_ENV.CRON_SECRET = CRON_MARKER;
  MUTABLE_ENV.CFBD_API_KEY = CFBD_MARKER;
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ [YEAR]: { regular: usablePayload(YEAR), postseason: [] } });

  await GET(request(`Bearer ${CRON_MARKER}`));
  await deferrer.flush();
  const stored = await readSchedulerReceipt('rankings');
  assert.ok(stored);
  const serialized = JSON.stringify(stored.value);
  for (const marker of [CRON_MARKER, CFBD_MARKER, 'Georgia', 'authorization']) {
    assert.ok(!serialized.includes(marker), `receipt never leaks ${marker}`);
  }
});

// The route is fully guarded after authentication (settings, registry, context,
// window claim/completion, quota, and E2A all resolve to typed results rather
// than throwing), so the `failure / unexpected-error` receipt mapping is an
// unreachable-at-runtime defensive backstop. A static source-pin guards its
// mapping (matching the game-stats defensive-branch convention).
test('the route pins the authenticated-only receipt finally wiring', () => {
  const routeSrc = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'route.ts'),
    'utf8'
  );
  assert.match(routeSrc, /if \(receiptInvocationId !== null\) \{/);
  assert.match(routeSrc, /job: 'rankings'/);
  assert.match(
    routeSrc,
    /providerCallAttempted: exec\.years\.some\(\(entry\) => entry\.providerCallAttempted\)/
  );
  assert.match(routeSrc, /rankingsYearsTarget\(exec\.years\)/);
});
