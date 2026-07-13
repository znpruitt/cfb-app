import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../appStateStore.ts';
import { __resetOddsUsageStoreForTests, setLatestKnownOddsUsage } from '../oddsUsageStore.ts';
import { getProviderDataDiagnostics } from '../providerDataDiagnostics.ts';

const YEAR = 2026;
const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const COMPLETED_KICKOFF = '2026-10-11T20:00:00.000Z'; // 4 days before NOW (> 6h)
const FUTURE_KICKOFF = '2026-10-18T20:00:00.000Z'; // after NOW, keeps season "active"

type ScheduleItemSeed = {
  id: string;
  week: number;
  seasonType: 'regular' | 'postseason';
  startDate: string;
  status: string;
  homeTeam: string;
  awayTeam: string;
};

function seedScheduleItems(items: ScheduleItemSeed[]) {
  return setAppState('schedule', `${YEAR}-all-all`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items,
  });
}

// A single completed regular-season week-1 game with a real CFBD-style numeric id
// (so a game-stats row can resolve to it by providerGameId), plus a future game
// that keeps the season "active".
function seedSchedule() {
  return seedScheduleItems([
    {
      id: '101',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
    {
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Gamma',
      awayTeam: 'Delta',
    },
  ]);
}

function seedScores(status: string, home: number | null, away: number | null, week = 1) {
  return setAppState('scores', `${YEAR}-${week}-regular`, {
    at: NOW,
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    items: [
      {
        id: '101',
        week,
        seasonType: 'regular',
        startDate: COMPLETED_KICKOFF,
        status,
        home: { team: 'Alpha', score: home },
        away: { team: 'Beta', score: away },
        time: null,
      },
    ],
  });
}

function gameStatsRow(providerGameId: number) {
  return {
    providerGameId,
    week: 1,
    seasonType: 'regular' as const,
    home: { school: 'Alpha' },
    away: { school: 'Beta' },
  };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetOddsUsageStoreForTests();
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

test('full coverage (final scores + usable game stats) → no scores/game-stats gaps', async () => {
  await seedSchedule();
  await seedScores('STATUS_FINAL', 21, 14);
  await setAppState('game-stats', `${YEAR}:1:regular`, {
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    games: [gameStatsRow(101)],
  });

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'scores'),
    undefined,
    'no scores gap when the completed slate has cached final scores'
  );
  assert.equal(
    diagnostics.find((d) => d.dataset === 'game-stats'),
    undefined,
    'no game-stats gap when the completed week is fully covered'
  );
});

// ---------------------------------------------------------------------------
// 4th-review finding #2 — completed-slate score coverage requires a canonical
// TERMINAL classification, not merely numeric scores.
// ---------------------------------------------------------------------------

test('an in-progress numeric score does NOT satisfy completed-slate coverage', async () => {
  await seedSchedule();
  // Mid-game refresh: numeric scores present but the game is still in progress.
  await seedScores('STATUS_IN_PROGRESS', 10, 7);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const scoreIssue = diagnostics.find((d) => d.dataset === 'scores');
  assert.ok(scoreIssue, 'a completed slate with only an in-progress numeric row is still missing');
});

test('a final score satisfies completed-slate coverage', async () => {
  await seedSchedule();
  await seedScores('STATUS_FINAL', 21, 14);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'scores'),
    undefined,
    'a final row covers the completed slate'
  );
});

test('a canceled game does not raise an impossible missing-final warning', async () => {
  await seedScheduleItems([
    {
      id: '101',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'Canceled',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
    {
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Gamma',
      awayTeam: 'Delta',
    },
  ]);
  // A canceled game will never have a final score; the cached row reflects that.
  await seedScores('Canceled', null, null);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'scores'),
    undefined,
    'a canceled game is terminal and resolves coverage without a numeric final'
  );
});

test('postponed / suspended / delayed / unknown score states remain unresolved', async () => {
  for (const status of ['Postponed', 'Suspended', 'Delayed', 'weird-unknown']) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    __resetOddsUsageStoreForTests();
    await seedSchedule();
    // Numeric scores but a non-terminal (or unknown) status must NOT satisfy coverage.
    await seedScores(status, 3, 0);
    const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
    assert.ok(
      diagnostics.find((d) => d.dataset === 'scores'),
      `status "${status}" is not terminal, so the slate remains missing a final`
    );
  }
});

test('a mixed slate with at least one final row counts as covered (slate granularity)', async () => {
  await seedScheduleItems([
    {
      id: '101',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
    {
      id: '103',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_IN_PROGRESS',
      homeTeam: 'Echo',
      awayTeam: 'Foxtrot',
    },
    {
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Gamma',
      awayTeam: 'Delta',
    },
  ]);
  await setAppState('scores', `${YEAR}-1-regular`, {
    at: NOW,
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    items: [
      {
        id: '101',
        week: 1,
        seasonType: 'regular',
        startDate: COMPLETED_KICKOFF,
        status: 'STATUS_FINAL',
        home: { team: 'Alpha', score: 21 },
        away: { team: 'Beta', score: 14 },
        time: null,
      },
      {
        id: '103',
        week: 1,
        seasonType: 'regular',
        startDate: COMPLETED_KICKOFF,
        status: 'STATUS_IN_PROGRESS',
        home: { team: 'Echo', score: 3 },
        away: { team: 'Foxtrot', score: 0 },
        time: null,
      },
    ],
  });
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'scores'),
    undefined,
    'a slate with a cached final row is covered even alongside an in-progress row'
  );
});

// ---------------------------------------------------------------------------
// 4th-review finding #3 — game-stats coverage is CONTENT-based, not key-based.
// ---------------------------------------------------------------------------

test('a game-stats record with games:[] does NOT satisfy coverage', async () => {
  await seedSchedule();
  await setAppState('game-stats', `${YEAR}:1:regular`, {
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    games: [],
  });
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const gsWarning = diagnostics.find((d) => d.dataset === 'game-stats' && d.severity === 'warning');
  assert.ok(gsWarning, 'an empty games array is not coverage — the week is still missing');
});

test('a record whose every row was dropped (no provider id) does NOT satisfy coverage', async () => {
  await seedSchedule();
  await setAppState('game-stats', `${YEAR}:1:regular`, {
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    games: [gameStatsRow(0)], // providerGameId 0 → unusable
  });
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'game-stats' && d.severity === 'warning'),
    'an all-dropped record is not coverage'
  );
});

test('partial game-stats coverage is surfaced as an info note', async () => {
  await seedScheduleItems([
    {
      id: '101',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
    {
      id: '104',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Echo',
      awayTeam: 'Foxtrot',
    },
    {
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Gamma',
      awayTeam: 'Delta',
    },
  ]);
  // Only one of the two expected week-1 games has stats → partial, not missing.
  await setAppState('game-stats', `${YEAR}:1:regular`, {
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    games: [gameStatsRow(101)],
  });
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'game-stats' && d.severity === 'warning'),
    undefined,
    'partial coverage is not a missing-week warning'
  );
  const partialInfo = diagnostics.find(
    (d) => d.dataset === 'game-stats' && d.severity === 'info' && /partial/i.test(d.message)
  );
  assert.ok(partialInfo, 'partial coverage is surfaced as an info note');
});

test('a disrupted (canceled) game is not counted as an expected missing game-stat', async () => {
  await seedScheduleItems([
    {
      id: '101',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
    {
      id: '105',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'Canceled',
      homeTeam: 'Echo',
      awayTeam: 'Foxtrot',
    },
    {
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Gamma',
      awayTeam: 'Delta',
    },
  ]);
  // Only the played game (101) has stats; the canceled game (105) will never
  // produce team stats, so this is FULL coverage, not partial.
  await setAppState('game-stats', `${YEAR}:1:regular`, {
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    games: [gameStatsRow(101)],
  });
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'game-stats'),
    undefined,
    'a canceled game does not manufacture a partial-coverage gap'
  );
});

// ---------------------------------------------------------------------------
// Split slate (early Thursday + later Saturday games) — must not be judged
// "complete" off the Thursday game while Saturday games remain.
// ---------------------------------------------------------------------------

const THURSDAY_KICKOFF = '2026-10-09T00:00:00.000Z'; // 6+ days before NOW (old)
const SATURDAY_STILL_LIVE = '2026-10-15T09:30:00.000Z'; // ~2.5h before NOW (< 6h → not complete)

test('split Thursday/Saturday slate is NOT complete while Saturday games are recent (no false warnings)', async () => {
  await seedScheduleItems([
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
  ]);

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
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
  await seedScheduleItems([
    {
      id: 'bowl',
      week: 1,
      seasonType: 'postseason',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
  ]);

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const gs = diagnostics.find((d) => d.dataset === 'game-stats');
  assert.ok(gs, 'postseason completed slate missing game stats is flagged');
});

// ---------------------------------------------------------------------------
// Rereview finding #1 — applicable score partitions are derived cache-only.
// ---------------------------------------------------------------------------

test('scoreSeasonTypes is regular-only before postseason games are scheduled', async () => {
  await seedSchedule();
  const { scoreSeasonTypes } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.deepEqual(scoreSeasonTypes, ['regular']);
});

test('scoreSeasonTypes includes postseason once the schedule carries bowls', async () => {
  await seedScheduleItems([
    {
      id: '101',
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
  ]);
  const { scoreSeasonTypes } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.deepEqual(scoreSeasonTypes, ['regular', 'postseason']);
});

test('scoreSeasonTypes falls back to regular when no schedule is cached', async () => {
  const { scoreSeasonTypes } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.deepEqual(scoreSeasonTypes, ['regular']);
});

// ---------------------------------------------------------------------------
// 4th-review finding #4 — odds freshness derives from the SELECTED SEASON's
// odds cache, never the global quota-observation timestamp.
// ---------------------------------------------------------------------------

const STALE_ODDS_FETCH = NOW - 5 * 24 * 60 * 60 * 1000; // > 2 days → stale
const FRESH_ODDS_FETCH = NOW - 60 * 1000; // 1 min → fresh

function seedOddsCache(season: number, key: string, lastFetch: number) {
  return setAppState('odds-cache', `${season}:${key}`, {
    data: [],
    lastFetch,
    usage: null,
  });
}

test('a stale selected-season odds cache raises a recency warning', async () => {
  await seedSchedule();
  await seedOddsCache(YEAR, 'default', STALE_ODDS_FETCH);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const oddsWarn = diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning');
  assert.ok(oddsWarn, 'the season-scoped cache entry drives the odds recency warning');
});

test('a recent selected-season odds cache raises no warning', async () => {
  await seedSchedule();
  await seedOddsCache(YEAR, 'default', FRESH_ODDS_FETCH);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning'),
    undefined,
    'a fresh season cache is not stale'
  );
});

test('no odds cache for the selected season → info "unknown", never a suppressed warning', async () => {
  await seedSchedule();
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const oddsInfo = diagnostics.find((d) => d.dataset === 'odds');
  assert.ok(oddsInfo, 'absence is reported');
  assert.equal(oddsInfo!.severity, 'info');
});

test("another season's fresh odds cache does not suppress this season's stale warning", async () => {
  await seedSchedule();
  await seedOddsCache(YEAR, 'default', STALE_ODDS_FETCH); // selected season: stale
  await seedOddsCache(YEAR - 1, 'default', FRESH_ODDS_FETCH); // other season: fresh
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning'),
    'cross-season freshness must not leak into the selected season'
  );
});

test('a fresh global quota timestamp does NOT make a stale season odds cache look fresh', async () => {
  await seedSchedule();
  await seedOddsCache(YEAR, 'default', STALE_ODDS_FETCH);
  // A recent quota observation (e.g. from a failed 402/429 or another season's
  // request). It must not affect this season's data-freshness verdict.
  await setLatestKnownOddsUsage({
    used: 10,
    remaining: 490,
    limit: 500,
    lastCost: 1,
    capturedAt: new Date(FRESH_ODDS_FETCH).toISOString(),
    source: 'odds-response-headers',
    sportKey: 'americanfootball_ncaaf',
    markets: ['h2h'],
    regions: ['us'],
    endpointType: 'odds',
    cacheStatus: 'hit',
  });
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning'),
    'quota freshness is decoupled from odds-data freshness'
  );
});
