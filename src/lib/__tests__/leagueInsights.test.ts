import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeGameTags,
  computeStandings,
  computeWeeklyInsights,
  prioritizeGameTags,
  deriveGameHighlightTags,
  deriveLeagueInsights,
  deriveOverviewHighlightSignals,
} from '../leagueInsights.ts';
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

test('deriveLeagueInsights includes biggest gain and biggest drop movement signals', () => {
  const gameOne = item(game({ key: 'movement-1' }), 'Alex', 'Blair');
  gameOne.score = {
    status: 'FINAL',
    away: { team: 'Away', score: 31 },
    home: { team: 'Home', score: 21 },
    time: null,
  };
  const gameTwo = item(game({ key: 'movement-2' }), 'Alex', 'Blair');
  gameTwo.score = {
    status: 'In Progress',
    away: { team: 'Away', score: 24 },
    home: { team: 'Home', score: 10 },
    time: '04:11',
  };

  const insights = deriveLeagueInsights({
    standings,
    recentResults: [gameOne, gameTwo],
    liveGames: [gameTwo],
    rankingsByTeamId: new Map(),
  });

  assert.ok(insights.some((insight) => insight.text === 'Biggest gain: Alex (+2 wins)'));
  assert.ok(insights.some((insight) => insight.text === 'Biggest drop: Blair (-2)'));
});

test('deriveLeagueInsights movement signals require minimum two games per owner', () => {
  const singleResult = item(game({ key: 'movement-single' }), 'Alex', 'Blair');
  singleResult.score = {
    status: 'FINAL',
    away: { team: 'Away', score: 28 },
    home: { team: 'Home', score: 14 },
    time: null,
  };

  const insights = deriveLeagueInsights({
    standings,
    recentResults: [singleResult],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });

  assert.ok(!insights.some((insight) => insight.text.startsWith('Biggest gain:')));
  assert.ok(!insights.some((insight) => insight.text.startsWith('Biggest drop:')));
});

test('deriveLeagueInsights does not double-count same-owner matchup sides for movement qualification', () => {
  const selfOwned = item(game({ key: 'self-owned-single' }), 'Alex', 'Alex');
  selfOwned.score = {
    status: 'FINAL',
    away: { team: 'Away', score: 35 },
    home: { team: 'Home', score: 21 },
    time: null,
  };

  const insights = deriveLeagueInsights({
    standings,
    recentResults: [selfOwned],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });

  assert.ok(!insights.some((insight) => insight.text.startsWith('Biggest gain:')));
  assert.ok(!insights.some((insight) => insight.text.startsWith('Biggest drop:')));
});

test('deriveLeagueInsights same-owner matchups cannot emit both biggest gain and biggest drop', () => {
  const selfOwnedOne = item(game({ key: 'self-owned-1' }), 'Alex', 'Alex');
  selfOwnedOne.score = {
    status: 'FINAL',
    away: { team: 'Away', score: 31 },
    home: { team: 'Home', score: 24 },
    time: null,
  };
  const selfOwnedTwo = item(game({ key: 'self-owned-2' }), 'Alex', 'Alex');
  selfOwnedTwo.score = {
    status: 'FINAL',
    away: { team: 'Away', score: 17 },
    home: { team: 'Home', score: 14 },
    time: null,
  };

  const insights = deriveLeagueInsights({
    standings,
    recentResults: [selfOwnedOne, selfOwnedTwo],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });

  assert.ok(!insights.some((insight) => insight.text.startsWith('Biggest gain: Alex')));
  assert.ok(!insights.some((insight) => insight.text.startsWith('Biggest drop: Alex')));
});

test('deriveOverviewHighlightSignals picks deterministic top matchup and upset watch', () => {
  const topMatchup = item(game({ key: 'top-matchup' }), 'Alex', 'Blair');
  topMatchup.score = {
    status: 'In Progress',
    away: { team: 'Away', score: 24 },
    home: { team: 'Home', score: 20 },
    time: '03:20',
  };
  const upsetWatch = item(
    game({
      key: 'upset-watch',
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
    'Casey',
    'Drew'
  );
  upsetWatch.score = {
    status: 'In Progress',
    away: { team: 'Favorite Away', score: 10 },
    home: { team: 'Home Underdog', score: 24 },
    time: '07:44',
  };
  const rankedSpotlight = item(
    game({
      key: 'ranked-spotlight',
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
    }),
    'Evan',
    'Fran'
  );

  const signals = deriveOverviewHighlightSignals({
    keyMatchups: [rankedSpotlight, topMatchup, upsetWatch],
    rankingsByTeamId: new Map([
      ['favorite-away', { rank: 20, rankSource: 'ap' }],
      ['ranked-away', { rank: 7, rankSource: 'ap' }],
    ]),
  });

  assert.equal(signals.topMatchupKey, 'top-matchup');
  assert.deepEqual(signals.upsetWatchKeys, ['upset-watch']);
  assert.equal(signals.rankedHighlightKey, 'ranked-spotlight');
});

test('deriveOverviewHighlightSignals returns null top matchup when no distinct owner-vs-owner games exist', () => {
  const sameOwner = item(game({ key: 'same-owner' }), 'Alex', 'Alex');
  const singleOwned = item(game({ key: 'single-owned' }), 'Alex', 'Placeholder');
  singleOwned.bucket.homeOwner = undefined;
  const unowned = item(game({ key: 'unowned' }), 'Placeholder', 'Placeholder');
  unowned.bucket.awayOwner = undefined;
  unowned.bucket.homeOwner = undefined;

  const signals = deriveOverviewHighlightSignals({
    keyMatchups: [sameOwner, singleOwned, unowned],
    rankingsByTeamId: new Map(),
  });

  assert.equal(signals.topMatchupKey, null);
});

test('deriveOverviewHighlightSignals ignores non-rendered live items for top/ranked selection', () => {
  const displayedMatchup = item(
    game({
      key: 'displayed-matchup',
      participants: {
        away: {
          kind: 'team',
          teamId: 'displayed-away',
          displayName: 'Displayed Away',
          canonicalName: 'Displayed Away',
          rawName: 'Displayed Away',
        },
        home: {
          kind: 'team',
          teamId: 'displayed-home',
          displayName: 'Displayed Home',
          canonicalName: 'Displayed Home',
          rawName: 'Displayed Home',
        },
      },
    }),
    'Alex',
    'Blair'
  );
  displayedMatchup.score = {
    status: 'In Progress',
    away: { team: 'Displayed Away', score: 14 },
    home: { team: 'Displayed Home', score: 10 },
    time: '03:30',
  };

  const signals = deriveOverviewHighlightSignals({
    keyMatchups: [displayedMatchup],
    rankingsByTeamId: new Map([
      ['displayed-away', { rank: 12, rankSource: 'ap' }],
      ['displayed-home', { rank: 19, rankSource: 'ap' }],
      ['offscope-away', { rank: 1, rankSource: 'ap' }],
    ]),
  });

  assert.equal(signals.topMatchupKey, 'displayed-matchup');
  assert.equal(signals.rankedHighlightKey, 'displayed-matchup');
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

test('computeStandings sorts by win pct, wins, then point differential', () => {
  const gamesList = [
    game({ key: 's1', csvAway: 'A-Team', csvHome: 'B-Team' }),
    game({ key: 's2', csvAway: 'A-Team', csvHome: 'C-Team' }),
    game({ key: 's3', csvAway: 'B-Team', csvHome: 'C-Team' }),
  ];
  const ownership = new Map([
    ['A-Team', 'Alex'],
    ['B-Team', 'Blake'],
    ['C-Team', 'Casey'],
  ]);
  const scores = {
    s1: {
      status: 'Final',
      away: { team: 'A-Team', score: 24 },
      home: { team: 'B-Team', score: 20 },
      time: null,
    },
    s2: {
      status: 'Final',
      away: { team: 'A-Team', score: 17 },
      home: { team: 'C-Team', score: 21 },
      time: null,
    },
    s3: {
      status: 'In Progress',
      away: { team: 'B-Team', score: 10 },
      home: { team: 'C-Team', score: 7 },
      time: '04:12',
    },
  };

  const standingsRows = computeStandings(gamesList, scores, ownership);
  assert.deepEqual(
    standingsRows.map((row) => [row.owner, row.wins, row.losses, row.liveGames]),
    [
      ['Casey', 1, 0, 1],
      ['Alex', 1, 1, 0],
      ['Blake', 0, 1, 1],
    ]
  );
});

test('computeWeeklyInsights returns owner activity and owned game totals', () => {
  const gamesList = [
    game({ key: 'w1', csvAway: 'A-Team', csvHome: 'B-Team' }),
    game({ key: 'w2', csvAway: 'A-Team', csvHome: 'Open' }),
    game({ key: 'w3', csvAway: 'C-Team', csvHome: 'D-Team' }),
  ];
  const ownership = new Map([
    ['A-Team', 'Alex'],
    ['B-Team', 'Blake'],
    ['C-Team', 'Casey'],
  ]);
  const scores = {
    w1: {
      status: 'Final',
      away: { team: 'A-Team', score: 31 },
      home: { team: 'B-Team', score: 20 },
      time: null,
    },
    w2: {
      status: 'In Progress',
      away: { team: 'A-Team', score: 14 },
      home: { team: 'Open', score: 7 },
      time: '09:33',
    },
  };

  const insights = computeWeeklyInsights(gamesList, scores, ownership);
  assert.equal(insights.mostActiveOwner, 'Alex');
  assert.equal(insights.mostActiveGames, 2);
  assert.equal(insights.ownedVsOwnedGames, 1);
  assert.equal(insights.totalOwnedGames, 3);
  assert.equal(insights.leaderThisWeek, 'Alex');
});

test('computeWeeklyInsights excludes same-owner matchups from owner-vs-owner totals', () => {
  const gamesList = [game({ key: 'same-owner', csvAway: 'A-Team', csvHome: 'B-Team' })];
  const ownership = new Map([
    ['A-Team', 'Alex'],
    ['B-Team', 'Alex'],
  ]);

  const insights = computeWeeklyInsights(gamesList, {}, ownership);
  assert.equal(insights.totalOwnedGames, 1);
  assert.equal(insights.ownedVsOwnedGames, 0);
});

test('computeWeeklyInsights counts owner-vs-owner games when owners differ', () => {
  const gamesList = [game({ key: 'different-owner', csvAway: 'A-Team', csvHome: 'B-Team' })];
  const ownership = new Map([
    ['A-Team', 'Alex'],
    ['B-Team', 'Blair'],
  ]);

  const insights = computeWeeklyInsights(gamesList, {}, ownership);
  assert.equal(insights.totalOwnedGames, 1);
  assert.equal(insights.ownedVsOwnedGames, 1);
});

test('computeGameTags marks swing, upset, and even scenarios', () => {
  const taggedGame = game({ key: 't1', csvAway: 'Dogs', csvHome: 'Cats' });
  const ownership = new Map([
    ['Dogs', 'Dana'],
    ['Cats', 'Eli'],
  ]);
  const score = {
    status: 'In Progress',
    away: { team: 'Dogs', score: 24 },
    home: { team: 'Cats', score: 17 },
    time: '02:01',
  };
  const odds = {
    favorite: 'Cats',
    spread: -2.5,
    homeSpread: -2.5,
    awaySpread: 2.5,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    total: 52.5,
    mlHome: -130,
    mlAway: 110,
    overPrice: -108,
    underPrice: -112,
    source: 'DraftKings',
    bookmakerKey: 'draftkings',
    capturedAt: '2026-09-01T17:00:00.000Z',
    lineSourceStatus: 'latest' as const,
  };

  assert.deepEqual(computeGameTags(taggedGame, score, odds, ownership), ['swing', 'upset', 'even']);
});

test('computeGameTags marks swing for owned-vs-owned even without odds', () => {
  const taggedGame = game({ key: 't-swing', csvAway: 'A', csvHome: 'B' });
  const ownership = new Map([
    ['A', 'Owner A'],
    ['B', 'Owner B'],
  ]);

  assert.deepEqual(computeGameTags(taggedGame, undefined, undefined, ownership), ['swing']);
});

test('computeGameTags applies even tag on spread threshold boundary', () => {
  const taggedGame = game({ key: 't-even-boundary', csvAway: 'A', csvHome: 'B' });
  const ownership = new Map([['A', 'Owner A']]);
  const score = {
    status: 'Scheduled',
    away: { team: 'A', score: null },
    home: { team: 'B', score: null },
    time: null,
  };
  const odds = {
    favorite: 'A',
    spread: -3,
    homeSpread: 3,
    awaySpread: -3,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    total: 49.5,
    mlHome: 120,
    mlAway: -140,
    overPrice: -110,
    underPrice: -110,
    source: 'DraftKings',
    bookmakerKey: 'draftkings',
    capturedAt: '2026-09-01T17:00:00.000Z',
    lineSourceStatus: 'latest' as const,
  };

  assert.deepEqual(computeGameTags(taggedGame, score, odds, ownership), ['even']);
});

test('computeGameTags detects neutral-site live upset using team identity fields', () => {
  const neutralGame = game({
    key: 't-neutral-upset',
    neutral: true,
    csvAway: 'Ole Miss',
    canAway: 'OleMiss',
    csvHome: 'LSU',
    canHome: 'LSU',
    participants: {
      away: {
        kind: 'team',
        teamId: 'olemiss',
        displayName: 'Mississippi',
        canonicalName: 'Mississippi',
        rawName: 'Ole Miss',
      },
      home: {
        kind: 'team',
        teamId: 'lsu',
        displayName: 'LSU',
        canonicalName: 'LSU',
        rawName: 'LSU',
      },
    },
  });
  const ownership = new Map([
    ['olemiss', 'Dana'],
    ['lsu', 'Eli'],
  ]);
  const score = {
    status: 'In Progress',
    away: { team: 'Ole Miss', score: 17 },
    home: { team: 'LSU', score: 10 },
    time: '04:44',
  };
  const odds = {
    favorite: 'LSU',
    spread: -4.5,
    homeSpread: -4.5,
    awaySpread: 4.5,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    total: 56.5,
    mlHome: -180,
    mlAway: 155,
    overPrice: -110,
    underPrice: -110,
    source: 'DraftKings',
    bookmakerKey: 'draftkings',
    capturedAt: '2026-09-01T17:00:00.000Z',
    lineSourceStatus: 'latest' as const,
  };

  assert.deepEqual(computeGameTags(neutralGame, score, odds, ownership), ['swing', 'upset']);
});

test('computeGameTags keeps deterministic behavior when odds are missing', () => {
  const taggedGame = game({ key: 't-no-odds', csvAway: 'A-Team', csvHome: 'B-Team' });
  const ownership = new Map([
    ['A-Team', 'Alex'],
    ['B-Team', 'Blair'],
  ]);
  const score = {
    status: 'In Progress',
    away: { team: 'A-Team', score: 7 },
    home: { team: 'B-Team', score: 3 },
    time: '12:00',
  };

  assert.deepEqual(computeGameTags(taggedGame, score, undefined, ownership), ['swing']);
});

test('computeGameTags does not label upset when side spreads are equal non-zero', () => {
  const taggedGame = game({ key: 'equal-spreads', csvAway: 'A-Team', csvHome: 'B-Team' });
  const ownership = new Map([
    ['A-Team', 'Alex'],
    ['B-Team', 'Blair'],
  ]);
  const score = {
    status: 'In Progress',
    away: { team: 'A-Team', score: 14 },
    home: { team: 'B-Team', score: 10 },
    time: '08:00',
  };
  const odds = {
    favorite: 'B-Team',
    spread: 0,
    homeSpread: -3,
    awaySpread: -3,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    total: 49.5,
    mlHome: -110,
    mlAway: -110,
    overPrice: -110,
    underPrice: -110,
    source: 'DraftKings',
    bookmakerKey: 'draftkings',
    capturedAt: '2026-09-01T17:00:00.000Z',
    lineSourceStatus: 'latest' as const,
  };

  assert.deepEqual(computeGameTags(taggedGame, score, odds, ownership), ['swing', 'even']);
});

test("computeGameTags does not label upset on pick'em side spreads", () => {
  const taggedGame = game({ key: 'pickem-spreads', csvAway: 'A-Team', csvHome: 'B-Team' });
  const ownership = new Map([
    ['A-Team', 'Alex'],
    ['B-Team', 'Blair'],
  ]);
  const score = {
    status: 'In Progress',
    away: { team: 'A-Team', score: 21 },
    home: { team: 'B-Team', score: 17 },
    time: '05:30',
  };
  const odds = {
    favorite: 'B-Team',
    spread: 0,
    homeSpread: 0,
    awaySpread: 0,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    total: 51.5,
    mlHome: -110,
    mlAway: -110,
    overPrice: -110,
    underPrice: -110,
    source: 'DraftKings',
    bookmakerKey: 'draftkings',
    capturedAt: '2026-09-01T17:00:00.000Z',
    lineSourceStatus: 'latest' as const,
  };

  assert.deepEqual(computeGameTags(taggedGame, score, odds, ownership), ['swing', 'even']);
});

test('computeGameTags falls back to odds.favorite when side spreads are incomplete', () => {
  const taggedGame = game({ key: 'favorite-fallback', csvAway: 'A-Team', csvHome: 'B-Team' });
  const ownership = new Map([
    ['A-Team', 'Alex'],
    ['B-Team', 'Blair'],
  ]);
  const score = {
    status: 'In Progress',
    away: { team: 'A-Team', score: 17 },
    home: { team: 'B-Team', score: 10 },
    time: '03:41',
  };
  const odds = {
    favorite: 'B-Team',
    spread: -4.5,
    homeSpread: -4.5,
    awaySpread: null,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    total: 54.5,
    mlHome: -180,
    mlAway: 160,
    overPrice: -110,
    underPrice: -110,
    source: 'DraftKings',
    bookmakerKey: 'draftkings',
    capturedAt: '2026-09-01T17:00:00.000Z',
    lineSourceStatus: 'latest' as const,
  };

  assert.deepEqual(computeGameTags(taggedGame, score, odds, ownership), ['swing', 'upset']);
});

test('computeWeeklyInsights reports no live leader when games are not live', () => {
  const insights = computeWeeklyInsights(
    [game({ key: 'no-live', csvAway: 'A-Team', csvHome: 'B-Team' })],
    {
      'no-live': {
        status: 'Scheduled',
        away: { team: 'A-Team', score: null },
        home: { team: 'B-Team', score: null },
        time: null,
      },
    },
    new Map([
      ['A-Team', 'Alex'],
      ['B-Team', 'Blair'],
    ])
  );

  assert.equal(insights.mostLiveGames, 0);
  assert.equal(insights.mostLiveOwner, null);
});

test('prioritizeGameTags applies swing > upset > even ordering with dedupe', () => {
  const prioritized = prioritizeGameTags(['even', 'swing', 'upset', 'swing']);
  assert.equal(prioritized.primary, 'swing');
  assert.deepEqual(prioritized.secondary, ['upset', 'even']);
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
