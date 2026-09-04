import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveLeagueSummaryViewModel,
  deriveStandingsContextLabel,
  prioritizeOverviewItems,
  selectOverviewViewModel,
} from '../selectors/overview';
import type { OverviewContext } from '../overview';
import type { OverviewGameItem } from '../overview';
import type { AppGame } from '../schedule';
import type { StandingsHistory } from '../standingsHistory';
import type { StandingsCoverage } from '../standings';

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? 'e',
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? 1,
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
      away: {
        kind: 'team',
        teamId: 'away-id',
        displayName: 'Away',
        canonicalName: 'Away',
        rawName: 'Away',
      },
      home: {
        kind: 'team',
        teamId: 'home-id',
        displayName: 'Home',
        canonicalName: 'Home',
        rawName: 'Home',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? 'Away',
    canHome: overrides.canHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'SEC',
    sources: overrides.sources,
  };
}

function item(
  key: string,
  date = '2026-09-01T17:00:00.000Z',
  gameOverrides: Partial<AppGame> = {}
): OverviewGameItem {
  return {
    bucket: {
      game: game({ ...gameOverrides, key, date }),
      awayOwner: 'Alex',
      homeOwner: 'Blake',
      awayIsLeagueTeam: true,
      homeIsLeagueTeam: true,
    },
    score: undefined,
    priority: 2,
    sortDate: Date.parse(date),
  };
}

function historyFromSnapshots(
  snapshots: Array<{
    week: number;
    standings: Parameters<typeof selectOverviewViewModel>[0]['standingsLeaders'];
  }>
): StandingsHistory {
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
    byOwner: {},
  };
}

test('prioritizeOverviewItems retains quality labels without changing caller-provided order', () => {
  const items = [
    item('earlier', '2026-09-01T17:00:00.000Z'),
    item('middle-ranked', '2026-09-01T18:00:00.000Z'),
    item('later-top', '2026-09-06T17:00:00.000Z'),
  ];
  const ordered = prioritizeOverviewItems({
    items,
    highlightSignals: {
      gameOfSlateKey: 'later-top',
      upsetWatchKeys: [],
      rankedHighlightKey: 'middle-ranked',
    },
    rankingsByTeamId: new Map(),
    topOwnerNames: new Set(),
  });

  assert.deepEqual(
    ordered.map((entry) => entry.item.bucket.game.key),
    ['earlier', 'middle-ranked', 'later-top']
  );
  assert.equal(ordered[0]?.highlightLabel, null);
  assert.equal(ordered[1]?.highlightLabel, null);
  assert.equal(ordered[1]?.isRankedSpotlight, true);
  assert.equal(ordered[2]?.highlightLabel, 'Game of the Week');
  assert.equal(ordered[2]?.isGameOfSlate, true);
});

test('selectOverviewViewModel prioritises marquee watchlist games before kickoff tie-breaks', () => {
  const earlierBase = item('earlier-single', '2026-09-01T17:00:00.000Z');
  const earlierSingle = {
    ...earlierBase,
    bucket: { ...earlierBase.bucket, homeOwner: undefined },
    priority: 1,
  };
  const tiedOwned = item('tied-owned', '2026-09-01T18:00:00.000Z');
  const tiedSingleZBase = item('tied-single-z', '2026-09-01T18:00:00.000Z');
  const tiedSingleZ = {
    ...tiedSingleZBase,
    bucket: { ...tiedSingleZBase.bucket, homeOwner: undefined },
    priority: 1,
  };
  const tiedSingleABase = item('tied-single-a', '2026-09-01T18:00:00.000Z');
  const tiedSingleA = {
    ...tiedSingleABase,
    bucket: { ...tiedSingleABase.bucket, homeOwner: undefined },
    priority: 1,
  };
  const laterTop = item('later-top', '2026-09-06T17:00:00.000Z', {
    participants: {
      away: {
        kind: 'team',
        teamId: 'later-away-id',
        displayName: 'Later Away',
        canonicalName: 'Later Away',
        rawName: 'Later Away',
      },
      home: {
        kind: 'team',
        teamId: 'later-home-id',
        displayName: 'Later Home',
        canonicalName: 'Later Home',
        rawName: 'Later Home',
      },
    },
  });
  const model = selectOverviewViewModel({
    standingsLeaders: [],
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeDetail: 'Weeks 0–1',
      emphasis: 'upcoming',
    },
    liveItems: [],
    // This is the real producer shape: owned-vs-owned games precede single-owned games.
    keyMatchups: [tiedOwned, laterTop, tiedSingleZ, earlierSingle, tiedSingleA],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map([
      ['later-away-id', { rank: 4, rankSource: 'ap' as const }],
      ['later-home-id', { rank: 9, rankSource: 'ap' as const }],
    ]),
  });

  assert.deepEqual(
    model.watchlistCandidates.map((entry) => entry.item.bucket.game.key),
    ['later-top', 'earlier-single', 'tied-owned', 'tied-single-a', 'tied-single-z']
  );
  assert.equal(
    model.watchlistCandidates.find((entry) => entry.item.bucket.game.key === 'later-top')
      ?.highlightLabel,
    'Game of the Week'
  );
});

test('Featured ties break on the game key, and owner count cannot displace at the cap', () => {
  // Section-ordering resolutions §2, extended to Featured by the owner 2026-09-04.
  // `selectFeaturedGames` slices this order without re-sorting, so the removed
  // `item.priority` key did not merely order Featured — at the cap it decided which
  // games appeared. This asserts both halves: order AND survival of the cap.
  const SHARED = '2026-09-05T18:00:00.000Z';
  const finalScore = {
    status: 'Final',
    time: null,
    away: { team: 'Away', score: 21 },
    home: { team: 'Home', score: 17 },
  };
  const lowPriority = item('a-low-priority', SHARED);
  lowPriority.score = finalScore;
  lowPriority.priority = 1;
  const highPriority = item('z-high-priority', SHARED);
  highPriority.score = finalScore;
  highPriority.priority = 2;

  const model = selectOverviewViewModel({
    standingsLeaders: [],
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeDetail: 'Week 1',
      emphasis: 'recent',
    },
    liveItems: [],
    // Producer order puts the higher-priority game first, so a stable sort alone would
    // keep it ahead — the assertion below only holds if the comparator reorders.
    keyMatchups: [highPriority, lowPriority],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal(model.recentResults.length, 2, 'both finals must reach Featured');
  assert.deepEqual(
    model.recentResults.map((entry) => entry.item.bucket.game.key),
    ['a-low-priority', 'z-high-priority'],
    'the key decides the tie; the two-owner game no longer leads'
  );

  const capped = selectOverviewViewModel({
    standingsLeaders: [],
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeDetail: 'Week 1',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [highPriority, lowPriority],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
    resultsLimit: 1,
  });

  assert.deepEqual(
    capped.recentResults.map((entry) => entry.item.bucket.game.key),
    ['a-low-priority'],
    'at the cap the one-owner game survives — owner count no longer decides what appears'
  );
});

test('watchlist ties break on the game key, not on how many owners a game involves', () => {
  // Section-ordering resolutions §2, scoped to every section by the owner 2026-09-04.
  // The pre-existing ordering test above cannot catch this: there the two-owner game
  // also wins alphabetically, so it passes either way. Here the two keys DISAGREE —
  // the lower-priority game sorts first by key and last by `item.priority`, which is
  // `awayOwner && homeOwner ? 2 : 1` at overview.ts:77. `watchlistPriority` — the
  // curation score above this — deliberately stays; only the owner-count key goes.
  // THREE candidates, not two. `deriveOverviewHighlightSignals` names exactly one
  // game of the slate, so with two entries the curation score always separates them
  // and `compareWatchlistItems` is never reached — a two-entry version of this test
  // passes with the deleted key restored. The decoy absorbs that promotion (it wins
  // the game-of-slate key tiebreak alphabetically), leaving the other two tied at a
  // curation score of zero so the comparator under test actually runs.
  const SHARED = '2026-09-01T17:00:00.000Z';
  const decoy = item('a-game-of-slate', SHARED);
  const lowPriority = item('m-low-priority', SHARED);
  lowPriority.priority = 1;
  const highPriority = item('z-high-priority', SHARED);
  highPriority.priority = 2;

  const model = selectOverviewViewModel({
    standingsLeaders: [],
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeDetail: 'Week 1',
      emphasis: 'upcoming',
    },
    liveItems: [],
    // Producer order puts the higher-priority game first, so a stable sort alone would
    // keep it ahead — the assertion below only holds if the comparator reorders.
    keyMatchups: [decoy, highPriority, lowPriority],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal(model.watchlistCandidates.length, 3, 'all three games must reach the watchlist');
  assert.equal(
    model.watchlistCandidates[0]?.highlightLabel,
    'Game of the Week',
    'positive control: the decoy really did absorb the curation promotion, so the two ' +
      'rows below it are tied on watchlistPriority and reach the tiebreak'
  );
  assert.deepEqual(
    model.watchlistCandidates.map((entry) => entry.item.bucket.game.key),
    ['a-game-of-slate', 'm-low-priority', 'z-high-priority'],
    'the key decides the tie; item.priority no longer floats the two-owner game'
  );
});

test('selectOverviewViewModel keeps dated recent results newest-first ahead of undated finals', () => {
  const older = {
    ...item('older-final', '2026-09-01T17:00:00.000Z'),
    score: {
      status: 'Final',
      time: null,
      away: { team: 'Away', score: 24 },
      home: { team: 'Home', score: 17 },
    },
  };
  const newerBase = item('newer-final', '2026-09-01T20:00:00.000Z');
  const newer = {
    ...newerBase,
    bucket: { ...newerBase.bucket, homeOwner: undefined },
    priority: 1,
    score: {
      status: 'Final',
      time: null,
      away: { team: 'Away', score: 31 },
      home: { team: 'Home', score: 20 },
    },
  };
  const undatedBase = item('undated-final');
  const undated = {
    ...undatedBase,
    bucket: {
      ...undatedBase.bucket,
      game: { ...undatedBase.bucket.game, date: null },
    },
    sortDate: Number.POSITIVE_INFINITY,
    score: {
      status: 'Final',
      time: null,
      away: { team: 'Away', score: 27 },
      home: { team: 'Home', score: 24 },
    },
  };
  const model = selectOverviewViewModel({
    standingsLeaders: [],
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeDetail: 'Week 1',
      emphasis: 'live',
    },
    liveItems: [],
    keyMatchups: [older, newer, undated],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
    resultsLimit: 2,
  });

  assert.deepEqual(
    model.recentResults.map((entry) => entry.item.bucket.game.key),
    ['newer-final', 'older-final']
  );
});

test('deriveLeagueSummaryViewModel reports complete season champion copy', () => {
  const standingsCoverage: StandingsCoverage = { state: 'complete', message: null };
  const summary = deriveLeagueSummaryViewModel({
    standingsLeaders: [
      {
        owner: 'Alex',
        wins: 10,
        losses: 2,
        winPct: 0.833,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 72,
        gamesBack: 0,
        finalGames: 12,
      },
      {
        owner: 'Blake',
        wins: 9,
        losses: 3,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 30,
        gamesBack: 1,
        finalGames: 12,
      },
    ],
    context: {
      scopeDetail: 'the postseason',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [
      {
        bucket: {
          game: game({ key: 'bowl-final', stage: 'bowl', postseasonRole: 'bowl' }),
          awayOwner: 'Alex',
          homeOwner: 'Blake',
          awayIsLeagueTeam: true,
          homeIsLeagueTeam: true,
        },
        score: {
          status: 'Final',
          time: null,
          away: { team: 'Away', score: 30 },
          home: { team: 'Home', score: 17 },
        },
        priority: 2,
        sortDate: 0,
      },
    ],
    standingsCoverage,
  });

  assert.ok(summary);
  assert.equal(summary?.phase, 'complete');
  assert.equal(summary?.headline, 'Champion: Alex');
  assert.equal(summary?.progressSignal, 'Season complete');
});

test('deriveStandingsContextLabel returns null when leader gap is not tight', () => {
  assert.equal(
    deriveStandingsContextLabel([
      {
        owner: 'Alex',
        wins: 8,
        losses: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 0,
        finalGames: 8,
      },
      {
        owner: 'Blake',
        wins: 5,
        losses: 3,
        winPct: 0.625,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 3,
        finalGames: 8,
      },
    ]),
    null
  );
});

test('selectOverviewViewModel truncates standings and splits featured vs recent', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'A',
        wins: 5,
        losses: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 20,
        gamesBack: 0,
        finalGames: 5,
      },
      {
        owner: 'B',
        wins: 4,
        losses: 1,
        winPct: 0.8,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 10,
        gamesBack: 1,
        finalGames: 5,
      },
      {
        owner: 'C',
        wins: 3,
        losses: 2,
        winPct: 0.6,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 2,
        finalGames: 5,
      },
      {
        owner: 'D',
        wins: 2,
        losses: 3,
        winPct: 0.4,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: -2,
        gamesBack: 3,
        finalGames: 5,
      },
      {
        owner: 'E',
        wins: 1,
        losses: 4,
        winPct: 0.2,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: -5,
        gamesBack: 4,
        finalGames: 5,
      },
      {
        owner: 'F',
        wins: 0,
        losses: 5,
        winPct: 0,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: -10,
        gamesBack: 5,
        finalGames: 5,
      },
    ],
    standingsCoverage: { state: 'complete', message: null },
    context: {
      scopeDetail: 'Week 1',
      emphasis: 'upcoming',
    },
    liveItems: [],
    keyMatchups: [
      {
        ...item('scheduled'),
        score: {
          status: 'Scheduled',
          time: null,
          away: { team: 'Away', score: null },
          home: { team: 'Home', score: null },
        },
      },
      {
        ...item('final'),
        score: {
          status: 'Final',
          time: null,
          away: { team: 'Away', score: 20 },
          home: { team: 'Home', score: 10 },
        },
      },
    ],
    matchupMatrix: {
      owners: ['A', 'B'],
      rows: [
        {
          owner: 'A',
          cells: [
            { owner: 'A', gameCount: 0 },
            { owner: 'B', gameCount: 2 },
          ],
        },
        {
          owner: 'B',
          cells: [
            { owner: 'A', gameCount: 2 },
            { owner: 'B', gameCount: 0 },
          ],
        },
      ],
    },
    rankingsByTeamId: new Map(),
  });

  assert.equal(model.standingsTopN.length, 5);
  assert.equal(model.standingsHasMore, true);
  assert.equal(model.watchlistCandidates.length, 1);
  assert.equal(model.watchlistCandidates[0]?.item.bucket.game.key, 'scheduled');
  assert.equal(model.recentResults.length, 1);
  assert.equal(model.recentResults[0]?.item.bucket.game.key, 'final');
  assert.equal(typeof model.heroNarrative, 'string');
  assert.equal('shouldShowLeaguePulse' in model, false);
  assert.equal('leaguePulse' in model, false);
  assert.equal(model.heroMode, 'leader');
  assert.equal(model.podiumLeaders.length, 0);
  assert.equal('keyMovements' in model, false);
});

test('selectOverviewViewModel shows featured matchups when no highlight cards are available', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'A',
        wins: 2,
        losses: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 8,
        gamesBack: 0,
        finalGames: 2,
      },
    ],
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeDetail: 'Week 1',
      emphasis: 'upcoming',
    },
    liveItems: [],
    keyMatchups: [
      {
        ...item('scheduled-only'),
        score: {
          status: 'Scheduled',
          time: null,
          away: { team: 'Away', score: null },
          home: { team: 'Home', score: null },
        },
      },
    ],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal(model.watchlistCandidates.length, 1);
});

test('selectOverviewViewModel shows featured matchups even when highlight cards exist', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'A',
        wins: 3,
        losses: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 12,
        gamesBack: 0,
        finalGames: 3,
      },
    ],
    standingsCoverage: { state: 'complete', message: null },
    context: {
      scopeDetail: 'Week 1',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [
      {
        ...item('scheduled-watch'),
        score: {
          status: 'Scheduled',
          time: null,
          away: { team: 'Away', score: null },
          home: { team: 'Home', score: null },
        },
      },
      {
        ...item('final-blowout'),
        score: {
          status: 'Final',
          time: null,
          away: { team: 'Away', score: 38 },
          home: { team: 'Home', score: 10 },
        },
      },
    ],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  // Retargeted: this fixture produces highlight cards, which previously
  // suppressed the watchlist. That either/or was a gate against a highlights
  // section no longer rendered anywhere, so a populated slate showed nothing.
  // The watchlist now shows whenever it has matchups — the presence of
  // highlights must NOT hide it. Both original assertions are preserved; only
  // the expected visibility flipped, which is the behavior change itself.
  assert.equal(model.watchlistCandidates.length, 1);
});

test('selectOverviewViewModel hides featured matchups when slate only has finals', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'A',
        wins: 5,
        losses: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 20,
        gamesBack: 0,
        finalGames: 5,
      },
    ],
    standingsCoverage: { state: 'complete', message: null },
    context: {
      scopeDetail: 'Week 1',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [
      {
        ...item('final-only'),
        score: {
          status: 'Final',
          time: null,
          away: { team: 'Away', score: 17 },
          home: { team: 'Home', score: 14 },
        },
      },
    ],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal(model.watchlistCandidates.length, 0);
});

test('selectOverviewViewModel switches hero to podium for complete season with top three', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'Pruitt',
        wins: 81,
        losses: 39,
        winPct: 0.675,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 997,
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
        pointDifferential: 801,
        gamesBack: 1,
        finalGames: 106,
      },
      {
        owner: 'Whited',
        wins: 70,
        losses: 45,
        winPct: 0.609,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 744,
        gamesBack: 2,
        finalGames: 115,
      },
    ],
    standingsCoverage: { state: 'complete', message: null },
    context: {
      scopeDetail: 'Postseason',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [
      {
        ...item('post-final'),
        bucket: {
          ...item('post-final').bucket,
          game: game({ key: 'post-final', stage: 'bowl', postseasonRole: 'bowl' }),
        },
        score: {
          status: 'Final',
          time: null,
          away: { team: 'Away', score: 31 },
          home: { team: 'Home', score: 24 },
        },
      },
    ],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal(model.heroMode, 'podium');
  assert.equal(model.podiumLeaders.length, 3);
  assert.match(model.heroNarrative ?? '', /won the title by 1 game over Maleski/);
});

test('selectOverviewViewModel hero narrative handles two-way top tie', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'Alice',
        wins: 8,
        losses: 2,
        winPct: 0.8,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 30,
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
        pointDifferential: 20,
        gamesBack: 0,
        finalGames: 10,
      },
      {
        owner: 'Chris',
        wins: 7,
        losses: 3,
        winPct: 0.7,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 10,
        gamesBack: 1,
        finalGames: 10,
      },
    ],
    standingsCoverage: { state: 'complete', message: null },
    context: {
      scopeDetail: 'Week 10',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal(model.isTopTie, true);
  assert.equal(model.topTierLeaders.length, 2);
  assert.deepEqual(
    model.topTierLeaders.map((row) => row.owner),
    ['Alice', 'Bob']
  );
  assert.match(model.heroNarrative ?? '', /Alice and Bob are tied for first at 8–2 \(0.800\)/);
});

test('selectOverviewViewModel hero narrative handles three-way top tie in complete season', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'Alice',
        wins: 9,
        losses: 3,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 50,
        gamesBack: 0,
        finalGames: 12,
      },
      {
        owner: 'Bob',
        wins: 9,
        losses: 3,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 25,
        gamesBack: 0,
        finalGames: 12,
      },
      {
        owner: 'Chris',
        wins: 9,
        losses: 3,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 15,
        gamesBack: 0,
        finalGames: 12,
      },
    ],
    standingsCoverage: { state: 'complete', message: null },
    context: {
      scopeDetail: 'Postseason',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [
      {
        ...item('post-final-3way'),
        bucket: {
          ...item('post-final-3way').bucket,
          game: game({ key: 'post-final-3way', stage: 'bowl', postseasonRole: 'bowl' }),
        },
        score: {
          status: 'Final',
          time: null,
          away: { team: 'Away', score: 28 },
          home: { team: 'Home', score: 21 },
        },
      },
    ],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal(model.isTopTie, true);
  assert.equal(model.topTierLeaders.length, 3);
  assert.match(model.heroNarrative ?? '', /Alice, Bob, and Chris finished tied for first at 9–3/);
});

test('selectOverviewViewModel hero narrative keeps non-tie winner phrasing', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'Alice',
        wins: 10,
        losses: 2,
        winPct: 0.833,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 70,
        gamesBack: 0,
        finalGames: 12,
      },
      {
        owner: 'Bob',
        wins: 9,
        losses: 3,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 40,
        gamesBack: 1,
        finalGames: 12,
      },
    ],
    standingsCoverage: { state: 'complete', message: null },
    context: {
      scopeDetail: 'Postseason',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [
      {
        ...item('post-final-non-tie'),
        bucket: {
          ...item('post-final-non-tie').bucket,
          game: game({ key: 'post-final-non-tie', stage: 'bowl', postseasonRole: 'bowl' }),
        },
        score: {
          status: 'Final',
          time: null,
          away: { team: 'Away', score: 24 },
          home: { team: 'Home', score: 17 },
        },
      },
    ],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal(model.isTopTie, false);
  assert.equal(model.topTierLeaders.length, 1);
  assert.match(model.heroNarrative ?? '', /Alice won the title by 1 game over Bob/);
});

test('selectOverviewViewModel is stable for identical inputs', () => {
  const params = {
    standingsLeaders: [
      {
        owner: 'A',
        wins: 1,
        losses: 0,
        winPct: 1,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 1,
        gamesBack: 0,
        finalGames: 1,
      },
    ],
    standingsCoverage: { state: 'complete', message: null } as const,
    context: {
      scopeDetail: 'Week 1',
      emphasis: 'upcoming',
    } satisfies OverviewContext,
    liveItems: [] as OverviewGameItem[],
    keyMatchups: [] as OverviewGameItem[],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map<string, never>(),
  };

  assert.deepEqual(selectOverviewViewModel(params), selectOverviewViewModel(params));
});

test('selectOverviewViewModel ignores retired matrix highlights when showing scheduled games', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [],
    standingsCoverage: { state: 'partial', message: null },
    standingsHistory: historyFromSnapshots([
      {
        week: 8,
        standings: [
          {
            owner: 'Alex',
            wins: 4,
            losses: 4,
            winPct: 0.5,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 2,
            gamesBack: 1,
            finalGames: 8,
          },
          {
            owner: 'Blake',
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
            wins: 4,
            losses: 4,
            winPct: 0.5,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: -1,
            gamesBack: 2,
            finalGames: 8,
          },
        ],
      },
      {
        week: 9,
        standings: [
          {
            owner: 'Alex',
            wins: 8,
            losses: 2,
            winPct: 0.8,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 15,
            gamesBack: 0,
            finalGames: 10,
          },
          {
            owner: 'Blake',
            wins: 6,
            losses: 4,
            winPct: 0.6,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 5,
            gamesBack: 2,
            finalGames: 10,
          },
          {
            owner: 'Casey',
            wins: 5,
            losses: 5,
            winPct: 0.5,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: -3,
            gamesBack: 3,
            finalGames: 10,
          },
        ],
      },
    ]),
    context: {
      scopeDetail: 'Week 1',
      emphasis: 'upcoming',
    },
    liveItems: [],
    keyMatchups: [item('scheduled-with-matrix-history')],
    matchupMatrix: {
      owners: ['A', 'B', 'C'],
      rows: [
        {
          owner: 'A',
          cells: [
            { owner: 'A', gameCount: 0, record: null },
            { owner: 'B', gameCount: 5, record: '4–1' },
            { owner: 'C', gameCount: 8, record: '4–4' },
          ],
        },
        {
          owner: 'B',
          cells: [
            { owner: 'A', gameCount: 5, record: '1–4' },
            { owner: 'B', gameCount: 0, record: null },
            { owner: 'C', gameCount: 4, record: '2–2' },
          ],
        },
        {
          owner: 'C',
          cells: [
            { owner: 'A', gameCount: 8, record: '4–4' },
            { owner: 'B', gameCount: 4, record: '2–2' },
            { owner: 'C', gameCount: 0, record: null },
          ],
        },
      ],
    },
    rankingsByTeamId: new Map(),
  });

  assert.equal(model.watchlistCandidates.length > 0, true);
});

test('selectOverviewViewModel keeps a final-only slate outside the upcoming watchlist', () => {
  const final = {
    ...item('final-typed'),
    score: {
      status: 'Final',
      time: null,
      away: { team: 'Away', score: 42 },
      home: { team: 'Home', score: 14 },
    },
  };
  const model = selectOverviewViewModel({
    standingsLeaders: [],
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeDetail: 'Week 9',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [final],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal(model.watchlistCandidates.length > 0, false);
});

test('selectOverviewViewModel never places an in-progress game in both the watchlist and Live', () => {
  const live = {
    ...item('live-game'),
    score: {
      status: 'Q2 0:00',
      time: '0:00',
      away: { team: 'Away', score: 14 },
      home: { team: 'Home', score: 10 },
    },
  };
  const scheduled = {
    ...item('scheduled-game'),
    score: {
      status: 'Scheduled',
      time: null,
      away: { team: 'Away', score: null },
      home: { team: 'Home', score: null },
    },
  };
  const liveItems = [live];
  const model = selectOverviewViewModel({
    standingsLeaders: [],
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeDetail: 'Week 1',
      emphasis: 'upcoming',
    },
    liveItems,
    keyMatchups: [scheduled, live],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });
  const liveKeys = new Set(liveItems.map((entry) => entry.bucket.game.key));
  const watchlistKeys = model.watchlistCandidates.map((entry) => entry.item.bucket.game.key);

  assert.deepEqual(watchlistKeys, ['scheduled-game']);
  assert.deepEqual(
    watchlistKeys.filter((key) => liveKeys.has(key)),
    []
  );
});

test('selectOverviewViewModel keeps an empty slate hidden regardless of noisy matrix data', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [],
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeDetail: 'Week 1',
      emphasis: 'upcoming',
    },
    liveItems: [],
    keyMatchups: [],
    matchupMatrix: {
      owners: ['A', 'B'],
      rows: [
        {
          owner: 'A',
          cells: [
            { owner: 'A', gameCount: 0, record: null },
            { owner: 'B', gameCount: 0, record: 'bad-record' },
          ],
        },
        {
          owner: 'B',
          cells: [
            { owner: 'A', gameCount: 0, record: 'also bad' },
            { owner: 'B', gameCount: 0, record: null },
          ],
        },
      ],
    },
    rankingsByTeamId: new Map(),
  });

  assert.equal(model.watchlistCandidates.length > 0, false);
});

test('selectOverviewViewModel keeps retired pulse output absent for scoped history', () => {
  const final = {
    ...item('prefix-cleanup'),
    score: {
      status: 'Final',
      time: null,
      away: { team: 'Away', score: 42 },
      home: { team: 'Home', score: 10 },
    },
  };
  final.bucket.awayOwner = 'Alice';
  final.bucket.homeOwner = 'Bob';

  const model = selectOverviewViewModel({
    standingsLeaders: [
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
        pointDifferential: -8,
        gamesBack: 2,
        finalGames: 5,
      },
    ],
    standingsHistory: historyFromSnapshots([
      {
        week: 1,
        standings: [
          {
            owner: 'Alice',
            wins: 2,
            losses: 3,
            winPct: 0.4,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: -3,
            gamesBack: 2,
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
        ],
      },
      {
        week: 2,
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
            pointDifferential: -8,
            gamesBack: 2,
            finalGames: 5,
          },
        ],
      },
    ]),
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeDetail: 'This postseason slate',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [final],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal('leaguePulse' in model, false);
});

test('selectOverviewViewModel keeps featured games when finals dominate early candidates', () => {
  const finals = [1, 2, 3, 4, 5, 6].map((value) => ({
    ...item(`final-${value}`),
    score: {
      status: 'Final',
      time: null,
      away: { team: 'Away', score: 20 + value },
      home: { team: 'Home', score: 10 },
    },
    sortDate: value,
  }));
  const featuredLater = {
    ...item('scheduled-late'),
    score: {
      status: 'Scheduled',
      time: null,
      away: { team: 'Away', score: null },
      home: { team: 'Home', score: null },
    },
    sortDate: 10,
  };
  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'Alex',
        wins: 4,
        losses: 1,
        winPct: 0.8,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 10,
        gamesBack: 0,
        finalGames: 5,
      },
    ],
    standingsCoverage: { state: 'complete', message: null },
    context: {
      scopeDetail: 'Week 8',
      emphasis: 'upcoming',
    },
    liveItems: [],
    keyMatchups: [...finals, featuredLater],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.ok(
    model.watchlistCandidates.some((entry) => entry.item.bucket.game.key === 'scheduled-late')
  );
  assert.equal(model.recentResults.length, 4);
});

test('selectOverviewViewModel is deterministic for identical highlight inputs', () => {
  const params = {
    standingsLeaders: [],
    standingsCoverage: { state: 'partial', message: null } as const,
    context: {
      scopeDetail: 'Week 2',
      emphasis: 'recent',
    } satisfies OverviewContext,
    liveItems: [] as OverviewGameItem[],
    keyMatchups: [
      {
        ...item('f-1'),
        score: {
          status: 'Final',
          time: null,
          away: { team: 'Away', score: 35 },
          home: { team: 'Home', score: 10 },
        },
      },
    ] as OverviewGameItem[],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  };

  assert.deepEqual(selectOverviewViewModel(params), selectOverviewViewModel(params));
});

test('selectOverviewViewModel keeps retired pulse fields absent during active season', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'Alex',
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
        owner: 'Blake',
        wins: 7,
        losses: 3,
        winPct: 0.7,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 6,
        gamesBack: 1,
        finalGames: 10,
      },
    ],
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeDetail: 'Week 9',
      emphasis: 'upcoming',
    },
    liveItems: [],
    keyMatchups: [item('active-pulse')],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal('leaguePulse' in model, false);
  assert.equal('shouldShowLeaguePulse' in model, false);
});

test('selectOverviewViewModel keeps retired pulse fields absent after season completes', () => {
  const postseasonFinal = {
    ...item('postseason-final'),
    bucket: {
      ...item('postseason-final').bucket,
      game: game({ key: 'postseason-final', stage: 'bowl', postseasonRole: 'bowl' }),
    },
    score: {
      status: 'Final',
      time: null,
      away: { team: 'Away', score: 27 },
      home: { team: 'Home', score: 20 },
    },
  };

  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'Alex',
        wins: 10,
        losses: 2,
        winPct: 0.833,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 30,
        gamesBack: 0,
        finalGames: 12,
      },
      {
        owner: 'Blake',
        wins: 9,
        losses: 3,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 10,
        gamesBack: 1,
        finalGames: 12,
      },
      {
        owner: 'Casey',
        wins: 8,
        losses: 4,
        winPct: 0.667,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 0,
        gamesBack: 2,
        finalGames: 12,
      },
    ],
    standingsHistory: historyFromSnapshots([
      {
        week: 11,
        standings: [
          {
            owner: 'Blake',
            wins: 9,
            losses: 3,
            winPct: 0.75,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 10,
            gamesBack: 0,
            finalGames: 12,
          },
          {
            owner: 'Alex',
            wins: 10,
            losses: 2,
            winPct: 0.833,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 30,
            gamesBack: 0,
            finalGames: 12,
          },
          {
            owner: 'Casey',
            wins: 8,
            losses: 4,
            winPct: 0.667,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 2,
            finalGames: 12,
          },
        ],
      },
      {
        week: 12,
        standings: [
          {
            owner: 'Alex',
            wins: 10,
            losses: 2,
            winPct: 0.833,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 30,
            gamesBack: 0,
            finalGames: 12,
          },
          {
            owner: 'Blake',
            wins: 9,
            losses: 3,
            winPct: 0.75,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 10,
            gamesBack: 1,
            finalGames: 12,
          },
          {
            owner: 'Casey',
            wins: 8,
            losses: 4,
            winPct: 0.667,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 2,
            finalGames: 12,
          },
        ],
      },
    ]),
    standingsCoverage: { state: 'complete', message: null },
    context: {
      scopeDetail: 'Postseason',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [postseasonFinal],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal('leaguePulse' in model, false);
  assert.equal('shouldShowLeaguePulse' in model, false);
});

test('selectOverviewViewModel does not recreate retired pulse filler for a completed season', () => {
  const postseasonFinal = {
    ...item('postseason-final-thin-pulse'),
    bucket: {
      ...item('postseason-final-thin-pulse').bucket,
      game: game({ key: 'postseason-final-thin-pulse', stage: 'bowl', postseasonRole: 'bowl' }),
    },
    score: {
      status: 'Final',
      time: null,
      away: { team: 'Away', score: 17 },
      home: { team: 'Home', score: 14 },
    },
  };

  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'Alex',
        wins: 10,
        losses: 2,
        winPct: 0.833,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 25,
        gamesBack: 0,
        finalGames: 12,
      },
      {
        owner: 'Blake',
        wins: 9,
        losses: 3,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 12,
        gamesBack: 1,
        finalGames: 12,
      },
      {
        owner: 'Casey',
        wins: 8,
        losses: 4,
        winPct: 0.667,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 4,
        gamesBack: 2,
        finalGames: 12,
      },
    ],
    standingsCoverage: { state: 'complete', message: null },
    context: {
      scopeDetail: 'Postseason',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [postseasonFinal],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal('leaguePulse' in model, false);
  assert.equal('shouldShowLeaguePulse' in model, false);
});

test('selectOverviewViewModel keeps retired movement output absent with active-season results', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'Alex',
        wins: 8,
        losses: 2,
        winPct: 0.8,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 15,
        gamesBack: 0,
        finalGames: 10,
      },
      {
        owner: 'Blake',
        wins: 6,
        losses: 4,
        winPct: 0.6,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 5,
        gamesBack: 2,
        finalGames: 10,
      },
      {
        owner: 'Casey',
        wins: 5,
        losses: 5,
        winPct: 0.5,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: -3,
        gamesBack: 3,
        finalGames: 10,
      },
    ],
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeDetail: 'Week 9',
      emphasis: 'upcoming',
    },
    liveItems: [],
    keyMatchups: [
      {
        ...item('active-movement-pulse-1'),
        bucket: {
          ...item('active-movement-pulse-1').bucket,
          awayOwner: 'Alex',
          homeOwner: 'Blake',
        },
        score: {
          status: 'Final',
          time: null,
          away: { team: 'Away', score: 31 },
          home: { team: 'Home', score: 17 },
        },
      },
      {
        ...item('active-movement-pulse-2'),
        bucket: {
          ...item('active-movement-pulse-2').bucket,
          awayOwner: 'Alex',
          homeOwner: 'Blake',
        },
        score: {
          status: 'Final',
          time: null,
          away: { team: 'Away', score: 24 },
          home: { team: 'Home', score: 20 },
        },
      },
    ],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal('keyMovements' in model, false);
  assert.equal('shouldShowLeaguePulse' in model, false);
});

test('selectOverviewViewModel keeps retired movement output absent with unresolved history', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'Alex',
        wins: 6,
        losses: 2,
        winPct: 0.75,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 14,
        gamesBack: 0,
        finalGames: 8,
      },
      {
        owner: 'Blake',
        wins: 4,
        losses: 4,
        winPct: 0.5,
        pointsFor: 0,
        pointsAgainst: 0,
        pointDifferential: 2,
        gamesBack: 2,
        finalGames: 8,
      },
    ],
    standingsHistory: {
      weeks: [1, 2, 3, 4],
      byWeek: {
        1: {
          week: 1,
          standings: [
            {
              owner: 'Alex',
              wins: 4,
              losses: 2,
              ties: 0,
              winPct: 0.667,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 6,
              gamesBack: 0,
              finalGames: 6,
            },
            {
              owner: 'Blake',
              wins: 4,
              losses: 2,
              ties: 0,
              winPct: 0.667,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 4,
              gamesBack: 0,
              finalGames: 6,
            },
          ],
          coverage: { state: 'complete', message: null },
        },
        2: {
          week: 2,
          standings: [
            {
              owner: 'Alex',
              wins: 6,
              losses: 2,
              ties: 0,
              winPct: 0.75,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 14,
              gamesBack: 0,
              finalGames: 8,
            },
            {
              owner: 'Blake',
              wins: 4,
              losses: 4,
              ties: 0,
              winPct: 0.5,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 2,
              gamesBack: 2,
              finalGames: 8,
            },
          ],
          coverage: { state: 'complete', message: null },
        },
        3: {
          week: 3,
          standings: [
            {
              owner: 'Alex',
              wins: 6,
              losses: 2,
              ties: 0,
              winPct: 0.75,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 14,
              gamesBack: 0,
              finalGames: 8,
            },
            {
              owner: 'Blake',
              wins: 4,
              losses: 4,
              ties: 0,
              winPct: 0.5,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 2,
              gamesBack: 2,
              finalGames: 8,
            },
          ],
          coverage: { state: 'partial', message: null },
        },
        4: {
          week: 4,
          standings: [
            {
              owner: 'Alex',
              wins: 6,
              losses: 2,
              ties: 0,
              winPct: 0.75,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 14,
              gamesBack: 0,
              finalGames: 8,
            },
            {
              owner: 'Blake',
              wins: 4,
              losses: 4,
              ties: 0,
              winPct: 0.5,
              pointsFor: 0,
              pointsAgainst: 0,
              pointDifferential: 2,
              gamesBack: 2,
              finalGames: 8,
            },
          ],
          coverage: { state: 'partial', message: null },
        },
      },
      byOwner: {
        Alex: [
          {
            week: 1,
            wins: 4,
            losses: 2,
            ties: 0,
            winPct: 0.667,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 6,
            gamesBack: 0,
          },
          {
            week: 2,
            wins: 6,
            losses: 2,
            ties: 0,
            winPct: 0.75,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 14,
            gamesBack: 0,
          },
          {
            week: 3,
            wins: 6,
            losses: 2,
            ties: 0,
            winPct: 0.75,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 14,
            gamesBack: 0,
          },
        ],
        Blake: [
          {
            week: 1,
            wins: 4,
            losses: 2,
            ties: 0,
            winPct: 0.667,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 4,
            gamesBack: 0,
          },
          {
            week: 2,
            wins: 4,
            losses: 4,
            ties: 0,
            winPct: 0.5,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 2,
            gamesBack: 2,
          },
          {
            week: 3,
            wins: 4,
            losses: 4,
            ties: 0,
            winPct: 0.5,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 2,
            gamesBack: 2,
          },
        ],
      },
    },
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeDetail: 'Week 4',
      emphasis: 'upcoming',
    },
    liveItems: [],
    keyMatchups: [],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal('keyMovements' in model, false);
  assert.deepEqual(
    model.previousStandingsLeaders.map(({ owner, wins, losses }) => ({ owner, wins, losses })),
    [
      { owner: 'Alex', wins: 4, losses: 2 },
      { owner: 'Blake', wins: 4, losses: 2 },
    ]
  );
  assert.deepEqual(
    model.standingsTopN.map(({ owner, wins, losses }) => ({ owner, wins, losses })),
    [
      { owner: 'Alex', wins: 6, losses: 2 },
      { owner: 'Blake', wins: 4, losses: 4 },
    ]
  );
});

test('selectOverviewViewModel includes winPctTrend derived from resolved standings history', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [
      {
        owner: 'Alex',
        wins: 2,
        losses: 0,
        winPct: 1,
        pointsFor: 20,
        pointsAgainst: 5,
        pointDifferential: 15,
        gamesBack: 0,
        finalGames: 2,
      },
      {
        owner: 'Blake',
        wins: 1,
        losses: 1,
        winPct: 0.5,
        pointsFor: 10,
        pointsAgainst: 10,
        pointDifferential: 0,
        gamesBack: 1,
        finalGames: 2,
      },
    ],
    standingsHistory: {
      weeks: [1, 2, 3],
      byWeek: {
        1: {
          week: 1,
          standings: [
            {
              owner: 'Alex',
              wins: 1,
              losses: 0,
              ties: 0,
              winPct: 1,
              pointsFor: 10,
              pointsAgainst: 2,
              pointDifferential: 8,
              gamesBack: 0,
              finalGames: 1,
            },
            {
              owner: 'Blake',
              wins: 0,
              losses: 1,
              ties: 0,
              winPct: 0,
              pointsFor: 2,
              pointsAgainst: 10,
              pointDifferential: -8,
              gamesBack: 1,
              finalGames: 1,
            },
          ],
          coverage: { state: 'complete', message: null },
        },
        2: {
          week: 2,
          standings: [
            {
              owner: 'Alex',
              wins: 2,
              losses: 0,
              ties: 0,
              winPct: 1,
              pointsFor: 20,
              pointsAgainst: 5,
              pointDifferential: 15,
              gamesBack: 0,
              finalGames: 2,
            },
            {
              owner: 'Blake',
              wins: 1,
              losses: 1,
              ties: 0,
              winPct: 0.5,
              pointsFor: 10,
              pointsAgainst: 10,
              pointDifferential: 0,
              gamesBack: 1,
              finalGames: 2,
            },
          ],
          coverage: { state: 'complete', message: null },
        },
        3: {
          week: 3,
          standings: [],
          coverage: { state: 'partial', message: null },
        },
      },
      byOwner: {
        Alex: [
          {
            week: 1,
            wins: 1,
            losses: 0,
            ties: 0,
            winPct: 1,
            pointsFor: 10,
            pointsAgainst: 2,
            pointDifferential: 8,
            gamesBack: 0,
          },
          {
            week: 2,
            wins: 2,
            losses: 0,
            ties: 0,
            winPct: 1,
            pointsFor: 20,
            pointsAgainst: 5,
            pointDifferential: 15,
            gamesBack: 0,
          },
        ],
        Blake: [
          {
            week: 1,
            wins: 0,
            losses: 1,
            ties: 0,
            winPct: 0,
            pointsFor: 2,
            pointsAgainst: 10,
            pointDifferential: -8,
            gamesBack: 1,
          },
          {
            week: 2,
            wins: 1,
            losses: 1,
            ties: 0,
            winPct: 0.5,
            pointsFor: 10,
            pointsAgainst: 10,
            pointDifferential: 0,
            gamesBack: 1,
          },
        ],
      },
    },
    standingsCoverage: { state: 'complete', message: null },
    context: {
      scopeDetail: 'Week 2',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.deepEqual(model.winPctTrend.find((series) => series.ownerName === 'Blake')?.points, [
    { week: 1, value: 0 },
    { week: 2, value: 0.5 },
  ]);
  assert.deepEqual(
    model.winBars.map((row) => row.ownerName),
    ['Alex', 'Blake']
  );
  assert.deepEqual(
    model.winBars.find((row) => row.ownerName === 'Blake'),
    {
      ownerId: 'Blake',
      ownerName: 'Blake',
      wins: 1,
      losses: 1,
      ties: 0,
      winPct: 0.5,
      gamesBack: 1,
    }
  );
});

test('selectOverviewViewModel emits capped storylines sorted by priority', () => {
  const week5Standings = [
    {
      owner: 'Leader',
      wins: 8,
      losses: 2,
      winPct: 0.8,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 20,
      gamesBack: 0,
      finalGames: 10,
    },
    {
      owner: 'Second',
      wins: 6,
      losses: 4,
      winPct: 0.6,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 5,
      gamesBack: 2,
      finalGames: 10,
    },
    {
      owner: 'PctLeader',
      wins: 5,
      losses: 1,
      winPct: 0.833,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 12,
      gamesBack: 4,
      finalGames: 6,
    },
  ];

  const week6Standings = [
    {
      owner: 'Leader',
      wins: 9,
      losses: 2,
      winPct: 0.818,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 24,
      gamesBack: 0,
      finalGames: 11,
    },
    {
      owner: 'Second',
      wins: 6,
      losses: 5,
      winPct: 0.545,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 2,
      gamesBack: 3,
      finalGames: 11,
    },
    {
      owner: 'PctLeader',
      wins: 8,
      losses: 1,
      winPct: 0.889,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDifferential: 15,
      gamesBack: 4,
      finalGames: 9,
    },
  ];

  const standingsHistory: StandingsHistory = {
    weeks: [5, 6],
    byWeek: {
      5: {
        week: 5,
        standings: week5Standings.map((row) => ({ ...row, ties: 0 })),
        coverage: { state: 'complete', message: null },
      },
      6: {
        week: 6,
        standings: week6Standings.map((row) => ({ ...row, ties: 0 })),
        coverage: { state: 'complete', message: null },
      },
    },
    byOwner: {
      Leader: [
        {
          week: 5,
          wins: 8,
          losses: 2,
          ties: 0,
          winPct: 0.8,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 20,
          gamesBack: 0,
        },
        {
          week: 6,
          wins: 9,
          losses: 2,
          ties: 0,
          winPct: 0.818,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 24,
          gamesBack: 0,
        },
      ],
      Second: [
        {
          week: 5,
          wins: 6,
          losses: 4,
          ties: 0,
          winPct: 0.6,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 5,
          gamesBack: 4,
        },
        {
          week: 6,
          wins: 6,
          losses: 5,
          ties: 0,
          winPct: 0.545,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 2,
          gamesBack: 3,
        },
      ],
      PctLeader: [
        {
          week: 5,
          wins: 5,
          losses: 1,
          ties: 0,
          winPct: 0.833,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 12,
          gamesBack: 2,
        },
        {
          week: 6,
          wins: 8,
          losses: 1,
          ties: 0,
          winPct: 0.889,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 15,
          gamesBack: 4,
        },
      ],
    },
  };

  const model = selectOverviewViewModel({
    standingsLeaders: week6Standings,
    standingsHistory,
    standingsCoverage: { state: 'complete', message: null },
    context: {
      scopeDetail: 'Week 6',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal(model.storylines.length, 3);
  assert.deepEqual(
    model.storylines.map((entry) => entry.type),
    ['leader-gap', 'movement', 'win-pct']
  );
  assert.ok(model.storylines[0].priority >= model.storylines[1].priority);
  assert.ok(model.storylines[1].priority >= model.storylines[2].priority);
});

test('selectOverviewViewModel applies final-season storyline phrasing and suppresses tight race', () => {
  const standingsHistory: StandingsHistory = {
    weeks: [15, 16],
    byWeek: {
      15: {
        week: 15,
        standings: [
          {
            owner: 'Leader',
            wins: 9,
            losses: 1,
            ties: 0,
            winPct: 0.9,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 0,
            finalGames: 10,
          },
          {
            owner: 'Second',
            wins: 8,
            losses: 2,
            ties: 0,
            winPct: 0.8,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 1,
            finalGames: 10,
          },
        ],
        coverage: { state: 'complete', message: null },
      },
      16: {
        week: 16,
        standings: [
          {
            owner: 'Leader',
            wins: 12,
            losses: 2,
            ties: 0,
            winPct: 0.857,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 0,
            finalGames: 14,
          },
          {
            owner: 'Second',
            wins: 10,
            losses: 4,
            ties: 0,
            winPct: 0.714,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 2,
            finalGames: 14,
          },
          {
            owner: 'Third',
            wins: 10,
            losses: 4,
            ties: 0,
            winPct: 0.714,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDifferential: 0,
            gamesBack: 2,
            finalGames: 14,
          },
        ],
        coverage: { state: 'complete', message: null },
      },
    },
    byOwner: {
      Leader: [
        {
          week: 15,
          wins: 9,
          losses: 1,
          ties: 0,
          winPct: 0.9,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
        },
        {
          week: 16,
          wins: 12,
          losses: 2,
          ties: 0,
          winPct: 0.857,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 0,
        },
      ],
      Second: [
        {
          week: 15,
          wins: 8,
          losses: 2,
          ties: 0,
          winPct: 0.8,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 1,
        },
        {
          week: 16,
          wins: 10,
          losses: 4,
          ties: 0,
          winPct: 0.714,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 2,
        },
      ],
      Third: [
        {
          week: 16,
          wins: 10,
          losses: 4,
          ties: 0,
          winPct: 0.714,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDifferential: 0,
          gamesBack: 2,
        },
      ],
    },
  };

  const model = selectOverviewViewModel({
    standingsLeaders: standingsHistory.byWeek[16]!.standings,
    standingsHistory,
    standingsCoverage: { state: 'complete', message: null },
    context: {
      scopeDetail: 'Final',
      emphasis: 'recent',
    },
    liveItems: [],
    keyMatchups: [],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.equal(
    model.storylines.some((item) => item.type === 'tight-race'),
    false
  );
  assert.match(model.storylines[0]?.text ?? '', /won the title by 2 games/i);
});

// ---------------------------------------------------------------------------
// PLATFORM-109 remediation — the view model must not re-derive the season
// context from a history that has had `pending` stripped.
//
// Both independent reviews found this: the five league routes now ship a
// stripped snapshot to the client, `OverviewPanel` handed it straight to this
// selector, and `selectSeasonContext`'s `unresolved.every(...)` is vacuously
// true for an empty list — so a live season was reclassified `final` and the
// storylines described a title that had been won.
// ---------------------------------------------------------------------------

const baseContext: OverviewContext = {
  scopeDetail: 'Week 2',
  emphasis: 'upcoming',
};

function liveHistoryWithAnUnplayedWeek(): StandingsHistory {
  const rows = (aliceWins: number) => [
    {
      owner: 'Alice',
      wins: aliceWins,
      losses: 0,
      ties: 0,
      winPct: 1,
      pointsFor: 40,
      pointsAgainst: 10,
      pointDifferential: 30,
      gamesBack: 0,
      finalGames: aliceWins,
    },
    {
      owner: 'Bob',
      wins: 0,
      losses: aliceWins,
      ties: 0,
      winPct: 0,
      pointsFor: 10,
      pointsAgainst: 40,
      pointDifferential: -30,
      gamesBack: aliceWins,
      finalGames: aliceWins,
    },
  ];
  return {
    weeks: [1, 2],
    byWeek: {
      1: {
        week: 1,
        standings: rows(1),
        coverage: { state: 'complete', message: null },
        played: true,
        pending: [],
      },
      2: {
        week: 2,
        standings: rows(1),
        coverage: { state: 'complete', message: null },
        played: false,
        // Kicks off next Saturday — pending, nowhere near abandoned.
        pending: [{ key: 'w2-g1', week: 2, kickoff: '2099-09-05T18:00:00.000Z' }],
      },
    },
    byOwner: {
      Alice: [
        {
          week: 1,
          wins: 1,
          losses: 0,
          ties: 0,
          winPct: 1,
          pointsFor: 40,
          pointsAgainst: 10,
          pointDifferential: 30,
          gamesBack: 0,
        },
      ],
      Bob: [
        {
          week: 1,
          wins: 0,
          losses: 1,
          ties: 0,
          winPct: 0,
          pointsFor: 10,
          pointsAgainst: 40,
          pointDifferential: -30,
          gamesBack: 1,
        },
      ],
    },
  };
}

function stripPending(history: StandingsHistory): StandingsHistory {
  const byWeek: StandingsHistory['byWeek'] = {};
  for (const [week, snapshot] of Object.entries(history.byWeek)) {
    const copy = { ...snapshot };
    delete copy.pending;
    byWeek[Number(week)] = copy;
  }
  return { ...history, byWeek };
}

function viewModelFor(standingsHistory: StandingsHistory) {
  return selectOverviewViewModel({
    standingsLeaders: standingsHistory.byWeek[1]!.standings.map((row) => ({
      owner: row.owner,
      wins: row.wins,
      losses: row.losses,
      winPct: row.winPct,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
      pointDifferential: row.pointDifferential,
      gamesBack: row.gamesBack,
      finalGames: row.finalGames,
    })),
    standingsHistory,
    standingsCoverage: { state: 'complete', message: null } as StandingsCoverage,
    context: baseContext,
    liveItems: [],
    keyMatchups: [],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });
}

test('PLATFORM-109: stripping pending does not change the view model', () => {
  const live = liveHistoryWithAnUnplayedWeek();

  // The whole point: the client copy and the server copy must describe the same
  // season. Before the fix the stripped copy read `final` and produced
  // completed-season storylines.
  assert.deepEqual(viewModelFor(stripPending(live)), viewModelFor(live));
});

test('PLATFORM-109: an explicit seasonContext overrides the derivation', () => {
  const live = liveHistoryWithAnUnplayedWeek();
  const params = {
    standingsLeaders: live.byWeek[1]!.standings.map((row) => ({
      owner: row.owner,
      wins: row.wins,
      losses: row.losses,
      winPct: row.winPct,
      pointsFor: row.pointsFor,
      pointsAgainst: row.pointsAgainst,
      pointDifferential: row.pointDifferential,
      gamesBack: row.gamesBack,
      finalGames: row.finalGames,
    })),
    standingsHistory: live,
    standingsCoverage: { state: 'complete', message: null } as StandingsCoverage,
    context: baseContext,
    liveItems: [],
    keyMatchups: [],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  };

  const derived = selectOverviewViewModel(params);
  const overridden = selectOverviewViewModel({ ...params, seasonContext: 'final' });

  // The caller's answer wins over the local derivation — which is what lets the
  // league routes hand down the one value they derived from the unstripped
  // snapshot instead of every consumer deriving its own.
  //
  // NOT PINNED: that `OverviewPanel` forwards its prop into THIS selector. The
  // value lands on `viewModel.storylines`, which no surface renders, so deleting
  // that one forwarding fails no test — verified by deleting it, not assumed.
  //
  // An earlier version of this note claimed the panel's markup was byte-
  // identical with `in-season` and with `final`. That was false and review
  // disproved it: the panel ALSO forwards the prop to `deriveLeagueInsights`,
  // which is render-observable and is now pinned in `OverviewPanel.test.tsx`.
  // The measurement behind the false claim came from a single fixture that
  // emitted no context-sensitive insights, stated as a general fact.
  //
  // So: one of the two forwardings is pinned at the render level, the other is
  // unpinnable until a surface renders storylines, and this selector contract is
  // what guards it meanwhile.
  assert.notDeepEqual(overridden.storylines, derived.storylines);
});
