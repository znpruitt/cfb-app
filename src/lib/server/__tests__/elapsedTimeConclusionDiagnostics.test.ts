import assert from 'node:assert/strict';
import test from 'node:test';

import { GAME_MAX_DURATION_MS, type PendingGame } from '../../standingsHistory.ts';
import { makeContext, makeLiveGame } from '../../liveScores/__tests__/fixtures.ts';
import { deriveElapsedTimeConclusionCoverage } from '../elapsedTimeConclusionDiagnostics.ts';

const NOW = new Date('2026-10-15T12:00:00.000Z');

function oldPending(key: string, week = 1): PendingGame {
  return {
    key,
    week,
    kickoff: new Date(NOW.getTime() - GAME_MAX_DURATION_MS - 1).toISOString(),
  };
}

test('projects accepted pending games onto canonical provider identities', () => {
  const context = makeContext(
    [
      makeLiveGame({
        providerGameId: 101,
        key: 'game-101',
        providerWeek: 1,
        kickoff: '2026-10-11T20:00:00.000Z',
        home: { identityKey: 'alpha', canonicalName: 'Alpha' },
        away: { identityKey: 'beta', canonicalName: 'Beta' },
      }),
    ],
    { pendingGames: [oldPending('game-101')] }
  );

  const result = deriveElapsedTimeConclusionCoverage({ context, now: NOW });
  assert.equal(result.affectedGameCount, 1);
  assert.deepEqual(result.games, [
    {
      providerGameId: 101,
      week: 1,
      seasonType: 'regular',
      homeTeam: 'Alpha',
      awayTeam: 'Beta',
      kickoff: '2026-10-11T20:00:00.000Z',
      reason: 'elapsed-time-conclusion',
    },
  ]);
});

test('retains the complete count when an accepted game has no provider-addressable identity', () => {
  const context = makeContext([], { pendingGames: [oldPending('synthetic-game')] });
  assert.deepEqual(deriveElapsedTimeConclusionCoverage({ context, now: NOW }), {
    affectedGameCount: 1,
    games: [],
  });
});

test('does not surface an individually old game when a sibling has not cleared the allowance', () => {
  const context = makeContext([], {
    pendingGames: [
      oldPending('old'),
      {
        key: 'future',
        week: 2,
        kickoff: new Date(NOW.getTime() + 60_000).toISOString(),
      },
    ],
  });
  assert.deepEqual(deriveElapsedTimeConclusionCoverage({ context, now: NOW }), {
    affectedGameCount: 0,
    games: [],
  });
});
