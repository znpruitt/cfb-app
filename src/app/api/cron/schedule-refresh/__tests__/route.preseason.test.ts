import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  getAppState,
  setDatasetAutoRefreshEnabled,
  setGlobalPause,
  acquireScheduleRefreshLease,
  ORDINARY_KICKOFF,
  CRITICAL_KICKOFF,
  seedSeasonLeague,
  seedSchedule,
  fetchLog,
  providerUrlLog,
  stubProvider,
  gameBody,
  runRoute,
  EARLY_FIRST_KICKOFF,
  seedPreseasonLeague,
  seedProbe,
} from './_routeHarness.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086E1B1 — preseason weekly coverage: cache-armed early preseason gets
// ordinary weekly maintenance; unarmed/final-week preseason defers to the daily
// season-transition cron; preseason never touches the postseason latch.
// ---------------------------------------------------------------------------

// 3 (route) — preseason year with no probe defers to season-transition.
test('a preseason year with no probe defers: skipped/season-transition-owner, no provider work', async () => {
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'season-transition-owner');
  const entry = events[0]!.years[0]!;
  assert.equal(entry.operation, null);
  assert.equal(entry.result, 'skipped');
  assert.equal(entry.reason, 'season-transition-owner');
  assert.equal(entry.providerCallAttempted, false);
  assert.equal(fetchLog.length, 0, 'a transition-owned year spends nothing');
});

// 8 (route) — a preseason year inside the final seven days defers too.
test('a preseason year within seven days of first kickoff defers to season-transition', async () => {
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  // First kickoff in the past relative to the real clock → inside/past the window.
  await seedProbe(2031, '2020-08-28T16:00:00.000Z');
  const { res } = await runRoute();
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'season-transition-owner');
  assert.equal(fetchLog.length, 0);
});

// 10/11/25 — cache-armed early preseason executes ONE E1A refresh (gates open).
test('cache-armed early preseason delegates to E1A once and maps success', async () => {
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedProbe(2031, EARLY_FIRST_KICKOFF);
  stubProvider({ 2031: { regular: gameBody(2031), postseason: '[]' } });
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(res.status, 200);
  assert.equal(body.result, 'success');
  const entry = events[0]!.years[0]!;
  assert.equal(entry.operation, 'preseason-maintenance');
  assert.equal(entry.result, 'success');
  assert.equal(entry.reason, 'written-clean');
  assert.equal(entry.providerCallAttempted, true);
  assert.deepEqual([...fetchLog].sort(), ['2031:postseason', '2031:regular'], 'one E1A refresh');
});

// 12/13 — early preseason honors the pause AND the toggle (ordinary/noncritical).
test('early preseason is skipped by the global pause and by the Schedule toggle', async () => {
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedProbe(2031, EARLY_FIRST_KICKOFF);
  for (const close of ['pause', 'toggle'] as const) {
    if (close === 'pause') await setGlobalPause(true);
    else {
      await setGlobalPause(false);
      await setDatasetAutoRefreshEnabled('schedule', false);
    }
    const { res, events } = await runRoute();
    const body = (await res.json()) as { result: string; reason: string };
    assert.equal(body.result, 'skipped', close);
    assert.equal(body.reason, 'automation-paused-or-disabled', close);
    const entry = events[0]!.years[0]!;
    assert.equal(entry.operation, 'preseason-maintenance');
    assert.equal(entry.reason, 'automation-paused-or-disabled');
    assert.equal(fetchLog.length, 0, 'a gated preseason year spends nothing');
  }
});

// 14 — a settings failure blocks early-preseason maintenance.
test('a settings-store failure blocks early preseason with settings-unavailable', async () => {
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedProbe(2031, EARLY_FIRST_KICKOFF);
  __setAppStateReadFailureForTests(new Error('settings down'), 'provider-refresh-settings');
  const { res, events } = await runRoute();
  __setAppStateReadFailureForTests(null);
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'settings-unavailable');
  assert.equal(events[0]!.years[0]!.reason, 'settings-unavailable');
  assert.equal(fetchLog.length, 0);
});

// 15 — a transition-owned year never consults settings.
test('a transition-owned preseason year never reads settings', async () => {
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  // No probe → transition owner. Settings store down: must be irrelevant.
  __setAppStateReadFailureForTests(new Error('settings down'), 'provider-refresh-settings');
  const { res } = await runRoute();
  __setAppStateReadFailureForTests(null);
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(body.result, 'skipped');
  assert.equal(
    body.reason,
    'season-transition-owner',
    'not settings-unavailable — no settings read'
  );
});

// 16/17 — preseason paths never read or write the postseason latch.
test('preseason classification neither reads nor writes the postseason latch', async () => {
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedProbe(2031, EARLY_FIRST_KICKOFF);
  stubProvider({ 2031: { regular: gameBody(2031), postseason: '[]' } });
  // A latch-store read outage must be invisible to a preseason year (no read).
  __setAppStateReadFailureForTests(new Error('latch store down'), 'schedule-weekly-control');
  const { res } = await runRoute();
  __setAppStateReadFailureForTests(null);
  const body = (await res.json()) as { result: string };
  assert.equal(body.result, 'success', 'a latch outage cannot affect a preseason year');
  // And no latch record was created (no write).
  const latch = await getAppState('schedule-weekly-control', '2031');
  assert.equal(latch, null, 'preseason never writes the postseason latch');
});

// 18/19/20 — read failures and probe/schedule contradictions are context failures.
test('probe/schedule read failures and armed-probe-without-schedule are context failures', async () => {
  // Probe read failure.
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  __setAppStateReadFailureForTests(new Error('probe down'), 'schedule-probe');
  let run = await runRoute();
  __setAppStateReadFailureForTests(null);
  let body = (await run.res.json()) as { result: string; reason: string };
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'canonical-context-unavailable');

  // Schedule read failure (armed probe).
  await seedProbe(2031, EARLY_FIRST_KICKOFF);
  __setAppStateReadFailureForTests(new Error('schedule down'), 'schedule');
  run = await runRoute();
  __setAppStateReadFailureForTests(null);
  body = (await run.res.json()) as { result: string; reason: string };
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'canonical-context-unavailable');

  // Armed early-preseason probe but the canonical schedule is missing.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedPreseasonLeague(2031);
  await seedProbe(2031, EARLY_FIRST_KICKOFF);
  run = await runRoute();
  body = (await run.res.json()) as { result: string; reason: string };
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'canonical-context-unavailable');
  assert.equal(fetchLog.length, 0, 'context failures never trigger provider work');
});

// 23 — a mixed season+preseason year executes ONCE under the season policy.
test('a mixed season+preseason year executes once under the active-season policy', async () => {
  await seedSeasonLeague(2020, 'season-league');
  await seedPreseasonLeague(2020, 'pre-league');
  await seedSchedule(2020, CRITICAL_KICKOFF);
  await seedProbe(2020, EARLY_FIRST_KICKOFF); // must be ignored — season owns the year
  await setGlobalPause(true); // critical bypasses the pause; preseason would not
  stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string };
  assert.equal(body.result, 'success', 'season policy (critical, exempt) governed the year');
  assert.equal(events[0]!.years.length, 1, 'the mixed year executed exactly once');
  assert.equal(events[0]!.years[0]!.operation, 'postseason-boundary');
  assert.deepEqual([...fetchLog].sort(), ['2020:postseason', '2020:regular'], 'one E1A refresh');
});

// 24 — preseason + season years remain sorted ascending and sequential.
test('mixed preseason/season years execute in ascending year order', async () => {
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedProbe(2031, EARLY_FIRST_KICKOFF);
  await seedSeasonLeague(2020);
  await seedSchedule(2020, CRITICAL_KICKOFF);
  stubProvider({
    2020: { regular: gameBody(2020), postseason: '[]' },
    2031: { regular: gameBody(2031), postseason: '[]' },
  });
  const { events } = await runRoute();
  assert.deepEqual(
    events[0]!.years.map((y) => y.year),
    [2020, 2031],
    'ascending year order'
  );
  assert.ok(
    fetchLog.slice(0, 2).every((f) => f.startsWith('2020:')),
    '2020 completes before 2031 starts'
  );
});

// 26 — preseason-maintenance lease contention maps to a truthful no-op.
test('early-preseason lease contention maps to no-op/refresh-in-progress', async () => {
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedProbe(2031, EARLY_FIRST_KICKOFF);
  const held = await acquireScheduleRefreshLease({ year: 2031, now: Date.now() });
  assert.equal(held.acquired, true);
  stubProvider({ 2031: { regular: gameBody(2031), postseason: '[]' } });
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string };
  assert.equal(body.result, 'no-op');
  const entry = events[0]!.years[0]!;
  assert.equal(entry.operation, 'preseason-maintenance');
  assert.equal(entry.reason, 'refresh-in-progress');
  assert.equal(fetchLog.length, 0);
});

// 27 — a transition-owned skip plus another year's success is NOT partial.
test('a transition-owned deferral plus a successful year aggregates to success', async () => {
  await seedPreseasonLeague(2031); // no probe → transition owner
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedSeasonLeague(2020);
  await seedSchedule(2020, CRITICAL_KICKOFF);
  stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });
  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(body.result, 'success', 'the deferral is a skip, never partial');
  assert.equal(body.reason, 'year-results');
  const byYear = Object.fromEntries(events[0]!.years.map((y) => [y.year, y]));
  assert.equal(byYear[2031]!.reason, 'season-transition-owner');
  assert.equal(byYear[2020]!.result, 'success');
});

// 28 — all transition-owned years aggregate to skipped/season-transition-owner.
test('all transition-owned years aggregate to skipped/season-transition-owner', async () => {
  await seedPreseasonLeague(2030);
  await seedSchedule(2030, ORDINARY_KICKOFF);
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  // Neither year has a probe → both defer.
  const { res } = await runRoute();
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'season-transition-owner');
});

// 29 — gated ordinary + gated preseason years aggregate to paused/disabled.
test('gated ordinary and preseason years aggregate to automation-paused-or-disabled', async () => {
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedProbe(2031, EARLY_FIRST_KICKOFF);
  await seedSeasonLeague(2030);
  await seedSchedule(2030, ORDINARY_KICKOFF); // active ordinary (far-future kickoff)
  await setGlobalPause(true);
  const { res } = await runRoute();
  const body = (await res.json()) as { result: string; reason: string };
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'automation-paused-or-disabled');
  assert.equal(fetchLog.length, 0);
});

// 32 — the inaccurate old reason is gone from the contract (not an emitted alias).
test('no-active-season is no longer present in the route or event contract', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const file of [
    'src/app/api/cron/schedule-refresh/route.ts',
    'src/lib/schedule/cronExecutionLog.ts',
  ]) {
    const source = await readFile(file, 'utf8');
    assert.ok(!source.includes('no-active-season'), `${file} must not carry the retired reason`);
  }
});

// ---------------------------------------------------------------------------
// E1B1 cycle-1 remediation (finding 1) — a successful preseason-maintenance
// refresh re-derives the probe's firstGameDate from the committed schedule
// (preserving baseCachedAt), so the season-transition handoff tracks the
// refreshed schedule instead of a stale probe.
// ---------------------------------------------------------------------------

test('a successful preseason refresh re-derives the probe firstGameDate (preserving baseCachedAt)', async () => {
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedProbe(2031, EARLY_FIRST_KICKOFF); // probe: 2099-08-28
  // The committed refresh carries an EARLIER provider-only game and then the
  // first league-visible game. Only the latter may anchor the probe.
  stubProvider({
    2031: {
      regular: JSON.stringify([
        {
          id: 20310,
          week: 0,
          home_team: 'FCS Alpha',
          away_team: 'FCS Beta',
          start_date: '2031-08-20T00:00:00Z',
        },
        {
          id: 20311,
          week: 1,
          home_team: 'Texas',
          away_team: 'Rice',
          start_date: '2031-09-01T18:30:00Z',
        },
      ]),
      postseason: '[]',
    },
  });
  const { res } = await runRoute();
  assert.equal((await res.json()).result, 'success');

  const probe = await getAppState<{ baseCachedAt: string; firstGameDate: string }>(
    'schedule-probe',
    '2031'
  );
  assert.equal(
    probe?.value?.firstGameDate,
    '2031-09-01T00:00:00.000Z',
    'firstGameDate re-derived from the first league-visible game date'
  );
  assert.equal(probe?.value?.baseCachedAt, '2031-05-01T00:00:00.000Z', 'baseCachedAt preserved');
});

test('an earlier committed kickoff crosses the handoff: the next run defers to season-transition', async () => {
  await seedPreseasonLeague(2031);
  await seedSchedule(2031, ORDINARY_KICKOFF);
  await seedProbe(2031, EARLY_FIRST_KICKOFF);
  // The refresh commits a game kicking off ~3 days from the REAL clock — inside
  // the seven-day handoff window relative to the derived first game.
  const imminentKickoff = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  stubProvider({
    2031: {
      regular: JSON.stringify([
        {
          id: 20311,
          week: 1,
          home_team: 'Texas',
          away_team: 'Rice',
          start_date: imminentKickoff,
          home_conference: 'Big 12',
          away_conference: 'American',
        },
      ]),
      postseason: '[]',
    },
  });

  // Run 1 — early preseason by the STALE probe; commits the imminent game and
  // re-derives the probe.
  const first = await runRoute();
  assert.equal((await first.res.json()).result, 'success');
  const probe = await getAppState<{ firstGameDate: string }>('schedule-probe', '2031');
  assert.equal(
    probe?.value?.firstGameDate,
    new Date(
      Date.UTC(
        new Date(imminentKickoff).getUTCFullYear(),
        new Date(imminentKickoff).getUTCMonth(),
        new Date(imminentKickoff).getUTCDate()
      )
    ).toISOString(),
    'probe now knows the imminent UTC game date'
  );

  // Run 2 — the re-derived probe puts the year inside the handoff window: the
  // DAILY season-transition cron owns it now (provider-free deferral).
  fetchLog.length = 0;
  providerUrlLog.length = 0;
  const second = await runRoute();
  const body = (await second.res.json()) as { result: string; reason: string };
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'season-transition-owner');
  assert.equal(fetchLog.length, 0, 'the deferred year spends nothing');
});
