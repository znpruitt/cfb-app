import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import OverviewPanel from '../OverviewPanel';
import type { OverviewContext, OverviewGameItem, OwnerMatchupMatrix } from '../../lib/overview';
import type { OwnerStandingsRow, StandingsCoverage } from '../../lib/standings';
import type { AppGame } from '../../lib/schedule';
import type { ScorePack } from '../../lib/scores';

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

function itemWithScore(gameValue: AppGame, score: ScorePack): OverviewGameItem {
  return {
    ...item(gameValue),
    score,
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
  scopeLabel: 'League',
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

test('overview highlights keep canonical neutral matchup separator with compact score header', () => {
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
      liveItems={[]}
      keyMatchups={[
        itemWithScore(neutralGame, {
          status: 'FINAL',
          away: { team: 'Texas', score: 24 },
          home: { team: 'Ohio State', score: 21 },
          time: null,
        }),
      ]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Texas<\/span> vs <span>Ohio State/);
  assert.match(html, /24–21/);
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
  assert.match(html, /Head-to-head matrix/);
  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
  assert.match(html, /1–1/);
  assert.doesNotMatch(html, /Standings snapshot/);
});

test('overview panel summary shows in-season leader, record, and win percentage', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /League leader/);
  assert.match(html, /Alice/);
  assert.match(html, /4–1/);
  assert.match(html, /Win% 0.800/);
});

test('overview panel summary uses standings win% gap over #2 during in-season state', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 6,
          losses: 1,
          winPct: 0.857,
          pointsFor: 200,
          pointsAgainst: 180,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 7,
        },
        {
          owner: 'Bob',
          wins: 7,
          losses: 2,
          winPct: 0.778,
          pointsFor: 230,
          pointsAgainst: 210,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 9,
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

  assert.match(html, /Gap over #2: 0.079 win%/);
  assert.doesNotMatch(html, /Tied at the top/);
});

test('overview panel summary shows tie copy when top win percentages match', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 6,
          losses: 2,
          winPct: 0.75,
          pointsFor: 200,
          pointsAgainst: 180,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 8,
        },
        {
          owner: 'Bob',
          wins: 9,
          losses: 3,
          winPct: 0.75,
          pointsFor: 290,
          pointsAgainst: 260,
          pointDifferential: 30,
          gamesBack: 0,
          finalGames: 12,
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

  assert.match(html, /Tied at the top/);
});

test('overview panel summary uses postseason in-progress championship language', () => {
  const postseasonGame = game({
    stage: 'bowl',
    status: 'in_progress',
  });
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[
        itemWithScore(postseasonGame, {
          status: 'Q3',
          away: { team: 'Away', score: 21 },
          home: { team: 'Home', score: 17 },
          time: '09:10',
        }),
      ]}
      keyMatchups={[item(postseasonGame)]}
      context={{ ...defaultContext, scopeLabel: 'Postseason' }}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Championship race/);
  assert.doesNotMatch(html, /League leader/);
});

test('overview panel summary shows season-complete champion, second, and third', () => {
  const postseasonFinal = game({ stage: 'bowl', status: 'final' });
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Pruitt',
          wins: 81,
          losses: 39,
          winPct: 0.675,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 120,
        },
        {
          owner: 'Maleski',
          wins: 65,
          losses: 41,
          winPct: 0.613,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 106,
        },
        {
          owner: 'Whited',
          wins: 70,
          losses: 45,
          winPct: 0.609,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 115,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[
        itemWithScore(postseasonFinal, {
          status: 'FINAL',
          away: { team: 'Away', score: 17 },
          home: { team: 'Home', score: 24 },
          time: null,
        }),
      ]}
      context={{ ...defaultContext, scopeLabel: 'Postseason', emphasis: 'recent' }}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Final results/);
  assert.match(html, /Champion: Pruitt \(81–39\)/);
  assert.match(html, /2nd: Maleski \(65–41\)/);
  assert.match(html, /3rd: Whited \(70–45\)/);
  assert.doesNotMatch(html, /League leader/);
});

test('overview panel summary does not render season-complete framing when standings coverage is partial', () => {
  const postseasonFinal = game({ stage: 'bowl', status: 'final' });
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={{ state: 'partial', message: 'Some games are still missing.' }}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[
        itemWithScore(postseasonFinal, {
          status: 'FINAL',
          away: { team: 'Away', score: 10 },
          home: { team: 'Home', score: 14 },
          time: null,
        }),
      ]}
      context={{ ...defaultContext, scopeLabel: 'Postseason', emphasis: 'recent' }}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /Final results/);
  assert.doesNotMatch(html, /Champion:/);
  assert.match(html, /Championship race/);
});

test('overview panel summary does not render season-complete framing when standings coverage is error', () => {
  const postseasonFinal = game({ stage: 'bowl', status: 'final' });
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={{ state: 'error', message: 'Standings load failed.' }}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[
        itemWithScore(postseasonFinal, {
          status: 'FINAL',
          away: { team: 'Away', score: 10 },
          home: { team: 'Home', score: 14 },
          time: null,
        }),
      ]}
      context={{ ...defaultContext, scopeLabel: 'Postseason', emphasis: 'recent' }}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /Final results/);
  assert.match(html, /Championship race/);
});

test('overview panel keeps league-home ordering with standings ahead of highlights', () => {
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

  assert.ok(html.indexOf('League leader') < html.indexOf('League standings'));
  assert.ok(html.indexOf('League standings') < html.indexOf('What matters next'));
  assert.ok(html.indexOf('What matters next') < html.indexOf('Live: none right now.'));
  assert.ok(html.indexOf('Live: none right now.') < html.indexOf('Head-to-head matrix'));
  assert.ok(html.includes('No runner-up yet'));
  assert.ok(html.includes('Week 1'));
});

test('overview panel uses compact live empty state copy', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Live: none right now\./);
  assert.doesNotMatch(html, /Postseason focus/);
  assert.match(html, /Head-to-head \(tap to expand\)/);
});
