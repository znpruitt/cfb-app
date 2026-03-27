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
  assert.equal(typeof model.leagueNarrative, 'string');
  assert.equal(model.shouldShowLeaguePulse, true);
  assert.ok(model.leaguePulse.length > 0);
  assert.equal(model.heroMode, 'leader');
  assert.equal(model.podiumLeaders.length, 0);
  assert.ok(model.keyMovements.every((insight) => !insight.id.startsWith('live-top25')));
  assert.ok(Array.isArray(model.leagueHighlights));
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
  assert.match(model.leagueNarrative ?? '', /won the title by 0.062 over Maleski/);
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

  const matrixHighlight = model.leagueHighlights.find(
    (entry) => entry.label === 'Split owner matchup'
  );
  assert.ok(matrixHighlight);
  assert.equal(matrixHighlight?.ctaLabel, 'View matrix');
  assert.equal(matrixHighlight?.drilldownTarget.destination, 'matrix');
  assert.equal(matrixHighlight?.drilldownTarget.kind, 'owner_pair');
  assert.match(matrixHighlight?.text ?? '', /dead even/);
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

  const gameHighlight = model.leagueHighlights.find(
    (entry) => entry.drilldownTarget.kind === 'game'
  );
  assert.ok(gameHighlight);
  assert.equal(gameHighlight?.ctaLabel, 'View game');
  assert.equal(gameHighlight?.drilldownTarget.destination, 'schedule');
  assert.equal(gameHighlight?.drilldownTarget.seasonTab, 'week');
  assert.equal(gameHighlight?.drilldownTarget.week, 1);
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

  assert.ok(model.leagueHighlights.every((entry) => entry.label !== 'Split owner matchup'));
  assert.ok(model.leagueHighlights.every((entry) => entry.label !== 'Heavy owner collision'));
});

test('selectOverviewViewModel uses unified CTA verbs for league highlights', () => {
  const model = selectOverviewViewModel({
    standingsLeaders: [],
    standingsCoverage: { state: 'partial', message: null },
    context: {
      scopeLabel: 'League',
      scopeDetail: 'Week 7',
      emphasis: 'recent',
      highlightsTitle: '',
      highlightsDescription: '',
      liveDescription: '',
      sectionOrder: ['highlights', 'standings', 'matrix', 'live'],
    },
    liveItems: [],
    keyMatchups: [
      {
        ...item('cta-game'),
        score: {
          status: 'Final',
          time: null,
          away: { team: 'Away', score: 28 },
          home: { team: 'Home', score: 24 },
        },
      },
    ],
    matchupMatrix: {
      owners: ['A', 'B'],
      rows: [
        {
          owner: 'A',
          cells: [
            { owner: 'A', gameCount: 0, record: null },
            { owner: 'B', gameCount: 6, record: '3-3' },
          ],
        },
        {
          owner: 'B',
          cells: [
            { owner: 'A', gameCount: 6, record: '3-3' },
            { owner: 'B', gameCount: 0, record: null },
          ],
        },
      ],
    },
    rankingsByTeamId: new Map(),
  });

  assert.ok(
    model.leagueHighlights.every((entry) =>
      ['View game', 'View standings', 'View matchup', 'View matrix'].includes(entry.ctaLabel)
    )
  );
  assert.ok(model.leagueHighlights.every((entry) => !entry.ctaLabel.startsWith('Open ')));
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
    previousStandingsLeaders: [
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

  const gainHighlight = model.leagueHighlights.find((entry) => entry.type === 'biggest_gain');
  if (gainHighlight) {
    assert.doesNotMatch(gainHighlight.text, /Biggest gain:/);
  }
  assert.ok(
    model.leagueHighlights.every((entry) => !/\(this postseason slate\)/i.test(entry.text))
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
