import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../server/appStateStore.ts';
import type { ScheduleWireItem } from '../../schedule.ts';
import { loadLiveScoreContext } from '../canonicalContext.ts';

const YEAR = 2026;
const NOW = new Date('2026-10-15T12:00:00.000Z');

function scheduleGame(id: string, homeTeam: string, awayTeam: string): ScheduleWireItem {
  return {
    id,
    week: 1,
    seasonType: 'regular',
    startDate: '2026-10-11T20:00:00.000Z',
    neutralSite: false,
    conferenceGame: true,
    homeTeam,
    awayTeam,
    homeId: Number(id) * 10 + 1,
    awayId: Number(id) * 10 + 2,
    homeConference: 'SEC',
    awayConference: 'SEC',
    status: 'STATUS_FINAL',
    completed: true,
  };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('a supplied schedule snapshot controls the canonical context instead of a second durable read', async () => {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: NOW.getTime(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: [scheduleGame('202', 'Georgia', 'Florida')],
  });

  const result = await loadLiveScoreContext({
    year: YEAR,
    now: NOW,
    scheduleItems: [scheduleGame('101', 'Alabama', 'Auburn')],
  });

  assert.equal(result.status, 'available');
  if (result.status !== 'available') return;
  assert.deepEqual(
    result.context.games.map((game) => game.canonical.providerGameId),
    [101]
  );
});
