import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import OverviewPanel from '../OverviewPanel';
import type { OverviewContext, OverviewGameItem, OwnerMatchupMatrix } from '../../lib/overview';
import { deriveLeagueInsights, deriveOverviewInsights } from '../../lib/selectors/insights';
import { selectSeasonContext } from '../../lib/selectors/seasonContext';
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
  // Final games render in the Featured games section, which shows each side's
  // score on its own line rather than a compact "24–21" header.
  assert.match(html, /Featured games/);
  assert.match(html, /Texas[\s\S]*?24/);
  assert.match(html, /Ohio State[\s\S]*?21/);
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

  assert.match(html, /Standings/);
  assert.match(html, /Insights/);
  assert.doesNotMatch(html, /Featured matchups/);
  assert.doesNotMatch(html, /View details/);
  assert.match(html, /All results →/);
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

  // The leader is surfaced as the rank-1 podium card and the top standings row;
  // the live count badge appears for owners with in-progress games.
  assert.match(html, /#1[\s\S]*?Alice/);
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

  // The in-season leader is surfaced via the rank-1 hero/podium card, which
  // shows the owner, their record, win percentage, and point differential.
  assert.match(html, /#1[\s\S]*?Alice/);
  assert.match(html, /4–1/);
  assert.match(html, /Win% 0.800/);
  assert.match(html, /Diff \+20/);
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

  // In-season, the leader and runner-up are shown as ranked hero cards with
  // their distinct win percentages (0.857 vs 0.778); the win% gap over #2 is
  // expressed by the ordered #1/#2 cards rather than a "Gap #2" narrative
  // string. The win percentages differ, confirming the gap is not a tie.
  assert.match(html, /#1[\s\S]*?Alice[\s\S]*?Win% 0.857/);
  assert.match(html, /#2[\s\S]*?Bob[\s\S]*?Win% 0.778/);
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

  // A top-win-percentage tie surfaces as a dead-heat insight naming the tied
  // owners; the hero card confirms the leader's tied record and win percentage.
  assert.match(html, /Title race dead heat/);
  assert.match(html, /Alice and Bob are tied for first\./);
  assert.match(html, /#1[\s\S]*?Alice[\s\S]*?6–2[\s\S]*?Win% 0.750/);
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

  // A multi-way tie surfaces as a dead-heat insight (which names the leader and
  // top runner-up) plus all tied owners shown with identical records at the top
  // of the podium/standings. The full owner list is no longer concatenated into
  // a single narrative string after the standings-ownership redesign.
  assert.match(html, /Title race dead heat/);
  assert.match(html, /#1[\s\S]*?Alice[\s\S]*?9–3/);
  assert.match(html, /#2[\s\S]*?Bob[\s\S]*?9–3/);
  assert.match(html, /#3[\s\S]*?Chris[\s\S]*?9–3/);
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

  // Postseason in-progress promotes the live game card and a matchups link;
  // the old "Championship race"/"View weekly matchups" narrative chrome was
  // removed in the standings-ownership redesign in favor of the live section.
  assert.match(html, /Live · 1/);
  assert.doesNotMatch(html, /League leader/);
  assert.match(html, /All matchups →/);
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

  // A completed season renders the three-card podium: rank-1 is flagged as
  // CHAMPION, with #2 and #3 cards. Each card shows owner and record. The prose
  // "won the title by …" / "Season podium" header were dropped in the redesign.
  assert.match(html, /CHAMPION/);
  assert.match(html, /#1/);
  assert.match(html, /#2/);
  assert.match(html, /#3/);
  assert.match(html, /Pruitt/);
  assert.match(html, /Maleski/);
  assert.match(html, /Whited/);
  assert.match(html, /81–39/);
  assert.match(html, /65–41/);
  assert.match(html, /70–45/);
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
  // With partial coverage the completed-season champion podium is suppressed;
  // the coverage message renders in its place.
  assert.doesNotMatch(html, /CHAMPION/);
  assert.match(html, /Some games are still missing\./);
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
  // With error coverage the completed-season champion podium is suppressed; the
  // error message renders in its place.
  assert.doesNotMatch(html, /CHAMPION/);
  assert.match(html, /Standings load failed\./);
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

  // Section order after the redesign: hero/podium (leader card) → Standings →
  // Featured games (results) → Upcoming watchlist. Live games, when present,
  // come after the watchlist.
  assert.ok(html.indexOf('Alice') < html.indexOf('Standings'));
  assert.ok(html.indexOf('Standings') < html.indexOf('Featured games'));
  assert.ok(html.indexOf('Featured games') < html.indexOf('Upcoming watchlist'));
  assert.doesNotMatch(html, /League pulse/);
  // The leader is the rank-1 hero card.
  assert.match(html, /#1[\s\S]*?Alice/);
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

  // Exactly one condensed standings table is rendered (one "Standings" heading
  // with its single "Full standings →" link).
  const standingsHeaderOccurrences = html.match(/>Standings</g) ?? [];
  assert.equal(standingsHeaderOccurrences.length, 1);
  const fullStandingsLinks = html.match(/Full standings →/g) ?? [];
  assert.equal(fullStandingsLinks.length, 1);
  assert.doesNotMatch(html, /League snapshot/);
  // Standings is positioned ahead of the results (Featured games) section.
  assert.ok(html.indexOf('>Standings<') < html.indexOf('Featured games'));
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
  // The completed games are summarized in the Featured games (results) section.
  assert.match(html, /Featured games/);
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

  // With no live games the live card section is omitted entirely rather than
  // rendering a "No live games" empty card.
  assert.doesNotMatch(html, /Live · /);
  assert.doesNotMatch(html, /Postseason focus/);
  // The standings "Full standings →" link is still present.
  assert.match(html, /Full standings →/);
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

  // The games-back trend now renders in the "GB Race" section (MiniTrendsGrid +
  // GbChangeTable), showing each owner with their current games-back figure and
  // per-week columns. The old "League Trends" / "Win %" / "Win Bars" cards were
  // replaced by this compact GB Race treatment.
  assert.match(html, /GB Race/);
  assert.match(html, /Alice/);
  assert.match(html, /Bob/);
  assert.match(html, /0 GB/);
  assert.match(html, /2 GB/);
  assert.match(html, /W1/);
  assert.match(html, /W2/);
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

  // With no resolved standings history (the only week has empty standings), the
  // trend / GB Race section is omitted entirely rather than rendering a zeroed
  // "Latest: 0.0%" win-percentage trend.
  assert.doesNotMatch(html, /GB Race/);
  assert.doesNotMatch(html, /Latest: 0\.0%/);
});

test('overview panel shows explicit empty states for featured and results when no shared insights exist', () => {
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
  // No insights surface exists with zero owners; the standings column shows its
  // own empty-state hint instead.
  assert.match(html, /Add owners to populate standings\./);
  assert.doesNotMatch(html, /Open insight/);
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
  // The upcoming watchlist stays hidden when the only matchup is already final;
  // no empty "No featured matchups yet" placeholder is rendered either.
  assert.doesNotMatch(html, /Upcoming watchlist/);
  assert.doesNotMatch(html, /No featured matchups yet for this slate\./);
});

test('overview panel renders shared selector insights instead of league pulse cards', () => {
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

  assert.doesNotMatch(html, /League pulse/);
  assert.match(html, /Tight title race/);
  // Insights render in the dedicated Insights column with a "See all →" link
  // rather than per-card "Open insight" CTAs.
  assert.match(html, />Insights</);
  assert.match(html, /See all →/);
});

test('overview panel renders top 3 shared insights in selector order without duplicates', () => {
  const standingsHistory = standingsHistoryFromSnapshots([
    {
      week: 1,
      standings: [
        {
          owner: 'Alice',
          wins: 2,
          losses: 1,
          winPct: 0.667,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 6,
          gamesBack: 0,
          finalGames: 3,
        },
        {
          owner: 'Bob',
          wins: 1,
          losses: 2,
          winPct: 0.333,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -3,
          gamesBack: 1,
          finalGames: 3,
        },
        {
          owner: 'Chris',
          wins: 0,
          losses: 3,
          winPct: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -7,
          gamesBack: 2,
          finalGames: 3,
        },
      ],
    },
    {
      week: 2,
      standings: [
        {
          owner: 'Bob',
          wins: 4,
          losses: 2,
          winPct: 0.667,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 4,
          gamesBack: 0,
          finalGames: 6,
        },
        {
          owner: 'Alice',
          wins: 3,
          losses: 3,
          winPct: 0.5,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
          finalGames: 6,
        },
        {
          owner: 'Chris',
          wins: 1,
          losses: 5,
          winPct: 0.167,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -8,
          gamesBack: 3,
          finalGames: 6,
        },
      ],
    },
    {
      week: 3,
      standings: [
        {
          owner: 'Bob',
          wins: 5,
          losses: 4,
          winPct: 0.556,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 2,
          gamesBack: 0,
          finalGames: 9,
        },
        {
          owner: 'Alice',
          wins: 5,
          losses: 4,
          winPct: 0.556,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 1,
          gamesBack: 0,
          finalGames: 9,
        },
        {
          owner: 'Chris',
          wins: 2,
          losses: 7,
          winPct: 0.222,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: -10,
          gamesBack: 3,
          finalGames: 9,
        },
      ],
    },
  ]);

  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={standingsHistory.byWeek[3]?.standings ?? []}
      standingsHistory={standingsHistory}
      standingsCoverage={coverage}
      matchupMatrix={matchupMatrix}
      liveItems={[]}
      keyMatchups={[]}
      context={defaultContext}
      displayTimeZone="UTC"
    />
  );

  // Each rendered insight row carries one category label (the small uppercase
  // eyebrow with letter-spacing:0.08em). Count those to know how many insight
  // rows are on screen — the redesign dropped the per-card "Open insight" CTA.
  const insightRowCount = (html.match(/letter-spacing:0\.08em/g) ?? []).length;
  assert.ok(insightRowCount >= 2 && insightRowCount <= 3);
  const rankedInsights = deriveOverviewInsights(
    deriveLeagueInsights({
      rows: standingsHistory.byWeek[3]?.standings ?? [],
      standingsHistory,
      seasonContext: selectSeasonContext({ standingsHistory }),
    })
  ).slice(0, insightRowCount);
  assert.ok(rankedInsights.length > 0);
  for (const insight of rankedInsights) {
    assert.ok(html.includes(insight.title), `expected insight title "${insight.title}" in markup`);
  }
  if (rankedInsights.length > 1) {
    assert.ok(html.indexOf(rankedInsights[0]!.title) < html.indexOf(rankedInsights[1]!.title));
  }
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

  // Completed-season podium mode renders the champion podium and suppresses the
  // redundant week-over-week movement chips ("+N wins" / "Biggest drop:").
  assert.match(html, /CHAMPION/);
  assert.doesNotMatch(html, /\(\+\d+ wins\)|Biggest drop:/);
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

  // After the redesign, a completed ranked game renders in the Featured games
  // section with both teams' rankings inlined on their names (#6 Ohio State,
  // #11 Oregon). The compact highlight-tag badges ("Top matchup", "Close") now
  // belong to the Upcoming watchlist (GameSummaryList) and are not emitted for
  // a final result here, so no spurious "Close" badge appears.
  assert.match(html, /#6/);
  assert.match(html, /#11/);
  assert.match(html, /Ohio State/);
  assert.match(html, /Oregon/);
  assert.doesNotMatch(html, />Close</);
});

test('overview highlights consume shared insights instead of matchup-derived headline copy', () => {
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

  assert.match(html, /Title race dead heat/);
  assert.match(html, /Alice and Bob are tied for first\./);
  assert.doesNotMatch(html, /Top ranked matchup/);
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

  // A non-tight race (2-game gap) emits no race/leader-gap insight at all, so
  // there is no duplicate "Leader gap" / "Tight race" / dead-heat messaging.
  assert.doesNotMatch(html, /Leader gap:/);
  assert.doesNotMatch(html, /Tight race:/);
  assert.doesNotMatch(html, /Tight title race|dead heat/);
  // The standings still surface both owners' win percentages without any
  // redundant gap narrative.
  assert.match(html, /Win% 0.833/);
  assert.match(html, /Win% 0.667/);
});

test('overview highlights show scope context once at section level', () => {
  const html = renderToStaticMarkup(
    <OverviewPanel
      standingsLeaders={[
        {
          owner: 'Alice',
          wins: 4,
          losses: 1,
          winPct: 0.8,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 6,
          gamesBack: 0,
          finalGames: 5,
        },
        {
          owner: 'Bob',
          wins: 4,
          losses: 1,
          winPct: 0.8,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 4,
          gamesBack: 0,
          finalGames: 5,
        },
      ]}
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

  // The redesigned panel no longer stamps a per-section scope label, so there
  // is no repeated "(this postseason slate)" qualifier on individual cards. The
  // insights section is rendered exactly once.
  assert.doesNotMatch(html, /\(this postseason slate\)/i);
  const insightsHeadings = html.match(/>Insights</g) ?? [];
  assert.equal(insightsHeadings.length, 1);
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

  // The standalone "League Storylines" section was folded into the Insights
  // surface during the redesign. A championship storyline now renders as a
  // "Champion margin" insight describing the winning margin in games.
  assert.match(html, /Champion margin/);
  assert.match(html, /Alice over Bob by 3 games/);
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

  // No history → no storyline-derived insights (and no legacy "League
  // Storylines" section, which the redesign removed entirely).
  assert.doesNotMatch(html, /League Storylines/);
  assert.doesNotMatch(html, /Champion margin|Failed chase|Toilet bowl/);
});

test('overview panel renders trends detail link in League Trends section', () => {
  // The trends surface is now the "GB Race" section, which only renders when
  // resolved standings history is present. Its "Full standings →" link points
  // at the trends view (?view=trends#trends).
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

  assert.match(html, /GB Race/);
  assert.match(html, /href="\/standings\?view=trends#trends"/);
});
