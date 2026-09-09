import assert from 'node:assert/strict';
import test from 'node:test';

import type { ScorePack } from '../../scores';
import { projectGameScoreboardState } from '../gameScoreboardState';

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

test('projection enumerates final, live, scheduled, and awaiting with explicit precedence', () => {
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
