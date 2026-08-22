import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GET,
  workAsyncStorage,
  TEST_LEAGUE_SLUG,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
  setDatasetAutoRefreshEnabled,
  setGlobalPause,
  getProviderRefreshStatus,
  acquireScheduleRefreshLease,
  MUTABLE_ENV,
  ORIGINAL_CONSOLE_LOG,
  ORDINARY_KICKOFF,
  CRITICAL_KICKOFF,
  makeLeague,
  seedSeasonLeague,
  seedSchedule,
  fetchLog,
  stubProvider,
  gameBody,
  cronRequest,
  runRoute,
  type League,
} from './_routeHarness.ts';
import { weekPartitionScope } from '../../../../../lib/providerRefreshScope.ts';

function finalGameBody(year: number, week = 1): string {
  return JSON.stringify([
    {
      id: year * 10 + week,
      week,
      home_team: 'Texas',
      away_team: 'Rice',
      start_date: `${year}-09-01T00:00:00Z`,
      home_points: 31,
      away_points: 14,
      completed: true,
    },
  ]);
}

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

// E1B1 tests 1/2 — no preseason/season league (empty / offseason-only) →
// no-maintenance-target (preseason years ARE targets now — covered in
// route.preseason.test.ts).
test('no maintenance target → skipped/no-maintenance-target (empty, offseason-only)', async () => {
  const registries: League[][] = [
    [],
    [makeLeague('off', { state: 'offseason' })],
    // A league with no lifecycle status at all.
    [makeLeague('off', undefined)],
    // PLATFORM-086F2H1T3 — an OFFSEASON demo league. It was never a candidate,
    // so it must NOT flip the reason to `no-automatic-maintenance-target`; this
    // pins the `isActive` gate on the exclusion. Mutation-verified: dropping
    // `isActive &&` from the route fails this case.
    [makeLeague(TEST_LEAGUE_SLUG, { state: 'offseason' })],
  ];
  for (const registry of registries) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    await setAppState('leagues', 'registry', registry);
    const { res, events } = await runRoute();
    const body = (await res.json()) as { result: string; reason: string };
    assert.equal(res.status, 200);
    assert.equal(body.result, 'skipped');
    assert.equal(body.reason, 'no-maintenance-target');
    assert.equal(events[0]!.reason, 'no-maintenance-target');
    assert.equal(fetchLog.length, 0, 'no provider work without a maintenance target');
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

test('ordinary schedule maintenance honors the independent Scores automation toggle', async () => {
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await setDatasetAutoRefreshEnabled('scores', false);
  stubProvider({ 2031: { regular: finalGameBody(2031), postseason: '[]' } });

  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string };
  assert.equal(body.result, 'success', 'the schedule dataset remains enabled');
  assert.equal(events[0]!.years[0]!.scoreRepairs, 0);
  assert.equal(await getAppState('scores', '2031-1-regular'), null);
});

// 16/17 — critical maintenance bypasses the pause AND the toggle.
test('postseason-boundary maintenance runs despite global pause and toggle off', async () => {
  await seedSeasonLeague(2020);
  await seedSchedule(2020, CRITICAL_KICKOFF);
  await setGlobalPause(true);
  await setDatasetAutoRefreshEnabled('schedule', false);
  stubProvider({ 2020: { regular: finalGameBody(2020), postseason: '[]' } });
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'success', 'lifecycle-critical maintenance is exempt');
  const entry = events[0]!.years[0]!;
  assert.equal(entry.operation, 'postseason-boundary');
  assert.equal(entry.result, 'success');
  assert.ok(fetchLog.length > 0, 'the critical year reached the provider');
  assert.equal(
    await getAppState('scores', '2020-1-regular'),
    null,
    'the noncritical score sweep still honors global pause'
  );
});

// 18 — a settings outage cannot block critical schedule work, but its score
// backstop fails closed because Scores automation is noncritical.
test('a critical-only invocation survives settings failure with its score sweep disabled', async () => {
  await seedSeasonLeague(2020);
  await seedSchedule(2020, CRITICAL_KICKOFF);
  stubProvider({ 2020: { regular: finalGameBody(2020), postseason: '[]' } });
  __setAppStateReadFailureForTests(new Error('settings down'), 'provider-refresh-settings');
  const { res, events } = await runRoute();
  __setAppStateReadFailureForTests(null);
  const body = (await res.json()) as { result: string };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'success', 'no settings dependency on the critical path');
  assert.equal(events[0]!.years[0]!.result, 'success');
  assert.equal(await getAppState('scores', '2020-1-regular'), null);
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

test('a score-sweep commit failure makes the cron year and provider status truthful', async () => {
  await seedSeasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  stubProvider({ 2031: { regular: finalGameBody(2031), postseason: '[]' } });
  __setAppStateWriteFailureForTests(new Error('scores down'), 'scores');
  let run: Awaited<ReturnType<typeof runRoute>>;
  try {
    run = await runRoute();
  } finally {
    __setAppStateWriteFailureForTests(null);
  }
  const { res, events } = run;

  const body = (await res.json()) as {
    result: string;
    years: Array<{ result: string; reason: string }>;
  };
  assert.equal(body.result, 'failure');
  assert.equal(body.years[0]?.result, 'failure');
  assert.equal(body.years[0]?.reason, 'score-sweep-failed');
  assert.equal(events[0]!.years[0]!.result, 'failure');
  assert.deepEqual(events[0]!.years[0]!.scoreSweepFailedPartitions, [
    { week: 1, seasonType: 'regular' },
  ]);
  const status = await getProviderRefreshStatus('scores', weekPartitionScope(2031, 1, 'regular'));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'score-sweep-durable-commit-failed');
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
    ['durationMs', 'event', 'invalidLifecycleTargets', 'reason', 'result', 'years'],
    'top-level schema is the exact allowlist'
  );
  assert.ok(Number.isInteger(event.durationMs) && event.durationMs >= 0);
  for (const year of event.years) {
    assert.deepEqual(
      Object.keys(year).sort(),
      [
        'dataChanged',
        'kickoffsChanged',
        'operation',
        'providerCallAttempted',
        'reason',
        'result',
        'rowsCommitted',
        'rowsReceived',
        'scoreDifferenceCount',
        'scoreDifferences',
        'scoreDifferencesTruncated',
        'scoreRepairs',
        'scoreSweepFailedPartitions',
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
