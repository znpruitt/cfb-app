import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeGameTags,
  computeStandings,
  prioritizeGameTags,
  deriveGameHighlightTags,
  deriveGameMovementInsights,
  deriveOverviewHighlightSignals,
} from '../gameTags.ts';
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

test('deriveGameMovementInsights includes leader gap and ranked matchup priority', () => {
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

  const insights = deriveGameMovementInsights({
    standings,
    recentResults: [rankedGame],
    liveGames: [],
    rankingsByTeamId,
  });

  assert.equal(insights[0]?.text, 'Pruitt leads by 0.077 win%');
  assert.ok(insights.some((insight) => insight.text.includes('#7 vs #14 matchup this week')));
});

test('deriveGameMovementInsights adds leader gap widened cue when prior snapshot gap was smaller', () => {
  const insights = deriveGameMovementInsights({
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

test('deriveGameMovementInsights includes close-game count', () => {
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

  const insights = deriveGameMovementInsights({
    standings,
    recentResults: [closeGame],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });

  assert.ok(insights.some((insight) => insight.text === '1 close game this week'));
});

test('deriveGameMovementInsights includes biggest gain movement signal from standings deltas', () => {
  const insights = deriveGameMovementInsights({
    standings: [
      {
        owner: 'Alex',
        wins: 6,
        losses: 1,
        winPct: 0.857,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 22,
        gamesBack: 0,
        finalGames: 7,
      },
      {
        owner: 'Blair',
        wins: 3,
        losses: 4,
        winPct: 0.429,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: -14,
        gamesBack: 3,
        finalGames: 7,
      },
    ],
    previousStandings: [
      {
        owner: 'Alex',
        wins: 5,
        losses: 2,
        winPct: 0.714,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 5,
        gamesBack: 0,
        finalGames: 7,
      },
      {
        owner: 'Blair',
        wins: 2,
        losses: 5,
        winPct: 0.286,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: -2,
        gamesBack: 3,
        finalGames: 7,
      },
    ],
    recentResults: [],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });

  assert.ok(insights.some((insight) => insight.text === 'Biggest gain: Alex (+1 wins)'));
});

test('deriveGameMovementInsights includes biggest drop movement signal from standings deltas', () => {
  const insights = deriveGameMovementInsights({
    standings: [
      {
        owner: 'Alex',
        wins: 6,
        losses: 2,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 22,
        gamesBack: 0,
        finalGames: 8,
      },
      {
        owner: 'Blair',
        wins: 4,
        losses: 4,
        winPct: 0.5,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: -14,
        gamesBack: 2,
        finalGames: 8,
      },
    ],
    previousStandings: [
      {
        owner: 'Alex',
        wins: 6,
        losses: 2,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 20,
        gamesBack: 0,
        finalGames: 8,
      },
      {
        owner: 'Blair',
        wins: 4,
        losses: 2,
        winPct: 0.667,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: -4,
        gamesBack: 1,
        finalGames: 6,
      },
    ],
    recentResults: [],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });

  assert.ok(insights.some((insight) => insight.text === 'Biggest drop: Blair (-2)'));
});

test('deriveGameMovementInsights movement signals are absent when no prior standings snapshot exists', () => {
  const insights = deriveGameMovementInsights({
    standings,
    recentResults: [],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });

  assert.ok(!insights.some((insight) => insight.text.startsWith('Biggest gain:')));
  assert.ok(!insights.some((insight) => insight.text.startsWith('Biggest drop:')));
});

test('deriveGameMovementInsights uses previous standings snapshot for top-rank movement', () => {
  const insights = deriveGameMovementInsights({
    standings: [
      {
        owner: 'Alex',
        wins: 6,
        losses: 2,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 19,
        gamesBack: 0,
        finalGames: 8,
      },
      {
        owner: 'Blair',
        wins: 6,
        losses: 2,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 10,
        gamesBack: 0,
        finalGames: 8,
      },
      {
        owner: 'Casey',
        wins: 5,
        losses: 3,
        winPct: 0.625,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 1,
        finalGames: 8,
      },
    ],
    previousStandings: [
      {
        owner: 'Blair',
        wins: 6,
        losses: 2,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 15,
        gamesBack: 0,
        finalGames: 8,
      },
      {
        owner: 'Alex',
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
        owner: 'Casey',
        wins: 5,
        losses: 3,
        winPct: 0.625,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 1,
        finalGames: 8,
      },
    ],
    recentResults: [],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });

  assert.ok(insights.some((insight) => insight.id === 'rank-movement-Alex'));
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

test('deriveGameMovementInsights shows top-two result only for final top-two head-to-head', () => {
  const finalTopTwoGame = item(game({ key: 'top-two-final' }), 'Pruitt', 'Maleski');
  finalTopTwoGame.score = {
    status: 'FINAL',
    away: { team: 'Away', score: 35 },
    home: { team: 'Home', score: 31 },
    time: null,
  };

  const insights = deriveGameMovementInsights({
    standings,
    recentResults: [finalTopTwoGame],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });

  assert.ok(insights.some((insight) => insight.text === 'Top 2 matchup result'));
});

test('deriveGameMovementInsights does not show top-two result for scheduled or live top-two games', () => {
  const scheduledTopTwoGame = item(game({ key: 'top-two-scheduled' }), 'Pruitt', 'Maleski');
  const liveTopTwoGame = item(game({ key: 'top-two-live' }), 'Pruitt', 'Maleski');
  liveTopTwoGame.score = {
    status: 'Q3',
    away: { team: 'Away', score: 14 },
    home: { team: 'Home', score: 10 },
    time: '05:44',
  };

  const scheduledInsights = deriveGameMovementInsights({
    standings,
    recentResults: [scheduledTopTwoGame],
    liveGames: [],
    rankingsByTeamId: new Map(),
  });
  const liveInsights = deriveGameMovementInsights({
    standings,
    recentResults: [liveTopTwoGame],
    liveGames: [liveTopTwoGame],
    rankingsByTeamId: new Map(),
  });

  assert.ok(!scheduledInsights.some((insight) => insight.text === 'Top 2 matchup result'));
  assert.ok(!liveInsights.some((insight) => insight.text === 'Top 2 matchup result'));
  assert.ok(liveInsights.some((insight) => insight.text === '1 live game affecting standings'));
});

test('deriveGameMovementInsights does not show top-two result for final game with only one top-two owner', () => {
  const finalOneTopTwoOwnerGame = item(game({ key: 'one-top-two-final' }), 'Pruitt', 'Whited');
  finalOneTopTwoOwnerGame.score = {
    status: 'FINAL',
    away: { team: 'Away', score: 28 },
    home: { team: 'Home', score: 24 },
    time: null,
  };

  const insights = deriveGameMovementInsights({
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

test('computeGameTags marks Top 25 when both teams are ranked', () => {
  const taggedGame = game({ key: 'top-25', csvAway: 'Dogs', csvHome: 'Cats' });
  const ownership = new Map<string, string>();
  const rankingsByTeamId = new Map([
    ['a', { rank: 8, rankSource: 'ap' as const }],
    ['h', { rank: 19, rankSource: 'ap' as const }],
  ]);

  assert.deepEqual(computeGameTags(taggedGame, undefined, undefined, ownership, rankingsByTeamId), [
    'top_25_matchup',
  ]);
});

test('computeGameTags marks upset watch for live underdog lead when favored by odds', () => {
  const taggedGame = game({ key: 'upset-watch-live', csvAway: 'Dogs', csvHome: 'Cats' });
  const ownership = new Map<string, string>();
  const score = {
    status: 'In Progress',
    away: { team: 'Dogs', score: 24 },
    home: { team: 'Cats', score: 17 },
    time: '02:01',
  };
  const odds = {
    favorite: 'Cats',
    spread: -7.5,
    homeSpread: -7.5,
    awaySpread: 7.5,
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

  assert.deepEqual(computeGameTags(taggedGame, score, odds, ownership), ['upset_watch']);
});

test('computeGameTags marks upset for final underdog win', () => {
  const taggedGame = game({ key: 'upset-final', csvAway: 'A', csvHome: 'B' });
  const ownership = new Map<string, string>();
  const score = {
    status: 'Final',
    away: { team: 'A', score: 31 },
    home: { team: 'B', score: 27 },
    time: null,
  };
  const odds = {
    favorite: 'B',
    spread: -7.5,
    homeSpread: -7.5,
    awaySpread: 7.5,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    total: 49.5,
    mlHome: -260,
    mlAway: 210,
    overPrice: -110,
    underPrice: -110,
    source: 'DraftKings',
    bookmakerKey: 'draftkings',
    capturedAt: '2026-09-01T17:00:00.000Z',
    lineSourceStatus: 'latest' as const,
  };

  assert.deepEqual(computeGameTags(taggedGame, score, odds, ownership), ['upset']);
});

test('computeGameTags applies priority ordering when multiple tags apply', () => {
  const taggedGame = game({ key: 'tag-priority', csvAway: 'A-Team', csvHome: 'B-Team' });
  const ownership = new Map<string, string>();
  const rankingsByTeamId = new Map([
    ['a', { rank: 15, rankSource: 'ap' as const }],
    ['h', { rank: 6, rankSource: 'ap' as const }],
  ]);
  const score = {
    status: 'FINAL',
    away: { team: 'A-Team', score: 34 },
    home: { team: 'B-Team', score: 31 },
    time: null,
  };
  const odds = {
    favorite: 'B-Team',
    spread: -6.5,
    homeSpread: -6.5,
    awaySpread: 6.5,
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

  const prioritized = prioritizeGameTags(
    computeGameTags(taggedGame, score, odds, ownership, rankingsByTeamId)
  );
  assert.equal(prioritized.primary, 'upset');
  assert.deepEqual(prioritized.secondary, ['top_25_matchup']);
});

test('computeGameTags returns no tags when data is insufficient', () => {
  const taggedGame = game({ key: 'insufficient', csvAway: 'A-Team', csvHome: 'B-Team' });
  const ownership = new Map<string, string>();
  const score = {
    status: 'Scheduled',
    away: { team: 'A-Team', score: null },
    home: { team: 'B-Team', score: null },
    time: null,
  };
  assert.deepEqual(computeGameTags(taggedGame, score, undefined, ownership), []);
});

test('computeGameTags does not emit Top 25 when rankings are unavailable', () => {
  const taggedGame = game({ key: 'no-rankings-top25', csvAway: 'A-Team', csvHome: 'B-Team' });
  const ownership = new Map<string, string>();
  const odds = {
    favorite: 'B-Team',
    spread: -7,
    homeSpread: -7,
    awaySpread: 7,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    total: 49.5,
    mlHome: -180,
    mlAway: 160,
    overPrice: -110,
    underPrice: -110,
    source: 'DraftKings',
    bookmakerKey: 'draftkings',
    capturedAt: '2026-09-01T17:00:00.000Z',
    lineSourceStatus: 'latest' as const,
  };
  const score = {
    status: 'In Progress',
    away: { team: 'A-Team', score: 10 },
    home: { team: 'B-Team', score: 17 },
    time: '09:11',
  };

  assert.deepEqual(computeGameTags(taggedGame, score, odds, ownership), []);
});

test('prioritizeGameTags applies upset > upset_watch > top_25_matchup ordering with dedupe', () => {
  const prioritized = prioritizeGameTags(['top_25_matchup', 'upset_watch', 'upset', 'upset_watch']);
  assert.equal(prioritized.primary, 'upset');
  assert.deepEqual(prioritized.secondary, ['upset_watch', 'top_25_matchup']);
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
