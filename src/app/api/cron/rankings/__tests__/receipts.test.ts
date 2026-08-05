import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GET } from '../route';
import { TEST_LEAGUE_SLUG, type League } from '../../../../../lib/league.ts';
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

/** Append one league. Pass `TEST_LEAGUE_SLUG` to seed the DEMO league. */
async function seedLeague(
  year: number,
  state: 'season' | 'preseason' = 'season',
  slug = `league-${year}-${state}`
): Promise<void> {
  const existing = (await getAppState<League[]>('leagues', 'registry'))?.value ?? [];
  await setAppState('leagues', 'registry', [...existing, makeLeague(slug, { state, year })]);
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

/**
 * PLATFORM-086F2H1T4 — this suite previously had NO provider observer at all,
 * so it could make no claim about provider spend. Two properties matter here:
 *
 *   1. Requests are recorded BEFORE parsing and BEFORE path branching, so an
 *      unrecognized endpoint or an input shape the stub cannot parse is still
 *      visible (both callers on this path swallow a stub throw).
 *   2. The receipt's own `providerCallAttempted` field is NOT a substitute. It
 *      reports rankings REFRESH attempts only, is hard-false on every inert
 *      per-year entry, and is trivially false when there are no year entries at
 *      all — so it stays false even after a real, billed `/info` quota probe.
 */
const providerUrlLog: string[] = [];
const fetchLog: { info: number; rankings: string[] } = { info: 0, rankings: [] };

function stubProvider(
  rankings?: Record<number, { regular: unknown[]; postseason: unknown[] }>
): void {
  globalThis.fetch = (async (input: URL | string | Request) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    providerUrlLog.push(href);
    const url = new URL(href);
    if (url.pathname === '/info') {
      fetchLog.info += 1;
      return new Response(JSON.stringify({ remainingCalls: 4000, patronLevel: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/rankings') {
      const year = Number(url.searchParams.get('year'));
      const seasonType =
        url.searchParams.get('seasonType') === 'postseason' ? 'postseason' : 'regular';
      fetchLog.rankings.push(`${year}:${seasonType}`);
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
  providerUrlLog.length = 0;
  fetchLog.info = 0;
  fetchLog.rankings = [];
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

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1T4 — demo-league exclusion, receipt projection
// ---------------------------------------------------------------------------

// POSITIVE CONTROL — this suite's observer is new; the zero-request assertions
// below are only meaningful because it demonstrably records real traffic, every
// `fetch` input shape, and endpoints the stub itself rejects.
test('POSITIVE CONTROL: the receipt suite observer records real traffic and every input shape', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ [YEAR]: { regular: usablePayload(YEAR), postseason: [] } });

  await GET(request());
  assert.equal(fetchLog.info, 1, 'the real run made a quota probe');
  assert.deepEqual(fetchLog.rankings.sort(), [`${YEAR}:postseason`, `${YEAR}:regular`]);
  assert.equal(providerUrlLog.length, 3, 'the URL log saw the same three requests');
  assert.ok(providerUrlLog.some((url) => url.includes(`year=${YEAR}`)));

  // All three input shapes resolve to the same href. `Request` is the one a
  // parse-then-record observer loses: `String(request)` is "[object Request]".
  const probe = 'https://api.collegefootballdata.com/info?probe=1';
  providerUrlLog.length = 0;
  await globalThis.fetch(probe);
  await globalThis.fetch(new URL(probe));
  await globalThis.fetch(new Request(probe));
  assert.deepEqual(providerUrlLog, [probe, probe, probe]);

  // An unrecognized endpoint records even though the stub throws.
  const unknown = 'https://api.collegefootballdata.com/teams?probe=1';
  providerUrlLog.length = 0;
  await assert.rejects(() => globalThis.fetch(unknown));
  assert.deepEqual(providerUrlLog, [unknown]);
});

// REGRESSION TEST — a gates-open demo-only run with a DUE window. Without the
// exclusion this fixture reaches `/info` and both rankings partitions and writes
// the demo year into the receipt target.
test('T4 regression: a demo-only run records the new reason, zero target years, and no request', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  await seedLeague(YEAR, 'season', TEST_LEAGUE_SLUG);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  stubProvider({ [YEAR]: { regular: usablePayload(YEAR), postseason: [] } });

  const res = await GET(request());
  assert.equal(res.status, 200);
  assert.equal(eventLines[0]?.reason, 'no-automatic-ranking-target');

  assert.equal(deferrer.count(), 1, 'an authenticated invocation still writes a receipt');
  await deferrer.flush();
  const stored = await readSchedulerReceipt('rankings');
  assert.ok(stored);
  assert.deepEqual(Object.keys(stored.value).slice().sort(), RECEIPT_KEYS);
  assert.equal(stored.value.result, 'skipped');
  assert.equal(stored.value.reason, 'no-automatic-ranking-target');
  assert.equal(stored.value.providerCallAttempted, false);
  assert.deepEqual(stored.value.target, {
    kind: 'rankings-years',
    totalYears: 0,
    truncated: false,
    years: [],
  });
  // The observed truth, independent of the receipt's self-report.
  assert.deepEqual(providerUrlLog, []);
  assert.equal(fetchLog.info + fetchLog.rankings.length, 0);
});

// REGRESSION TEST — a mixed registry projects only the production year into the
// bounded receipt target.
test('T4 regression: a mixed run stores only the production year in the receipt target', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: SLOT_WEEKLY_MS });
  const DEMO_YEAR = 2033;
  await seedLeague(DEMO_YEAR, 'preseason', TEST_LEAGUE_SLUG);
  await seedLeague(YEAR);
  await seedSchedule(YEAR, FIRST_KICKOFF);
  await seedSchedule(DEMO_YEAR, '2031-11-15T18:00:00.000Z');
  stubProvider({
    [YEAR]: { regular: usablePayload(YEAR), postseason: [] },
    [DEMO_YEAR]: { regular: usablePayload(DEMO_YEAR, 'Michigan'), postseason: [] },
  });

  await GET(request());
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
  assert.deepEqual(fetchLog.rankings.sort(), [`${YEAR}:postseason`, `${YEAR}:regular`]);
  assert.ok(!providerUrlLog.some((url) => url.includes(`year=${DEMO_YEAR}`)));
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
