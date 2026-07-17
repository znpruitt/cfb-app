import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../appStateStore.ts';
import { __resetOddsUsageStoreForTests, setLatestKnownOddsUsage } from '../oddsUsageStore.ts';
import {
  deriveCompletedSlates,
  deriveCompletedStatSlates,
  getProviderDataDiagnostics,
} from '../providerDataDiagnostics.ts';
import { createOddsCacheKey, defaultOddsCacheKey } from '../../../app/api/odds/routeInternals.ts';

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
  homeConference?: string;
  awayConference?: string;
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
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
    {
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Texas',
      awayTeam: 'Oklahoma',
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
        home: { team: 'Alabama', score: home },
        away: { team: 'Georgia', score: away },
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
    // Provider-present stat fields: coverage requires stat AUTHORITY, not just
    // identity — an identity-only row must not count as covered.
    home: { school: 'Alabama', raw: { totalYards: '350' } },
    away: { school: 'Georgia', raw: { totalYards: '280' } },
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
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
    {
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Texas',
      awayTeam: 'Oklahoma',
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
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
    {
      id: '103',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_IN_PROGRESS',
      homeTeam: 'Ohio State',
      awayTeam: 'Michigan',
    },
    {
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Texas',
      awayTeam: 'Oklahoma',
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
        home: { team: 'Alabama', score: 21 },
        away: { team: 'Georgia', score: 14 },
        time: null,
      },
      {
        id: '103',
        week: 1,
        seasonType: 'regular',
        startDate: COMPLETED_KICKOFF,
        status: 'STATUS_IN_PROGRESS',
        home: { team: 'Ohio State', score: 3 },
        away: { team: 'Michigan', score: 0 },
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
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
    {
      id: '104',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Ohio State',
      awayTeam: 'Michigan',
    },
    {
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Texas',
      awayTeam: 'Oklahoma',
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
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
    {
      id: '105',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'Canceled',
      homeTeam: 'Ohio State',
      awayTeam: 'Michigan',
    },
    {
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Texas',
      awayTeam: 'Oklahoma',
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

test('a completed slate whose every game is disrupted produces NO missing-stats warning (finding #3)', async () => {
  await seedScheduleItems([
    {
      id: '106',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'Canceled',
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
    {
      id: '107',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'Postponed',
      homeTeam: 'Ohio State',
      awayTeam: 'Michigan',
    },
    {
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Texas',
      awayTeam: 'Oklahoma',
    },
  ]);
  // No game-stats cached for the week, but every completed game is disrupted → no
  // stat-producing games are expected, so the slate is not applicable.
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'game-stats'),
    undefined,
    'a disrupted-only slate must never produce a permanent missing-stats warning'
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
      id: '701',
      week: 7,
      seasonType: 'regular',
      startDate: THURSDAY_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
    {
      id: '702',
      week: 7,
      seasonType: 'regular',
      startDate: SATURDAY_STILL_LIVE,
      status: 'STATUS_IN_PROGRESS',
      homeTeam: 'Texas',
      awayTeam: 'Oklahoma',
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
        id: '701',
        week: 7,
        seasonType: 'regular',
        startDate: THURSDAY_KICKOFF,
        status: 'STATUS_FINAL',
        homeTeam: 'Alabama',
        awayTeam: 'Georgia',
      },
      {
        id: '702',
        week: 7,
        seasonType: 'regular',
        startDate: SATURDAY_STILL_LIVE,
        status: 'STATUS_FINAL',
        homeTeam: 'Texas',
        awayTeam: 'Oklahoma',
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
      id: '901',
      week: 1,
      seasonType: 'postseason',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
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
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
    {
      id: '901',
      week: 1,
      seasonType: 'postseason',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Texas',
      awayTeam: 'Oklahoma',
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
// 5th-review finding #2 — odds freshness derives from the CANONICAL/DEFAULT
// season-scoped odds cache entry only — never the newest across filtered query
// variants, and never the global quota-observation timestamp.
// ---------------------------------------------------------------------------

const STALE_ODDS_FETCH = NOW - 5 * 24 * 60 * 60 * 1000; // > 2 days → stale
const FRESH_ODDS_FETCH = NOW - 60 * 1000; // 1 min → fresh

// The exact key the served UI's default (unfiltered) odds request writes.
function seedCanonicalOddsCache(season: number, lastFetch: number) {
  return setAppState('odds-cache', defaultOddsCacheKey(season), {
    data: [],
    lastFetch,
    usage: null,
  });
}

// A DIFFERENT key from a filtered markets/bookmakers request.
function seedFilteredOddsCache(season: number, lastFetch: number) {
  const key = `${season}:${createOddsCacheKey({
    bookmakers: ['draftkings'],
    markets: ['h2h'],
    regions: ['us'],
  })}`;
  return setAppState('odds-cache', key, { data: [], lastFetch, usage: null });
}

test('a stale canonical odds cache raises a recency warning', async () => {
  await seedSchedule();
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const oddsWarn = diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning');
  assert.ok(oddsWarn, 'the canonical cache entry drives the odds recency warning');
});

test('a recent canonical odds cache raises no warning', async () => {
  await seedSchedule();
  await seedCanonicalOddsCache(YEAR, FRESH_ODDS_FETCH);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning'),
    undefined,
    'a fresh canonical cache is not stale'
  );
});

test('no canonical odds cache → info "unknown", even when filtered entries exist (finding #2)', async () => {
  await seedSchedule();
  // Only a filtered entry exists — it must NOT be borrowed as canonical freshness.
  await seedFilteredOddsCache(YEAR, FRESH_ODDS_FETCH);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const oddsInfo = diagnostics.find((d) => d.dataset === 'odds');
  assert.ok(oddsInfo, 'absence of the canonical entry is reported');
  assert.equal(oddsInfo!.severity, 'info');
});

test('a recent FILTERED refresh does not make the stale canonical cache look fresh (finding #2)', async () => {
  await seedSchedule();
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH); // served/default: stale
  await seedFilteredOddsCache(YEAR, FRESH_ODDS_FETCH); // filtered variant: fresh
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning'),
    'a filtered refresh must not suppress the canonical staleness warning'
  );
});

test("another season's fresh canonical cache does not suppress this season's stale warning", async () => {
  await seedSchedule();
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH); // selected season: stale
  await seedCanonicalOddsCache(YEAR - 1, FRESH_ODDS_FETCH); // other season: fresh
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning'),
    'cross-season freshness must not leak into the selected season'
  );
});

test('a fresh global quota timestamp does NOT make a stale canonical odds cache look fresh', async () => {
  await seedSchedule();
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);
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

// ---------------------------------------------------------------------------
// 5th-review finding #6 — rankings coverage requires usable CONTENT, not just a
// cached record.
// ---------------------------------------------------------------------------

function seedRankings(at: number, weeks: unknown[]) {
  return setAppState('rankings', String(YEAR), { at, response: { weeks } });
}

test('a rankings record with weeks:[] does NOT count as coverage (finding #6)', async () => {
  await seedSchedule();
  await seedRankings(NOW, []); // record present but empty
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const rankingsInfo = diagnostics.find((d) => d.dataset === 'rankings');
  assert.ok(rankingsInfo, 'an empty rankings record is reported as unavailable');
  assert.equal(rankingsInfo!.severity, 'info');
  assert.match(rankingsInfo!.message, /no rankings/i);
});

test('a recent rankings record with usable weeks is healthy (no warning)', async () => {
  await seedSchedule();
  await seedRankings(NOW - 60_000, [{ week: 1, teams: [{ teamId: 'x' }] }]);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'rankings'),
    undefined,
    'fresh usable rankings produce no diagnostic'
  );
});

test('an old rankings record with usable weeks warns as stale during an active season', async () => {
  await seedSchedule();
  await seedRankings(NOW - 9 * 24 * 60 * 60 * 1000, [{ week: 1, teams: [{ teamId: 'x' }] }]);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'rankings' && d.severity === 'warning'),
    'usable-but-old rankings warn as stale'
  );
});

// ---------------------------------------------------------------------------
// Review remediation — one private grouped-cutoff core behind two named
// helpers: `deriveCompletedSlates` (ALL games — score diagnostics, so disrupted
// slates stay visible to missing-final checks) and `deriveCompletedStatSlates`
// (stat-producing games only — the cron imports this exact export, so game-stats
// recovery and its diagnostics section always see the same candidate set).
// ---------------------------------------------------------------------------

const SLATE_FIXTURE_HOUR = 60 * 60 * 1000;
const SLATE_FIXTURE_DAY = 24 * SLATE_FIXTURE_HOUR;
const slateIso = (msAgo: number) => new Date(NOW - msAgo).toISOString();
const SLATE_FIXTURE_ITEMS = [
  // Week 7: old Thursday final + a Saturday game only 2h old → NOT completed
  // for ANY consumer (whole-slate cutoff).
  {
    id: '701',
    week: 7,
    seasonType: 'regular',
    startDate: slateIso(2 * SLATE_FIXTURE_DAY),
    status: 'STATUS_FINAL',
  },
  {
    id: '702',
    week: 7,
    seasonType: 'regular',
    startDate: slateIso(2 * SLATE_FIXTURE_HOUR),
    status: 'STATUS_FINAL',
  },
  // Week 6: everything old → completed for every consumer.
  {
    id: '601',
    week: 6,
    seasonType: 'regular',
    startDate: slateIso(9 * SLATE_FIXTURE_DAY),
    status: 'STATUS_FINAL',
  },
  // Week 5: old final + a POSTPONED game rescheduled into the future — the
  // disrupted kickoff blocks the generic (scores) view until it resolves but
  // must not delay stat ingestion of the played games.
  {
    id: '501',
    week: 5,
    seasonType: 'regular',
    startDate: slateIso(16 * SLATE_FIXTURE_DAY),
    status: 'STATUS_FINAL',
  },
  {
    id: '502',
    week: 5,
    seasonType: 'regular',
    startDate: slateIso(-3 * SLATE_FIXTURE_DAY),
    status: 'Postponed',
  },
  // Week 4: disrupted-only with an old kickoff → completed for scores (its
  // unresolved status stays visible) but never a stat-producing candidate.
  {
    id: '401',
    week: 4,
    seasonType: 'regular',
    startDate: slateIso(23 * SLATE_FIXTURE_DAY),
    status: 'Postponed',
  },
];

test('deriveCompletedStatSlates: whole-slate cutoff over stat-producing games only', () => {
  assert.deepEqual(
    deriveCompletedStatSlates(SLATE_FIXTURE_ITEMS, NOW).map((s) => `${s.week}:${s.seasonType}`),
    ['6:regular', '5:regular'],
    'split slate excluded until whole-slate old; disrupted rows never complete, block, or create a stat slate'
  );
});

test('deriveCompletedSlates (scores view): disrupted slates stay visible', () => {
  assert.deepEqual(
    deriveCompletedSlates(SLATE_FIXTURE_ITEMS, NOW).map((s) => `${s.week}:${s.seasonType}`),
    ['6:regular', '4:regular'],
    'the disrupted-only week 4 remains a completed slate for score checks; week 5 waits for its rescheduled game; the split week 7 stays excluded'
  );
});

test('a postponed-only old slate still raises a scores diagnostic (not silently dropped)', async () => {
  await seedScheduleItems([
    {
      id: '401',
      week: 4,
      seasonType: 'regular',
      startDate: '2026-09-15T20:00:00.000Z', // long before NOW
      status: 'Postponed',
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
    {
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Texas',
      awayTeam: 'Oklahoma',
    },
  ]);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'scores'),
    'a postponed game is unresolved, not terminal — its slate must stay visible to score checks'
  );
  assert.equal(
    diagnostics.find((d) => d.dataset === 'game-stats'),
    undefined,
    'the same disrupted-only slate is never a game-stats expectation'
  );
});

// ---------------------------------------------------------------------------
// Review remediation — unverifiable schedule rows (no provider-addressable id)
// stay diagnostically VISIBLE without becoming ordinary missing stats or cron
// recovery candidates.
// ---------------------------------------------------------------------------

test('an unverifiable-only completed slate emits an explicit game-stats warning', async () => {
  await seedScheduleItems([
    {
      // mapCfbdScheduleGame fallback shape when CFBD omits game.id.
      id: '1-Alabama-Georgia',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
    {
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Texas',
      awayTeam: 'Oklahoma',
    },
  ]);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const unverifiable = diagnostics.find(
    (d) => d.dataset === 'game-stats' && /provider-addressable/i.test(d.message)
  );
  assert.ok(unverifiable, 'the unverifiable-only slate must not be silently skipped');
  assert.equal(unverifiable!.severity, 'warning');
  assert.equal(
    diagnostics.find((d) => d.dataset === 'game-stats' && /no cached game stats/i.test(d.message)),
    undefined,
    'unverifiable rows are not classified as ordinary missing game stats'
  );
});

test('a mixed slate reports BOTH missing valid ids and unverifiable rows', async () => {
  await seedScheduleItems([
    {
      id: '101',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
    {
      id: '1-Texas-Oklahoma',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Texas',
      awayTeam: 'Oklahoma',
    },
    {
      id: '103',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Ohio State',
      awayTeam: 'Michigan',
    },
  ]);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'game-stats' && /no cached game stats/i.test(d.message)),
    'the valid expected id is still reported as missing'
  );
  assert.ok(
    diagnostics.find((d) => d.dataset === 'game-stats' && /provider-addressable/i.test(d.message)),
    'the unverifiable row is reported distinctly'
  );
});

// ---------------------------------------------------------------------------
// Review remediation — diagnostics load the SAME canonical partition-fallback
// schedule views as cron recovery (`loadCachedScheduleItems`): `-all-all`, else
// the regular/postseason pair. A partition-only layout must not report "no
// schedule" while the cron actively recovers its slates.
// ---------------------------------------------------------------------------

function seedPartition(partition: 'regular' | 'postseason', items: ScheduleItemSeed[]) {
  return setAppState('schedule', `${YEAR}-all-${partition}`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items,
  });
}

const REGULAR_PARTITION_ITEMS: ScheduleItemSeed[] = [
  {
    id: '101',
    week: 1,
    seasonType: 'regular',
    startDate: COMPLETED_KICKOFF,
    status: 'STATUS_FINAL',
    homeTeam: 'Alabama',
    awayTeam: 'Georgia',
  },
  {
    id: '102',
    week: 2,
    seasonType: 'regular',
    startDate: FUTURE_KICKOFF,
    status: 'STATUS_SCHEDULED',
    homeTeam: 'Texas',
    awayTeam: 'Oklahoma',
  },
];

const POSTSEASON_PARTITION_ITEMS: ScheduleItemSeed[] = [
  {
    id: '901',
    week: 1,
    seasonType: 'postseason',
    startDate: COMPLETED_KICKOFF,
    status: 'STATUS_FINAL',
    homeTeam: 'Alabama',
    awayTeam: 'Georgia',
  },
];

test('a regular-only partition cache is fully visible to diagnostics', async () => {
  await seedPartition('regular', REGULAR_PARTITION_ITEMS);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'schedule' && d.severity === 'error'),
    undefined,
    'a partition-only layout is not "no schedule"'
  );
  assert.ok(
    diagnostics.find((d) => d.dataset === 'game-stats' && d.severity === 'warning'),
    'the completed slate the cron would recover is judged by diagnostics too'
  );
});

test('a postseason-only partition cache is fully visible to diagnostics', async () => {
  await seedPartition('postseason', POSTSEASON_PARTITION_ITEMS);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'schedule' && d.severity === 'error'),
    undefined
  );
  const gsWarning = diagnostics.find(
    (d) => d.dataset === 'game-stats' && /postseason/i.test(d.message)
  );
  assert.ok(gsWarning, 'the completed postseason slate is judged');
});

test('combined regular + postseason partitions are judged together', async () => {
  await seedPartition('regular', REGULAR_PARTITION_ITEMS);
  await seedPartition('postseason', POSTSEASON_PARTITION_ITEMS);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'schedule' && d.severity === 'error'),
    undefined
  );
  const gameStats = diagnostics.filter((d) => d.dataset === 'game-stats');
  assert.ok(
    gameStats.some((d) => /postseason|\(post\)/i.test(d.message)),
    'the postseason slate is reported'
  );
  assert.equal(
    gameStats.length >= 2,
    true,
    'the regular slate is reported alongside the postseason one'
  );
});

// ---------------------------------------------------------------------------
// Review remediation — stale-placeholder recovery lifecycle: a placeholder
// label on a MATURE dated game is stale schedule evidence, so the game stays
// expected (and reported) by its numeric provider id; the same lifecycle holds
// for partition-only cache layouts, using the same `now` as slate completion.
// ---------------------------------------------------------------------------

const STALE_PLACEHOLDER_ITEMS: ScheduleItemSeed[] = [
  {
    id: '911',
    week: 1,
    seasonType: 'postseason',
    startDate: COMPLETED_KICKOFF, // mature: days past the completion cutoff
    status: 'scheduled',
    homeTeam: 'Alabama',
    awayTeam: 'TBD',
  },
];

test('a mature numeric-id game with a stale placeholder label is reported missing (aggregate layout)', async () => {
  await seedScheduleItems(STALE_PLACEHOLDER_ITEMS);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'game-stats' && d.severity === 'warning'),
    'the played game is expected by its provider id despite the stale TBD label'
  );
});

test('the same stale-placeholder lifecycle holds for a partition-only cache layout', async () => {
  await seedPartition('postseason', STALE_PLACEHOLDER_ITEMS);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'game-stats' && d.severity === 'warning'),
    'aggregate and partition layouts share the same lifecycle behavior'
  );
});

test('a legacy identity-only cached row does not satisfy coverage (recovery-eligible)', async () => {
  await seedSchedule();
  await setAppState('game-stats', `${YEAR}:1:regular`, {
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    // Legacy pre-authority shape: valid id + schools, empty raw maps.
    games: [
      {
        providerGameId: 101,
        week: 1,
        seasonType: 'regular' as const,
        home: { school: 'Alabama', raw: {} },
        away: { school: 'Georgia', raw: {} },
      },
    ],
  });
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'game-stats'),
    'a zero-filled legacy row must not mark the week complete'
  );
});

// ---------------------------------------------------------------------------
// Review remediation — the missing-stats WARNING anchors on the newest
// completed stat slate whose expected set is nonempty: a newer no-expected
// slate (FCS-vs-FCS-only, unverifiable-only) must not absorb the "latest" slot
// and downgrade the newest applicable missing slate to backfill info.
// ---------------------------------------------------------------------------

test('a newer FCS-only slate does not downgrade the newest applicable missing slate', async () => {
  await seedScheduleItems([
    // Newest completed slate: positively classified FCS-vs-FCS only → expects nothing.
    {
      id: '201',
      week: 2,
      seasonType: 'regular',
      startDate: '2026-10-13T20:00:00.000Z', // newer than week 1, still > 6h old
      status: 'STATUS_FINAL',
      homeTeam: 'Montana',
      awayTeam: 'Montana State',
      homeConference: 'Big Sky',
      awayConference: 'Big Sky',
    },
    // Older applicable slate with a provider-addressable id and no stats.
    {
      id: '101',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
    {
      id: '102',
      week: 3,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Texas',
      awayTeam: 'Oklahoma',
    },
  ]);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const warning = diagnostics.find(
    (d) =>
      d.dataset === 'game-stats' &&
      d.severity === 'warning' &&
      /no cached game stats/i.test(d.message)
  );
  assert.ok(warning, 'the newest APPLICABLE missing slate keeps warning severity');
  assert.match(warning!.message, /week 1 regular/, 'the applicable slate is the anchor');
});

test('an unverifiable-only newer slate does not downgrade the applicable missing warning', async () => {
  await seedScheduleItems([
    {
      // Synthetic id → unverifiable, expects nothing.
      id: '2-Alabama-Georgia',
      week: 2,
      seasonType: 'regular',
      startDate: '2026-10-13T20:00:00.000Z',
      status: 'STATUS_FINAL',
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
    {
      id: '101',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Texas',
      awayTeam: 'Oklahoma',
    },
  ]);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find(
      (d) =>
        d.dataset === 'game-stats' &&
        d.severity === 'warning' &&
        /week 1 regular.*no cached game stats/i.test(d.message)
    ),
    'the applicable slate keeps its warning'
  );
  assert.ok(
    diagnostics.find((d) => d.dataset === 'game-stats' && /provider-addressable/i.test(d.message)),
    'the unverifiable slate stays separately visible'
  );
});
