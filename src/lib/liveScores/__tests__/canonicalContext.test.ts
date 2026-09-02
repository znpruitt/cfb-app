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

function scheduleGame(
  id: string,
  homeTeam: string,
  awayTeam: string,
  overrides: Partial<ScheduleWireItem> = {}
): ScheduleWireItem {
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
    ...overrides,
  };
}

function observeWeekReads(item: ScheduleWireItem, onRead: () => void): ScheduleWireItem {
  const week = item.week;
  const observed = { ...item };
  return Object.defineProperty(observed, 'week', {
    configurable: true,
    enumerable: true,
    get() {
      onRead();
      return week;
    },
  });
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

test('live-score build filters irrelevant regular rows without moving postseason pending weeks', async () => {
  const relevant = scheduleGame('101', 'Alabama', 'Auburn', {
    week: 15,
    status: 'scheduled',
    completed: false,
    homeClassification: 'fbs',
    awayClassification: 'fbs',
  });
  const irrelevant = scheduleGame('202', 'Lower Division Home', 'Lower Division Away', {
    week: 16,
    status: 'scheduled',
    completed: false,
    homeClassification: 'fcs',
    awayClassification: 'iii',
  });
  const postseason = scheduleGame('303', 'Georgia', 'Florida', {
    week: 1,
    status: 'scheduled',
    completed: false,
    seasonType: 'postseason',
    gamePhase: 'postseason',
    postseasonSubtype: 'bowl',
    eventKey: 'fixture-bowl',
    homeClassification: 'fbs',
    awayClassification: 'fbs',
  });

  let relevantWeekReads = 0;
  let irrelevantWeekReads = 0;
  const observedRelevant = observeWeekReads(relevant, () => {
    relevantWeekReads += 1;
  });
  const observedIrrelevant = observeWeekReads(irrelevant, () => {
    irrelevantWeekReads += 1;
  });

  const baseline = await loadLiveScoreContext({
    year: YEAR,
    now: NOW,
    scheduleItems: [relevant, postseason],
  });
  const withIrrelevantRow = await loadLiveScoreContext({
    year: YEAR,
    now: NOW,
    scheduleItems: [observedIrrelevant, observedRelevant, postseason],
  });

  assert.equal(baseline.status, 'available');
  assert.equal(withIrrelevantRow.status, 'available');
  if (baseline.status !== 'available' || withIrrelevantRow.status !== 'available') return;
  assert.deepEqual(withIrrelevantRow.context.games, baseline.context.games);
  assert.deepEqual(withIrrelevantRow.context.pendingGames, baseline.context.pendingGames);
  assert.equal(
    withIrrelevantRow.context.pendingGames.find((game) => game.key === `${YEAR}-fixture-bowl`)
      ?.week,
    16
  );
  // Positive control: this observer fires when a row reaches buildScheduleFromApi.
  assert.ok(relevantWeekReads > 0);
  // The irrelevant row remains available to raw-id validation, which never reads
  // its week, but it must not reach the expensive canonical build.
  assert.equal(irrelevantWeekReads, 0);
});
