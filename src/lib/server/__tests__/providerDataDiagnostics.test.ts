import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  getAppState,
  setAppState,
} from '../appStateStore.ts';
import { __resetOddsUsageStoreForTests, setLatestKnownOddsUsage } from '../oddsUsageStore.ts';
import {
  getProviderDataDiagnostics,
  unknownProviderDataExpectations,
} from '../providerDataDiagnostics.ts';
import { createOddsCacheKey, defaultOddsCacheKey } from '../../../app/api/odds/routeInternals.ts';
import { legacyRowFromWire, wireGame } from '../../gameStats/__tests__/fixtures.ts';
import { PROVIDER_DATASETS } from '../../providerDatasets.ts';

const YEAR = 2026;
const NOW = Date.parse('2026-10-15T12:00:00.000Z');
const COMPLETED_KICKOFF = '2026-10-11T20:00:00.000Z'; // 4 days before NOW (> 6h)
const FUTURE_KICKOFF = '2026-10-18T20:00:00.000Z'; // after NOW, keeps season "active"

type ScheduleItemSeed = {
  id: string;
  week: number;
  seasonType: 'regular' | 'postseason';
  startDate: string | null;
  status: string;
  homeTeam: string;
  awayTeam: string;
  startTimeTBD?: boolean;
};

/** Numeric CFBD participant ids derived from the seed's game id (home/away). */
function participantIds(id: string): { homeId: number; awayId: number } {
  const base = Number(id) * 10;
  return { homeId: base + 1, awayId: base + 2 };
}

function scheduleWireItems(items: ScheduleItemSeed[]) {
  return items.map((item) => ({
    ...item,
    neutralSite: false,
    conferenceGame: false,
    homeConference: 'SEC',
    awayConference: 'Big Ten',
    ...(Number.isFinite(Number(item.id)) ? participantIds(item.id) : {}),
  }));
}

function seedScheduleItems(
  items: ScheduleItemSeed[],
  // PLATFORM-090 round 3 — a schedule KNOWN to be missing a partition.
  partial: { partialFailure: boolean; failedSeasonTypes: string[] } = {
    partialFailure: false,
    failedSeasonTypes: [],
  }
) {
  return setAppState('schedule', `${YEAR}-all-all`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: partial.partialFailure,
    failedSeasonTypes: partial.failedSeasonTypes,
    // PLATFORM-086H3E3: diagnostics now judge coverage through the canonical
    // slate + evidence authorities, so seeds must be REAL canonical-build
    // inputs — FBS conferences (so games are tracked) and numeric participant
    // ids (so complete stored rows can participant-verify).
    items: scheduleWireItems(items),
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

/**
 * A COMPLETE, participant-verified legacy row for a seeded game id: built
 * through the real legacy writer path, with schoolIds matching the schedule
 * seed's derived participant ids — the shape the evidence authority classifies
 * `satisfied` (PLATFORM-086H3E3 coverage is evidence-based, not row-count).
 */
function satisfiedRow(id: number, home = 'Alpha', away = 'Beta') {
  const ids = participantIds(String(id));
  return legacyRowFromWire(
    wireGame({
      id,
      home: { school: home, teamId: ids.homeId },
      away: { school: away, teamId: ids.awayId },
    }),
    1
  );
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

test('PLATFORM-113: season-finality elapsed-time conclusions are visible with game identity', async () => {
  await seedScheduleItems([
    {
      id: '101',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
  ]);

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const elapsed = findByCode(diagnostics, 'scores-elapsed-time-conclusions');
  assert.ok(elapsed);
  assert.equal(elapsed!.severity, 'warning');
  assert.equal(elapsed!.repair, 'data-maintenance');
  assert.equal(elapsed!.affectedGameCount, 1);
  assert.match(elapsed!.message, /^Canonical score diagnostics found/);
  assert.doesNotMatch(elapsed!.message, /Season finality accepted/);
  assert.deepEqual(elapsed!.gameRefs, [
    {
      providerGameId: 101,
      week: 1,
      seasonType: 'regular',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
      kickoff: COMPLETED_KICKOFF,
      reason: 'elapsed-time-conclusion',
    },
  ]);
});

test('PLATFORM-113: child schedule caches still surface elapsed-time conclusions', async () => {
  await setAppState('schedule', `${YEAR}-all-regular`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items: scheduleWireItems([
      {
        id: '101',
        week: 1,
        seasonType: 'regular',
        startDate: COMPLETED_KICKOFF,
        status: 'STATUS_SCHEDULED',
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
      },
    ]),
  });

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const elapsed = findByCode(diagnostics, 'scores-elapsed-time-conclusions');
  assert.ok(elapsed, 'the supported child-cache shape must feed score diagnostics');
  assert.equal(elapsed!.affectedGameCount, 1);
  assert.equal(elapsed!.gameRefs?.[0]?.providerGameId, 101);
});

test('PLATFORM-113: a recent terminal sibling does not suppress an elapsed-time conclusion', async () => {
  await seedScheduleItems([
    {
      id: '101',
      week: 1,
      seasonType: 'regular',
      startDate: '2026-10-14T00:00:00.000Z',
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
    {
      id: '102',
      week: 1,
      seasonType: 'regular',
      startDate: '2026-10-15T09:30:00.000Z',
      status: 'STATUS_FINAL',
      homeTeam: 'Gamma',
      awayTeam: 'Delta',
    },
  ]);

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const elapsed = findByCode(diagnostics, 'scores-elapsed-time-conclusions');
  assert.ok(
    elapsed,
    'elapsed finality must not wait for the separate six-hour whole-slate threshold'
  );
  assert.equal(elapsed!.affectedGameCount, 1);
  assert.equal(elapsed!.gameRefs?.[0]?.providerGameId, 101);
  assert.equal(findByCode(diagnostics, 'scores-terminal-coverage-missing'), undefined);
  assert.equal(findByCode(diagnostics, 'scores-terminal-coverage-partial'), undefined);
});

test('PLATFORM-113: no elapsed conclusion is surfaced until every pending game clears the gate', async () => {
  await seedScheduleItems([
    {
      id: '101',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_SCHEDULED',
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

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(findByCode(diagnostics, 'scores-elapsed-time-conclusions'), undefined);
});

test('PLATFORM-113: a TBD kickoff is never converted into an elapsed-time conclusion', async () => {
  await seedScheduleItems([
    {
      id: '101',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      startTimeTBD: true,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
  ]);

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(findByCode(diagnostics, 'scores-elapsed-time-conclusions'), undefined);
});

test('PLATFORM-113: elapsed-time identities are bounded while the accepted count stays complete', async () => {
  await seedScheduleItems(
    Array.from({ length: 8 }, (_, index) => ({
      id: String(201 + index),
      week: 1,
      seasonType: 'regular' as const,
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: `Home ${index + 1}`,
      awayTeam: `Away ${index + 1}`,
    }))
  );

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const elapsed = findByCode(diagnostics, 'scores-elapsed-time-conclusions');
  assert.ok(elapsed);
  assert.equal(elapsed!.affectedGameCount, 8);
  assert.equal(elapsed!.gameRefs?.length, 6);
  assert.match(elapsed!.message, /\+2 more/);
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
    games: [satisfiedRow(101)],
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

test('a final row cannot hide an in-progress sibling in the same slate', async () => {
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
  const scoreIssue = diagnostics.find((d) => d.dataset === 'scores');
  assert.ok(scoreIssue, 'the in-progress sibling still owes its own final');
  assert.equal(scoreIssue!.code, 'scores-terminal-coverage-partial');
  assert.equal(scoreIssue!.affectedGameCount, 1);
  assert.deepEqual(
    scoreIssue!.gameRefs?.map((game) => game.providerGameId),
    [103]
  );
});

test('an unparseable-kickoff sibling stays pending and does not manufacture a score gap', async () => {
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
      startDate: null,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Echo',
      awayTeam: 'Foxtrot',
    },
  ]);
  await seedScores('STATUS_FINAL', 21, 14);

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'scores'),
    undefined,
    'canonical pending applicability means the undated sibling does not owe a final'
  );
});

test('game-level score-gap identities are bounded while the total remains truthful', async () => {
  await seedScheduleItems(
    Array.from({ length: 8 }, (_, index) => ({
      id: String(201 + index),
      week: 1,
      seasonType: 'regular' as const,
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: `Home ${index + 1}`,
      awayTeam: `Away ${index + 1}`,
    }))
  );

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const scoreIssue = diagnostics.find((d) => d.dataset === 'scores');
  assert.ok(scoreIssue);
  assert.equal(scoreIssue!.affectedGameCount, 8);
  assert.equal(scoreIssue!.gameRefs?.length, 6);
  assert.match(scoreIssue!.message, /\+2 more/);
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
  // Only one of the two expected week-1 games has SATISFIED evidence → partial, not missing.
  await setAppState('game-stats', `${YEAR}:1:regular`, {
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    games: [satisfiedRow(101)],
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
  // Only the played game (101) has SATISFIED evidence; the canceled game (105)
  // will never produce team stats, so this is FULL coverage, not partial.
  await setAppState('game-stats', `${YEAR}:1:regular`, {
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    games: [satisfiedRow(101)],
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
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
    {
      id: '107',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'Postponed',
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
  // Numeric ids: the canonical slate addresses games only by real CFBD ids —
  // unaddressable rows can never be covered OR flagged, by design.
  await seedScheduleItems([
    {
      id: '701',
      week: 7,
      seasonType: 'regular',
      startDate: THURSDAY_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
    {
      id: '702',
      week: 7,
      seasonType: 'regular',
      startDate: SATURDAY_STILL_LIVE,
      status: 'STATUS_FINAL',
      homeTeam: 'Gamma',
      awayTeam: 'Delta',
    },
  ]);

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

// ===========================================================================
// PLATFORM-086F2F — stable diagnostic codes + truthful repair surfaces.
// ===========================================================================

const F2F_CODES = new Set([
  'schedule-cache-missing',
  'schedule-refresh-partial',
  'schedule-cache-stale',
  'schedule-diagnostics-unavailable',
  'scores-terminal-coverage-missing',
  'scores-terminal-coverage-partial',
  'scores-elapsed-time-conclusions',
  'scores-diagnostics-unavailable',
  'game-stats-context-unavailable',
  'game-stats-latest-slate-missing',
  'game-stats-older-slate-missing',
  'game-stats-evidence-partial',
  'game-stats-duplicate-conflict',
  'game-stats-identity-mismatch',
  'game-stats-participant-validation-unavailable',
  'game-stats-record-unservable',
  'game-stats-diagnostics-unavailable',
  'rankings-cache-missing',
  'rankings-cache-stale',
  'rankings-diagnostics-unavailable',
  'odds-cache-missing',
  'odds-cache-stale',
  'odds-diagnostics-unavailable',
]);
const F2F_REPAIR_SURFACES = new Set(['data-maintenance', 'team-identity']);
// PLATFORM-086F2H4 removed `season-management` from
// `ProviderDiagnosticRepairSurface`. This allowlist is PERMISSIVE — leaving the
// retired member in it kept the suite green while quietly disabling the one
// thing this assertion exists for: catching a diagnostic that emits a surface
// the union no longer has.

function findByCode(
  diagnostics: Awaited<ReturnType<typeof getProviderDataDiagnostics>>['diagnostics'],
  code: string
) {
  return diagnostics.find((d) => d.code === code);
}

test('F2F: every emitted diagnostic carries a closed code + valid repair surface', async () => {
  // A broad scenario that trips several branches at once.
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
      id: '102',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Gamma',
      awayTeam: 'Delta',
    },
  ]);
  // No scores, no game-stats, no rankings, no odds cached → several diagnostics.
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(diagnostics.length > 0, 'expected diagnostics for the bare scenario');
  for (const d of diagnostics) {
    assert.ok(F2F_CODES.has(d.code), `unexpected code ${d.code}`);
    assert.ok(
      d.repair === null || F2F_REPAIR_SURFACES.has(d.repair),
      `unexpected repair ${String(d.repair)}`
    );
  }
});

test('F2F: missing schedule → schedule-cache-missing (error, data-maintenance)', async () => {
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const d = findByCode(diagnostics, 'schedule-cache-missing');
  assert.ok(d);
  assert.equal(d!.severity, 'error');
  assert.equal(d!.repair, 'data-maintenance');
});

test('F2F: partial schedule refresh → schedule-refresh-partial (data-maintenance)', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: true,
    failedSeasonTypes: ['postseason'],
    items: [
      {
        id: '101',
        week: 1,
        seasonType: 'regular',
        startDate: FUTURE_KICKOFF,
        status: 'STATUS_SCHEDULED',
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
        neutralSite: false,
        conferenceGame: false,
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        homeId: 1011,
        awayId: 1012,
      },
    ],
  });
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const d = findByCode(diagnostics, 'schedule-refresh-partial');
  assert.ok(d);
  assert.equal(d!.repair, 'data-maintenance');
});

test('F2F: stale schedule during active season → schedule-cache-stale', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: NOW - 9 * 24 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: '101',
        week: 1,
        seasonType: 'regular',
        startDate: FUTURE_KICKOFF,
        status: 'STATUS_SCHEDULED',
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
        neutralSite: false,
        conferenceGame: false,
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        homeId: 1011,
        awayId: 1012,
      },
    ],
  });
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const d = findByCode(diagnostics, 'schedule-cache-stale');
  assert.ok(d);
  assert.equal(d!.repair, 'data-maintenance');
});

test('F2F: no scores for completed slates → scores-terminal-coverage-missing', async () => {
  await seedSchedule();
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const d = findByCode(diagnostics, 'scores-terminal-coverage-missing');
  assert.ok(d);
  assert.equal(d!.severity, 'error');
  assert.equal(d!.repair, 'data-maintenance');
});

test('F2F: completed slate without game-stats → game-stats-latest-slate-missing', async () => {
  await seedSchedule();
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const d = findByCode(diagnostics, 'game-stats-latest-slate-missing');
  assert.ok(d);
  assert.equal(d!.repair, 'data-maintenance');
});

test('F2F: game-stat identity mismatch → game-stats-identity-mismatch (team-identity), never duplicate-conflict', async () => {
  await seedSchedule();
  await setAppState('game-stats', `${YEAR}:1:regular`, {
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    // Stored home participant id (999999) is known but disagrees with the schedule's
    // numeric id (1011) → a fail-closed identity mismatch (PLATFORM-086H3C5).
    games: [
      legacyRowFromWire(
        wireGame({
          id: 101,
          home: { school: 'Alpha', teamId: 999_999 },
          away: { school: 'Beta', teamId: 1012 },
        }),
        1
      ),
    ],
  });
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const mismatch = findByCode(diagnostics, 'game-stats-identity-mismatch');
  assert.ok(mismatch, 'identity mismatch is surfaced under its own code');
  assert.equal(mismatch!.severity, 'warning');
  assert.equal(mismatch!.repair, 'team-identity');
  assert.equal(findByCode(diagnostics, 'game-stats-duplicate-conflict'), undefined);
  // An identity-only slate (no genuinely refresh-repairable absence) must NOT also
  // emit the generic Data-Maintenance "missing" diagnostic (r4 finding).
  assert.equal(findByCode(diagnostics, 'game-stats-latest-slate-missing'), undefined);
  assert.equal(findByCode(diagnostics, 'game-stats-older-slate-missing'), undefined);
});

test('F2F: rankings absent → rankings-cache-missing (info, data-maintenance)', async () => {
  await seedSchedule();
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const d = findByCode(diagnostics, 'rankings-cache-missing');
  assert.ok(d);
  assert.equal(d!.severity, 'info');
  assert.equal(d!.repair, 'data-maintenance');
});

test('F2F: stale rankings → rankings-cache-stale (warning, data-maintenance)', async () => {
  await seedSchedule();
  await seedRankings(NOW - 9 * 24 * 60 * 60 * 1000, [{ week: 1, teams: [{ teamId: 'x' }] }]);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const d = findByCode(diagnostics, 'rankings-cache-stale');
  assert.ok(d);
  assert.equal(d!.repair, 'data-maintenance');
});

test('PLATFORM-118: records becomes stale after 12 hours even with no finalisation context', async () => {
  const item = {
    year: YEAR,
    teamId: 333,
    team: 'Alabama',
    classification: 'fbs',
    conference: 'SEC',
    total: { games: 2, wins: 2, losses: 0, ties: 0 },
  };
  const twelveHours = 12 * 60 * 60 * 1000;

  await setAppState('team-records', String(YEAR), {
    at: NOW - twelveHours,
    year: YEAR,
    items: [item],
  });
  const boundary = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(findByCode(boundary.diagnostics, 'records-cache-stale'), undefined);

  await setAppState('team-records', String(YEAR), {
    at: NOW - twelveHours - 1,
    year: YEAR,
    items: [item],
  });
  const stale = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const diagnostic = findByCode(stale.diagnostics, 'records-cache-stale');
  assert.ok(
    diagnostic,
    'the production diagnostics path enforces the records 12-hour ceiling without a final'
  );
  assert.equal(diagnostic!.severity, 'warning');
  assert.equal(
    diagnostic!.repair,
    null,
    'records remain cache-only with no manual repair consumer'
  );
  assert.match(diagnostic!.message, /older than the 12-hour policy/);
});

test('F2F: odds snapshot absent → odds-cache-missing (info); stale canonical → odds-cache-stale (2d boundary)', async () => {
  await seedSchedule();
  const absent = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const missing = findByCode(absent.diagnostics, 'odds-cache-missing');
  assert.ok(missing);
  assert.equal(missing!.severity, 'info');

  // 2-day staleness boundary: a >2d-old canonical snapshot warns.
  await seedCanonicalOddsCache(YEAR, NOW - 3 * 24 * 60 * 60 * 1000);
  const stale = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const staleOdds = findByCode(stale.diagnostics, 'odds-cache-stale');
  assert.ok(staleOdds);
  assert.equal(staleOdds!.repair, 'data-maintenance');
});

test('F2F: scores/game-stats remain evidence-based, not age-based (final score covers the slate)', async () => {
  await seedSchedule();
  await seedScores('STATUS_FINAL', 21, 14);
  await setAppState('game-stats', `${YEAR}:1:regular`, {
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    games: [satisfiedRow(101)],
  });
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  // A recent, fully-covered slate yields NO scores/game-stats codes (evidence, not age).
  assert.equal(findByCode(diagnostics, 'scores-terminal-coverage-missing'), undefined);
  assert.equal(findByCode(diagnostics, 'scores-terminal-coverage-partial'), undefined);
  assert.equal(findByCode(diagnostics, 'game-stats-latest-slate-missing'), undefined);
});

test('F2F: a refresh-repairable partial (some absent) → evidence-partial with data-maintenance repair', async () => {
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
  // One of two expected week-1 games verified; the other is absent (current season →
  // refresh-repairable) → partial WITH a Data Maintenance repair.
  await setAppState('game-stats', `${YEAR}:1:regular`, {
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    games: [satisfiedRow(101)],
  });
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const partial = findByCode(diagnostics, 'game-stats-evidence-partial');
  assert.ok(partial);
  assert.equal(partial!.repair, 'data-maintenance');
});

test('F2F: a historical manual-only partial → evidence-partial with NULL repair (accepted limitation)', async () => {
  const HIST = 2024;
  const HIST_KICK = '2024-10-11T20:00:00.000Z'; // long before NOW (2026) → completed & historical
  await setAppState('schedule', `${HIST}-all-all`, {
    at: NOW,
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: '201',
        week: 1,
        seasonType: 'regular',
        startDate: HIST_KICK,
        status: 'STATUS_FINAL',
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
        neutralSite: false,
        conferenceGame: false,
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        homeId: 2011,
        awayId: 2012,
      },
    ],
  });
  // A legacy-malformed (defective) row whose participants MATCH the schedule ids →
  // for a HISTORICAL season this is the terminal `manual-only` state, an accepted
  // upstream limitation with no repair path.
  await setAppState('game-stats', `${HIST}:1:regular`, {
    year: HIST,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    games: [
      legacyRowFromWire(
        wireGame({
          id: 201,
          home: { school: 'Alpha', teamId: 2011, statOverrides: { totalYards: 'not-a-number' } },
          away: { school: 'Beta', teamId: 2012 },
        }),
        1
      ),
    ],
  });
  const { diagnostics } = await getProviderDataDiagnostics(HIST, { now: NOW });
  const partial = findByCode(diagnostics, 'game-stats-evidence-partial');
  assert.ok(partial, 'historical manual-only surfaces as a partial');
  assert.equal(partial!.repair, null);
});

// ---------------------------------------------------------------------------
// PLATFORM-089 — the Odds diagnostic agrees with the polling authority about
// WHETHER THERE IS ANYTHING TO POLL, and judges freshness from the served entry.
//
// Production on 2026-08-09 had System Health reporting `odds-cache-stale` while
// the Odds cron reported `no-eligible-target` on every delivery: two surfaces
// disagreeing about whether an operator could do anything. Applicability is now
// the 45-day polling horizon. Freshness deliberately stays on the cache entry —
// see the block comment in the source for why the refresh-control clock was
// tried and rejected.
// ---------------------------------------------------------------------------

/** A refresh-control record for the canonical season-scoped key. */
function seedOddsRefreshControl(season: number, lastCompletedCheckAt: string | null) {
  return setAppState('odds-refresh-control', defaultOddsCacheKey(season), {
    lease: null,
    lastCompletedCheckAt,
    automaticFailureCount: 0,
    automaticNotBefore: null,
  });
}

/** A schedule whose only future game is `daysOut` away (plus one completed game). */
function seedScheduleWithFutureGame(daysOut: number, status = 'STATUS_SCHEDULED') {
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
      startDate: new Date(NOW + daysOut * 24 * 60 * 60 * 1000).toISOString(),
      status,
      homeTeam: 'Gamma',
      awayTeam: 'Delta',
    },
  ]);
}

// REGRESSION TEST — a recent completed CHECK must NOT clear a stale SERVED
// snapshot.
//
// This pass briefly counted `lastCompletedCheckAt` as freshness, reasoning that a
// valid no-op proves the data is being maintained. It does not. The no-op branch
// that leaves the entry untouched is the one retaining prior rows it cannot prove
// obsolete — and `/api/odds` keeps serving exactly those rows. Counting the check
// clock there cleared the warning permanently, one fresh no-op per day, while the
// stale lines stayed on screen. Binding invariant 1 says the same thing: odds
// staleness derives from the canonical `odds-cache` entry.
test('PLATFORM-089: a recent completed check does NOT clear a stale served snapshot', async () => {
  await seedSchedule();
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);
  await seedOddsRefreshControl(YEAR, new Date(NOW - 60 * 1000).toISOString());

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const warn = diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning');
  assert.ok(warn, 'the served snapshot is what is stale, whatever the check clock says');
  assert.equal(warn!.code, 'odds-cache-stale');
});

test('PLATFORM-089: a stale snapshot inside the horizon still warns', async () => {
  await seedSchedule();
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const warn = diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning');
  assert.ok(warn, 'an old snapshot with a live polling target is actionable');
  assert.equal(warn!.code, 'odds-cache-stale');
});

test('PLATFORM-089: no future game inside 45 days ⇒ an old snapshot is not reported stale', async () => {
  // `isSeasonActive` is SYMMETRIC (±45 days), so a game 40 days in the PAST used
  // to keep an old snapshot "actionable" when the cron had nothing to poll and no
  // operator action existed. Applicability now matches the polling horizon.
  await seedScheduleItems([
    {
      id: '101',
      week: 1,
      seasonType: 'regular',
      startDate: new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'STATUS_FINAL',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
  ]);
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning'),
    undefined,
    'nothing to poll ⇒ nothing to act on'
  );
});

test('PLATFORM-089: the diagnostic horizon matches the polling horizon at both edges', async () => {
  // 46 days out: outside the horizon, no warning.
  await seedScheduleWithFutureGame(46);
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);
  let result = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    result.diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning'),
    undefined,
    '46 days out is not a polling target'
  );

  // 44 days out: inside the horizon, the warning returns.
  await seedScheduleWithFutureGame(44);
  result = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    result.diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning'),
    '44 days out IS a polling target, so staleness is actionable again'
  );
});

test('PLATFORM-089: a disrupted future game is not a polling target for the diagnostic', async () => {
  // Parity with `collectEligibleOddsGames`, which excludes disrupted games: a
  // canceled game must not be the sole reason health asks for a refresh.
  await seedScheduleWithFutureGame(10, 'STATUS_CANCELED');
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning'),
    undefined,
    'a canceled game is not something to fetch odds for'
  );
});

// REGRESSION TEST — the horizon check reads the SAME schedule keys the cron does.
//
// `${year}-all-all` is only the first of three: the shared loader falls back to
// the `-all-regular` + `-all-postseason` pair. Checking only the first meant that
// on the split shape the diagnostic saw no pollable target and could never warn,
// while the cron polled normally — the exact health-vs-cron disagreement this
// change exists to remove, reintroduced by the fix for it.
test('PLATFORM-089: a split regular/postseason schedule is still a pollable target', async () => {
  await setAppState('schedule', `${YEAR}-all-regular`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: '201',
        week: 2,
        seasonType: 'regular',
        startDate: new Date(NOW + 10 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'STATUS_SCHEDULED',
        homeTeam: 'Gamma',
        awayTeam: 'Delta',
        neutralSite: false,
        conferenceGame: false,
        homeConference: 'SEC',
        awayConference: 'Big Ten',
      },
    ],
  });
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'odds' && d.code === 'odds-cache-stale'),
    'the cron would poll this shape, so health must be able to say it is stale'
  );
});

test('PLATFORM-089: the odds diagnostic ages from the OBSERVATION clock, the older of the two', async () => {
  // Every writer captures `observedAt` BEFORE the request and stamps `lastFetch`
  // at commit, so `observedAt <= lastFetch` always. The previous version of this
  // test seeded the opposite — a fresh observation under a stale commit — which
  // no writer can produce, so it asserted a state the system cannot reach and
  // left the only reachable direction unpinned.
  //
  // Reachable direction: a commit that looks fresh over an observation that is
  // genuinely old must age from the OBSERVATION, matching the polling policy.
  await seedSchedule();
  await setAppState('odds-cache', defaultOddsCacheKey(YEAR), {
    data: [],
    lastFetch: NOW - 60 * 1000, // commit clock: one minute ago
    usage: null,
    observedAt: new Date(STALE_ODDS_FETCH).toISOString(), // observed 5 days ago
  });
  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  const warn = diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning');
  assert.ok(warn, 'a recent commit must not disguise a five-day-old observation');
  assert.equal(warn!.code, 'odds-cache-stale');
});

test('PLATFORM-089: the odds diagnostic makes no provider request', async () => {
  // System Health must never spend quota to determine status. Any outbound fetch
  // from this read is the defect.
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    throw new Error(`diagnostics must not fetch (${String(input)})`);
  }) as typeof fetch;
  try {
    await seedSchedule();
    await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);
    await getProviderDataDiagnostics(YEAR, { now: NOW });
    // POSITIVE CONTROL — prove the counter can SEE a request before asserting
    // there were none. Without this the assertion below passes just as happily
    // against a stub nothing could ever reach.
    assert.equal(calls, 0, 'determining status must not spend quota');
    await globalThis
      .fetch('https://example.com/probe')
      .then(() => undefined)
      .catch(() => undefined);
    assert.equal(calls, 1, 'the observer registers a real request');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-089 follow-up — the ONE case where an unmoving entry is not neglect.
//
// After `no-op / early-lines-withdrawn` the cache entry cannot advance: the
// provider has nothing, and the prior rows are retained by policy. Warning daily
// about that is the standing false alarm this campaign removes, relocated to the
// staleness channel. Suppression is keyed on the REASON, so the sibling no-op
// (`empty-response` over rows that could not be proven obsolete) still warns —
// there the served data really is unverified.
// ---------------------------------------------------------------------------

function oddsReceipt(overrides: {
  reason: string;
  result?: string;
  year?: number;
  completedAt?: number;
  job?: string;
}) {
  const completedAt = overrides.completedAt ?? NOW - 60 * 1000;
  return setAppState('scheduler-execution-status', overrides.job ?? 'odds', {
    version: 1,
    job: overrides.job ?? 'odds',
    source: 'qstash',
    invocationId: 'inv-1',
    startedAt: new Date(completedAt - 1000).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs: 1000,
    result: overrides.result ?? 'no-op',
    reason: overrides.reason,
    providerCallAttempted: true,
    target: {
      kind: 'odds',
      year: overrides.year ?? YEAR,
      cadence: 'early',
      eligibleGames: 1,
    },
  });
}

test('PLATFORM-089: a recent withdrawn-lines confirmation suppresses the stale warning', async () => {
  await seedSchedule();
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);
  await oddsReceipt({ reason: 'early-lines-withdrawn' });

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    diagnostics.find((d) => d.dataset === 'odds' && d.severity === 'warning'),
    undefined,
    'the provider was asked and has nothing — the entry cannot advance and nobody can act'
  );
});

// REGRESSION TEST — the sibling no-op must STILL warn.
//
// `empty-response` over prior rows that could not be proven obsolete also leaves
// the entry untouched, but there the served rows are unverified, not confirmed
// absent. Suppressing on "a check completed" rather than on the REASON would
// clear that warning permanently too — the exact hole the first review found.
test('PLATFORM-089: an ordinary empty-response no-op does NOT suppress the stale warning', async () => {
  await seedSchedule();
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);
  await oddsReceipt({ reason: 'empty-response' });

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'odds' && d.code === 'odds-cache-stale'),
    'only a confirmed withdrawal suppresses; any other completed check does not'
  );
});

test('PLATFORM-089: the withdrawn-lines confirmation EXPIRES on the staleness clock', async () => {
  await seedSchedule();
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);
  // Confirmed three days ago: older than a snapshot is allowed to be, so it no
  // longer describes now — if the loop had kept running there would be a newer
  // receipt, and its absence is itself the signal.
  await oddsReceipt({
    reason: 'early-lines-withdrawn',
    completedAt: NOW - 3 * 24 * 60 * 60 * 1000,
  });

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'odds' && d.code === 'odds-cache-stale'),
    'a stale confirmation cannot vouch for the present'
  );
});

test('PLATFORM-089: a withdrawn-lines confirmation for ANOTHER year does not suppress', async () => {
  await seedSchedule();
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);
  await oddsReceipt({ reason: 'early-lines-withdrawn', year: YEAR - 1 });

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'odds' && d.code === 'odds-cache-stale'),
    'cross-season evidence must not leak into the selected season'
  );
});

test('PLATFORM-089: a corrupt receipt fails closed to the entry-based rule', async () => {
  await seedSchedule();
  await seedCanonicalOddsCache(YEAR, STALE_ODDS_FETCH);
  // Wrong `source` for the job — the validating reader rebuilds and rejects it.
  await setAppState('scheduler-execution-status', 'odds', {
    version: 1,
    job: 'odds',
    source: 'vercel-cron',
    invocationId: 'inv-2',
    startedAt: new Date(NOW - 61 * 1000).toISOString(),
    completedAt: new Date(NOW - 60 * 1000).toISOString(),
    durationMs: 1000,
    result: 'no-op',
    reason: 'early-lines-withdrawn',
    providerCallAttempted: true,
    target: { kind: 'odds', year: YEAR, cadence: 'early', eligibleGames: 1 },
  });

  const { diagnostics } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.dataset === 'odds' && d.code === 'odds-cache-stale'),
    'an unparseable receipt proves nothing; the ordinary rule applies'
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-090 — the published game-stats EXPECTATION.
//
// The diagnostics already decide whether evidence should exist (that is what
// gates every missing-evidence branch above); before this task that decision was
// never published, so System Health could not tell an expected preseason absence
// from a real gap and rendered a permanent yellow "No cached data". These pin
// the decision to the SAME canonical inputs the diagnostics use — never the
// calendar, a cache age, or a kickoff-proximity guess.
// ---------------------------------------------------------------------------

test('PLATFORM-090: a schedule of only FUTURE games expects no game stats yet', async () => {
  await seedScheduleItems([
    {
      id: '201',
      week: 1,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
  ]);
  const { diagnostics, expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(expectations['game-stats'], 'not-yet-expected');
  assert.equal(
    diagnostics.find((d) => d.dataset === 'game-stats'),
    undefined,
    'a scheduled-only season must not produce a game-stats diagnostic'
  );
});

// The genuine "slate underway" case the task requires to stay neutral: every
// game kicked off within the last 6h, so the canonical authority owes evidence
// for none of them yet.
test('PLATFORM-090: a slate whose games ALL kicked off <6h ago expects no game stats yet', async () => {
  const justKicked = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
  await seedScheduleItems([
    {
      id: '801',
      week: 7,
      seasonType: 'regular',
      startDate: justKicked,
      status: 'STATUS_IN_PROGRESS',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
    {
      id: '802',
      week: 7,
      seasonType: 'regular',
      startDate: justKicked,
      status: 'STATUS_IN_PROGRESS',
      homeTeam: 'Gamma',
      awayTeam: 'Delta',
    },
  ]);
  const { diagnostics, expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(expectations['game-stats'], 'not-yet-expected');
  assert.equal(
    diagnostics.find((d) => d.dataset === 'game-stats'),
    undefined
  );
});

// REGRESSION TEST (review round 4) — the OTHER half of the same slate. Rounds 1-3
// derived expectation from whole-slate completion, so a Thursday opener played
// SIX DAYS ago still reported "None expected" while the cron was polling it,
// simply because the Saturday games had not finished. Per-game applicability —
// the same authority the cron and coverage use — gets this right.
test('PLATFORM-090: a game played 6h+ ago expects stats even mid-slate', async () => {
  await seedScheduleItems([
    {
      id: '803',
      week: 7,
      seasonType: 'regular',
      startDate: THURSDAY_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
    {
      id: '804',
      week: 7,
      seasonType: 'regular',
      startDate: SATURDAY_STILL_LIVE,
      status: 'STATUS_IN_PROGRESS',
      homeTeam: 'Gamma',
      awayTeam: 'Delta',
    },
  ]);
  const { diagnostics, expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    expectations['game-stats'],
    'expected',
    'a game finished days ago is owed evidence; "None expected" would be false'
  );
  // The DIAGNOSTIC threshold is unchanged: still silent mid-slate, so this
  // changes only the published expectation, never warning noise.
  assert.equal(
    diagnostics.find((d) => d.dataset === 'game-stats'),
    undefined,
    'the whole-slate completion threshold still governs diagnostic silence'
  );
});

test('PLATFORM-090: a completed stat-producing slate with no evidence expects game stats', async () => {
  await seedSchedule();
  const { diagnostics, expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(expectations['game-stats'], 'expected');
  // The existing actionable warning is preserved, unweakened.
  const missing = diagnostics.find((d) => d.code === 'game-stats-latest-slate-missing');
  assert.ok(missing, 'a genuinely missing completed slate must still warn');
  assert.equal(missing!.severity, 'warning');
});

test('PLATFORM-090: a completed slate WITH full evidence still expects game stats', async () => {
  await seedSchedule();
  await setAppState('game-stats', `${YEAR}:1:regular`, {
    year: YEAR,
    week: 1,
    seasonType: 'regular',
    fetchedAt: new Date(NOW).toISOString(),
    games: [satisfiedRow(101)],
  });
  const { expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  // Expectation is about whether evidence SHOULD exist, not whether it does.
  assert.equal(expectations['game-stats'], 'expected');
});

test('PLATFORM-090: a completed slate whose every game is disrupted expects nothing', async () => {
  await seedScheduleItems([
    {
      id: '204',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'Canceled',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
    {
      id: '205',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'Postponed',
      homeTeam: 'Echo',
      awayTeam: 'Foxtrot',
    },
  ]);
  const { diagnostics, expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(expectations['game-stats'], 'not-yet-expected');
  assert.equal(
    diagnostics.find((d) => d.dataset === 'game-stats'),
    undefined
  );
});

test('PLATFORM-090: no cached schedule → expectation UNKNOWN, never expected absence', async () => {
  const { expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    expectations['game-stats'],
    'unknown',
    'the schedule is the source of truth; an absent one proves nothing about expectation'
  );
});

// Re-derived (round 4): the expectation comes from the SLATE, so a malformed
// stored record cannot influence it — it raises its own warning, which outranks
// the absent-cache branch in the freshness stoplight regardless.
test('PLATFORM-090: an unservable stored record leaves the expectation slate-derived', async () => {
  await seedSchedule();
  await setAppState('game-stats', `${YEAR}:1:regular`, { year: YEAR, games: 'not-an-array' });
  const { diagnostics, expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    expectations['game-stats'],
    'expected',
    'the completed slate owes evidence whatever the stored record looks like'
  );
  assert.ok(
    diagnostics.find((d) => d.code === 'game-stats-record-unservable'),
    'a malformed record must keep warning'
  );
});

test('PLATFORM-090: every non-game-stats dataset keeps an unconditional expectation', async () => {
  await seedScheduleItems([
    {
      id: '206',
      week: 1,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
  ]);
  const { expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  for (const [dataset, expectation] of Object.entries(expectations)) {
    if (dataset === 'game-stats') continue;
    assert.equal(expectation, 'expected', `${dataset} must keep its existing absence semantics`);
  }
});

// The fallback map's OWN contract, tested directly — the freshness-level test
// that names it cannot discriminate it (review finding).
test('PLATFORM-090: unknownProviderDataExpectations is all-unknown for every dataset', () => {
  const expectations = unknownProviderDataExpectations();
  assert.deepEqual(Object.keys(expectations).sort(), [...PROVIDER_DATASETS].sort());
  for (const dataset of PROVIDER_DATASETS) {
    assert.equal(expectations[dataset], 'unknown', `${dataset} must not assert an expectation`);
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-090 second review round — the expectation must fail closed on every
// input it cannot corroborate. `not-yet-expected` is a POSITIVE claim; anything
// that could be hiding a played slate has to resolve `unknown` instead.
// ---------------------------------------------------------------------------

// REGRESSION TEST (review finding 1) — a completed slate whose raw rows were all
// DROPPED by the canonical build (here: unaddressable non-decimal ids, the same
// mechanism an `invalid_row` / `out_of_scope_postseason` classification uses)
// yields `coverage.games.length === 0`. Round one read that zero as "nothing is
// expected" and rendered a healthy gray row while a whole slate's stats were
// genuinely missing and no diagnostic fired.
test('PLATFORM-090: a completed slate whose canonical rows were all dropped is UNKNOWN', async () => {
  await seedScheduleItems([
    {
      id: 'not-a-decimal-id',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
  ]);
  const { expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    expectations['game-stats'],
    'unknown',
    'a dropped-row artifact must never read as a healthy lifecycle state'
  );
});

// The benign twin of the test above: the game is PRESENT in the canonical slate
// and disrupted, so the authority positively says no evidence is owed. This is
// what proves the empty-slate rule discriminates rather than failing every
// zero-expected season.
test('PLATFORM-090: a disrupted-only completed slate stays NOT-YET-EXPECTED', async () => {
  await seedScheduleItems([
    {
      id: '301',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'Canceled',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
  ]);
  const { expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(expectations['game-stats'], 'not-yet-expected');
});

// REGRESSION TEST (review finding 3) — a row whose kickoff cannot be read is
// skipped by `deriveCompletedSlates`, so it can never PROVE a slate complete,
// but it equally cannot be proven incomplete. Round one concluded
// `not-yet-expected` from the resulting empty slate list.
test('PLATFORM-090: an unreadable kickoff blocks the not-yet-expected conclusion', async () => {
  await seedScheduleItems([
    {
      id: '302',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Gamma',
      awayTeam: 'Delta',
    },
    {
      id: '303',
      week: 1,
      seasonType: 'regular',
      startDate: 'not-a-parseable-date',
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
  ]);
  const { expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    expectations['game-stats'],
    'unknown',
    'an unreadable kickoff could be hiding a played slate'
  );
});

// POSITIVE CONTROL for the test above — the identical schedule with a READABLE
// future kickoff does reach `not-yet-expected`, so the assertion is discriminating
// the unreadable date and not some unrelated property of the fixture.
test('PLATFORM-090: the same schedule with readable kickoffs reaches not-yet-expected', async () => {
  await seedScheduleItems([
    {
      id: '302',
      week: 2,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Gamma',
      awayTeam: 'Delta',
    },
    {
      id: '303',
      week: 1,
      seasonType: 'regular',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
  ]);
  const { expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(expectations['game-stats'], 'not-yet-expected');
});

// An unreadable canonical context. Duplicate CFBD ids make the canonical build
// throw, so the slate loads `unavailable`. Round 4 made this structural rather
// than incidental: `deriveGameStatsExpectation` takes the slate result as its
// first input and returns `unknown` for an unavailable one, so there is no
// longer an assignment that could be reordered away (rounds 2-3 needed an
// explicit assignment precisely because the value came from elsewhere).
test('PLATFORM-090: an unavailable canonical context is UNKNOWN, with its warning intact', async () => {
  await seedScheduleItems([
    {
      id: '401',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
    {
      id: '401',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Echo',
      awayTeam: 'Foxtrot',
    },
  ]);
  const { diagnostics, expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.ok(
    diagnostics.find((d) => d.code === 'game-stats-context-unavailable'),
    'positive control: this fixture really does make the canonical context unavailable'
  );
  assert.ok(
    diagnostics.find((d) => d.code === 'scores-diagnostics-unavailable'),
    'score coverage fails closed when the shared canonical context is unavailable'
  );
  assert.equal(expectations['game-stats'], 'unknown');
});

// ---------------------------------------------------------------------------
// PLATFORM-090 round three — both confirming reviewers found the same class of
// residual hole: `not-yet-expected` could still be concluded from schedule
// evidence that was incomplete rather than genuinely empty.
// ---------------------------------------------------------------------------

// REGRESSION TEST — a cached schedule KNOWN to be missing a partition. The rows
// present are all future games, so rounds one and two concluded the positive
// claim `not-yet-expected`; the absent partition could hold a completed
// stat-producing slate.
test('PLATFORM-090: a partial schedule blocks the not-yet-expected conclusion', async () => {
  await seedScheduleItems(
    [
      {
        id: '501',
        week: 1,
        seasonType: 'postseason',
        startDate: FUTURE_KICKOFF,
        status: 'STATUS_SCHEDULED',
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
      },
    ],
    { partialFailure: true, failedSeasonTypes: ['regular'] }
  );
  const { expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    expectations['game-stats'],
    'unknown',
    'the missing partition could contain a completed slate'
  );
});

// POSITIVE CONTROL — the identical schedule committed COMPLETE does reach the
// neutral state, so the assertion above discriminates the partial flag itself.
test('PLATFORM-090: the same schedule committed complete reaches not-yet-expected', async () => {
  await seedScheduleItems([
    {
      id: '501',
      week: 1,
      seasonType: 'postseason',
      startDate: FUTURE_KICKOFF,
      status: 'STATUS_SCHEDULED',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
  ]);
  const { expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(expectations['game-stats'], 'not-yet-expected');
});

// Re-derived (round 4). Rounds 2-3 treated a dropped raw row as possible missing
// evidence and forced `unknown`. It is not: a row the canonical build drops is
// outside the system entirely — never polled, never counted by coverage, never
// warned about, and unrepairable by any refresh, because it carries no
// addressable CFBD id. Reporting `unknown` there produced a permanent
// unactionable yellow, the exact defect this task exists to remove. The
// total-drift case (every row dropped) is still caught, by the empty-slate rule.
test('PLATFORM-090: an unaddressable dropped row does not manufacture an expectation', async () => {
  await seedScheduleItems([
    {
      id: '502',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'Canceled',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
    },
    {
      id: 'dropped-non-decimal-id',
      week: 1,
      seasonType: 'regular',
      startDate: COMPLETED_KICKOFF,
      status: 'STATUS_FINAL',
      homeTeam: 'Echo',
      awayTeam: 'Foxtrot',
    },
  ]);
  const { diagnostics, expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(expectations['game-stats'], 'not-yet-expected');
  assert.equal(
    diagnostics.find((d) => d.dataset === 'game-stats'),
    undefined,
    'nothing in the system owes evidence for an unaddressable row'
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-090 round five — the schedule the SLATE reads and the schedule the
// completeness check reads must be the same one.
// ---------------------------------------------------------------------------

// REGRESSION TEST — the v2 re-derivation moved the slate onto
// `loadCachedScheduleItems` (which falls back to the season-partition children)
// while completeness still came from the `-all-all` aggregate alone. On that
// fallback shape the flag stayed false, so a cache holding only future bowls
// reported the neutral state while an entire played regular season was absent.
test('PLATFORM-090: a postseason-only fallback cache never reports the neutral state', async () => {
  await setAppState('schedule', `${YEAR}-all-postseason`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: '901',
        week: 1,
        seasonType: 'postseason',
        startDate: FUTURE_KICKOFF,
        status: 'STATUS_SCHEDULED',
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
        neutralSite: false,
        conferenceGame: false,
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        homeId: 9011,
        awayId: 9012,
      },
    ],
  });
  const { expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(
    expectations['game-stats'],
    'unknown',
    'the absent regular partition could hold a whole played season'
  );
});

// POSITIVE CONTROL — the same fallback shape WITH the regular partition present
// does reach the neutral state, so the assertion above discriminates the missing
// partition and not merely "the aggregate key was absent".
test('PLATFORM-090: a complete fallback cache (both children) reaches the neutral state', async () => {
  const wire = (id: string, seasonType: 'regular' | 'postseason') => ({
    id,
    week: 1,
    seasonType,
    startDate: FUTURE_KICKOFF,
    status: 'STATUS_SCHEDULED',
    homeTeam: 'Alpha',
    awayTeam: 'Beta',
    neutralSite: false,
    conferenceGame: false,
    homeConference: 'SEC',
    awayConference: 'Big Ten',
    homeId: Number(id) * 10 + 1,
    awayId: Number(id) * 10 + 2,
  });
  await setAppState('schedule', `${YEAR}-all-regular`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items: [wire('902', 'regular')],
  });
  await setAppState('schedule', `${YEAR}-all-postseason`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items: [wire('903', 'postseason')],
  });
  const { expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(expectations['game-stats'], 'not-yet-expected');
});

// An absent POSTSEASON partition is the ordinary state for most of a season
// (bowls are unpublished), and a postseason game is always later than the
// regular games in hand — so it must NOT block the neutral state.
test('PLATFORM-090: an absent postseason partition alone does not block the neutral state', async () => {
  await setAppState('schedule', `${YEAR}-all-regular`, {
    at: NOW - 3 * 60 * 60 * 1000,
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: '904',
        week: 1,
        seasonType: 'regular',
        startDate: FUTURE_KICKOFF,
        status: 'STATUS_SCHEDULED',
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
        neutralSite: false,
        conferenceGame: false,
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        homeId: 9041,
        awayId: 9042,
      },
    ],
  });
  const { expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
  assert.equal(expectations['game-stats'], 'not-yet-expected');
});

// REGRESSION TEST (round 6, found independently by BOTH reviewers) — the
// completeness read is the only durable read on the function's top-level path,
// outside every per-dataset try block. Unguarded, a `schedule`-scope store
// failure escaped the whole function: `/api/admin/provider-status` 500d and
// every System Health row degraded to Unknown — strictly worse than the warning
// this branch removes, and a breach of the module's isolation rule.
test('PLATFORM-090: a schedule-scope read failure degrades only its own facts', async () => {
  __setAppStateReadFailureForTests(new Error('schedule store boom'), 'schedule');
  try {
    const { diagnostics, expectations } = await getProviderDataDiagnostics(YEAR, { now: NOW });
    // The pass COMPLETED rather than rejecting — the point of the fix.
    assert.ok(
      diagnostics.find((d) => d.code === 'schedule-diagnostics-unavailable'),
      'the schedule read failure is reported as its own diagnostic'
    );
    // An unreadable partition cannot prove the season is accounted for.
    assert.equal(expectations['game-stats'], 'unknown');
    // Other datasets still report — one failing scope did not sink the report.
    assert.ok(
      diagnostics.some((d) => d.dataset !== 'schedule'),
      'non-schedule datasets still produced diagnostics'
    );
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});

// POSITIVE CONTROL for the observer above — the same seam DOES make the read
// throw, so the test is not passing because the failure never occurred.
test('PLATFORM-090: the read-failure seam genuinely fails the schedule scope', async () => {
  __setAppStateReadFailureForTests(new Error('schedule store boom'), 'schedule');
  try {
    await assert.rejects(
      () => getAppState('schedule', `${YEAR}-all-regular`),
      /schedule store boom/,
      'the seam must actually throw on the scope the guard protects'
    );
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});
