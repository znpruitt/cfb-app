import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveGameWeekPanelViewModel } from '../selectors/gameWeek.ts';
import { buildScheduleFromApi, type AppGame, type ScheduleWireItem } from '../schedule';
import type { ScorePack } from '../scores';
import { GAME_MAX_DURATION_MS } from '../standingsHistory';
import type { TeamCatalogItem } from '../teamIdentity';

const pipelineTeams: TeamCatalogItem[] = [
  { school: 'Away', level: 'FBS', conference: 'SEC' },
  { school: 'Home', level: 'FBS', conference: 'SEC' },
];

function cardFromWireStatus(
  status: string,
  kickoff: string,
  currentDateMs: number,
  options: { startTimeTBD?: boolean; score?: ScorePack } = {}
) {
  const scheduleItem: ScheduleWireItem = {
    id: `pipeline-${status}`,
    week: 1,
    startDate: kickoff,
    neutralSite: false,
    conferenceGame: true,
    homeTeam: 'Home',
    awayTeam: 'Away',
    homeConference: 'SEC',
    awayConference: 'SEC',
    status,
    completed: status === 'completed' || status === 'final',
    seasonType: 'regular',
  };
  if (typeof options.startTimeTBD === 'boolean') {
    scheduleItem.startTimeTBD = options.startTimeTBD;
  }

  const built = buildScheduleFromApi({
    scheduleItems: [scheduleItem],
    teams: pipelineTeams,
    aliasMap: {},
    season: 2026,
  });
  assert.equal(built.games.length, 1, status);
  const game = built.games[0];
  assert.ok(game, status);

  const vm = deriveGameWeekPanelViewModel({
    games: [game],
    oddsByKey: {},
    scoresByKey: options.score ? { [game.key]: options.score } : {},
    rosterByTeam: new Map(),
    rankingsByTeamId: new Map(),
    displayTimeZone: 'UTC',
    currentDateMs,
  });
  const card = vm.groupedGames[0]?.games[0];
  assert.ok(card, status);
  return card;
}

function cardFromGame(game: AppGame, score: ScorePack | undefined, currentDateMs: number) {
  const vm = deriveGameWeekPanelViewModel({
    games: [game],
    oddsByKey: {},
    scoresByKey: score ? { [game.key]: score } : {},
    rosterByTeam: new Map(),
    rankingsByTeamId: new Map(),
    displayTimeZone: 'UTC',
    currentDateMs,
  });
  const card = vm.groupedGames[0]?.games[0];
  assert.ok(card, game.key);
  return card;
}

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
    rawStatus: overrides.rawStatus,
    completed: overrides.completed,
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
        displayName: overrides.csvAway ?? 'Away',
        canonicalName: overrides.csvAway ?? 'Away',
        rawName: overrides.csvAway ?? 'Away',
      },
      home: {
        kind: 'team',
        teamId: 'home-id',
        displayName: overrides.csvHome ?? 'Home',
        canonicalName: overrides.csvHome ?? 'Home',
        rawName: overrides.csvHome ?? 'Home',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? 'Away',
    canHome: overrides.canHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'SEC',
    startTimeTBD: overrides.startTimeTBD,
    sources: overrides.sources,
  };
}

test('scheduled provider rows become awaiting at kickoff without a live label', () => {
  const kickoff = '2026-09-05T16:00:00.000Z';
  const kickoffMs = Date.parse(kickoff);

  const before = cardFromWireStatus('scheduled', kickoff, kickoffMs - 1, {
    startTimeTBD: false,
  });
  const atKickoff = cardFromWireStatus('scheduled', kickoff, kickoffMs, {
    startTimeTBD: false,
  });
  const after = cardFromWireStatus('scheduled', kickoff, kickoffMs + 1, {
    startTimeTBD: false,
  });

  assert.equal(before.scoreboardState, 'scheduled');
  assert.equal(atKickoff.scoreboardState, 'awaiting');
  assert.equal(after.scoreboardState, 'awaiting');
});

test('an explicit startTimeTBD true never supplies kickoff evidence', () => {
  const kickoff = '2026-09-05T16:00:00.000Z';
  const card = cardFromWireStatus('scheduled', kickoff, Date.parse(kickoff) + 1, {
    startTimeTBD: true,
  });

  assert.equal(card.scoreboardState, 'scheduled');
});

test('an absent startTimeTBD never supplies kickoff evidence', () => {
  const kickoff = '2026-09-05T16:00:00.000Z';
  const card = cardFromWireStatus('scheduled', kickoff, Date.parse(kickoff) + 1);

  assert.equal(card.game.startTimeTBD, undefined);
  assert.equal(card.scoreboardState, 'scheduled');
});

test('SYNTHETIC forward-looking wire disruption guard preserves a specific notice', () => {
  const kickoff = '2026-09-05T16:00:00.000Z';
  const expectedByRawStatus = new Map([
    ['canceled', 'Canceled'],
    ['STATUS_POSTPONED', 'Postponed'],
    ['suspended', 'Suspended'],
  ] as const);

  for (const [rawStatus, expectedNotice] of expectedByRawStatus) {
    const card = cardFromWireStatus(rawStatus, kickoff, Date.parse(kickoff) + 60_000, {
      startTimeTBD: false,
    });
    assert.equal(card.scoreboardState, 'scheduled', rawStatus);
    assert.equal(card.scheduleNotice, expectedNotice, rawStatus);
    assert.equal(card.statusRowValue, null, rawStatus);
  }
});

test('SYNTHETIC score-pack disruption enums use the normalized Schedule notice', () => {
  const kickoff = '2026-09-05T16:00:00.000Z';
  const card = cardFromGame(
    game({ key: 'score-postponed', date: kickoff, startTimeTBD: false }),
    {
      status: 'STATUS_POSTPONED',
      time: null,
      away: { team: 'Away', score: null },
      home: { team: 'Home', score: null },
    },
    Date.parse(kickoff) + 60_000
  );

  assert.equal(card.scoreboardState, 'scheduled');
  assert.equal(card.scheduleNotice, 'Postponed');
  assert.equal(card.statusRowValue, null);
});

test('wire completion labels without usable scores remain awaiting after kickoff', () => {
  const kickoff = '2026-09-05T16:00:00.000Z';

  for (const rawStatus of ['scheduled', 'completed', 'final']) {
    const card = cardFromWireStatus(rawStatus, kickoff, Date.parse(kickoff) + 60_000, {
      startTimeTBD: false,
    });
    assert.equal(card.scoreboardState, 'awaiting', rawStatus);
    assert.equal(card.scheduleNotice, null, rawStatus);
    assert.equal(card.statusRowValue, null, rawStatus);
  }
});

test('scoreless playable rows await through eight hours, then restore scheduled kickoff', () => {
  const kickoff = '2026-09-05T16:00:00.000Z';

  for (const [elapsedMs, expectedState] of [
    [GAME_MAX_DURATION_MS, 'awaiting'],
    [GAME_MAX_DURATION_MS + 1, 'scheduled'],
  ] as const) {
    for (const rawStatus of ['scheduled', 'completed']) {
      const card = cardFromWireStatus(rawStatus, kickoff, Date.parse(kickoff) + elapsedMs, {
        startTimeTBD: false,
      });
      assert.equal(card.scoreboardState, expectedState, `${rawStatus}:${elapsedMs}`);
      assert.equal(
        card.scheduleNotice,
        expectedState === 'scheduled' ? 'Scheduled' : null,
        `${rawStatus}:${elapsedMs}`
      );
      assert.equal(
        card.statusRowValue,
        expectedState === 'scheduled' ? '4:00 PM' : null,
        `${rawStatus}:${elapsedMs}`
      );
    }
  }
});

test('placeholder plus a usable final score stays final (v1 regression guard)', () => {
  const kickoff = '2026-09-05T16:00:00.000Z';
  const card = cardFromGame(
    game({ key: 'placeholder-final', date: kickoff, isPlaceholder: true, startTimeTBD: false }),
    {
      status: 'FINAL',
      time: null,
      away: { team: 'Away', score: 31 },
      home: { team: 'Home', score: 28 },
    },
    Date.parse(kickoff) + 60_000
  );

  assert.equal(card.scoreboardState, 'final');
  assert.equal(card.scheduleNotice, null);
});

test('abandoned plus a live Q4 score stays live', () => {
  const kickoff = '2026-09-05T16:00:00.000Z';
  const card = cardFromGame(
    game({ key: 'abandoned-live', date: kickoff, startTimeTBD: false }),
    {
      status: 'Q4',
      time: '2:14',
      away: { team: 'Away', score: 24 },
      home: { team: 'Home', score: 17 },
    },
    Date.parse(kickoff) + GAME_MAX_DURATION_MS + 1
  );

  assert.equal(card.scoreboardState, 'live');
  assert.equal(card.statusRowValue, 'Q4 2:14');
  assert.equal(card.scheduleNotice, null);
});

test('SYNTHETIC forward-looking disruption plus a live score stays live without a notice', () => {
  const kickoff = '2026-09-05T16:00:00.000Z';
  const card = cardFromGame(
    game({
      key: 'disrupted-live',
      date: kickoff,
      rawStatus: 'STATUS_DELAYED',
      startTimeTBD: false,
    }),
    {
      status: 'Q3',
      time: '8:42',
      away: { team: 'Away', score: 7 },
      home: { team: 'Home', score: 10 },
    },
    Date.parse(kickoff) + 60_000
  );

  assert.equal(card.scoreboardState, 'live');
  assert.equal(card.statusRowValue, 'Q3 8:42');
  assert.equal(card.scheduleNotice, null);
});

test('deriveGameWeekPanelViewModel groups games and computes counts', () => {
  const games = [game({ key: 'a' }), game({ key: 'b', status: 'in_progress' })];

  const vm = deriveGameWeekPanelViewModel({
    games,
    oddsByKey: {
      a: {
        favorite: 'Away',
        spread: -3.5,
        homeSpread: -3.5,
        awaySpread: 3.5,
        spreadPriceHome: -110,
        spreadPriceAway: -110,
        total: 51.5,
        mlHome: -150,
        mlAway: 130,
        overPrice: -110,
        underPrice: -110,
        source: 'DraftKings',
        bookmakerKey: 'draftkings',
        capturedAt: '2026-09-01T12:00:00.000Z',
        lineSourceStatus: 'latest',
      },
    },
    scoresByKey: {
      b: {
        status: 'in progress',
        time: '5:00',
        away: { team: 'Away', score: 7 },
        home: { team: 'Home', score: 3 },
      },
    },
    rosterByTeam: new Map([
      ['Away', 'Alice'],
      ['Home', 'Bob'],
    ]),
    rankingsByTeamId: new Map([['away-id', { rank: 12, rankSource: 'ap' }]]),
    displayTimeZone: 'America/New_York',
  });

  assert.equal(vm.totalGames, 2);
  assert.equal(vm.hasNoGames, false);
  assert.equal(vm.groupedGames.length, 1);
  assert.equal(vm.groupedGames[0]?.games.length, 2);
  assert.equal(vm.groupedGames[0]?.games[0]?.awayOwner, 'Alice');
  assert.equal(vm.groupedGames[0]?.games[0]?.homeOwner, 'Bob');
});

test('deriveGameWeekPanelViewModel marks placeholders and canonical-label rule', () => {
  const vm = deriveGameWeekPanelViewModel({
    games: [
      game({
        key: 'p',
        stage: 'bowl',
        status: 'placeholder',
        label: 'Winner A vs Winner B',
        csvAway: 'Team TBD',
        csvHome: 'Winner SEC',
      }),
    ],
    oddsByKey: {},
    scoresByKey: {},
    rosterByTeam: new Map(),
    rankingsByTeamId: new Map(),
    displayTimeZone: 'America/New_York',
  });

  const card = vm.groupedGames[0]?.games[0];
  assert.ok(card);
  assert.equal(card?.showCanonicalEventLabel, true);
  assert.equal(card?.scheduleNotice, 'Scheduled');
});

test('owner matchup resolves despite a provider-name mismatch (PLATFORM-039)', () => {
  // csvAway "Wash St" differs from the stored/canonical "Washington State".
  const vm = deriveGameWeekPanelViewModel({
    games: [
      game({
        key: 'mismatch',
        csvAway: 'Wash St',
        canAway: 'Washington State',
        csvHome: 'Oregon',
        canHome: 'Oregon',
        awayConf: 'Big Ten',
        homeConf: 'Big Ten',
      }),
    ],
    oddsByKey: {},
    scoresByKey: {},
    rosterByTeam: new Map([
      ['Washington State', 'Alice'],
      ['Oregon', 'Bob'],
    ]),
    rankingsByTeamId: new Map(),
    displayTimeZone: 'America/New_York',
  });

  const card = vm.groupedGames[0]?.games[0];
  assert.ok(card);
  assert.equal(card?.awayOwner, 'Alice');
  assert.equal(card?.homeOwner, 'Bob');
});

test('an FCS participant cannot create an owner matchup (PLATFORM-036)', () => {
  // Real FCS conference (Big Sky) that does not contain the token "FCS"; even
  // though both teams appear in the roster, the FCS team must not be owned and
  // the game must not surface as an owner matchup.
  const vm = deriveGameWeekPanelViewModel({
    games: [
      game({
        key: 'fbs-vs-fcs',
        csvAway: 'Montana',
        csvHome: 'Washington',
        awayConf: 'Big Sky',
        homeConf: 'Big Ten',
      }),
    ],
    oddsByKey: {},
    scoresByKey: {},
    rosterByTeam: new Map([
      ['Montana', 'Alice'],
      ['Washington', 'Bob'],
    ]),
    rankingsByTeamId: new Map(),
    displayTimeZone: 'America/New_York',
  });

  const card = vm.groupedGames[0]?.games[0];
  assert.ok(card);
  assert.equal(card?.awayOwner, undefined);
  assert.equal(card?.homeOwner, 'Bob');
});
