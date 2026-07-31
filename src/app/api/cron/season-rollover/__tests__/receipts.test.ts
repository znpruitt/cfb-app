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
  __resetTeamDatabaseStoreForTests,
  setTeamDatabaseFile,
} from '../../../../../lib/server/teamDatabaseStore.ts';
import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
  RECEIPT_KEYS,
} from '../../../../../lib/server/__tests__/schedulerReceiptTestHarness.ts';
import {
  buildSchedulerExecutionReceipt,
  recordSchedulerExecutionReceipt,
} from '../../../../../lib/server/schedulerExecutionStatus.ts';
import type { SeasonRolloverCronExecutionEvent } from '../../../../../lib/lifecycleCronExecutionLog.ts';

// PLATFORM-086F2E2A — durable receipts + one secret-safe runtime event for the
// season-rollover lifecycle cron. Existing rollover behavior stays pinned by
// route.test.ts unchanged; this suite proves ONLY the event + receipt contract.
// Rollover is cache-only, so `providerCallAttempted` is always false.

const CRON_SECRET = 'test-cron-secret';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CONSOLE_LOG = console.log;

// A championship well past the 7-day rollover gate relative to the real clock.
const PAST_CHAMP = '2024-01-08T00:00:00.000Z';

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

function makeLeague(slug: string, status: League['status'], year: number): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  };
}

/** Seed a structured, (optionally) final CFP championship for `year`. */
async function seedChampionship(year: number, champDate: string, final = true): Promise<void> {
  await setAppState('schedule', `${year}-all-all`, {
    items: [
      {
        id: `${year}0752`,
        week: 15,
        startDate: champDate,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Alpha U',
        awayTeam: 'Beta U',
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        status: 'final',
        seasonType: 'postseason',
        gamePhase: 'postseason',
        postseasonSubtype: 'playoff',
        playoffRound: 'national_championship',
        playoffCompetition: 'College Football Playoff',
        playoffRoundSource: 'cfbd-structured',
      },
    ],
  });
  await setAppState('scores', `${year}-all-postseason`, {
    at: Date.parse(champDate),
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    items: [
      {
        id: `${year}0752`,
        seasonType: 'postseason',
        startDate: champDate,
        week: 15,
        status: final ? 'final' : 'in progress',
        home: { team: 'Alpha U', score: final ? 34 : 14 },
        away: { team: 'Beta U', score: final ? 21 : 10 },
        time: null,
      },
    ],
  });
}

async function seedTeams(): Promise<void> {
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: '2023-01-01T00:00:00.000Z',
    items: [
      { school: 'Alpha U', conference: 'SEC' },
      { school: 'Beta U', conference: 'Big Ten' },
    ],
  });
}

function cronRequest(secret: string | null = CRON_SECRET): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://example.com/api/cron/season-rollover', { headers });
}

async function runRoute(req: Request = cronRequest()): Promise<{
  res: Response | null;
  event: SeasonRolloverCronExecutionEvent;
  threw: unknown;
  raw: string[];
}> {
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
  const events: SeasonRolloverCronExecutionEvent[] = [];
  for (const line of raw) {
    try {
      const parsed = JSON.parse(line) as { event?: string };
      if (parsed?.event === 'season-rollover-cron')
        events.push(parsed as SeasonRolloverCronExecutionEvent);
    } catch {
      /* not an event line */
    }
  }
  assert.equal(events.length, 1, `exactly one season-rollover-cron event (got ${events.length})`);
  return { res, event: events[0]!, threw, raw };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  deferrer = installSchedulerReceiptDeferrer();
});

test.afterEach(() => {
  deferrer.restore();
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  console.log = ORIGINAL_CONSOLE_LOG;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CRON_SECRET === undefined) delete MUTABLE_ENV.CRON_SECRET;
  else MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
  console.log = ORIGINAL_CONSOLE_LOG;
});

async function seedPriorReceipt() {
  const receipt = buildSchedulerExecutionReceipt({
    job: 'season-rollover',
    invocationId: '33333333-3333-4333-8333-333333333333',
    startedAtMs: Date.now() - 60_000,
    completedAtMs: Date.now() - 59_000,
    result: 'success',
    reason: 'rollover-complete',
    providerCallAttempted: false,
    target: {
      kind: 'season-rollover-years',
      totalYears: 1,
      truncated: false,
      years: [{ year: 2023, targetLeagues: 1, rolledOverLeagues: 1 }],
    },
  });
  assert.ok(receipt);
  await recordSchedulerExecutionReceipt(receipt);
  const stored = await readSchedulerReceipt('season-rollover');
  assert.ok(stored);
  return stored;
}

// 1 — auth failures: unchanged 401, one event, no receipt.
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

  assert.equal(deferrer.count(), 0);
  await deferrer.flush();
  assert.deepEqual(
    await readSchedulerReceipt('season-rollover'),
    before,
    'prior receipt preserved'
  );
});

// 2 — no season groups: skipped event + receipt with zero years.
test('no season leagues: skipped/no-season-leagues event and receipt with zero years', async () => {
  await setAppState('leagues', 'registry', []);
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'no-season-leagues');
  assert.deepEqual(event.years, []);

  await deferrer.flush();
  const stored = await readSchedulerReceipt('season-rollover');
  assert.ok(stored);
  assert.deepEqual(Object.keys(stored.value).slice().sort(), RECEIPT_KEYS);
  assert.equal(stored.value.source, 'vercel-cron');
  assert.equal(stored.value.result, 'skipped');
  assert.equal(stored.value.reason, 'no-season-leagues');
  assert.equal(stored.value.providerCallAttempted, false);
  assert.deepEqual(stored.value.target, {
    kind: 'season-rollover-years',
    totalYears: 0,
    truncated: false,
    years: [],
  });
});

// 3 — a championship-gate skip reason remains visible.
test('a not-final championship is a skipped year carrying the exact skip reason', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, false); // not final → skip
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'skipped');
  const year = event.years[0]!;
  assert.equal(year.result, 'skipped');
  assert.equal(year.reason, 'not-final');
  assert.equal(year.providerCallAttempted, false);
  assert.equal(year.rolledOverLeagues, 0);
});

// 4 — eligibility durable-read failure → failure / read-failed.
test('an eligibility read failure is failure/read-failed', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);
  __setAppStateReadFailureForTests(new Error('schedule read boom'), 'schedule');
  const { res, event } = await runRoute();
  __setAppStateReadFailureForTests(null);
  assert.equal(res!.status, 200, 'a per-year read failure is the detailed 200 response');
  assert.equal(event.result, 'failure');
  const year = event.years[0]!;
  assert.equal(year.result, 'failure');
  assert.equal(year.reason, 'read-failed');
});

// 5/9 — complete rollover → success/rollover-complete with truthful counts, provider flag false.
test('a complete rollover is success/rollover-complete with truthful counts and a provider-free receipt', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'success');
  const year = event.years[0]!;
  assert.equal(year.result, 'success');
  assert.equal(year.reason, 'rollover-complete');
  assert.equal(year.targetLeagues, 1);
  assert.equal(year.rolledOverLeagues, 1);
  assert.equal(year.providerCallAttempted, false);

  await deferrer.flush();
  const stored = await readSchedulerReceipt('season-rollover');
  assert.equal(stored?.value.result, 'success');
  assert.equal(stored?.value.providerCallAttempted, false);
  assert.deepEqual(stored?.value.target, {
    kind: 'season-rollover-years',
    totalYears: 1,
    truncated: false,
    years: [{ year: 2023, targetLeagues: 1, rolledOverLeagues: 1 }],
  });
});

// 6 — mixed-year eligible + skipped aggregate to success (skip never degrades).
test('a mixed eligible/skipped multi-year run aggregates to success', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('rolls', { state: 'season', year: 2023 }, 2023),
    makeLeague('waits', { state: 'season', year: 2022 }, 2022),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true); // eligible → rolls
  await seedChampionship(2022, PAST_CHAMP, false); // not final → skip
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'success', 'a skipped sibling never degrades the rolled year');
  assert.equal(event.years.length, 2);
  const byYear = new Map(event.years.map((y) => [y.year, y]));
  assert.equal(byYear.get(2023)!.result, 'success');
  assert.equal(byYear.get(2022)!.result, 'skipped');
  assert.equal(byYear.get(2022)!.reason, 'not-final');
});

// 7 — partial per-league rollover → partial / rollover-partial.
test('one league failing its archive while another rolls is partial/rollover-partial', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
    makeLeague('beta', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);
  // Fail ONLY beta's per-league archive write; alpha rolls cleanly.
  __setAppStateWriteFailureForTests(new Error('archive boom'), 'standings-archive:beta');
  const { res, event } = await runRoute();
  __setAppStateWriteFailureForTests(null);
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'partial');
  const year = event.years[0]!;
  assert.equal(year.result, 'partial');
  assert.equal(year.reason, 'rollover-partial');
  assert.equal(year.targetLeagues, 2);
  assert.equal(year.rolledOverLeagues, 1);

  await deferrer.flush();
  assert.equal((await readSchedulerReceipt('season-rollover'))?.value.reason, 'rollover-partial');
});

// 8 — all eligible work failing → failure / rollover-failed.
test('every league failing its archive is failure/rollover-failed', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);
  __setAppStateWriteFailureForTests(new Error('archive boom'), 'standings-archive:alpha');
  const { res, event } = await runRoute();
  __setAppStateWriteFailureForTests(null);
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'failure');
  const year = event.years[0]!;
  assert.equal(year.result, 'failure');
  assert.equal(year.reason, 'rollover-failed');
  assert.equal(year.rolledOverLeagues, 0);
});

// 10 — a throwing logger changes no response, and the receipt is still scheduled.
test('a throwing logger still schedules the receipt and changes no response or rollover', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);
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
  const body = (await res.json()) as { success?: boolean; leaguesRolledOver?: string[] };
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.leaguesRolledOver, ['alpha'], 'the rollover still happened');
  assert.equal(deferrer.count(), 1);
  await deferrer.flush();
  assert.equal((await readSchedulerReceipt('season-rollover'))?.value.result, 'success');
});

// 11 — a receipt-store failure changes no response/archive/transition, and no marker leaks.
test('a receipt-store failure changes no response, and no slug/credential/error leaks', async () => {
  const CRON_MARKER = 'sekret-cron-MARKER';
  MUTABLE_ENV.CRON_SECRET = CRON_MARKER;
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('secret-slug-MARKER', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);
  __setAppStateWriteFailureForTests(new Error('receipt write boom'), 'scheduler-execution-status');
  const { res, event, raw } = await runRoute(cronRequest(CRON_MARKER));
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'success');
  await deferrer.flush();
  __setAppStateWriteFailureForTests(null);
  // The receipt-store write failed, so nothing persisted.
  assert.equal(await readSchedulerReceipt('season-rollover'), null);
  const serialized = raw.join('\n');
  assert.equal(
    Object.keys(event.years[0]!).slice().sort().join(','),
    [
      'providerCallAttempted',
      'reason',
      'result',
      'rolledOverLeagues',
      'suppressionCleared',
      'targetLeagues',
      'year',
    ]
      .sort()
      .join(',')
  );
  for (const marker of [CRON_MARKER, 'secret-slug-MARKER']) {
    assert.ok(!serialized.includes(marker), `no leak of ${marker}`);
  }
});
