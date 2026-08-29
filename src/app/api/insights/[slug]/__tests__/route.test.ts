import assert from 'node:assert/strict';
import test from 'node:test';

import { addLeague } from '@/lib/leagueRegistry';
import type { InsightsResponse } from '@/lib/insights/loadInsights';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '@/lib/server/appStateStore';
import { __resetTeamDatabaseStoreForTests } from '@/lib/server/teamDatabaseStore';

import { GET } from '../route';

const SLUG = 'weekly-recap-api';
const YEAR = 2024;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
});

test('authenticated Insights response attaches the authoritative request-time recap', async () => {
  await addLeague({
    slug: SLUG,
    displayName: 'Weekly Recap API League',
    year: YEAR,
    createdAt: '2024-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  });
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nGeorgia,Bob\n');
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      {
        id: '401000801',
        week: 1,
        seasonType: 'regular',
        startDate: '2024-08-25T00:00:00.000Z',
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Texas',
        awayTeam: 'Georgia',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'STATUS_FINAL',
        completed: true,
      },
    ],
  });
  await setAppState('scores', `${YEAR}-all-regular`, {
    items: [
      {
        id: '401000801',
        week: 1,
        seasonType: 'regular',
        startDate: '2024-08-25T00:00:00.000Z',
        status: 'final',
        home: { team: 'Texas', score: 31 },
        away: { team: 'Georgia', score: 17 },
        time: null,
      },
    ],
  });

  const response = await GET(new Request(`http://localhost/api/insights/${SLUG}?year=${YEAR}`), {
    params: Promise.resolve({ slug: SLUG }),
  });
  const payload = (await response.json()) as InsightsResponse;

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(payload.insights), 'the standing feed remains present');
  assert.equal(payload.weeklyRecap.status, 'available');
  if (payload.weeklyRecap.status !== 'available') return;
  assert.equal(payload.weeklyRecap.week, 1);
  assert.equal(payload.weeklyRecap.headline, 'Alice takes the week at 1–0');
  assert.deepEqual(payload.weeklyRecap.ownerLines, [
    { owner: 'Alice', recordLabel: '1–0', pointsLabel: '31 PF · 17 PA' },
    { owner: 'Bob', recordLabel: '0–1', pointsLabel: '17 PF · 31 PA' },
  ]);
});

test('an omitted year resolves the league operating season rather than a stale projection', async () => {
  const slug = `${SLUG}-legacy-year`;
  await addLeague({
    slug,
    displayName: 'Weekly Recap Legacy Year League',
    year: YEAR - 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  });
  await setAppState(`owners:${slug}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nGeorgia,Bob\n');
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      {
        id: '401000802',
        week: 1,
        seasonType: 'regular',
        startDate: '2024-08-25T00:00:00.000Z',
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Texas',
        awayTeam: 'Georgia',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'STATUS_FINAL',
        completed: true,
      },
    ],
  });
  await setAppState('scores', `${YEAR}-all-regular`, {
    items: [
      {
        id: '401000802',
        week: 1,
        seasonType: 'regular',
        startDate: '2024-08-25T00:00:00.000Z',
        status: 'final',
        home: { team: 'Texas', score: 31 },
        away: { team: 'Georgia', score: 17 },
        time: null,
      },
    ],
  });

  const response = await GET(new Request(`http://localhost/api/insights/${slug}`), {
    params: Promise.resolve({ slug }),
  });
  const payload = (await response.json()) as InsightsResponse;

  assert.equal(response.status, 200);
  assert.equal(payload.weeklyRecap.status, 'available');
  if (payload.weeklyRecap.status === 'available') {
    assert.equal(payload.weeklyRecap.week, 1);
  }
});
