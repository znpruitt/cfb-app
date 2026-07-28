import assert from 'node:assert/strict';
import test from 'node:test';

import type { AppGame } from '../../schedule.ts';
import type { ScorePack } from '../../scores.ts';
import {
  LIVE_SCORE_POLL_INTERVAL_MS,
  LIVE_SCORE_WINDOW_AFTER_MS,
  LIVE_SCORE_WINDOW_BEFORE_MS,
  deriveLiveScorePartitions,
  isCurrentLiveScoreSeason,
  isLiveScoreEligibleGame,
  selectLiveScorePollGames,
} from '../browserPolling.ts';

// PLATFORM-086B2B — browser live-poll eligibility. Pure/deterministic (a fixed
// `now`), it decides whether a VISIBLE tab should issue a cache-only score read:
// current season + a schedule-owned kickoff inside `[−15 min, +24 h]`, excluding
// resolved finals and canceled/postponed, keeping delayed/suspended.

// A November 2025 anchor → canonical current season 2025 (seasonYearForToday).
const NOW = new Date('2025-11-01T18:00:00.000Z');
const NOW_MS = NOW.getTime();
const CURRENT_SEASON = 2025;

function makeGame(overrides: Partial<AppGame> & { key: string }): AppGame {
  return {
    eventId: overrides.key,
    week: 9,
    providerWeek: 9,
    canonicalWeek: 9,
    date: new Date(NOW_MS).toISOString(),
    stage: 'regular',
    status: 'scheduled',
    stageOrder: 1,
    slotOrder: 0,
    eventKey: overrides.key,
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: null,
    neutral: false,
    neutralDisplay: 'vs',
    venue: null,
    isPlaceholder: false,
    participants: {
      home: {
        kind: 'team',
        teamId: 'home',
        displayName: 'Home',
        canonicalName: 'Home',
        rawName: 'Home',
      },
      away: {
        kind: 'team',
        teamId: 'away',
        displayName: 'Away',
        canonicalName: 'Away',
        rawName: 'Away',
      },
    },
    csvAway: '',
    csvHome: '',
    canAway: '',
    canHome: '',
    awayConf: '',
    homeConf: '',
    ...overrides,
  };
}

function scorePack(status: string): ScorePack {
  return { status, home: { team: 'home', score: 0 }, away: { team: 'away', score: 0 }, time: null };
}

test('isCurrentLiveScoreSeason gates on the canonical current season only', () => {
  assert.equal(isCurrentLiveScoreSeason(CURRENT_SEASON, NOW), true);
  assert.equal(isCurrentLiveScoreSeason(CURRENT_SEASON - 1, NOW), false);
  assert.equal(isCurrentLiveScoreSeason(CURRENT_SEASON + 1, NOW), false);
});

test('the eligibility window is the inclusive [kickoff-15min, kickoff+24h]', () => {
  const at = (offsetMs: number) =>
    makeGame({ key: 'g', date: new Date(NOW_MS - offsetMs).toISOString() });
  // Kickoff exactly 15 min in the future = the earliest inclusive edge → eligible.
  assert.equal(isLiveScoreEligibleGame(at(-LIVE_SCORE_WINDOW_BEFORE_MS), undefined, NOW), true);
  // A minute earlier than that edge → not yet armed.
  assert.equal(
    isLiveScoreEligibleGame(at(-LIVE_SCORE_WINDOW_BEFORE_MS - 60_000), undefined, NOW),
    false
  );
  // In progress right now → eligible.
  assert.equal(isLiveScoreEligibleGame(at(0), undefined, NOW), true);
  // Kickoff exactly 24 h ago = the latest inclusive edge → still eligible.
  assert.equal(isLiveScoreEligibleGame(at(LIVE_SCORE_WINDOW_AFTER_MS), undefined, NOW), true);
  // A minute past 24 h → window closed.
  assert.equal(
    isLiveScoreEligibleGame(at(LIVE_SCORE_WINDOW_AFTER_MS + 60_000), undefined, NOW),
    false
  );
});

test('a game with no/unparseable kickoff is never eligible (not schedule-owned enough)', () => {
  assert.equal(isLiveScoreEligibleGame(makeGame({ key: 'g', date: null }), undefined, NOW), false);
  assert.equal(
    isLiveScoreEligibleGame(makeGame({ key: 'g', date: 'not-a-date' }), undefined, NOW),
    false
  );
});

test('canceled/postponed drop out; finals and delayed/suspended stay eligible in-window', () => {
  const inWindow = makeGame({ key: 'g', date: new Date(NOW_MS).toISOString() });
  // Finals STAY eligible: a scoreboard `final` can still be corrected by the
  // cron's `/games` reconciliation, and the browser cannot tell provisional from
  // resolved finals — so it keeps polling cache-only until the window closes.
  assert.equal(isLiveScoreEligibleGame(inWindow, scorePack('final'), NOW), true);
  assert.equal(isLiveScoreEligibleGame(inWindow, scorePack('FINAL'), NOW), true);
  // A final OUTSIDE the window ages out normally.
  const aged = makeGame({
    key: 'g',
    date: new Date(NOW_MS - LIVE_SCORE_WINDOW_AFTER_MS - 60_000).toISOString(),
  });
  assert.equal(isLiveScoreEligibleGame(aged, scorePack('final'), NOW), false);
  // Canceled / postponed → terminal for polling.
  for (const s of ['canceled', 'Cancelled', 'postponed', 'STATUS_POSTPONED']) {
    assert.equal(isLiveScoreEligibleGame(inWindow, scorePack(s), NOW), false, s);
  }
  // Delayed / suspended are disrupted but NOT terminal → still eligible.
  for (const s of ['delayed', 'suspended']) {
    assert.equal(isLiveScoreEligibleGame(inWindow, scorePack(s), NOW), true, s);
  }
  // In-progress / scheduled cached statuses stay eligible.
  assert.equal(isLiveScoreEligibleGame(inWindow, scorePack('Q4 2:00'), NOW), true);
  assert.equal(isLiveScoreEligibleGame(inWindow, scorePack('scheduled'), NOW), true);
});

test('selectLiveScorePollGames filters to eligible games, and is empty off the current season', () => {
  const games = [
    makeGame({ key: 'live', date: new Date(NOW_MS).toISOString() }),
    // An in-window final stays eligible (correctable until the window closes).
    makeGame({ key: 'final', date: new Date(NOW_MS).toISOString() }),
    // A canceled in-window game drops out (terminal).
    makeGame({ key: 'canceled', date: new Date(NOW_MS).toISOString() }),
    // Out of window → not eligible.
    makeGame({
      key: 'future',
      date: new Date(NOW_MS + 3 * LIVE_SCORE_WINDOW_AFTER_MS).toISOString(),
    }),
  ];
  const scoresByKey = { final: scorePack('final'), canceled: scorePack('canceled') };

  const eligible = selectLiveScorePollGames({
    games,
    scoresByKey,
    season: CURRENT_SEASON,
    now: NOW,
  });
  assert.deepEqual(
    eligible.map((g) => g.key),
    ['live', 'final']
  );

  // Viewing a historical season → the browser never auto-polls, regardless of window.
  assert.deepEqual(
    selectLiveScorePollGames({ games, scoresByKey, season: CURRENT_SEASON - 1, now: NOW }),
    []
  );
});

test('deriveLiveScorePartitions dedupes (providerWeek, seasonType) and maps stages correctly', () => {
  const partitions = deriveLiveScorePartitions([
    makeGame({ key: 'a', week: 9, providerWeek: 9, stage: 'regular' }),
    makeGame({ key: 'b', week: 9, providerWeek: 9, stage: 'regular' }), // dup partition
    // Conference championship counts as the REGULAR season type (provider quirk).
    makeGame({
      key: 'c',
      week: 15,
      providerWeek: 1,
      stage: 'conference_championship',
      postseasonRole: 'conference_championship',
    }),
    // A bowl is postseason; the partition uses providerWeek, not canonical week.
    makeGame({ key: 'd', week: 20, providerWeek: 1, stage: 'bowl', postseasonRole: null }),
  ]);

  // 'a'/'b' collapse to one; 'c' (regular, providerWeek 1) and 'd' (postseason,
  // providerWeek 1) are distinct despite sharing a providerWeek.
  assert.deepEqual(
    [...partitions].sort((x, y) =>
      `${x.seasonType}${x.providerWeek}`.localeCompare(`${y.seasonType}${y.providerWeek}`)
    ),
    [
      { providerWeek: 1, seasonType: 'postseason' },
      { providerWeek: 1, seasonType: 'regular' },
      { providerWeek: 9, seasonType: 'regular' },
    ]
  );
});

test('the poll cadence constant is 3 minutes', () => {
  assert.equal(LIVE_SCORE_POLL_INTERVAL_MS, 3 * 60 * 1000);
});
