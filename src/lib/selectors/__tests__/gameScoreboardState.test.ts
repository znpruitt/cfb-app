import assert from 'node:assert/strict';
import test from 'node:test';

import { POLLING_WINDOW_AFTER_KICKOFF_MS } from '../../liveScores/pollingTarget';
import type { AppGame } from '../../schedule';
import type { ScorePack } from '../../scores';
import {
  isScoreReportExpectedGame,
  NO_SCORE_REPORTED_LABEL,
  projectGameScoreboardState,
} from '../gameScoreboardState';

const KICKOFF = '2026-09-05T16:00:00.000Z';
const BEFORE_KICKOFF = Date.parse('2026-09-05T15:59:59.999Z');
const AT_KICKOFF = Date.parse(KICKOFF);

function score(status: string, away: number | null, home: number | null): ScorePack {
  return {
    status,
    time: null,
    away: { team: 'Away', score: away },
    home: { team: 'Home', score: home },
  };
}

function game(overrides: Partial<AppGame> = {}): AppGame {
  const key = overrides.key ?? 'game';
  return {
    key,
    eventId: overrides.eventId ?? key,
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? 1,
    date: Object.hasOwn(overrides, 'date') ? (overrides.date ?? null) : KICKOFF,
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    rawStatus: overrides.rawStatus,
    completed: overrides.completed,
    startTimeTBD: Object.hasOwn(overrides, 'startTimeTBD') ? overrides.startTimeTBD : false,
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? key,
    label: overrides.label ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? false,
    neutralDisplay: overrides.neutralDisplay ?? 'home_away',
    venue: overrides.venue ?? null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
      away: {
        kind: 'team',
        teamId: `${key}-away`,
        displayName: 'Away',
        canonicalName: 'Away',
        rawName: 'Away',
      },
      home: {
        kind: 'team',
        teamId: `${key}-home`,
        displayName: 'Home',
        canonicalName: 'Home',
        rawName: 'Home',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? 'Away',
    canHome: overrides.canHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'Big Ten',
    sources: overrides.sources,
  };
}

function project(params: { game?: AppGame; score?: ScorePack; nowMs?: number }) {
  return projectGameScoreboardState({
    game: params.game ?? game(),
    score: params.score,
    nowMs: params.nowMs ?? AT_KICKOFF,
  });
}

test('the planning-owned fifth-state label is pinned at its single seam', () => {
  assert.equal(NO_SCORE_REPORTED_LABEL, 'No score reported');
});

test('projection enumerates every scoreboard state with explicit precedence', () => {
  assert.equal(project({ score: score('Final', 21, 17), nowMs: BEFORE_KICKOFF }), 'final');
  assert.equal(project({ score: score('Q3 8:14', 21, 17), nowMs: BEFORE_KICKOFF }), 'live');
  for (const [gameValue, nowMs] of [
    [game(), BEFORE_KICKOFF],
    [game({ date: null }), AT_KICKOFF],
    [game({ date: 'not-a-date' }), AT_KICKOFF],
    [game(), Number.NaN],
  ] as const) {
    assert.equal(project({ game: gameValue, nowMs }), 'scheduled');
  }
  for (const scorePack of [undefined, score('', null, null), score('Scheduled', 0, 0)]) {
    assert.equal(project({ score: scorePack }), 'awaiting');
  }
  assert.equal(project({ score: score('Final', 21, null) }), 'awaiting');
});

test('terminal no-score eligibility requires a real confirmed undisrupted game', () => {
  const elapsed = AT_KICKOFF + POLLING_WINDOW_AFTER_KICKOFF_MS + 1;
  const ineligibleGames = [
    game({ key: 'flag-omitted', startTimeTBD: undefined }),
    game({ key: 'time-tbd', startTimeTBD: true }),
    game({ key: 'placeholder', isPlaceholder: true }),
    game({ key: 'placeholder-status', status: 'placeholder' }),
    game({
      key: 'unresolved-participant',
      participants: {
        away: { kind: 'placeholder', slotId: 'away', displayName: 'Winner of A' },
        home: {
          kind: 'team',
          teamId: 'home',
          displayName: 'Home',
          canonicalName: 'Home',
          rawName: 'Home',
        },
      },
    }),
    game({ key: 'disrupted', rawStatus: 'STATUS_CANCELED' }),
  ];

  assert.equal(isScoreReportExpectedGame(game(), undefined), true);
  for (const gameValue of ineligibleGames) {
    assert.equal(isScoreReportExpectedGame(gameValue, undefined), false, gameValue.key);
    assert.equal(project({ game: gameValue, nowMs: elapsed }), 'scheduled', gameValue.key);
  }

  const scoreDisruptedGame = game({ key: 'score-disrupted' });
  const disruptedScore = score('STATUS_POSTPONED', null, null);
  assert.equal(isScoreReportExpectedGame(scoreDisruptedGame, disruptedScore), false);
  assert.equal(
    project({ game: scoreDisruptedGame, score: disruptedScore, nowMs: elapsed }),
    'scheduled'
  );
});

test('awaiting includes the polling boundary and partial finals become unavailable after it', () => {
  const atPollingBoundary = AT_KICKOFF + POLLING_WINDOW_AFTER_KICKOFF_MS;
  const partialFinal = score('Final', 21, null);

  assert.equal(project({ nowMs: atPollingBoundary }), 'awaiting');
  assert.equal(project({ nowMs: atPollingBoundary + 1 }), 'unavailable');
  assert.equal(project({ score: partialFinal, nowMs: atPollingBoundary }), 'awaiting');
  assert.equal(project({ score: partialFinal, nowMs: atPollingBoundary + 1 }), 'unavailable');
  assert.equal(
    project({ score: score('Q4', 21, 17), nowMs: atPollingBoundary + 1 }),
    'live',
    'attached live evidence wins at any age'
  );
  assert.equal(
    project({ score: score('Final', 21, 17), nowMs: atPollingBoundary + 1 }),
    'final',
    'usable final evidence wins at any age'
  );
});
