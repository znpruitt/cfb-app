import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the E1A authority's `revalidateTag` (via invalidateStandings) runs under
// node:test.
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { GET } from '../route';
import type { League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  getAppState,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  setDatasetAutoRefreshEnabled,
  setGlobalPause,
} from '../../../../../lib/server/providerRefreshSettings.ts';
import { acquireScheduleRefreshLease } from '../../../../../lib/schedule/scheduleRefreshLease.ts';
import { resetScheduleRouteCacheForTests } from '../../../schedule/cache.ts';
import type { ScheduleRefreshCronExecutionEvent } from '../../../../../lib/schedule/cronExecutionLog.ts';

const CRON_SECRET = 'test-cron-secret';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_LOG = console.log;

// Deterministic operation fixtures relative to the REAL clock (the route
// classifies at Date.now()): a far-future latest regular kickoff keeps the year
// `ordinary-maintenance`; a past kickoff puts it past the boundary
// (`postseason-boundary`).
const ORDINARY_KICKOFF = '2099-11-27T20:00:00.000Z';
const CRITICAL_KICKOFF = '2020-11-28T20:00:00.000Z';

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
  const existing = (await getAppState<League[]>('leagues', 'registry'))?.value ?? [];
  await setAppState('leagues', 'registry', [
    ...existing,
    makeLeague(slug, { state: 'season', year }, year),
  ]);
}

/** Seed a prior-good canonical schedule whose latest regular kickoff fixes the operation. */
async function seedSchedule(
  year: number,
  kickoff: string,
  options: { at?: number } = {}
): Promise<void> {
  await setAppState('schedule', `${year}-all-all`, {
    at: options.at ?? 1,
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

type PartitionResponse = string | 'throw';
const fetchLog: string[] = [];

/** Year-aware CFBD stub; records `${year}:${seasonType}` per request. */
function stubProvider(
  perYear: Record<number, { regular: PartitionResponse; postseason: PartitionResponse }>
): void {
  globalThis.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const year = Number(url.searchParams.get('year'));
    const seasonType = url.searchParams.get('seasonType') ?? '';
    fetchLog.push(`${year}:${seasonType}`);
    const cfg = perYear[year]?.[seasonType === 'postseason' ? 'postseason' : 'regular'];
    if (cfg === undefined || cfg === 'throw') throw new Error('stub: network down');
    return new Response(cfg, { status: 200, headers: { 'content-type': 'application/json' } });
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

type CapturedRun = {
  res: Response;
  events: ScheduleRefreshCronExecutionEvent[];
  rawLines: string[];
};

/** Invoke the route under the Next work store, capturing structured log events. */
async function runRoute(req: Request = cronRequest()): Promise<CapturedRun> {
  const rawLines: string[] = [];
  const events: ScheduleRefreshCronExecutionEvent[] = [];
  console.log = ((...args: unknown[]) => {
    const line = args.map((a) => String(a)).join(' ');
    rawLines.push(line);
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
    return { res, events, rawLines };
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  resetScheduleRouteCacheForTests();
  fetchLog.length = 0;
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
  stubProvider({});
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

// 1 — missing CRON_SECRET → 401, one failure event, no context/provider work.
test('missing CRON_SECRET → 401, one failure event, no work', async () => {
  delete MUTABLE_ENV.CRON_SECRET;
  const { res, events } = await runRoute(cronRequest(null));
  assert.equal(res.status, 401);
  assert.equal(events.length, 1, 'exactly one structured event');
  assert.equal(events[0]!.result, 'failure');
  assert.equal(events[0]!.reason, 'cron-secret-not-configured');
  assert.deepEqual(events[0]!.years, []);
  assert.equal(fetchLog.length, 0, 'no provider work');
});

// 2 — invalid authorization → 401, one failure event.
test('invalid authorization → 401, one failure event', async () => {
  const { res, events } = await runRoute(cronRequest('wrong-secret'));
  assert.equal(res.status, 401);
  assert.equal(events.length, 1);
  assert.equal(events[0]!.result, 'failure');
  assert.equal(events[0]!.reason, 'cron-authorization-invalid');
  assert.equal(fetchLog.length, 0);
});

// 3/4/5 — no active season league (empty / preseason-only / offseason-only).
test('no season league → skipped/no-active-season (empty, preseason-only, offseason-only)', async () => {
  const registries: League[][] = [
    [],
    [makeLeague('pre', { state: 'preseason', year: 2031 })],
    [makeLeague('off', { state: 'offseason' })],
  ];
  for (const registry of registries) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await setAppState('leagues', 'registry', registry);
    const { res, events } = await runRoute();
    const body = (await res.json()) as { result: string; reason: string };
    assert.equal(res.status, 200);
    assert.equal(body.result, 'skipped');
    assert.equal(body.reason, 'no-active-season');
    assert.equal(events[0]!.reason, 'no-active-season');
    assert.equal(fetchLog.length, 0, 'no provider work without a season target');
  }
});

// 6 — registry read failure → failure/canonical-context-unavailable.
test('registry read failure → failure/canonical-context-unavailable', async () => {
  __setAppStateReadFailureForTests(new Error('registry down'), 'leagues');
  const { res, events } = await runRoute();
  __setAppStateReadFailureForTests(null);
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(res.status, 200, 'controlled operational failure is HTTP 200');
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'canonical-context-unavailable');
  assert.equal(events[0]!.result, 'failure');
  assert.equal(fetchLog.length, 0);
});

// 7 — active year with missing schedule → context failure, no provider call.
test('an active year with no cached schedule fails canonical-context-unavailable without provider work', async () => {
  await seedSeasonLeague(2031);
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'canonical-context-unavailable');
  const yearEntry = events[0]!.years[0]!;
  assert.equal(yearEntry.year, 2031);
  assert.equal(yearEntry.operation, null);
  assert.equal(yearEntry.result, 'failure');
  assert.equal(yearEntry.reason, 'canonical-context-unavailable');
  assert.equal(yearEntry.providerCallAttempted, false);
  assert.equal(fetchLog.length, 0, 'unavailable context never triggers provider work');
});

// 13 — ordinary + global pause → skipped.
test('ordinary maintenance + global pause → skipped/automation-paused-or-disabled', async () => {
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await setGlobalPause(true);
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'automation-paused-or-disabled');
  const entry = events[0]!.years[0]!;
  assert.equal(entry.operation, 'ordinary-maintenance');
  assert.equal(entry.result, 'skipped');
  assert.equal(entry.reason, 'automation-paused-or-disabled');
  assert.equal(fetchLog.length, 0, 'a gated ordinary year spends nothing');
});

// 14 — ordinary + Schedule toggle off → skipped.
test('ordinary maintenance + Schedule toggle off → skipped', async () => {
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await setDatasetAutoRefreshEnabled('schedule', false);
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'skipped');
  assert.equal(events[0]!.years[0]!.reason, 'automation-paused-or-disabled');
  assert.equal(fetchLog.length, 0);
});

// 15/27 — ordinary + gates open → E1A invoked once; success outcomes map to success.
test('ordinary maintenance with open gates delegates to E1A once and maps success', async () => {
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  stubProvider({ 2031: { regular: gameBody(2031), postseason: '[]' } });
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'success');
  assert.equal(body.reason, 'year-results');
  const entry = events[0]!.years[0]!;
  assert.equal(entry.operation, 'ordinary-maintenance');
  assert.equal(entry.result, 'success');
  assert.equal(entry.reason, 'written-clean');
  assert.equal(entry.providerCallAttempted, true);
  assert.equal(entry.dataChanged, true);
  // Exactly ONE E1A invocation = one regular + one postseason fetch.
  assert.deepEqual([...fetchLog].sort(), ['2031:postseason', '2031:regular']);
  // The E1A authority committed durably.
  const stored = await getAppState<{ items: unknown[] }>('schedule', '2031-all-all');
  assert.equal(stored?.value?.items?.length, 1);
});

// 16/17 — critical maintenance bypasses the pause AND the toggle.
test('postseason-boundary maintenance runs despite global pause and toggle off', async () => {
  await seedSeasonLeague(2020);
  await seedSchedule(2020, CRITICAL_KICKOFF);
  await setGlobalPause(true);
  await setDatasetAutoRefreshEnabled('schedule', false);
  stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'success', 'lifecycle-critical maintenance is exempt');
  const entry = events[0]!.years[0]!;
  assert.equal(entry.operation, 'postseason-boundary');
  assert.equal(entry.result, 'success');
  assert.ok(fetchLog.length > 0, 'the critical year reached the provider');
});

// 18 — the critical path does not read settings (a settings-store outage is invisible).
test('a critical-only invocation never consults the settings store', async () => {
  await seedSeasonLeague(2020);
  await seedSchedule(2020, CRITICAL_KICKOFF);
  stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });
  __setAppStateReadFailureForTests(new Error('settings down'), 'provider-refresh-settings');
  const { res, events } = await runRoute();
  __setAppStateReadFailureForTests(null);
  const body = (await res.json()) as { result: string };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'success', 'no settings dependency on the critical path');
  assert.equal(events[0]!.years[0]!.result, 'success');
});

// 19 — a settings failure blocks ordinary work.
test('a settings-store failure blocks ordinary maintenance with settings-unavailable', async () => {
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  __setAppStateReadFailureForTests(new Error('settings down'), 'provider-refresh-settings');
  const { res, events } = await runRoute();
  __setAppStateReadFailureForTests(null);
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'settings-unavailable');
  const entry = events[0]!.years[0]!;
  assert.equal(entry.result, 'failure');
  assert.equal(entry.reason, 'settings-unavailable');
  assert.equal(fetchLog.length, 0, 'no provider work on a blocked ordinary year');
});

// 20 — a settings failure cannot block a critical year in a mixed invocation.
test('a settings failure blocks the ordinary year but not the critical year (mixed)', async () => {
  await seedSeasonLeague(2020, 'critical-league');
  await seedSchedule(2020, CRITICAL_KICKOFF);
  await seedSeasonLeague(2031, 'ordinary-league');
  await seedSchedule(2031, ORDINARY_KICKOFF);
  stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });
  __setAppStateReadFailureForTests(new Error('settings down'), 'provider-refresh-settings');
  const { res, events } = await runRoute();
  __setAppStateReadFailureForTests(null);
  const body = (await res.json()) as { result: string };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'partial', 'critical success + ordinary failure → partial');
  const byYear = Object.fromEntries(events[0]!.years.map((y) => [y.year, y]));
  assert.equal(byYear[2020]!.result, 'success');
  assert.equal(byYear[2031]!.result, 'failure');
  assert.equal(byYear[2031]!.reason, 'settings-unavailable');
  assert.ok(
    fetchLog.every((entry) => entry.startsWith('2020:')),
    'only the critical year fetched'
  );
});

// 21 — multiple active years execute sequentially in ascending order.
test('multiple active years execute sequentially in ascending year order', async () => {
  await seedSeasonLeague(2021, 'later');
  await seedSchedule(2021, CRITICAL_KICKOFF);
  await seedSeasonLeague(2020, 'earlier');
  await seedSchedule(2020, CRITICAL_KICKOFF);
  stubProvider({
    2020: { regular: gameBody(2020), postseason: '[]' },
    2021: { regular: gameBody(2021), postseason: '[]' },
  });
  const { events } = await runRoute();
  assert.deepEqual(
    events[0]!.years.map((y) => y.year),
    [2020, 2021],
    'ascending year order'
  );
  const firstYearFetches = fetchLog.slice(0, 2);
  assert.ok(
    firstYearFetches.every((f) => f.startsWith('2020:')),
    '2020 completes before 2021 starts (sequential)'
  );
});

// 22 — ordinary-skipped + critical-success aggregates to success.
test('an ordinary year skipped by the toggle does not make a critical success partial', async () => {
  await seedSeasonLeague(2020, 'critical-league');
  await seedSchedule(2020, CRITICAL_KICKOFF);
  await seedSeasonLeague(2031, 'ordinary-league');
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await setDatasetAutoRefreshEnabled('schedule', false);
  stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'success', 'skips are excluded from the partial comparison');
  const byYear = Object.fromEntries(events[0]!.years.map((y) => [y.year, y]));
  assert.equal(byYear[2031]!.result, 'skipped');
  assert.equal(byYear[2020]!.result, 'success');
});

// 23 — success + failure aggregates to partial.
test('a success plus a failure aggregates to partial', async () => {
  await seedSeasonLeague(2020, 'ok-league');
  await seedSchedule(2020, CRITICAL_KICKOFF);
  await seedSeasonLeague(2021, 'bad-league');
  await seedSchedule(2021, CRITICAL_KICKOFF);
  stubProvider({
    2020: { regular: gameBody(2020), postseason: '[]' },
    2021: { regular: 'throw', postseason: 'throw' },
  });
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(body.result, 'partial');
  assert.equal(body.reason, 'year-results');
  const byYear = Object.fromEntries(events[0]!.years.map((y) => [y.year, y]));
  assert.equal(byYear[2020]!.result, 'success');
  assert.equal(byYear[2021]!.result, 'failure');
  assert.equal(byYear[2021]!.reason, 'partition-fetch-failed');
  assert.equal(byYear[2021]!.providerCallAttempted, true, 'true even after transport failure');
});

// 24 — all failures aggregate to failure.
test('all failing years aggregate to failure', async () => {
  await seedSeasonLeague(2020);
  await seedSchedule(2020, CRITICAL_KICKOFF);
  stubProvider({ 2020: { regular: 'throw', postseason: 'throw' } });
  const { res } = await runRoute();
  const body = (await res.json()) as { result: string };
  assert.equal(body.result, 'failure');
});

// 25 — all no-ops aggregate to no-op (stale observation preserves newer durable).
test('all no-op years aggregate to no-op (stale-observation)', async () => {
  await seedSeasonLeague(2020);
  // Prior durable observed in the FUTURE → any refresh is a stale observation.
  await seedSchedule(2020, CRITICAL_KICKOFF, { at: Date.parse('2099-01-01T00:00:00.000Z') });
  stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string };
  assert.equal(body.result, 'no-op');
  assert.equal(events[0]!.years[0]!.reason, 'stale-observation');
});

// 26 — lease contention maps to no-op/refresh-in-progress.
test('E1A lease contention maps to no-op/refresh-in-progress', async () => {
  await seedSeasonLeague(2020);
  await seedSchedule(2020, CRITICAL_KICKOFF);
  const held = await acquireScheduleRefreshLease({ year: 2020, now: Date.now() });
  assert.equal(held.acquired, true);
  stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string };
  assert.equal(body.result, 'no-op');
  const entry = events[0]!.years[0]!;
  assert.equal(entry.result, 'no-op');
  assert.equal(entry.reason, 'refresh-in-progress');
  assert.equal(entry.providerCallAttempted, false);
  assert.equal(fetchLog.length, 0, 'the losing caller makes no provider request');
});

// 30/31 — exactly one structured event; only approved keys.
test('exactly one structured event per invocation with only approved keys', async () => {
  await seedSeasonLeague(2020);
  await seedSchedule(2020, CRITICAL_KICKOFF);
  stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });
  const { events } = await runRoute();
  assert.equal(events.length, 1, 'exactly one event');
  const event = events[0]!;
  assert.deepEqual(
    Object.keys(event).sort(),
    ['durationMs', 'event', 'reason', 'result', 'years'],
    'top-level schema is the exact allowlist'
  );
  assert.ok(Number.isInteger(event.durationMs) && event.durationMs >= 0);
  for (const year of event.years) {
    assert.deepEqual(
      Object.keys(year).sort(),
      [
        'dataChanged',
        'operation',
        'providerCallAttempted',
        'reason',
        'result',
        'rowsCommitted',
        'rowsReceived',
        'year',
      ],
      'year-entry schema is the exact allowlist'
    );
  }
});

// 32 — secret/payload/error marker values never leak into the event line.
test('secrets, payload markers, and error markers never leak into the event', async () => {
  const SECRET_MARKER = 'super-secret-cron-token-LEAK-CANARY';
  MUTABLE_ENV.CRON_SECRET = SECRET_MARKER;
  await setAppState('leagues', 'registry', [
    {
      ...makeLeague('leaky', { state: 'season', year: 2020 }, 2020),
      displayName: 'REGISTRY-ROW-LEAK-CANARY',
    },
  ]);
  await seedSchedule(2020, CRITICAL_KICKOFF);
  globalThis.fetch = (async () => {
    throw new Error('PROVIDER-ERROR-LEAK-CANARY');
  }) as typeof fetch;
  const { rawLines } = await runRoute(cronRequest(SECRET_MARKER));
  const eventLines = rawLines.filter((l) => l.includes('schedule-refresh-cron'));
  assert.equal(eventLines.length, 1);
  for (const marker of [SECRET_MARKER, 'REGISTRY-ROW-LEAK-CANARY', 'PROVIDER-ERROR-LEAK-CANARY']) {
    assert.ok(!eventLines[0]!.includes(marker), `event must not contain ${marker}`);
  }
});

// 33 — a logger failure preserves the response.
test('a logger failure never changes the HTTP response', async () => {
  await seedSeasonLeague(2020);
  await seedSchedule(2020, CRITICAL_KICKOFF);
  stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  console.log = (() => {
    throw new Error('console down');
  }) as typeof console.log;
  let res: Response;
  try {
    res = await workAsyncStorage.run(store as never, () => GET(cronRequest()));
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }
  assert.equal(res.status, 200, 'response unchanged despite the logging fault');
  const body = (await res.json()) as { result: string };
  assert.equal(body.result, 'success');
});

// 49 — vercel.json remains only the two lifecycle jobs.
test('vercel.json retains only the daily lifecycle crons (no weekly schedule entry)', async () => {
  const { readFile } = await import('node:fs/promises');
  const raw = JSON.parse(await readFile('vercel.json', 'utf8')) as {
    crons?: Array<{ path: string; schedule: string }>;
  };
  assert.deepEqual(raw.crons, [
    { path: '/api/cron/season-transition', schedule: '0 0 * * *' },
    { path: '/api/cron/season-rollover', schedule: '0 0 * * *' },
  ]);
});

// ---------------------------------------------------------------------------
// Cycle-1 review remediation (finding 1) — the durable boundary latch: once a
// year classifies postseason-boundary, a schedule change that moves the latest
// regular kickoff LATER cannot revert it to operator-gated ordinary maintenance.
// ---------------------------------------------------------------------------

test('a critical year is latched durably and stays exempt after the boundary moves later', async () => {
  await seedSeasonLeague(2020);
  await seedSchedule(2020, CRITICAL_KICKOFF);
  stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });

  // Run 1 — classifies postseason-boundary and persists the latch.
  const first = await runRoute();
  assert.equal((await first.res.json()).result, 'success');
  const latch = await getAppState<{ postseasonBoundaryReachedAt?: string }>(
    'schedule-weekly-control',
    '2020'
  );
  assert.ok(
    typeof latch?.value?.postseasonBoundaryReachedAt === 'string',
    'the boundary latch is persisted durably'
  );

  // A schedule change moves the latest REGULAR kickoff far into the future —
  // boundary math alone would now classify ordinary — and the operator closes
  // the gates.
  await seedSchedule(2020, ORDINARY_KICKOFF, { at: 2 });
  await setGlobalPause(true);
  await setDatasetAutoRefreshEnabled('schedule', false);
  stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });

  // Run 2 — the latch keeps the year lifecycle-critical: still exempt, still runs.
  const second = await runRoute();
  const body = (await second.res.json()) as { result: string };
  assert.notEqual(body.result, 'skipped', 'a latched year is never operator-gated');
  const entry = second.events[0]!.years[0]!;
  assert.equal(entry.operation, 'postseason-boundary', 'latched classification persists');
  assert.ok(fetchLog.length > 0, 'the latched year still reached the provider');
});
