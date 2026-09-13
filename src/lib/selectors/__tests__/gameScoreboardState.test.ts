import assert from 'node:assert/strict';
import test from 'node:test';

import { POLLING_WINDOW_AFTER_KICKOFF_MS } from '../../liveScores/pollingTarget';
import type { ScorePack } from '../../scores';
import { NO_SCORE_REPORTED_LABEL, projectGameScoreboardState } from '../gameScoreboardState';

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

test('the planning-owned fifth-state label is pinned at its single seam', () => {
  assert.equal(NO_SCORE_REPORTED_LABEL, 'No score reported.');
});

test('projection enumerates every scoreboard state with explicit precedence', () => {
  assert.equal(
    projectGameScoreboardState(score('Final', 21, 17), KICKOFF, BEFORE_KICKOFF),
    'final'
  );
  assert.equal(
    projectGameScoreboardState(score('Q3 8:14', 21, 17), KICKOFF, BEFORE_KICKOFF),
    'live'
  );
  for (const [kickoff, nowMs] of [
    [KICKOFF, BEFORE_KICKOFF],
    [null, AT_KICKOFF],
    ['not-a-date', AT_KICKOFF],
    [KICKOFF, Number.NaN],
  ] as const) {
    assert.equal(projectGameScoreboardState(undefined, kickoff, nowMs), 'scheduled');
  }
  for (const scorePack of [undefined, score('', null, null), score('Scheduled', 0, 0)]) {
    assert.equal(projectGameScoreboardState(scorePack, KICKOFF, AT_KICKOFF), 'awaiting');
  }
  assert.equal(
    projectGameScoreboardState(score('Final', 21, null), KICKOFF, AT_KICKOFF),
    'awaiting'
  );
});

test('awaiting includes the polling boundary and becomes unavailable one millisecond later', () => {
  const atPollingBoundary = AT_KICKOFF + POLLING_WINDOW_AFTER_KICKOFF_MS;

  assert.equal(projectGameScoreboardState(undefined, KICKOFF, atPollingBoundary), 'awaiting');
  assert.equal(
    projectGameScoreboardState(undefined, KICKOFF, atPollingBoundary + 1),
    'unavailable'
  );
  assert.equal(
    projectGameScoreboardState(score('Q4', 21, 17), KICKOFF, atPollingBoundary + 1),
    'live',
    'attached live evidence wins at any age'
  );
  assert.equal(
    projectGameScoreboardState(score('Final', 21, 17), KICKOFF, atPollingBoundary + 1),
    'final',
    'usable final evidence wins at any age'
  );
});
