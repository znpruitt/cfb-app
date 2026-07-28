import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../../server/appStateStore.ts';
import { __resetOddsRouteCacheForTests } from '../../../app/api/odds/routeInternals.ts';
import { loadCanonicalOddsContext } from '../canonicalOddsContext.ts';

const SEASON = 2026;
const NOW = new Date('2026-09-01T00:00:00.000Z');

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetOddsRouteCacheForTests();
  __setAppStateReadFailureForTests(null);
  process.env.NEXT_PUBLIC_SEASON = String(SEASON);
});

function scheduleItem() {
  return {
    id: 'game-1',
    week: 1,
    startDate: '2026-09-05T19:30:00.000Z',
    neutralSite: false,
    conferenceGame: false,
    homeTeam: 'Georgia',
    awayTeam: 'Clemson',
    homeConference: 'SEC',
    awayConference: 'ACC',
    status: 'scheduled',
    seasonType: 'regular',
    gamePhase: 'regular',
  };
}

test('context: an available context carries built games and per-game polling signals', async () => {
  await setAppState('schedule', `${SEASON}-all-all`, { items: [scheduleItem()] });
  const result = await loadCanonicalOddsContext({ now: NOW });
  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.equal(result.context.year, SEASON);
  assert.equal(result.context.games.length, 1);
  assert.equal(result.context.pollingGames.length, 1);
  assert.equal(result.context.pollingGames[0]?.homeResolved, true);
  assert.equal(result.context.pollingGames[0]?.awayResolved, true);
  assert.equal(result.context.pollingGames[0]?.rawStatus, 'scheduled');
  assert.ok(result.context.seasonScopedKey.startsWith(`${SEASON}:`));
});

test('context: a genuinely empty schedule is available with no games (not unavailable)', async () => {
  const result = await loadCanonicalOddsContext({ now: NOW });
  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.equal(result.context.games.length, 0);
});

test('context: a schedule read failure is canonical-context-unavailable, not "no games"', async () => {
  __setAppStateReadFailureForTests(new Error('schedule store down'), 'schedule');
  try {
    const result = await loadCanonicalOddsContext({ now: NOW });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.status === 'unavailable' && result.reason, 'canonical-context-unavailable');
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});
