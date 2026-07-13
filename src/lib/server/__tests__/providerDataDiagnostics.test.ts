import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../appStateStore.ts';
import { getProviderDataDiagnostics } from '../providerDataDiagnostics.ts';

const YEAR = 2026;
const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const COMPLETED_KICKOFF = '2026-10-11T20:00:00.000Z'; // 4 days before NOW (> 6h)
const FUTURE_KICKOFF = '2026-10-18T20:00:00.000Z'; // after NOW, keeps season "active"

function seedSchedule() {
  return setAppState('schedule', `${YEAR}-all-all`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: 'g1',
        week: 1,
        seasonType: 'regular',
        startDate: COMPLETED_KICKOFF,
        status: 'STATUS_FINAL',
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
      },
      {
        id: 'g2',
        week: 2,
        seasonType: 'regular',
        startDate: FUTURE_KICKOFF,
        status: 'STATUS_SCHEDULED',
        homeTeam: 'Gamma',
        awayTeam: 'Delta',
      },
    ],
  });
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('missing schedule → schedule error', async () => {
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const scheduleError = diagnostics.find((d) => d.dataset === 'schedule' && d.severity === 'error');
  assert.ok(scheduleError, 'expected a schedule error when nothing is cached');
});

test('completed slate with no cached scores → scores warning/error', async () => {
  await seedSchedule();
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const scoreIssue = diagnostics.find((d) => d.dataset === 'scores');
  assert.ok(scoreIssue, 'expected a scores diagnostic for the completed, unscored slate');
  assert.ok(['warning', 'error'].includes(scoreIssue!.severity));
});

test('completed slate with no cached game stats → game-stats warning', async () => {
  await seedSchedule();
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const gsWarning = diagnostics.find((d) => d.dataset === 'game-stats' && d.severity === 'warning');
  assert.ok(gsWarning, 'expected a game-stats warning for the missing completed week');
});

test('games without odds are NOT reported as a failure (only info/warn on snapshot recency)', async () => {
  await seedSchedule();
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const oddsError = diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'error');
  assert.equal(oddsError, undefined, 'odds must never be classified as an error for missing lines');
  const oddsInfo = diagnostics.find((d) => d.dataset === 'odds');
  assert.ok(oddsInfo, 'expected an informational odds note when no snapshot exists');
  assert.equal(oddsInfo!.severity, 'info');
});

test('coverage present → no scores/game-stats gaps reported', async () => {
  await seedSchedule();
  await setAppState('scores', `${YEAR}-1-regular`, {
    at: NOW,
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    items: [
      {
        id: 'g1',
        week: 1,
        seasonType: 'regular',
        startDate: COMPLETED_KICKOFF,
        status: 'STATUS_FINAL',
        home: { team: 'Alpha', score: 21 },
        away: { team: 'Beta', score: 14 },
        time: null,
      },
    ],
  });
  await setAppState('game-stats', `${YEAR}:1:regular`, {
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    games: [],
  });

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'scores'),
    undefined,
    'no scores gap when the completed slate has cached final scores'
  );
  assert.equal(
    diagnostics.find((d) => d.dataset === 'game-stats' && d.severity === 'warning'),
    undefined,
    'no game-stats warning when the completed week is cached'
  );
});

// ---------------------------------------------------------------------------
// Finding #1 — a split slate (early Thursday + later Saturday games) must not be
// judged "complete" off the Thursday game while Saturday games remain.
// ---------------------------------------------------------------------------

const THURSDAY_KICKOFF = '2026-10-09T00:00:00.000Z'; // 6+ days before NOW (old)
const SATURDAY_STILL_LIVE = '2026-10-15T09:30:00.000Z'; // ~2.5h before NOW (< 6h → not complete)

test('split Thursday/Saturday slate is NOT complete while Saturday games are recent (no false warnings)', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: 'thu',
        week: 7,
        seasonType: 'regular',
        startDate: THURSDAY_KICKOFF,
        status: 'STATUS_FINAL',
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
      },
      {
        id: 'sat',
        week: 7,
        seasonType: 'regular',
        startDate: SATURDAY_STILL_LIVE,
        status: 'STATUS_IN_PROGRESS',
        homeTeam: 'Gamma',
        awayTeam: 'Delta',
      },
    ],
  });

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  // No cached scores/game-stats for week 7, but the slate is still underway, so
  // there must be no missing-data warnings for it yet.
  assert.equal(
    diagnostics.find((d) => d.dataset === 'scores'),
    undefined,
    'no false scores warning while the Saturday game is still recent'
  );
  assert.equal(
    diagnostics.find((d) => d.dataset === 'game-stats' && d.severity === 'warning'),
    undefined,
    'no false game-stats warning while the slate is underway'
  );
});

test('split slate once the whole slate is old DOES warn on missing data', async () => {
  // Both games now well in the past → slate complete → missing data flagged.
  const longAgoNow = Date.parse('2026-10-20T12:00:00.000Z');
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: longAgoNow - 3 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: 'thu',
        week: 7,
        seasonType: 'regular',
        startDate: THURSDAY_KICKOFF,
        status: 'STATUS_FINAL',
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
      },
      {
        id: 'sat',
        week: 7,
        seasonType: 'regular',
        startDate: SATURDAY_STILL_LIVE,
        status: 'STATUS_FINAL',
        homeTeam: 'Gamma',
        awayTeam: 'Delta',
      },
    ],
  });

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: longAgoNow });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'game-stats'),
    'a fully completed slate with no game stats is flagged'
  );
});

test('postseason completed slate with no game stats is flagged', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: 'bowl',
        week: 1,
        seasonType: 'postseason',
        startDate: COMPLETED_KICKOFF,
        status: 'STATUS_FINAL',
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
      },
    ],
  });

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const gs = diagnostics.find((d) => d.dataset === 'game-stats');
  assert.ok(gs, 'postseason completed slate missing game stats is flagged');
});

// ---------------------------------------------------------------------------
// Rereview finding #1 — applicable score partitions are derived cache-only.
// ---------------------------------------------------------------------------

test('scoreSeasonTypes is regular-only before postseason games are scheduled', async () => {
  await seedSchedule(); // regular-only fixture
  const { scoreSeasonTypes } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.deepEqual(scoreSeasonTypes, ['regular']);
});

test('scoreSeasonTypes includes postseason once the schedule carries bowls', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: 'g1',
        week: 1,
        seasonType: 'regular',
        startDate: COMPLETED_KICKOFF,
        status: 'STATUS_FINAL',
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
      },
      {
        id: 'bowl',
        week: 1,
        seasonType: 'postseason',
        startDate: FUTURE_KICKOFF,
        status: 'STATUS_SCHEDULED',
        homeTeam: 'Gamma',
        awayTeam: 'Delta',
      },
    ],
  });
  const { scoreSeasonTypes } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.deepEqual(scoreSeasonTypes, ['regular', 'postseason']);
});

test('scoreSeasonTypes falls back to regular when no schedule is cached', async () => {
  const { scoreSeasonTypes } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.deepEqual(scoreSeasonTypes, ['regular']);
});

// ---------------------------------------------------------------------------
// Rereview finding #4 — a shared durable odds-usage read is used, not the memo.
// ---------------------------------------------------------------------------

test('a provided oddsUsage snapshot is used verbatim (no fallback read)', async () => {
  await seedSchedule();
  const staleSnapshot = {
    used: 10,
    remaining: 490,
    limit: 500,
    lastCost: 1,
    capturedAt: '2026-08-01T00:00:00.000Z', // > 2 days before NOW → stale
    source: 'odds-response-headers' as const,
    sportKey: 'americanfootball_ncaaf',
    markets: ['h2h'],
    regions: ['us'],
    endpointType: 'odds' as const,
    cacheStatus: 'hit' as const,
  };
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, {
    now: NOW,
    oddsUsage: staleSnapshot,
  });
  const oddsWarn = diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning');
  assert.ok(oddsWarn, 'the provided stale snapshot drives the odds recency warning');
});

test('an explicit null oddsUsage means "no snapshot" without reading the memo', async () => {
  await seedSchedule();
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW, oddsUsage: null });
  const oddsInfo = diagnostics.find((d) => d.dataset === 'odds');
  assert.ok(oddsInfo);
  assert.equal(
    oddsInfo!.severity,
    'info',
    'null snapshot → informational "no snapshot", not error'
  );
});
