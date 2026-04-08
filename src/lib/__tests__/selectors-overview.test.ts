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

function item(key: string): OverviewGameItem {
  return {
    bucket: {
      game: game({ key }),
      awayOwner: 'Alex',
      homeOwner: 'Blake',
      awayIsLeagueTeam: true,
      homeIsLeagueTeam: true,
    },
    score: undefined,
    priority: 2,
    sortDate: 0,
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

test('prioritizeOverviewItems keeps highlight order and avoids duplicate labels', () => {
  const items = [item('fallback'), item('top'), item('upset')];
  const ordered = prioritizeOverviewItems({
    items,
    highlightSignals: {
      topMatchupKey: 'top',
      upsetWatchKeys: ['top', 'upset'],
      rankedHighlightKey: 'fallback',
    },
    rankingsByTeamId: new Map(),
    topOwnerNames: new Set(['Alex', 'Blake']),
  });

  assert.deepEqual(
    ordered.map((entry) => entry.item.bucket.game.key),
    ['top', 'upset', 'fallback']
  );
  assert.equal(ordered[0]?.highlightLabel, 'Upset watch');
  assert.equal(ordered[1]?.highlightLabel, 'Upset watch');
  assert.ok(Array.isArray(ordered[0]?.highlightTags));
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
      scopeLabel: 'Postseason',
      scopeDetail: 'the postseason',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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
      scopeLabel: 'League',
      scopeDetail: 'Week 1',
      emphasis: 'upcoming',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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
  assert.equal(model.featuredMatchups.length, 1);
  assert.equal(model.shouldShowFeaturedMatchups, true);
  assert.equal(model.featuredMatchups[0]?.item.bucket.game.key, 'scheduled');
  assert.equal(model.recentResults.length, 1);
  assert.equal(model.recentResults[0]?.item.bucket.game.key, 'final');
  assert.equal(typeof model.heroNarrative, 'string');
  assert.equal(model.shouldShowLeaguePulse, true);
  assert.ok(model.leaguePulse.length > 0);
  assert.equal(model.heroMode, 'leader');
  assert.equal(model.podiumLeaders.length, 0);
  assert.ok(model.keyMovements.every((insight) => !insight.id.startsWith('live-top25')));
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
      scopeLabel: 'League',
      scopeDetail: 'Week 1',
      emphasis: 'upcoming',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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

  assert.equal(model.featuredMatchups.length, 1);
  assert.equal(model.shouldShowFeaturedMatchups, true);
});

test('selectOverviewViewModel hides featured matchups when highlight cards exist', () => {
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
      scopeLabel: 'League',
      scopeDetail: 'Week 1',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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

  assert.equal(model.featuredMatchups.length, 1);
  assert.equal(model.shouldShowFeaturedMatchups, false);
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
      scopeLabel: 'League',
      scopeDetail: 'Week 1',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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

  assert.equal(model.featuredMatchups.length, 0);
  assert.equal(model.shouldShowFeaturedMatchups, false);
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
      scopeLabel: 'Postseason',
      scopeDetail: 'Postseason',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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
  assert.match(model.heroNarrative ?? '', /won the title by 0.062 over Maleski/);
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
      scopeLabel: 'League',
      scopeDetail: 'Week 10',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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
      scopeLabel: 'Postseason',
      scopeDetail: 'Postseason',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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
      scopeLabel: 'Postseason',
      scopeDetail: 'Postseason',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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
  assert.match(model.heroNarrative ?? '', /Alice won the title by 0.083 over Bob/);
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
      scopeLabel: 'League',
      scopeDetail: 'Week 1',
      emphasis: 'upcoming',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
    } satisfies OverviewContext,
    liveItems: [] as OverviewGameItem[],
    keyMatchups: [] as OverviewGameItem[],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map<string, never>(),
  };

  assert.deepEqual(selectOverviewViewModel(params), selectOverviewViewModel(params));
});

test('selectOverviewViewModel adds meaningful matrix highlight only when notable', () => {
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
      scopeLabel: 'League',
      scopeDetail: 'Week 1',
      emphasis: 'upcoming',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
    },
    liveItems: [],
    keyMatchups: [],
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

  // leagueHighlights retired from view model — verify shouldShowFeaturedMatchups
  // reacts to internal highlights (split matchup makes highlights non-empty → hides featured)
  assert.equal(model.shouldShowFeaturedMatchups, false);
});

test('selectOverviewViewModel emits typed game highlight drilldowns with truthful CTA copy', () => {
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
      scopeLabel: 'League',
      scopeDetail: 'Week 9',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
    },
    liveItems: [],
    keyMatchups: [final],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  // leagueHighlights retired from view model — verify shouldShowFeaturedMatchups
  // is false when game highlights exist internally
  assert.equal(model.shouldShowFeaturedMatchups, false);
});

test('selectOverviewViewModel suppresses weak owner-vs-owner highlights', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [],
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeLabel: 'League',
      scopeDetail: 'Week 1',
      emphasis: 'upcoming',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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

  // leagueHighlights retired — weak matrix data should still produce shouldShowFeaturedMatchups: true
  assert.equal(model.shouldShowFeaturedMatchups, false);
});

test('selectOverviewViewModel removes noisy scope suffix and duplicated movement prefixes', () => {
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
      scopeLabel: 'Postseason',
      scopeDetail: 'This postseason slate',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
    },
    liveItems: [],
    keyMatchups: [final],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  // leagueHighlights retired — verify pulse items don't include noisy scope suffix
  assert.ok(
    model.leaguePulse.every((entry) => !/\(this postseason slate\)/i.test(entry.text))
  );
});

test('selectOverviewViewModel keeps featured games when finals dominate early candidates', () => {
  const finals = [1, 2, 3, 4].map((value) => ({
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
      scopeLabel: 'League',
      scopeDetail: 'Week 8',
      emphasis: 'upcoming',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
    },
    liveItems: [],
    keyMatchups: [...finals, featuredLater],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.ok(
    model.featuredMatchups.some((entry) => entry.item.bucket.game.key === 'scheduled-late')
  );
  assert.equal(model.recentResults.length, 4);
});

test('selectOverviewViewModel is deterministic for identical highlight inputs', () => {
  const params = {
    standingsLeaders: [],
    standingsCoverage: { state: 'partial', message: null } as const,
    context: {
      scopeLabel: 'League',
      scopeDetail: 'Week 2',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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

test('selectOverviewViewModel keeps live-competition pulse wording during active season', () => {
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
      scopeLabel: 'League',
      scopeDetail: 'Week 9',
      emphasis: 'upcoming',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
    },
    liveItems: [],
    keyMatchups: [item('active-pulse')],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.ok(model.leaguePulse.some((entry) => /leads by|closest race/i.test(entry.text)));
});

test('selectOverviewViewModel removes live-competition pulse wording after season completes', () => {
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
      scopeLabel: 'Postseason',
      scopeDetail: 'Postseason',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
    },
    liveItems: [],
    keyMatchups: [postseasonFinal],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.ok(model.leaguePulse.some((entry) => /Season complete/i.test(entry.text)));
  assert.ok(model.leaguePulse.every((entry) => !/leads by|closest race/i.test(entry.text)));
});

test('selectOverviewViewModel suppresses league pulse when completed season only emits season-complete filler', () => {
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
      scopeLabel: 'Postseason',
      scopeDetail: 'Postseason',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
    },
    liveItems: [],
    keyMatchups: [postseasonFinal],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.deepEqual(model.leaguePulse, [
    { id: 'season-complete', text: 'Season complete: final standings locked.' },
  ]);
  assert.equal(model.shouldShowLeaguePulse, false);
});

test('selectOverviewViewModel active-season pulse keeps history-derived temporal signals', () => {
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
      scopeLabel: 'League',
      scopeDetail: 'Week 9',
      emphasis: 'upcoming',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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

  assert.ok(model.keyMovements.some((entry) => entry.id.startsWith('leader-gap')));
  assert.equal(model.shouldShowLeaguePulse, true);
});

test('selectOverviewViewModel movement snapshots ignore unresolved future weeks in standingsHistory', () => {
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
      scopeLabel: 'League',
      scopeDetail: 'Week 4',
      emphasis: 'upcoming',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
    },
    liveItems: [],
    keyMatchups: [],
    matchupMatrix: { owners: [], rows: [] },
    rankingsByTeamId: new Map(),
  });

  assert.ok(model.keyMovements.some((entry) => entry.id === 'biggest-gain-Alex'));
  assert.ok(!model.keyMovements.some((entry) => entry.id === 'biggest-gain-Blake'));
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
      scopeLabel: 'League',
      scopeDetail: 'Week 2',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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
      scopeLabel: 'League',
      scopeDetail: 'Week 6',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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
      scopeLabel: 'League',
      scopeDetail: 'Final',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
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
