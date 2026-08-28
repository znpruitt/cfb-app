import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { addLeague } from '@/lib/leagueRegistry';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '@/lib/server/appStateStore';
import { __resetTeamDatabaseStoreForTests } from '@/lib/server/teamDatabaseStore';

import LeagueInsightsPage from '../page';

const SLUG = 'weekly-recap-page';
const YEAR = 2024;

async function renderPageContent(slug: string): Promise<string> {
  const page = await LeagueInsightsPage({ params: Promise.resolve({ slug }) });
  const main = page as ReactElement<{ children: ReactElement<{ children: ReactElement }> }>;
  return renderToStaticMarkup(main.props.children.props.children);
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
});

test('Insights page renders the request-time recap above the standing insight list', async () => {
  await addLeague({
    slug: SLUG,
    displayName: 'Weekly Recap League',
    year: YEAR,
    createdAt: '2024-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  });
  await setAppState(`owners:${SLUG}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nGeorgia,Bob\n');
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      {
        id: '401000777',
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
        id: '401000777',
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

  const html = await renderPageContent(SLUG);

  assert.match(html, /Weekly recap/);
  assert.match(html, /Alice/);
  assert.match(html, /31 PF · 17 PA/);
  assert.match(html, /1–0/);
  assert.ok(
    html.indexOf('Weekly recap') < html.indexOf('Alice'),
    'the recap heading must lead its result rows'
  );
});

test('Insights page renders the eligible week when it has no completed results', async () => {
  const slug = 'weekly-recap-empty';
  await addLeague({
    slug,
    displayName: 'Quiet Weekly Recap League',
    year: YEAR,
    createdAt: '2024-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  });
  await setAppState(`owners:${slug}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nGeorgia,Bob\n');
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      {
        id: '401000778',
        week: 1,
        seasonType: 'regular',
        startDate: '2024-08-25T00:00:00.000Z',
        startTimeTBD: true,
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Texas',
        awayTeam: 'Georgia',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'scheduled',
        completed: false,
      },
    ],
  });

  const html = await renderPageContent(slug);

  assert.match(html, /No completed results were recorded for Week 1\./);
  assert.match(html, /1 game remains unresolved\./);
});

test('Insights page surfaces a completed league game whose result is unavailable', async () => {
  const slug = 'weekly-recap-missing-result';
  await addLeague({
    slug,
    displayName: 'Incomplete Weekly Recap League',
    year: YEAR,
    createdAt: '2024-01-01T00:00:00.000Z',
    status: { state: 'season', year: YEAR },
  });
  await setAppState(`owners:${slug}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nGeorgia,Bob\n');
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      {
        id: '401000779',
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

  const html = await renderPageContent(slug);

  assert.match(html, /No completed results were recorded for Week 1\./);
  assert.match(html, /1 game\. Waiting on complete results\./);
});

test('Insights page hides the request-time recap outside the active season', async () => {
  const slug = 'weekly-recap-offseason';
  await addLeague({
    slug,
    displayName: 'Offseason Weekly Recap League',
    year: YEAR,
    createdAt: '2024-01-01T00:00:00.000Z',
    status: { state: 'offseason' },
  });
  await setAppState(`owners:${slug}:${YEAR}`, 'csv', 'team,owner\nTexas,Alice\nGeorgia,Bob\n');
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      {
        id: '401000780',
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
        id: '401000780',
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

  const html = await renderPageContent(slug);

  assert.doesNotMatch(html, /Weekly recap/);
  assert.match(html, /All Insights/);
});
