import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
} from '../../../../../lib/server/appStateStore.ts';
import {
  __deleteDurableOddsStoreFileForTests,
  __resetDurableOddsStoreForTests,
} from '../../../../../lib/server/durableOddsStore.ts';
import {
  __deleteOddsUsageStoreFileForTests,
  __resetOddsUsageStoreForTests,
} from '../../../../../lib/server/oddsUsageStore.ts';
import { setGlobalPause } from '../../../../../lib/server/providerRefreshSettings.ts';
import { setAppState } from '../../../../../lib/server/appStateStore.ts';
import { __resetOddsRouteCacheForTests } from '../../../odds/routeInternals.ts';
import {
  buildSchedulerExecutionReceipt,
  recordSchedulerExecutionReceipt,
} from '../../../../../lib/server/schedulerExecutionStatus.ts';
import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
  RECEIPT_KEYS,
} from '../../../../../test/schedulerReceiptTestHarness.ts';
import type { OddsCronExecutionEvent } from '../../../../../lib/odds/cronExecutionLog.ts';
import { GET } from '../route.ts';

// PLATFORM-086F2E1 — durable execution receipts for the Odds cron. The runtime
// event, response, lease, quota, and provider semantics stay pinned by
// cron-odds.test.ts unchanged; this suite proves ONLY the receipt contract.
//
// NOTE: the Odds route CATCHES unexpected exceptions in its own outer `catch`
// and returns the pessimistic `failure / unexpected-error` response — it does
// NOT rethrow. So the "unexpected exception" receipt test asserts the recorded
// failure and the unchanged existing response, not a propagated throw.

const CRON_SECRET = 'test-cron-secret';
const H = 60 * 60 * 1000;
const DAY = 24 * H;
const YEAR = 2026;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;
let seededKickoffMs = Date.now() + 2 * DAY;

function cronRequest(secret: string | null = CRON_SECRET): Request {
  return new Request('https://example.com/api/cron/odds', {
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  });
}

function scheduleItem(kickoffMs: number, status = 'scheduled') {
  return {
    id: 'game-1',
    week: 1,
    startDate: new Date(kickoffMs).toISOString(),
    neutralSite: false,
    conferenceGame: false,
    homeTeam: 'Georgia',
    awayTeam: 'Clemson',
    homeConference: 'SEC',
    awayConference: 'ACC',
    status,
    seasonType: 'regular',
    gamePhase: 'regular',
  };
}

async function seedSchedule(kickoffMs: number): Promise<void> {
  seededKickoffMs = kickoffMs;
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    items: [scheduleItem(kickoffMs)],
  });
}

const SPORTS_URL = 'https://api.the-odds-api.com/v4/sports';
const ODDS_URL = 'https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds';

function oddsPayload() {
  return [
    {
      home_team: 'Georgia Bulldogs',
      away_team: 'Clemson Tigers',
      commence_time: new Date(seededKickoffMs).toISOString(),
      bookmakers: [
        {
          key: 'draftkings',
          title: 'DraftKings',
          markets: [
            {
              key: 'spreads',
              outcomes: [
                { name: 'Georgia', point: -3.5, price: -110 },
                { name: 'Clemson', point: 3.5, price: -110 },
              ],
            },
          ],
        },
      ],
    },
  ];
}

function installFetch(remaining = '480'): { sportsCalls: number; oddsCalls: number } {
  const counts = { sportsCalls: 0, oddsCalls: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(ODDS_URL)) {
      counts.oddsCalls += 1;
      return new Response(JSON.stringify(oddsPayload()), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-requests-used': '20',
          'x-requests-remaining': remaining,
          'x-requests-last': '3',
        },
      });
    }
    if (url.startsWith(SPORTS_URL)) {
      counts.sportsCalls += 1;
      return new Response(JSON.stringify([{ key: 'americanfootball_ncaaf' }]), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-requests-used': '20',
          'x-requests-remaining': remaining,
          'x-requests-last': '0',
        },
      });
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;
  return counts;
}

function captureEvent(): { events: OddsCronExecutionEvent[]; restore: () => void } {
  const events: OddsCronExecutionEvent[] = [];
  console.log = ((...args: unknown[]) => {
    const line = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
    try {
      const parsed = JSON.parse(line);
      if (parsed && parsed.event === 'odds-cron') events.push(parsed as OddsCronExecutionEvent);
    } catch {
      /* not an event line */
    }
  }) as typeof console.log;
  return { events, restore: () => void (console.log = ORIGINAL_CONSOLE_LOG) };
}

async function runCron(req: Request = cronRequest()): Promise<{
  res: Response;
  event: OddsCronExecutionEvent;
}> {
  const cap = captureEvent();
  let res: Response;
  try {
    res = await GET(req);
  } finally {
    cap.restore();
  }
  assert.equal(cap.events.length, 1, `exactly one odds-cron event (got ${cap.events.length})`);
  return { res, event: cap.events[0]! };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await __deleteDurableOddsStoreFileForTests(YEAR);
  __resetDurableOddsStoreForTests();
  await __deleteOddsUsageStoreFileForTests();
  __resetOddsUsageStoreForTests();
  __resetOddsRouteCacheForTests();
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  globalThis.fetch = ORIGINAL_FETCH;
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.ODDS_API_KEY = 'test-odds-key';
  MUTABLE_ENV.NEXT_PUBLIC_SEASON = String(YEAR);
  deferrer = installSchedulerReceiptDeferrer();
});

test.afterEach(() => {
  deferrer.restore();
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_CONSOLE_LOG;
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
});

async function seedPriorReceipt() {
  const receipt = buildSchedulerExecutionReceipt({
    job: 'odds',
    invocationId: '77777777-7777-4777-8777-777777777777',
    startedAtMs: Date.now() - 60_000,
    completedAtMs: Date.now() - 59_000,
    result: 'success',
    reason: 'written-clean',
    providerCallAttempted: true,
    target: { kind: 'odds', year: YEAR, cadence: 'baseline', eligibleGames: 1 },
  });
  assert.ok(receipt);
  await recordSchedulerExecutionReceipt(receipt);
  const stored = await readSchedulerReceipt('odds');
  assert.ok(stored);
  return stored;
}

test('missing and invalid cron authorization never create or advance a receipt', async () => {
  const before = await seedPriorReceipt();

  delete MUTABLE_ENV.CRON_SECRET;
  installFetch();
  const missing = await runCron();
  assert.equal(missing.res.status, 401);

  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  const invalid = await runCron(cronRequest('wrong'));
  assert.equal(invalid.res.status, 401);

  assert.equal(deferrer.count(), 0, 'no receipt scheduled on auth failure');
  await deferrer.flush();
  const after = await readSchedulerReceipt('odds');
  assert.deepEqual(after, before, 'the seeded prior receipt is preserved byte-equivalent');
});

test('an authenticated paused invocation writes the exact provider-free skip receipt', async () => {
  await setGlobalPause(true);
  const counts = installFetch();
  const { res, event } = await runCron();
  assert.equal(res.status, 200);
  assert.equal(event.reason, 'automation-paused-or-disabled');
  assert.equal(counts.sportsCalls + counts.oddsCalls, 0);

  assert.equal(deferrer.count(), 1);
  await deferrer.flush();
  const stored = await readSchedulerReceipt('odds');
  assert.ok(stored);
  assert.deepEqual(Object.keys(stored.value).slice().sort(), RECEIPT_KEYS);
  assert.equal(stored.value.result, 'skipped');
  assert.equal(stored.value.reason, 'automation-paused-or-disabled');
  assert.equal(stored.value.providerCallAttempted, false);
  assert.deepEqual(stored.value.target, {
    kind: 'odds',
    year: YEAR,
    cadence: null,
    eligibleGames: 0,
  });
});

test('a due provider poll records the success receipt with cadence and eligible games', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  const counts = installFetch('53');
  const { res, event } = await runCron();
  assert.equal(res.status, 200);
  assert.equal(event.reason, 'written-clean');
  assert.equal(counts.oddsCalls, 1);

  await deferrer.flush();
  const stored = await readSchedulerReceipt('odds');
  assert.equal(stored?.value.result, 'success');
  assert.equal(stored?.value.reason, 'written-clean');
  assert.equal(stored?.value.providerCallAttempted, true);
  assert.equal(stored?.value.target.kind, 'odds');
  assert.deepEqual(stored?.value.target, {
    kind: 'odds',
    year: YEAR,
    cadence: 'baseline',
    eligibleGames: 1,
  });
});

test('a receipt-store failure leaves the route response and runtime event unchanged', async () => {
  await setGlobalPause(true);
  installFetch();
  __setAppStateWriteFailureForTests(new Error('receipt write boom'), 'scheduler-execution-status');
  const { res, event } = await runCron();
  assert.equal(res.status, 200);
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'automation-paused-or-disabled');
  await deferrer.flush();
  __setAppStateWriteFailureForTests(null);
  assert.equal(await readSchedulerReceipt('odds'), null);
});

test('an authenticated unexpected exception records failure/unexpected-error with the existing response', async () => {
  // A settings-scope read failure makes isAutoRefreshAllowed throw AFTER auth;
  // the Odds route's own outer catch resolves it to the pessimistic
  // failure/unexpected-error response (it does not rethrow), and the receipt
  // records that verbatim.
  installFetch();
  __setAppStateReadFailureForTests(new Error('settings read boom'), 'provider-refresh-settings');
  const { res, event } = await runCron();
  __setAppStateReadFailureForTests(null);
  assert.equal(res.status, 500, 'the existing unexpected-error response is unchanged');
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'unexpected-error');

  assert.equal(deferrer.count(), 1);
  await deferrer.flush();
  const stored = await readSchedulerReceipt('odds');
  assert.equal(stored?.value.result, 'failure');
  assert.equal(stored?.value.reason, 'unexpected-error');
  assert.equal(stored?.value.providerCallAttempted, false);
});

test('no credential, URL, or payload marker leaks into the receipt', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  installFetch('53');
  await runCron();
  await deferrer.flush();
  const stored = await readSchedulerReceipt('odds');
  assert.ok(stored);
  const serialized = JSON.stringify(stored.value);
  assert.ok(!serialized.includes('test-odds-key'));
  assert.ok(!serialized.includes('apiKey'));
  assert.ok(!serialized.includes('the-odds-api.com'));
});

test('PLATFORM-089: an early-cadence poll is recorded truthfully in the receipt', async () => {
  // This suite owns the WRITE: the receipt carries the cadence the route actually
  // selected, not a flattened `baseline`. Whether the closed cadence set ACCEPTS
  // `early` on the way back in is the validating reader's contract, pinned in
  // `schedulerExecutionStatus.test.ts` — the harness reader below is a raw
  // `getAppState` and would happily return a value the real reader rejects.
  await seedSchedule(Date.now() + 20 * DAY);
  const counts = installFetch('53');
  const { res, event } = await runCron();
  assert.equal(res.status, 200);
  assert.equal(counts.oddsCalls, 1);
  assert.equal(event.cadence, 'early');

  await deferrer.flush();
  const stored = await readSchedulerReceipt('odds');
  assert.equal(stored?.value.result, 'success');
  assert.deepEqual(stored?.value.target, {
    kind: 'odds',
    year: YEAR,
    cadence: 'early',
    eligibleGames: 1,
  });
});
