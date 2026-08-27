import assert from 'node:assert/strict';
import test from 'node:test';

import { GAME_MAX_DURATION_MS, type PendingGame } from '../../standingsHistory.ts';
import { selectPendingGameFinality } from '../pendingGameFinality.ts';

const NOW = new Date('2026-10-15T12:00:00.000Z');

function pending(key: string, ageMs: number, kickoff?: string | null): PendingGame {
  return {
    key,
    week: 1,
    kickoff: kickoff === undefined ? new Date(NOW.getTime() - ageMs).toISOString() : kickoff,
  };
}

test('surfaces every pending game only when the complete population clears the allowance', () => {
  const oldA = pending('old-a', GAME_MAX_DURATION_MS + 1);
  const oldB = pending('old-b', GAME_MAX_DURATION_MS + 60_000);

  assert.deepEqual(selectPendingGameFinality({ pendingGames: [oldA, oldB], now: NOW }), {
    allPendingGamesConcluded: true,
    acceptedWithoutResult: [oldA, oldB],
  });
});

test('an old game is not recorded as accepted while any pending sibling remains unresolved', () => {
  const result = selectPendingGameFinality({
    pendingGames: [
      pending('old', GAME_MAX_DURATION_MS + 1),
      pending('recent', GAME_MAX_DURATION_MS - 1),
    ],
    now: NOW,
  });

  assert.equal(result.allPendingGamesConcluded, false);
  assert.deepEqual(result.acceptedWithoutResult, []);
});

test('exactly eight hours is not abandoned and a null kickoff can never clear the gate', () => {
  assert.equal(
    selectPendingGameFinality({
      pendingGames: [pending('boundary', GAME_MAX_DURATION_MS)],
      now: NOW,
    }).allPendingGamesConcluded,
    false
  );
  assert.equal(
    selectPendingGameFinality({
      pendingGames: [pending('undated', 0, null)],
      now: NOW,
    }).allPendingGamesConcluded,
    false
  );
});

test('an empty pending population preserves season finality without inventing a conclusion', () => {
  assert.deepEqual(selectPendingGameFinality({ pendingGames: [], now: NOW }), {
    allPendingGamesConcluded: true,
    acceptedWithoutResult: [],
  });
});
