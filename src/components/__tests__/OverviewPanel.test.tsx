import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import OverviewPanel from '../OverviewPanel';
import type { OverviewContext, OverviewGameItem, OwnerMatchupMatrix } from '../../lib/overview';
import type { OwnerStandingsRow, StandingsCoverage } from '../../lib/standings';
import type { StandingsHistory } from '../../lib/standingsHistory';
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

function standingsHistoryFromSnapshots(
  snapshots: Array<{ week: number; standings: OwnerStandingsRow[] }>
): StandingsHistory {
  const byOwner = snapshots.reduce<StandingsHistory['byOwner']>((acc, snapshot) => {
    snapshot.standings.forEach((row) => {
      if (!acc[row.owner]) acc[row.owner] = [];
      acc[row.owner]!.push({
        week: snapshot.week,
        wins: row.wins,
        losses: row.losses,
        ties: 0,
        winPct: row.winPct,
        pointsFor: row.pointsFor,
        pointsAgainst: row.pointsAgainst,
        pointDifferential: row.pointDifferential,
        gamesBack: row.gamesBack,
      });
    });
    return acc;
  }, {});

  return {
    weeks: snapshots.map((snapshot) => snapshot.week),
    byWeek: Object.fromEntries(
      snapshots.map((snapshot) => [
        snapshot.week,
        {
          week: snapshot.week,
          standings: snapshot.standings.map((row) => ({ ...row, ties: 0 })),
          coverage: { state: 'complete', message: null as string | null },
        },
      ])
    ),
    byOwner,
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
  assert.match(html, /grid-cols-\[minmax\(0,1fr\)_3\.8rem\]/);
});

test('overview panel renders league highlights and standings without matrix table', () => {
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
  assert.match(html, /League highlights/);
  assert.doesNotMatch(html, /Featured matchups/);
  assert.doesNotMatch(html, /View details/);
  assert.match(html, /View all results/);
  assert.doesNotMatch(html, /Head-to-head matrix/);
  assert.doesNotMatch(html, /<table/);
  assert.doesNotMatch(html, /League snapshot/);
});

test('overview standings emphasize leader row and show live count when available', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      games={[game({ key: 'live-1', csvAway: 'Texas', csvHome: 'Rice' })]}
      scoresByKey={{
        'live-1': {
          status: 'In Progress',
          away: { team: 'Texas', score: 14 },
          home: { team: 'Rice', score: 10 },
          time: '07:11',
        },
      }}
      rosterByTeam={
        new Map([
          ['Texas', 'Alice'],
          ['Rice', 'Bob'],
        ])
      }
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

  assert.match(html, /Leader/);
  assert.match(html, /1 live/);
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

  assert.match(html, /League leader: Alice/);
  assert.match(html, /Alice/);
  assert.match(html, /4–1/);
  assert.match(html, /Win% 0.800/);
  assert.match(html, /Leads at 4–1 \(0.800\), \+20 diff/);
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

  assert.match(html, /Gap #2 0.079/);
  assert.doesNotMatch(html, /Gap tied/);
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

  assert.match(html, /Gap tied/);
  assert.match(html, /Alice and Bob are tied for first at 6–2 \(0.750\)/);
});

test('overview panel summary narrative lists all owners in a three-way tie', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 9,
          losses: 3,
          winPct: 0.75,
          pointsFor: 200,
          pointsAgainst: 180,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 12,
        },
        {
          owner: 'Bob',
          wins: 9,
          losses: 3,
          winPct: 0.75,
          pointsFor: 190,
          pointsAgainst: 170,
          pointDifferential: 20,
          gamesBack: 0,
          finalGames: 12,
        },
        {
          owner: 'Chris',
          wins: 9,
          losses: 3,
          winPct: 0.75,
          pointsFor: 180,
          pointsAgainst: 160,
          pointDifferential: 20,
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

  assert.match(html, /Alice, Bob, and Chris are tied for first at 9–3 \(0.750\)/);
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

  assert.match(html, />Championship race</);
  assert.doesNotMatch(html, /League leader/);
  assert.match(html, /View weekly matchups/);
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

  assert.match(html, /Season podium/);
  assert.match(html, /#1/);
  assert.match(html, /#2/);
  assert.match(html, /#3/);
  assert.match(html, /Pruitt/);
  assert.match(html, /Maleski/);
  assert.match(html, /Whited/);
  assert.match(html, /81–39/);
  assert.match(html, /65–41/);
  assert.match(html, /70–45/);
  assert.match(html, /Pruitt won the title by 0.062 over Maleski/);
  assert.doesNotMatch(html, /League leader/);
  assert.ok(html.indexOf('Pruitt') < html.indexOf('Maleski'));
  assert.ok(html.indexOf('Maleski') < html.indexOf('Whited'));
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

test('overview panel keeps league-home ordering with standings and highlights ahead of results', () => {
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

  assert.ok(html.indexOf('League leader: Alice') < html.indexOf('League standings (Top 5)'));
  assert.ok(html.indexOf('League standings (Top 5)') < html.indexOf('League highlights'));
  assert.ok(html.indexOf('League highlights') < html.indexOf('Recent results'));
  assert.ok(html.indexOf('Recent results') < html.indexOf('Upcoming watchlist'));
  assert.doesNotMatch(html, /League pulse/);
  assert.ok(html.indexOf('Upcoming watchlist') < html.indexOf('No live games right now.'));
  assert.ok(html.includes('Gap #2 —'));
  assert.ok(html.includes('Week 1'));
});

test('overview panel keeps standings as the only condensed ranking table', () => {
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
      keyMatchups={[item(game({ key: 'what-matters' }))]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  const standingsHeaderOccurrences = html.match(/Owner · Record · Metrics/g) ?? [];
  assert.equal(standingsHeaderOccurrences.length, 1);
  assert.doesNotMatch(html, /League snapshot/);
  assert.ok(html.indexOf('League summary') < html.indexOf('League standings (Top 5)'));
  assert.ok(html.indexOf('League standings (Top 5)') < html.indexOf('Recent results'));
});

test('overview panel hides watchlist when highlight cards already summarize the slate', () => {
  const finals = [1, 2, 3, 4].map((value) =>
    itemWithScore(
      game({
        key: `final-${value}`,
        csvAway: `Final Away ${value}`,
        csvHome: `Final Home ${value}`,
        date: `2026-10-0${value}T16:00:00.000Z`,
      }),
      {
        status: 'Final',
        away: { team: `Final Away ${value}`, score: 24 + value },
        home: { team: `Final Home ${value}`, score: 14 },
        time: null,
      }
    )
  );
  const featuredScheduled = itemWithScore(
    game({
      key: 'scheduled-late',
      csvAway: 'Georgia',
      csvHome: 'Florida',
      date: '2026-10-20T22:00:00.000Z',
    }),
    {
      status: 'Scheduled',
      away: { team: 'Georgia', score: null },
      home: { team: 'Florida', score: null },
      time: null,
    }
  );

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[...finals, featuredScheduled]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /Upcoming watchlist/);
  assert.match(html, /League highlights/);
});

test('overview panel renders subtle standings movement indicator when prior standings exist', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 6,
          losses: 2,
          winPct: 0.75,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 8,
          gamesBack: 0,
          finalGames: 8,
        },
        {
          owner: 'Bob',
          wins: 5,
          losses: 3,
          winPct: 0.625,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 5,
          gamesBack: 1,
          finalGames: 8,
        },
      ]}
      standingsHistory={standingsHistoryFromSnapshots([
        {
          week: 1,
          standings: [
            {
              owner: 'Bob',
              wins: 5,
              losses: 3,
              winPct: 0.625,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 5,
              gamesBack: 0,
              finalGames: 8,
            },
            {
              owner: 'Alice',
              wins: 6,
              losses: 2,
              winPct: 0.75,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 8,
              gamesBack: 1,
              finalGames: 8,
            },
          ],
        },
        {
          week: 2,
          standings: [
            {
              owner: 'Alice',
              wins: 6,
              losses: 2,
              winPct: 0.75,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 8,
              gamesBack: 0,
              finalGames: 8,
            },
            {
              owner: 'Bob',
              wins: 5,
              losses: 3,
              winPct: 0.625,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 5,
              gamesBack: 1,
              finalGames: 8,
            },
          ],
        },
      ])}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /↑/);
  assert.match(html, /↓/);
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

  assert.match(html, /No live games right now\./);
  assert.doesNotMatch(html, /Postseason focus/);
  assert.match(html, /League highlights/);
  assert.match(html, /View full standings/);
  assert.doesNotMatch(html, /No featured matchups yet for this slate\./);
});

test('overview panel renders League Trends games back section when history is provided', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsHistory={standingsHistoryFromSnapshots([
        {
          week: 1,
          standings: [
            {
              owner: 'Alice',
              wins: 5,
              losses: 1,
              winPct: 0.833,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 10,
              gamesBack: 0,
              finalGames: 6,
            },
            {
              owner: 'Bob',
              wins: 3,
              losses: 3,
              winPct: 0.5,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 0,
              gamesBack: 2,
              finalGames: 6,
            },
          ],
        },
        {
          week: 2,
          standings: [
            {
              owner: 'Alice',
              wins: 6,
              losses: 1,
              winPct: 0.857,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 12,
              gamesBack: 0,
              finalGames: 7,
            },
            {
              owner: 'Bob',
              wins: 4,
              losses: 3,
              winPct: 0.571,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 2,
              gamesBack: 2,
              finalGames: 7,
            },
          ],
        },
      ])}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /League Trends/);
  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
  assert.match(html, /Latest: 0.0 GB/);
  assert.match(html, /Latest: 2.0 GB/);
  assert.match(html, /Win %/);
  assert.match(html, /Latest: 85.7%/);
  assert.match(html, /Latest: 57.1%/);
  assert.match(html, /Win Bars/);
  assert.match(html, /6W · 85.7%/);
  assert.match(html, /4W · 57.1%/);
});

test('overview panel shows win percent empty-state copy when no resolved standings history exists', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsHistory={{
        weeks: [3],
        byWeek: {
          3: {
            week: 3,
            standings: [],
            coverage: { state: 'partial', message: null },
          },
        },
        byOwner: {
          Alice: [
            {
              week: 3,
              wins: 2,
              losses: 1,
              ties: 0,
              winPct: 0.667,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 0,
              gamesBack: 0,
            },
          ],
        },
      }}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Win % trend will appear after standings history is available\./);
  assert.doesNotMatch(html, /Latest: 0\.0%/);
});

test('overview panel shows explicit empty states for featured, highlights, and results', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[]}
      standingsCoverage={coverage}
      matchupMatrix={{ owners: [], rows: [] }}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /No featured matchups yet for this slate\./);
  assert.match(
    html,
    /Highlights will appear once this slate has meaningful outcomes or matchup signals\./
  );
  assert.match(html, /No recent results yet—completed games will appear here\./);
});

test('overview panel keeps featured matchups hidden when none are meaningful for current phase', () => {
  const finalOnly = itemWithScore(game({ key: 'final-only' }), {
    status: 'FINAL',
    away: { team: 'Away', score: 30 },
    home: { team: 'Home', score: 20 },
    time: null,
  });
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[finalOnly]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.doesNotMatch(html, /Featured matchups/);
  assert.doesNotMatch(html, /No featured matchups yet for this slate\./);
});

test('overview panel renders league pulse section when selector emits pulse items', () => {
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
      keyMatchups={[item(game({ key: 'pulse-game' }))]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /League pulse/);
  assert.match(html, /Closest race:|leads by .* win%/i);
});

test('overview panel renders insight strip with prioritized ranked matchup signal', () => {
  const rankedGame = game({
    key: 'ranked-game',
    csvAway: 'Texas',
    csvHome: 'Miami',
    participants: {
      away: {
        kind: 'team',
        teamId: 'texas',
        displayName: 'Texas',
        canonicalName: 'Texas',
        rawName: 'Texas',
      },
      home: {
        kind: 'team',
        teamId: 'miami',
        displayName: 'Miami',
        canonicalName: 'Miami',
        rawName: 'Miami',
      },
    },
  });

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Pruitt',
          wins: 10,
          losses: 2,
          winPct: 0.833,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 12,
        },
        {
          owner: 'Maleski',
          wins: 9,
          losses: 3,
          winPct: 0.75,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
          finalGames: 12,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[item(rankedGame)]}
      rankingsByTeamId={
        new Map([
          ['texas', { rank: 7, rankSource: 'ap' }],
          ['miami', { rank: 14, rankSource: 'ap' }],
        ])
      }
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /0.083/);
  assert.match(html, /Top ranked matchup/);
  assert.match(html, /#7 Texas vs #14 Miami/);
});

test('overview panel suppresses redundant movement chips in completed-season podium mode', () => {
  const postseasonFinal = game({ key: 'title-game', stage: 'bowl', status: 'final' });
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
      standingsHistory={standingsHistoryFromSnapshots([
        {
          week: 14,
          standings: [
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
          ],
        },
        {
          week: 15,
          standings: [
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
          ],
        },
      ])}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[
        itemWithScore(postseasonFinal, {
          status: 'FINAL',
          away: { team: 'Away', score: 24 },
          home: { team: 'Home', score: 17 },
          time: null,
        }),
      ]}
      context={{ ...defaultContext, scopeLabel: 'Postseason', emphasis: 'recent' }}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Season podium/);
  assert.doesNotMatch(html, /Alice \(\+2 wins\)|Biggest drop:/);
});

test('overview panel game summary badges prefer top-25 and top-matchup over close and ranked', () => {
  const rankedCloseTopGame = itemWithScore(
    game({
      key: 'badge-priority',
      csvAway: 'Ohio State',
      csvHome: 'Oregon',
      participants: {
        away: {
          kind: 'team',
          teamId: 'osu',
          displayName: 'Ohio State',
          canonicalName: 'Ohio State',
          rawName: 'Ohio State',
        },
        home: {
          kind: 'team',
          teamId: 'oregon',
          displayName: 'Oregon',
          canonicalName: 'Oregon',
          rawName: 'Oregon',
        },
      },
    }),
    {
      status: 'FINAL',
      away: { team: 'Ohio State', score: 31 },
      home: { team: 'Oregon', score: 24 },
      time: null,
    }
  );
  rankedCloseTopGame.bucket.awayOwner = 'Alice';
  rankedCloseTopGame.bucket.homeOwner = 'Bob';

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 8,
          losses: 1,
          winPct: 0.889,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 9,
        },
        {
          owner: 'Bob',
          wins: 7,
          losses: 2,
          winPct: 0.778,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
          finalGames: 9,
        },
        {
          owner: 'Cara',
          wins: 6,
          losses: 3,
          winPct: 0.667,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 2,
          finalGames: 9,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[rankedCloseTopGame]}
      rankingsByTeamId={
        new Map([
          ['osu', { rank: 6, rankSource: 'ap' }],
          ['oregon', { rank: 11, rankSource: 'ap' }],
        ])
      }
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /#6 vs #11/);
  assert.match(html, /Top matchup/);
  assert.doesNotMatch(html, />Close</);
  const topMatchupOccurrences = html.match(/Top matchup/g) ?? [];
  assert.equal(topMatchupOccurrences.length, 1);
});

test('overview highlights prioritize top matchup and conditionally render upset watch plus standings context', () => {
  const topMatchup = itemWithScore(
    game({
      key: 'top-matchup-highlight',
      participants: {
        away: {
          kind: 'team',
          teamId: 'away-top',
          displayName: 'Away Top',
          canonicalName: 'Away Top',
          rawName: 'Away Top',
        },
        home: {
          kind: 'team',
          teamId: 'home-top',
          displayName: 'Home Top',
          canonicalName: 'Home Top',
          rawName: 'Home Top',
        },
      },
    }),
    {
      status: 'In Progress',
      away: { team: 'Away Top', score: 17 },
      home: { team: 'Home Top', score: 14 },
      time: '05:55',
    }
  );
  topMatchup.bucket.awayOwner = 'Alice';
  topMatchup.bucket.homeOwner = 'Bob';

  const upsetWatch = itemWithScore(
    game({
      key: 'upset-watch-highlight',
      participants: {
        away: {
          kind: 'team',
          teamId: 'favorite-away',
          displayName: 'Favorite Away',
          canonicalName: 'Favorite Away',
          rawName: 'Favorite Away',
        },
        home: {
          kind: 'team',
          teamId: 'home-underdog',
          displayName: 'Home Underdog',
          canonicalName: 'Home Underdog',
          rawName: 'Home Underdog',
        },
      },
    }),
    {
      status: 'In Progress',
      away: { team: 'Favorite Away', score: 10 },
      home: { team: 'Home Underdog', score: 24 },
      time: '08:41',
    }
  );
  upsetWatch.bucket.awayOwner = 'Casey';
  upsetWatch.bucket.homeOwner = 'Drew';

  const rankedSpotlight = item(
    game({
      key: 'ranked-spotlight-highlight',
      participants: {
        away: {
          kind: 'team',
          teamId: 'ranked-away',
          displayName: 'Ranked Away',
          canonicalName: 'Ranked Away',
          rawName: 'Ranked Away',
        },
        home: {
          kind: 'team',
          teamId: 'unranked-home',
          displayName: 'Unranked Home',
          canonicalName: 'Unranked Home',
          rawName: 'Unranked Home',
        },
      },
    })
  );
  rankedSpotlight.bucket.awayOwner = 'Erin';
  rankedSpotlight.bucket.homeOwner = 'Frank';

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 8,
          losses: 2,
          winPct: 0.8,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 12,
          gamesBack: 0,
          finalGames: 10,
        },
        {
          owner: 'Bob',
          wins: 8,
          losses: 2,
          winPct: 0.8,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 10,
          gamesBack: 0,
          finalGames: 10,
        },
      ]}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[topMatchup, upsetWatch]}
      keyMatchups={[rankedSpotlight, upsetWatch, topMatchup]}
      rankingsByTeamId={
        new Map([
          ['away-top', { rank: 11, rankSource: 'ap' }],
          ['home-top', { rank: 15, rankSource: 'ap' }],
          ['favorite-away', { rank: 20, rankSource: 'ap' }],
          ['ranked-away', { rank: 9, rankSource: 'ap' }],
        ])
      }
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /Top ranked matchup/);
  assert.doesNotMatch(html, /Ranked spotlight/);
  assert.match(html, /Tight race: Alice and Bob are separated by 0.000 win%/);
});

test('overview standings context suppresses leader-gap duplicate messaging when race is not tight', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 10,
          losses: 2,
          winPct: 0.833,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
          finalGames: 12,
        },
        {
          owner: 'Bob',
          wins: 8,
          losses: 4,
          winPct: 0.667,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 2,
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

  assert.doesNotMatch(html, /Leader gap:/);
  assert.doesNotMatch(html, /Tight race:/);
  assert.match(html, /0.166/);
});

test('overview highlights show scope context once at section level', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsLeaders}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[
        itemWithScore(game({ key: 'scope-check' }), {
          status: 'Final',
          away: { team: 'Away Team', score: 35 },
          home: { team: 'Home Team', score: 14 },
          time: null,
        }),
      ]}
      context={{ ...defaultContext, scopeDetail: 'Postseason' }}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /League highlights/);
  assert.match(html, />Postseason</);
  assert.doesNotMatch(html, /\(this postseason slate\)/i);
});

test('overview panel renders League Storylines section when selector emits storylines', () => {
  const standingsHistory = standingsHistoryFromSnapshots([
    {
      week: 1,
      standings: [
        {
          owner: 'Alice',
          wins: 4,
          losses: 1,
          winPct: 0.8,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 10,
          gamesBack: 0,
          finalGames: 5,
        },
        {
          owner: 'Bob',
          wins: 2,
          losses: 3,
          winPct: 0.4,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -5,
          gamesBack: 2,
          finalGames: 5,
        },
      ],
    },
    {
      week: 2,
      standings: [
        {
          owner: 'Alice',
          wins: 5,
          losses: 1,
          winPct: 0.833,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 12,
          gamesBack: 0,
          finalGames: 6,
        },
        {
          owner: 'Bob',
          wins: 2,
          losses: 4,
          winPct: 0.333,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -6,
          gamesBack: 3,
          finalGames: 6,
        },
      ],
    },
  ]);

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 5,
          losses: 1,
          winPct: 0.833,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 12,
          gamesBack: 0,
          finalGames: 6,
        },
        {
          owner: 'Bob',
          wins: 2,
          losses: 4,
          winPct: 0.333,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -6,
          gamesBack: 3,
          finalGames: 6,
        },
      ]}
      standingsHistory={standingsHistory}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  assert.match(html, /League Storylines/);
  assert.match(html, /Alice won the title by 3 games/);
});

test('overview panel omits League Storylines section when no storylines are available', () => {
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

  assert.doesNotMatch(html, /League Storylines/);
});

test('overview panel renders trends detail link in League Trends section', () => {
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

  assert.match(html, /See full trends/);
  assert.match(html, /href="\/standings\?view=trends#trends"/);
});
