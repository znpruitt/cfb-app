import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveGameHighlightTags, deriveLeagueInsights } from '../leagueInsights.ts';
import type { OverviewGameItem } from '../overview.ts';
import type { TeamRankingEnrichment } from '../rankings.ts';
import type { AppGame } from '../schedule.ts';
import type { OwnerStandingsRow } from '../standings.ts';

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

function item(gameValue: AppGame, awayOwner = 'Alice', homeOwner = 'Bob'): OverviewGameItem {
  return {
    bucket: {
      game: gameValue,
      awayOwner,
      homeOwner,
      awayIsLeagueTeam: true,
      homeIsLeagueTeam: true,
    },
    priority: 2,
    sortDate: 1,
  };
}

const standings: OwnerStandingsRow[] = [
  {
    owner: 'Pruitt',
    wins: 11,
    losses: 2,
    winPct: 0.846,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDifferential: 0,
    gamesBack: 0,
    finalGames: 13,
  },
  {
    owner: 'Maleski',
    wins: 10,
    losses: 3,
    winPct: 0.769,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDifferential: 0,
    gamesBack: 1,
    finalGames: 13,
  },
  {
    owner: 'Whited',
    wins: 9,
    losses: 4,
    winPct: 0.692,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDifferential: 0,
    gamesBack: 2,
    finalGames: 13,
  },
];

test('deriveLeagueInsights includes leader gap and ranked matchup priority', () => {
  const rankingsByTeamId = new Map<string, TeamRankingEnrichment>([
    ['texas', { rank: 7, rankSource: 'ap' }],
    ['georgia', { rank: 14, rankSource: 'ap' }],
  ]);
  const rankedGame = item(
    game({
      key: 'tx-uga',
      csvAway: 'Texas',
      csvHome: 'Georgia',
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
          teamId: 'georgia',
          displayName: 'Georgia',
          canonicalName: 'Georgia',
          rawName: 'Georgia',
        },
      },
    })
  );

  const insights = deriveLeagueInsights({
    standings,
    recentResults: [rankedGame],
    liveGames: [],
    rankingsByTeamId,
  });

  assert.equal(insights[0]?.text, 'Pruitt leads by 0.077 win%');
  assert.ok(insights.some((insight) => insight.text.includes('#7 vs #14 matchup this week')));
});

test('deriveLeagueInsights adds leader gap widened cue when prior snapshot gap was smaller', () => {
  const insights = deriveLeagueInsights({
    standings,
    previousStandings: [
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
        winPct: 0.78,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 1,
        finalGames: 12,
      },
    ],
    recentResults: [],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });

  assert.ok(insights.some((insight) => insight.text === 'Leader gap widened to 0.077'));
});

test('deriveLeagueInsights includes close-game count', () => {
  const closeGame = item(
    game({
      key: 'close',
      canAway: 'team-a',
      canHome: 'team-b',
    })
  );
  closeGame.score = {
    status: 'FINAL',
    away: { team: 'A', score: 31 },
    home: { team: 'B', score: 28 },
    time: null,
  };

  const insights = deriveLeagueInsights({
    standings,
    recentResults: [closeGame],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });

  assert.ok(insights.some((insight) => insight.text === '1 close game this week'));
});

test('deriveLeagueInsights shows top-two result only for final top-two head-to-head', () => {
  const finalTopTwoGame = item(game({ key: 'top-two-final' }), 'Pruitt', 'Maleski');
  finalTopTwoGame.score = {
    status: 'FINAL',
    away: { team: 'Away', score: 35 },
    home: { team: 'Home', score: 31 },
    time: null,
  };

  const insights = deriveLeagueInsights({
    standings,
    recentResults: [finalTopTwoGame],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });

  assert.ok(insights.some((insight) => insight.text === 'Top 2 matchup result'));
});

test('deriveLeagueInsights does not show top-two result for scheduled or live top-two games', () => {
  const scheduledTopTwoGame = item(game({ key: 'top-two-scheduled' }), 'Pruitt', 'Maleski');
  const liveTopTwoGame = item(game({ key: 'top-two-live' }), 'Pruitt', 'Maleski');
  liveTopTwoGame.score = {
    status: 'Q3',
    away: { team: 'Away', score: 14 },
    home: { team: 'Home', score: 10 },
    time: '05:44',
  };

  const scheduledInsights = deriveLeagueInsights({
    standings,
    recentResults: [scheduledTopTwoGame],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });
  const liveInsights = deriveLeagueInsights({
    standings,
    recentResults: [liveTopTwoGame],
    liveGames: [liveTopTwoGame],
    rankingsByTeamId: new Map(),
  });

  assert.ok(!scheduledInsights.some((insight) => insight.text === 'Top 2 matchup result'));
  assert.ok(!liveInsights.some((insight) => insight.text === 'Top 2 matchup result'));
  assert.ok(liveInsights.some((insight) => insight.text === '1 live game affecting standings'));
});

test('deriveLeagueInsights does not show top-two result for final game with only one top-two owner', () => {
  const finalOneTopTwoOwnerGame = item(game({ key: 'one-top-two-final' }), 'Pruitt', 'Whited');
  finalOneTopTwoOwnerGame.score = {
    status: 'FINAL',
    away: { team: 'Away', score: 28 },
    home: { team: 'Home', score: 24 },
    time: null,
  };

  const insights = deriveLeagueInsights({
    standings,
    recentResults: [finalOneTopTwoOwnerGame],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });

  assert.ok(!insights.some((insight) => insight.text === 'Top 2 matchup result'));
});

test('deriveGameHighlightTags prioritizes top-25 then top-matchup badges and caps tag count', () => {
  const rankedCloseGame = item(
    game({
      key: 'badge-game',
      participants: {
        away: {
          kind: 'team',
          teamId: 'away',
          displayName: 'Away',
          canonicalName: 'Away',
          rawName: 'Away',
        },
        home: {
          kind: 'team',
          teamId: 'home',
          displayName: 'Home',
          canonicalName: 'Home',
          rawName: 'Home',
        },
      },
    }),
    'Pruitt',
    'Maleski'
  );
  rankedCloseGame.score = {
    status: 'FINAL',
    away: { team: 'Away', score: 24 },
    home: { team: 'Home', score: 21 },
    time: null,
  };

  const tags = deriveGameHighlightTags({
    item: rankedCloseGame,
    rankingsByTeamId: new Map([
      ['away', { rank: 6, rankSource: 'ap' }],
      ['home', { rank: 11, rankSource: 'ap' }],
    ]),
    topOwners: new Set(['Pruitt', 'Maleski', 'Whited']),
  });

  assert.deepEqual(
    tags.map((tag) => tag.text),
    ['#6 vs #11', 'Top matchup']
  );
});

test('deriveGameHighlightTags adds close tag for seven-point margin when no higher tags exist', () => {
  const closeGame = item(
    game({ key: 'close-only', canAway: 'away', canHome: 'home' }),
    'Dan',
    'Eli'
  );
  closeGame.score = {
    status: 'FINAL',
    away: { team: 'Away', score: 17 },
    home: { team: 'Home', score: 10 },
    time: null,
  };

  const tags = deriveGameHighlightTags({
    item: closeGame,
    rankingsByTeamId: new Map(),
    topOwners: new Set(['Pruitt', 'Maleski', 'Whited']),
  });

  assert.equal(tags[0]?.text, 'Close');
});
