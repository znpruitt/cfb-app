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
import WeeklyRecapSection from '@/components/recap/WeeklyRecapSection';

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

test('Insights recap keeps context uncertainty distinct from genuine absence', () => {
  const unavailable = renderToStaticMarkup(
    <WeeklyRecapSection recap={{ status: 'unavailable' }} />
  );
  const absent = renderToStaticMarkup(<WeeklyRecapSection recap={{ status: 'absent' }} />);

  assert.match(
    unavailable,
    /This week&#x27;s recap isn&#x27;t available right now\. Please check back shortly\./
  );
  assert.equal(absent, '');
});

test('full recap qualifies and renders non-compact movement accessibly', () => {
  const html = renderToStaticMarkup(
    <WeeklyRecapSection
      recap={{
        status: 'available',
        week: 2,
        weekLabel: 'Week 2',
        latestGameDate: '2026-09-12',
        headline: 'Alice takes the week at 1–0',
        isIncomplete: true,
        ownerLines: [{ owner: 'Alice', recordLabel: '1–0', pointsLabel: '31 PF · 17 PA' }],
        leaderLines: [],
        tileLeaderLines: [],
        movementLines: [
          { owner: 'Alice', direction: 'up', deltaLabel: '▲ 1', shiftLabel: '#2 → #1' },
        ],
        recordChangeLines: [],
        headToHeadLines: [],
        notableResultLines: [
          {
            kind: 'game',
            id: 'game-notable',
            label: 'Closest game',
            detail: '4-point margin',
            winner: { team: 'Texas', owner: 'Alice', score: '31' },
            loser: { team: 'Purdue', owner: null, score: '27' },
          },
        ],
        tileHighlights: [],
      }}
    />
  );

  assert.match(html, /Week 2 movement/);
  assert.match(html, /aria-label="Moved up in standings"/);
  assert.match(html, /text-\[14\.5px\]/);
  assert.match(html, /Notable results/);
  assert.match(html, /Closest game/);
  assert.match(html, /Purdue/);
  assert.doesNotMatch(html, /recap-tile-movement-heading/);
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
  assert.match(html, /Alice takes the week at 1–0/);
  assert.match(html, /Week records/);
  assert.match(html, /aria-label="Week leaders"/);
  assert.match(html, /Best record/);
  assert.match(html, /High score/);
  assert.match(html, /Closest game/);
  assert.match(html, /Alice/);
  assert.match(html, /31 PF · 17 PA/);
  assert.match(html, /1–0/);
  assert.ok(
    html.indexOf('Weekly recap') < html.indexOf('Alice'),
    'the recap heading must lead its result rows'
  );
  assert.match(html, /Record changes/);
  assert.match(html, /Head-to-head results/);
  assert.match(html, /Largest Single-Game Blowout/);
  assert.doesNotMatch(html, /Notable results/);
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

  assert.match(html, /No completed results were recorded for this week\./);
  assert.doesNotMatch(html, /game remains unresolved/);
  assert.doesNotMatch(html, /Week records/);
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
  await setAppState(
    `owners:${slug}:${YEAR}`,
    'csv',
    'team,owner\nTexas,Alice\nGeorgia,Bob\nClemson,Carol\nFlorida,Dave\n'
  );
  await setAppState('schedule', `${YEAR}-all-all`, {
    items: [
      {
        id: '401000778',
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
      {
        id: '401000779',
        week: 1,
        seasonType: 'regular',
        startDate: '2024-08-25T00:00:00.000Z',
        neutralSite: false,
        conferenceGame: true,
        homeTeam: 'Clemson',
        awayTeam: 'Florida',
        homeConference: 'ACC',
        awayConference: 'SEC',
        status: 'STATUS_FINAL',
        completed: true,
      },
    ],
  });
  await setAppState('scores', `${YEAR}-all-regular`, {
    items: [
      {
        id: '401000778',
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

  assert.match(html, /Week 1 results/);
  assert.match(html, /31 PF · 17 PA/);
  assert.match(html, /This recap reflects the completed results currently available\./);
  assert.doesNotMatch(html, /Waiting on complete results/);
  assert.doesNotMatch(html, /coverage|cache|CFBD/i);
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
