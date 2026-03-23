import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import OverviewPanel from '../OverviewPanel';
import type { OverviewContext, OverviewGameItem, OwnerMatchupMatrix } from '../../lib/overview';
import type { OwnerStandingsRow, StandingsCoverage } from '../../lib/standings';
import type { AppGame } from '../../lib/schedule';

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? 'e',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? '2026-09-01T17:00:00.000Z',
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? 'event',
    label: overrides.label ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? false,
    neutralDisplay: overrides.neutralDisplay ?? 'home_away',
    venue: overrides.venue ?? null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
      home: {
        kind: 'team',
        teamId: 'h',
        displayName: 'Home',
        canonicalName: 'Home',
        rawName: 'Home',
      },
      away: {
        kind: 'team',
        teamId: 'a',
        displayName: 'Away',
        canonicalName: 'Away',
        rawName: 'Away',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? overrides.csvAway ?? 'Away',
    canHome: overrides.canHome ?? overrides.csvHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'Big Ten',
    sources: overrides.sources,
  };
}

function item(gameValue: AppGame): OverviewGameItem {
  return {
    bucket: {
      game: gameValue,
      awayOwner: 'Alice',
      homeOwner: 'Bob',
      awayIsLeagueTeam: true,
      homeIsLeagueTeam: true,
    },
    priority: 2,
    sortDate: 1,
  };
}

const standingsLeaders: OwnerStandingsRow[] = [
  {
    owner: 'Alice',
    wins: 4,
    losses: 1,
    winPct: 0.8,
    pointsFor: 120,
    pointsAgainst: 100,
    pointDifferential: 20,
    gamesBack: 0,
    finalGames: 5,
  },
];

const coverage: StandingsCoverage = { state: 'complete', message: null };

const defaultContext: OverviewContext = {
  scopeLabel: 'Current league focus',
  scopeDetail: 'Week 1',
  emphasis: 'upcoming',
  highlightsTitle: 'What matters next',
  highlightsDescription:
    'The active slate is upcoming, so Overview leads with the next head-to-head and owned-team games to watch.',
  liveDescription: 'If games go live, they will automatically move to the top of Overview.',
  sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
};

const matchupMatrix: OwnerMatchupMatrix = {
  owners: ['Alice', 'Bob'],
  rows: [
    {
      owner: 'Alice',
      cells: [
        { owner: 'Alice', gameCount: 0, record: null },
        { owner: 'Bob', gameCount: 2, record: '1–1' },
      ],
    },
    {
      owner: 'Bob',
      cells: [
        { owner: 'Alice', gameCount: 2, record: '1–1' },
        { owner: 'Bob', gameCount: 0, record: null },
      ],
    },
  ],
};

test('overview panel uses neutral wording for neutral-site games', () => {
  const neutralGame = game({
    csvAway: 'Texas',
    csvHome: 'Ohio State',
    neutral: true,
    neutralDisplay: 'vs',
    stage: 'bowl',
  });

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[item(neutralGame)]}
      keyMatchups={[item(neutralGame)]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Texas<\/span> vs <span>Ohio State/);
  assert.doesNotMatch(html, /Texas at Ohio State/);
});

test('overview panel keeps home-away wording for standard games', () => {
  const homeAwayGame = game({
    csvAway: 'Texas',
    csvHome: 'Rice',
    neutral: false,
    neutralDisplay: 'home_away',
    stage: 'regular',
  });

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[item(homeAwayGame)]}
      keyMatchups={[item(homeAwayGame)]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Texas<\/span> @ <span>Rice/);
});

test('overview panel renders full condensed standings and weekly owner matrix', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        ...standingsLeaders,
        {
          owner: 'Bob',
          wins: 3,
          losses: 2,
          winPct: 0.6,
          pointsFor: 110,
          pointsAgainst: 101,
          pointDifferential: 9,
          gamesBack: 1,
          finalGames: 5,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /League standings/);
  assert.match(html, /Games by vs games against/);
  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
  assert.match(html, /1–1/);
  assert.doesNotMatch(html, /Standings snapshot/);
});

test('overview panel orders sections from active context instead of always leading with standings', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[item(game({ key: 'next-up' }))]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.ok(html.indexOf('What matters next') < html.indexOf('League standings'));
  assert.ok(html.includes('Current league focus'));
  assert.ok(html.includes('Week 1'));
});
