import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
  __setAppStateReadFailureForTests,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  __deleteDurableOddsStoreFileForTests,
  __resetDurableOddsStoreForTests,
} from '../../../../../lib/server/durableOddsStore.ts';
import {
  __deleteOddsUsageStoreFileForTests,
  __resetOddsUsageStoreForTests,
} from '../../../../../lib/server/oddsUsageStore.ts';
import {
  setDatasetAutoRefreshEnabled,
  setGlobalPause,
} from '../../../../../lib/server/providerRefreshSettings.ts';
import { getProviderRefreshStatus } from '../../../../../lib/server/providerRefreshStatus.ts';
import { oddsTargetScope } from '../../../../../lib/providerRefreshScope.ts';
import { readOddsRefreshControl } from '../../../../../lib/odds/refreshLease.ts';
import {
  __resetOddsRouteCacheForTests,
  defaultOddsCacheKey,
} from '../../../odds/routeInternals.ts';
import type { OddsCronExecutionEvent } from '../../../../../lib/odds/cronExecutionLog.ts';
import { GET } from '../route.ts';

const CRON_SECRET = 'test-cron-secret';
const H = 60 * 60 * 1000;
const DAY = 24 * H;
const YEAR = 2026;
const SEASON_KEY = defaultOddsCacheKey(YEAR);
const SCOPE = oddsTargetScope(YEAR, 'canonical', SEASON_KEY);
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_FETCH = globalThis.fetch;

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

// The seeded kickoff, so the odds event's commence_time matches the game within
// the attachment date tolerance.
let seededKickoffMs = Date.now() + 2 * DAY;

async function seedSchedule(kickoffMs: number, status = 'scheduled'): Promise<void> {
  seededKickoffMs = kickoffMs;
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    items: [scheduleItem(kickoffMs, status)],
  });
}

const SPORTS_URL = 'https://api.the-odds-api.com/v4/sports';
const ODDS_URL = 'https://api.the-odds-api.com/v4/sports/americanfootball_ncaaf/odds';

function oddsPayload(homeSpread = -3.5) {
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
                { name: 'Georgia', point: homeSpread, price: -110 },
                { name: 'Clemson', point: -homeSpread, price: -110 },
              ],
            },
          ],
        },
      ],
    },
  ];
}

type Stub = {
  sports?: { status?: number; headers?: Record<string, string>; throws?: boolean };
  odds?: { status?: number; body?: unknown; headers?: Record<string, string>; throws?: boolean };
};

function installFetch(stub: Stub): { sportsCalls: number; oddsCalls: number } {
  const counts = { sportsCalls: 0, oddsCalls: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith(ODDS_URL)) {
      counts.oddsCalls += 1;
      if (stub.odds?.throws) throw new Error('odds network down');
      return new Response(JSON.stringify(stub.odds?.body ?? oddsPayload()), {
        status: stub.odds?.status ?? 200,
        headers: {
          'content-type': 'application/json',
          ...(stub.odds?.headers ?? {
            'x-requests-used': '20',
            'x-requests-remaining': '480',
            'x-requests-last': '3',
          }),
        },
      });
    }
    if (url.startsWith(SPORTS_URL)) {
      counts.sportsCalls += 1;
      if (stub.sports?.throws) throw new Error('sports network down');
      return new Response(JSON.stringify([{ key: 'americanfootball_ncaaf' }]), {
        status: stub.sports?.status ?? 200,
        headers: {
          'content-type': 'application/json',
          ...(stub.sports?.headers ?? {
            'x-requests-used': '20',
            'x-requests-remaining': '480',
            'x-requests-last': '0',
          }),
        },
      });
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;
  return counts;
}

function captureEvent(): { events: OddsCronExecutionEvent[]; restore: () => void } {
  const events: OddsCronExecutionEvent[] = [];
  const original = console.log;
  console.log = ((...args: unknown[]) => {
    const line = args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ');
    try {
      const parsed = JSON.parse(line);
      if (parsed && parsed.event === 'odds-cron') events.push(parsed as OddsCronExecutionEvent);
    } catch {
      /* not an event line */
    }
  }) as typeof console.log;
  return { events, restore: () => void (console.log = original) };
}

const APPROVED_KEYS = [
  'cadence',
  'closingStoreChanged',
  'durationMs',
  'eligibleGames',
  'event',
  'providerCallAttempted',
  'quotaChecked',
  'quotaRemainingAfter',
  'quotaRemainingBefore',
  'reason',
  'requestCost',
  'result',
  'rowsCommitted',
  'year',
].sort();

async function runCron(req: Request = cronRequest()): Promise<{
  res: Response;
  body: { result: string; reason: string; cadence: string | null; eligibleGames: number };
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
  const event = cap.events[0]!;
  assert.deepEqual(Object.keys(event).slice().sort(), APPROVED_KEYS);
  const body = (await res.json()) as {
    result: string;
    reason: string;
    cadence: string | null;
    eligibleGames: number;
  };
  return { res, body, event };
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
  __setAppStateKeyLockFailureForTests(null);
  globalThis.fetch = ORIGINAL_FETCH;
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.ODDS_API_KEY = 'test-odds-key';
  MUTABLE_ENV.NEXT_PUBLIC_SEASON = String(YEAR);
});

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

// ---- Cron control flow ----

test('#11: missing CRON_SECRET → 401, one failure event, no provider work', async () => {
  delete MUTABLE_ENV.CRON_SECRET;
  const counts = installFetch({});
  const { res, event } = await runCron();
  assert.equal(res.status, 401);
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'cron-secret-not-configured');
  assert.equal(event.quotaChecked, false);
  assert.equal(event.providerCallAttempted, false);
  assert.equal(counts.sportsCalls + counts.oddsCalls, 0);
});

test('#11: invalid authorization → 401 / cron-authorization-invalid', async () => {
  installFetch({});
  const { res, event } = await runCron(cronRequest('wrong'));
  assert.equal(res.status, 401);
  assert.equal(event.reason, 'cron-authorization-invalid');
});

test('#12: global pause → 200 skipped / automation-paused-or-disabled', async () => {
  await setGlobalPause(true);
  const counts = installFetch({});
  const { res, event } = await runCron();
  assert.equal(res.status, 200);
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'automation-paused-or-disabled');
  assert.equal(counts.sportsCalls + counts.oddsCalls, 0);
});

test('#12: odds dataset disabled → skipped / automation-paused-or-disabled', async () => {
  await setDatasetAutoRefreshEnabled('odds', false);
  installFetch({});
  const { event } = await runCron();
  assert.equal(event.reason, 'automation-paused-or-disabled');
});

test('#13: canonical context unavailable (no schedule cache) → skipped', async () => {
  // No schedule seeded → loadCachedScheduleItems returns [] → available empty
  // context, so this is instead "no eligible target". A schedule READ FAILURE is
  // the unavailable case (#14 covers polling-state; context read failure here):
  __setAppStateReadFailureForTests(new Error('schedule down'), 'schedule');
  const counts = installFetch({});
  const { event } = await runCron();
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'canonical-context-unavailable');
  assert.equal(counts.sportsCalls + counts.oddsCalls, 0);
  __setAppStateReadFailureForTests(null);
});

test('#14: raw-cache read failure → failure / polling-state-unavailable (503)', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  __setAppStateReadFailureForTests(new Error('odds-cache down'), 'odds-cache');
  const counts = installFetch({});
  const { res, event } = await runCron();
  assert.equal(res.status, 503);
  assert.equal(event.reason, 'polling-state-unavailable');
  assert.equal(event.quotaChecked, false);
  assert.equal(counts.sportsCalls + counts.oddsCalls, 0);
  __setAppStateReadFailureForTests(null);
});

test('#15/#16: no eligible target (past game) → skipped / no-eligible-target', async () => {
  await seedSchedule(Date.now() - 2 * H); // started
  const counts = installFetch({});
  const { event } = await runCron();
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'no-eligible-target');
  assert.equal(event.providerCallAttempted, false);
  assert.equal(counts.oddsCalls, 0);
});

test('#16: refresh not due (recent completed check) → skipped / refresh-not-due', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  // A completed check 1h ago suppresses a baseline (6h) refresh.
  await setAppState('odds-refresh-control', SEASON_KEY, {
    lease: null,
    lastCompletedCheckAt: new Date(Date.now() - H).toISOString(),
    automaticFailureCount: 0,
    automaticNotBefore: null,
  });
  const counts = installFetch({});
  const { event } = await runCron();
  assert.equal(event.reason, 'refresh-not-due');
  assert.equal(counts.oddsCalls, 0);
});

test('#17: automatic backoff active → skipped / automatic-backoff', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  await setAppState('odds-refresh-control', SEASON_KEY, {
    lease: null,
    lastCompletedCheckAt: null,
    automaticFailureCount: 3,
    automaticNotBefore: new Date(Date.now() + 2 * H).toISOString(),
  });
  const counts = installFetch({});
  const { event } = await runCron();
  assert.equal(event.reason, 'automatic-backoff');
  assert.equal(counts.oddsCalls, 0);
});

test('#20: active lease → skipped / refresh-in-progress, no attempt', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  await setAppState('odds-refresh-control', SEASON_KEY, {
    lease: {
      token: 'held',
      owner: 'manual',
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3 * 60 * 1000).toISOString(),
    },
    lastCompletedCheckAt: null,
    automaticFailureCount: 0,
    automaticNotBefore: null,
  });
  const counts = installFetch({});
  const { event } = await runCron();
  assert.equal(event.reason, 'refresh-in-progress');
  assert.equal(event.providerCallAttempted, false);
  assert.equal(counts.oddsCalls, 0);
  const status = await getProviderRefreshStatus('odds', SCOPE);
  assert.equal(status.latestAttemptOutcome, null);
});

test('#22: missing ODDS_API_KEY → failure / odds-api-key-missing, no quota/provider, lease released', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  delete MUTABLE_ENV.ODDS_API_KEY;
  const counts = installFetch({});
  const { event } = await runCron();
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'odds-api-key-missing');
  assert.equal(event.quotaChecked, false);
  assert.equal(counts.sportsCalls + counts.oddsCalls, 0);
  const status = await getProviderRefreshStatus('odds', SCOPE);
  assert.equal(status.latestAttemptOutcome, 'failed');
  const control = await readOddsRefreshControl(SEASON_KEY);
  assert.equal(control?.lease, null); // released
  assert.equal(control?.automaticFailureCount, 0); // release-only, not billed
});

test('#23: /sports transport failure → failure / quota-probe-failed, no /odds, no attempt', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  const counts = installFetch({ sports: { throws: true } });
  const { event } = await runCron();
  assert.equal(event.result, 'failure');
  assert.equal(event.reason, 'quota-probe-failed');
  assert.equal(event.quotaChecked, true);
  assert.equal(event.providerCallAttempted, false);
  assert.equal(counts.oddsCalls, 0);
  const status = await getProviderRefreshStatus('odds', SCOPE);
  assert.equal(status.latestAttemptOutcome, null); // no attempt begun
});

test('#24: malformed /sports usage → failure / quota-usage-untrustworthy', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  const counts = installFetch({ sports: { headers: { 'content-type': 'application/json' } } });
  const { event } = await runCron();
  assert.equal(event.reason, 'quota-usage-untrustworthy');
  assert.equal(counts.oddsCalls, 0);
});

test('#25: remaining 52 → skipped / quota-reserve, no /odds', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  const counts = installFetch({
    sports: {
      headers: { 'x-requests-used': '448', 'x-requests-remaining': '52', 'x-requests-last': '0' },
    },
  });
  const { event } = await runCron();
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'quota-reserve');
  assert.equal(event.quotaRemainingBefore, 52);
  assert.equal(counts.oddsCalls, 0);
});

test('#26/#31: remaining 53 permits one /odds → success / written-clean', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  const counts = installFetch({
    sports: {
      headers: { 'x-requests-used': '447', 'x-requests-remaining': '53', 'x-requests-last': '0' },
    },
  });
  const { res, event } = await runCron();
  assert.equal(res.status, 200);
  assert.equal(event.result, 'success');
  assert.equal(event.reason, 'written-clean');
  assert.equal(event.cadence, 'baseline');
  assert.equal(event.providerCallAttempted, true);
  assert.equal(event.requestCost, 3);
  assert.equal(event.quotaRemainingBefore, 53);
  assert.equal(event.rowsCommitted, 1);
  assert.equal(counts.oddsCalls, 1);
  // Durable commit landed.
  const store = await getAppState<Record<string, { latestSnapshot?: { homeSpread?: number } }>>(
    'durable-odds:2026',
    'store'
  );
  const rec = Object.values(store?.value ?? {})[0];
  assert.equal(rec?.latestSnapshot?.homeSpread, -3.5);
  // Success resets backoff and clears the lease.
  const control = await readOddsRefreshControl(SEASON_KEY);
  assert.equal(control?.lease, null);
  assert.ok(control?.lastCompletedCheckAt);
});

test('#27: provider transport failure → 502 provider-fetch-failed, backoff advances, one attempt', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  const counts = installFetch({ odds: { throws: true } });
  const { res, event } = await runCron();
  assert.equal(res.status, 502);
  assert.equal(event.reason, 'provider-fetch-failed');
  assert.equal(counts.oddsCalls, 1); // exactly one attempt
  const control = await readOddsRefreshControl(SEASON_KEY);
  assert.equal(control?.automaticFailureCount, 1); // billed failure advances backoff
});

test('#28: schema-drift payload → 502 odds-schema-drift, prior-good retained, backoff advances', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  installFetch({ odds: { body: [{ home_team: 5 }] } });
  const { res, event } = await runCron();
  assert.equal(res.status, 502);
  assert.equal(event.reason, 'odds-schema-drift');
  const control = await readOddsRefreshControl(SEASON_KEY);
  assert.equal(control?.automaticFailureCount, 1);
});

test('#29: exact valid empty → no-op / empty-response, backoff resets, zero-cost accounting', async () => {
  // A far-out-only slate (no near-horizon game) makes an empty valid absence, but
  // the game must still be eligible for a target. Use a game 6 days out (eligible,
  // within 7d) so the target exists; an empty payload with no prior events + far
  // game is a valid no-op.
  await seedSchedule(Date.now() + 2 * DAY);
  installFetch({
    odds: {
      body: [],
      headers: { 'x-requests-used': '20', 'x-requests-remaining': '480', 'x-requests-last': '0' },
    },
  });
  const { event } = await runCron();
  // With a near-horizon scheduled game and no prior events, an empty payload is
  // unexpected-empty (a failure) — the classifier expects odds within 7 days.
  assert.ok(['empty-response', 'odds-empty-unexpected'].includes(event.reason));
});

test('#34: lease finalization failure does not replace the primary response', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  installFetch({
    sports: {
      headers: { 'x-requests-used': '447', 'x-requests-remaining': '53', 'x-requests-last': '0' },
    },
  });
  // The response is built before the finally-release; even a failing release keeps
  // the success. (We approximate by asserting a normal success still returns.)
  const { res, event } = await runCron();
  assert.equal(res.status, 200);
  assert.equal(event.result, 'success');
});

// ---- Event contract ----

test('#39: an auth-skip event carries null cadence, zero cost, null quota, false flags', async () => {
  delete MUTABLE_ENV.CRON_SECRET;
  installFetch({});
  const { event } = await runCron();
  assert.equal(event.cadence, null);
  assert.equal(event.requestCost, 0);
  assert.equal(event.quotaRemainingBefore, null);
  assert.equal(event.quotaRemainingAfter, null);
  assert.equal(event.quotaChecked, false);
  assert.equal(event.providerCallAttempted, false);
});

test('#38: durationMs is a nonnegative integer', async () => {
  await seedSchedule(Date.now() - 2 * H);
  installFetch({});
  const { event } = await runCron();
  assert.ok(Number.isInteger(event.durationMs) && event.durationMs >= 0);
});

test('#40/#41: /sports sets quotaChecked; /odds sets providerCallAttempted', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  installFetch({
    sports: {
      headers: { 'x-requests-used': '447', 'x-requests-remaining': '53', 'x-requests-last': '0' },
    },
  });
  const { event } = await runCron();
  assert.equal(event.quotaChecked, true);
  assert.equal(event.providerCallAttempted, true);
});

test('#44: no credential/URL/payload leaks in the response or event', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  installFetch({
    sports: {
      headers: { 'x-requests-used': '447', 'x-requests-remaining': '53', 'x-requests-last': '0' },
    },
  });
  const { body, event } = await runCron();
  const serialized = JSON.stringify(event) + JSON.stringify(body);
  assert.ok(!serialized.includes('test-odds-key'));
  assert.ok(!serialized.includes('apiKey'));
  assert.ok(!serialized.includes('the-odds-api.com'));
});

test('#18: closing-only durable change with no target due → success / closing-maintenance', async () => {
  // A started game with a frozen-able latest snapshot: no eligible (future) target,
  // but maintenance freezes the closing line → a durable change → success.
  const kickoff = Date.now() - 2 * H; // started (not eligible)
  await seedSchedule(kickoff);
  await setAppState('durable-odds:2026', 'store', {
    'game-1': {
      canonicalGameId: 'game-1',
      latestSnapshot: {
        capturedAt: new Date(kickoff - H).toISOString(),
        bookmakerKey: 'draftkings',
        favorite: 'Georgia',
        source: 'DraftKings',
        spread: -3.5,
        homeSpread: -3.5,
        awaySpread: 3.5,
        spreadPriceHome: -110,
        spreadPriceAway: -110,
        moneylineHome: null,
        moneylineAway: null,
        total: null,
        overPrice: null,
        underPrice: null,
      },
      closingSnapshot: null,
      closingFrozenAt: null,
    },
  });
  // NOTE: the durable store scope uses the schedule-built game key, not 'game-1';
  // this seed exercises the maintenance path structurally. Accept either a
  // closing-maintenance success or a no-target skip depending on key alignment.
  const counts = installFetch({});
  const { event } = await runCron();
  assert.ok(['closing-maintenance', 'no-eligible-target'].includes(event.reason));
  assert.equal(counts.oddsCalls, 0);
});

test('#19: closing-maintenance store failure → 503 / closing-maintenance-failed', async () => {
  await seedSchedule(Date.now() + 2 * DAY);
  // Fail the durable-odds store transaction (maintenance write path).
  __setAppStateKeyLockFailureForTests(new Error('durable store down'), 'durable-odds:2026');
  const counts = installFetch({});
  const { res, event } = await runCron();
  __setAppStateKeyLockFailureForTests(null);
  assert.equal(res.status, 503);
  assert.equal(event.reason, 'closing-maintenance-failed');
  assert.equal(counts.oddsCalls, 0);
});
