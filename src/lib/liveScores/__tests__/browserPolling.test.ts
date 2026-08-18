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
  deriveLiveTrackingState,
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

// ---------------------------------------------------------------------------
// POLISH-005 — what the league surface tells a member about live coverage.
//
// Owner design, 2026-08-18: tie the indicator to whether the live-scores poller
// is actually being ACTED UPON, rather than inferring liveness from a field.
// `deriveLiveTrackingState` therefore derives from the poller's own arming rule.
//
// The first attempt read `game.status`, which the schedule-refresh cron writes
// and the live-scores engine never rewrites — so a schedule snapshotted mid-slate
// lit a "Live" badge for hours over a week of finals. Schedule status is not
// consulted here at all, which is why these tests never set it.
// ---------------------------------------------------------------------------

const trackingArgs = (games: AppGame[], scoresByKey: Record<string, ScorePack> = {}) => ({
  games,
  scoresByKey,
  season: CURRENT_SEASON,
  now: NOW,
});

test('deriveLiveTrackingState: nothing armed → no badge', () => {
  // Kickoff two days out: outside the -15m window, so the poller is not running
  // and there is nothing to claim.
  const future = makeGame({
    key: 'future',
    date: new Date(NOW_MS + 48 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(deriveLiveTrackingState(trackingArgs([future])), null);
});

test('deriveLiveTrackingState: armed before kickoff → preparing', () => {
  // Polling starts 15 minutes early, so the app IS working and has nothing to
  // report yet. "Preparing for kickoff" is the honest claim.
  const soon = makeGame({ key: 'soon', date: new Date(NOW_MS + 10 * 60 * 1000).toISOString() });
  assert.equal(deriveLiveTrackingState(trackingArgs([soon])), 'preparing');
});

test('deriveLiveTrackingState: kicked off and not final → tracking', () => {
  const started = makeGame({
    key: 'started',
    date: new Date(NOW_MS - 30 * 60 * 1000).toISOString(),
  });
  assert.equal(
    deriveLiveTrackingState(trackingArgs([started], { started: scorePack('Q2 4:11') })),
    'tracking'
  );
});

test('deriveLiveTrackingState: every armed game final → no badge', () => {
  // The poll window stays open 24h for corrections, but coverage is over. This
  // is what stops the badge running until Sunday after a Saturday slate.
  const done = makeGame({ key: 'done', date: new Date(NOW_MS - 3 * 60 * 60 * 1000).toISOString() });
  assert.equal(deriveLiveTrackingState(trackingArgs([done], { done: scorePack('Final') })), null);

  // Anti-vacuity: the SAME game still in progress does produce the badge, so the
  // null above is the final-score rule and not an inert fixture.
  assert.equal(
    deriveLiveTrackingState(trackingArgs([done], { done: scorePack('Q4 0:32') })),
    'tracking'
  );
});

test('deriveLiveTrackingState: a stale in_progress SCHEDULE row cannot light it', () => {
  // The defect both reviewers found. The schedule was cached mid-slate, so the
  // row still says `in_progress`; the games ended hours ago and the score feed
  // says so. Schedule status must not participate.
  const stale = makeGame({
    key: 'stale',
    status: 'in_progress',
    date: new Date(NOW_MS - 6 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(
    deriveLiveTrackingState(trackingArgs([stale], { stale: scorePack('Final') })),
    null,
    'a terminal score ends coverage regardless of what the schedule still says'
  );
});

test('deriveLiveTrackingState: schedule status never decides preparing vs tracking', () => {
  // Mutation-found. The stale-schedule test above pairs `in_progress` with a
  // FINAL score, so the final-score filter removes that game before status could
  // matter — re-adding status as a term survived it. This pins the design
  // decision itself: the kickoff CLOCK decides, never the schedule field.
  //
  // A row marked `in_progress` whose kickoff is still ahead is contradictory
  // data, and exactly what a mid-slate schedule snapshot can leave behind.
  const contradictory = makeGame({
    key: 'contradictory',
    status: 'in_progress',
    date: new Date(NOW_MS + 10 * 60 * 1000).toISOString(),
  });
  assert.equal(
    deriveLiveTrackingState(trackingArgs([contradictory])),
    'preparing',
    'kickoff has not happened, whatever the schedule row claims'
  );
});

test('deriveLiveTrackingState: one live game among finals still tracks', () => {
  const done = makeGame({ key: 'done', date: new Date(NOW_MS - 4 * 60 * 60 * 1000).toISOString() });
  const live = makeGame({ key: 'live', date: new Date(NOW_MS - 20 * 60 * 1000).toISOString() });
  assert.equal(
    deriveLiveTrackingState(
      trackingArgs([done, live], { done: scorePack('Final'), live: scorePack('Q1 12:00') })
    ),
    'tracking'
  );
});

test('deriveLiveTrackingState: a score OUTAGE does not read as live play', () => {
  // Review-found. Treating "not final" as live counts a game with NO attached
  // score as outstanding, so an empty `scoresByKey` — a dead feed or a cold
  // cache — made every game that kicked off in the last 24h read as live. The
  // surface then asserted "Tracking scores" while nothing was updating, and this
  // slice had already deleted the hedge that used to cover that state.
  const started = makeGame({
    key: 'started',
    date: new Date(NOW_MS - 45 * 60 * 1000).toISOString(),
  });
  assert.equal(
    deriveLiveTrackingState(trackingArgs([started], {})),
    null,
    'absence of score data is not evidence of play'
  );

  // Anti-vacuity: the SAME game with an in-progress score does track, so the
  // null above is the evidence rule and not an inert fixture.
  assert.equal(
    deriveLiveTrackingState(trackingArgs([started], { started: scorePack('Q3 2:00') })),
    'tracking'
  );
});

test('deriveLiveTrackingState: a FINAL game never reads as awaiting kickoff', () => {
  // Mutation-found. Normally redundant — a final game's kickoff is in the past,
  // so the clock comparison already excludes it. This covers contradictory
  // provider data (a final result carrying a future timestamp), where dropping
  // the guard would promise a kickoff for a game that is already over.
  // +10 minutes: inside the 15-minute arming window, so the poller IS running.
  // (+20 would sit outside it, nothing would be armed, and the control below
  // could not prepare — which is exactly how this fixture failed first.)
  const finished = makeGame({
    key: 'finished',
    date: new Date(NOW_MS + 10 * 60 * 1000).toISOString(),
  });
  assert.equal(
    deriveLiveTrackingState(trackingArgs([finished], { finished: scorePack('Final') })),
    null,
    'a finished game is not preparing, whatever its timestamp claims'
  );

  // Anti-vacuity: the identical future-kickoff game WITHOUT a final score does
  // prepare, so the null above is the final-score guard.
  assert.equal(deriveLiveTrackingState(trackingArgs([finished])), 'preparing');
});

test('deriveLiveTrackingState: a placeholder TBD clock is not a kickoff promise', () => {
  // Review-found. `startTimeTBD` marks the provider's placeholder hour, which
  // `formatExpandedKickoff` already refuses to render as a real time. Parsing it
  // as a kickoff promised a start the app cannot stand behind.
  const tbd = makeGame({
    key: 'tbd',
    startTimeTBD: true,
    date: new Date(NOW_MS + 10 * 60 * 1000).toISOString(),
  });
  assert.equal(
    deriveLiveTrackingState(trackingArgs([tbd])),
    null,
    'a placeholder clock cannot promise a kickoff'
  );

  // Anti-vacuity: the identical game with a CONFIRMED time does prepare.
  const confirmed = makeGame({
    key: 'confirmed',
    date: new Date(NOW_MS + 10 * 60 * 1000).toISOString(),
  });
  assert.equal(deriveLiveTrackingState(trackingArgs([confirmed])), 'preparing');

  // And a TBD game that is genuinely underway still tracks — the guard bounds
  // the PROMISE, not the observation.
  assert.equal(
    deriveLiveTrackingState(trackingArgs([tbd], { tbd: scorePack('Q1 9:30') })),
    'tracking'
  );
});
