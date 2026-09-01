import assert from 'node:assert/strict';
import test from 'node:test';

import type { OverviewGameItem } from '../../overview.ts';
import type { AvailableWeeklyRecapViewModel } from '../../recap/composeWeeklyRecap.ts';
import type { AppGame } from '../../schedule.ts';
import type { ScorePack } from '../../scores.ts';
import { NO_CLAIM_OWNER } from '../../standings.ts';
import {
  OVERVIEW_LIVE_LIMIT,
  selectOverviewGamePresentation,
  selectOverviewGameSections,
  type OverviewGamePresentation,
  type OverviewGameSections,
} from '../overviewGameSections.ts';

const DEFAULT_NOW = new Date('2026-09-06T20:00:00.000Z');
const HIDDEN_PRESENTATION: Pick<
  OverviewGamePresentation,
  'phase' | 'recapGameKeys' | 'expiredFinalWeeks'
> = {
  phase: 'hidden',
  recapGameKeys: new Set<string>(),
  expiredFinalWeeks: new Set<number>(),
};

function game(overrides: Partial<AppGame> & { key: string }): AppGame {
  const away = `${overrides.key}-away`;
  const home = `${overrides.key}-home`;
  return {
    key: overrides.key,
    eventId: overrides.eventId ?? overrides.key,
    eventKey: overrides.eventKey ?? overrides.key,
    week: overrides.week ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 1,
    stage: overrides.stage ?? 'regular',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 0,
    date: overrides.date ?? '2026-09-06T18:00:00.000Z',
    status: overrides.status ?? 'scheduled',
    rawStatus: overrides.rawStatus ?? overrides.status ?? 'scheduled',
    completed: overrides.completed,
    startTimeTBD: overrides.startTimeTBD,
    label: overrides.label ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? overrides.key,
    neutral: overrides.neutral ?? false,
    neutralDisplay: overrides.neutralDisplay ?? 'home_away',
    venue: overrides.venue ?? null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
      away: {
        kind: 'team',
        teamId: away,
        displayName: away,
        canonicalName: away,
        rawName: away,
      },
      home: {
        kind: 'team',
        teamId: home,
        displayName: home,
        canonicalName: home,
        rawName: home,
      },
    },
    csvAway: overrides.csvAway ?? away,
    csvHome: overrides.csvHome ?? home,
    canAway: overrides.canAway ?? away,
    canHome: overrides.canHome ?? home,
    awayConf: overrides.awayConf ?? 'SEC',
    homeConf: overrides.homeConf ?? 'Big Ten',
    sources: overrides.sources,
  };
}

function score(
  status: string,
  awayScore: number | null = 0,
  homeScore: number | null = 0
): ScorePack {
  return {
    status,
    away: { team: 'away', score: awayScore },
    home: { team: 'home', score: homeScore },
    time: status === 'Q2' ? '8:14' : null,
  };
}

function item(
  gameValue: AppGame,
  options: {
    score?: ScorePack;
    awayOwner?: string;
    homeOwner?: string;
    awayIsLeagueTeam?: boolean;
    homeIsLeagueTeam?: boolean;
  } = {}
): OverviewGameItem {
  return {
    bucket: {
      game: gameValue,
      awayOwner: options.awayOwner ?? 'Alice',
      homeOwner: options.homeOwner ?? 'Bob',
      awayIsLeagueTeam: options.awayIsLeagueTeam ?? true,
      homeIsLeagueTeam: options.homeIsLeagueTeam ?? true,
    },
    score: options.score,
    priority: 2,
    sortDate: gameValue.date ? Date.parse(gameValue.date) : Number.POSITIVE_INFINITY,
  };
}

function route(
  items: OverviewGameItem[],
  options: {
    now?: Date;
    eligibleWatchlistKeys?: ReadonlySet<string>;
    featuredGameKeys?: ReadonlySet<string>;
    presentation?: Pick<OverviewGamePresentation, 'phase' | 'recapGameKeys' | 'expiredFinalWeeks'>;
  } = {}
): OverviewGameSections {
  return selectOverviewGameSections({
    items,
    eligibleWatchlistKeys:
      options.eligibleWatchlistKeys ?? new Set(items.map((entry) => entry.bucket.game.key)),
    featuredGameKeys: options.featuredGameKeys ?? new Set<string>(),
    presentation: options.presentation ?? HIDDEN_PRESENTATION,
    now: options.now ?? DEFAULT_NOW,
  });
}

function assertOnlySection(
  sections: OverviewGameSections,
  gameKey: string,
  expected: keyof OverviewGameSections
): void {
  const memberships = (Object.keys(sections) as Array<keyof OverviewGameSections>).filter(
    (section) => sections[section].some((entry) => entry.bucket.game.key === gameKey)
  );
  assert.deepEqual(
    memberships,
    [expected],
    `${gameKey} must appear in exactly ${expected}, got ${memberships.join(', ') || 'none'}`
  );
}

function availableRecap(
  gameKeys: string[],
  overrides: Partial<AvailableWeeklyRecapViewModel> = {}
): AvailableWeeklyRecapViewModel {
  return {
    status: 'available',
    week: 1,
    weekLabel: 'Week 1',
    latestGameDate: '2026-09-05',
    headline: 'Alice takes the week',
    isIncomplete: false,
    ownerLines: [],
    leaderLines: [],
    tileLeaderLines: [],
    movementLines: [],
    recordChangeLines: [],
    headToHeadLines: [],
    notableResultLines: [],
    tileHighlights: gameKeys.map((gameKey) => ({
      kind: 'game' as const,
      id: `game-${gameKey}`,
      gameKey,
      label: 'Closest game',
      detail: '3-point margin',
      winner: { team: 'Winner', owner: 'Alice', score: '24' },
      loser: { team: 'Loser', owner: 'Bob', score: '21' },
    })),
    ...overrides,
  };
}

test('scheduled promotes from watchlist to Live at a confirmed kickoff', () => {
  const scheduled = item(game({ key: 'scheduled-kickoff', date: '2026-09-06T18:00:00.000Z' }), {
    score: score('scheduled'),
  });

  const before = route([scheduled], { now: new Date('2026-09-06T17:59:00.000Z') });
  assertOnlySection(before, 'scheduled-kickoff', 'scheduled');
  assert.equal(before.scheduled[0]?.routeStatus.label, 'Scheduled');

  const after = route([scheduled], { now: new Date('2026-09-06T18:01:00.000Z') });
  assertOnlySection(after, 'scheduled-kickoff', 'live');
  assert.equal(after.live[0]?.routeStatus.label, 'Awaiting score');
});

test('a bounded scoreless Live row promotes to Recent finals when a final score attaches', () => {
  const gameValue = game({ key: 'score-attaches', date: '2026-09-06T18:00:00.000Z' });
  const awaiting = route([item(gameValue)]);
  assertOnlySection(awaiting, 'score-attaches', 'live');

  const completed = route([item(gameValue, { score: score('final', 21, 24) })]);
  assertOnlySection(completed, 'score-attaches', 'recentFinals');
  assert.equal(completed.recentFinals[0]?.routeStatus.label, 'Final');
});

test('unknown routes by kickoff and keeps Awaiting score bounded to eight hours', () => {
  const future = item(game({ key: 'unknown-future', date: '2026-09-06T20:01:00.000Z' }));
  const bounded = item(game({ key: 'unknown-bounded', date: '2026-09-06T12:00:00.000Z' }));
  const abandoned = item(game({ key: 'unknown-abandoned', date: '2026-09-06T11:59:00.000Z' }));
  const sections = route([future, bounded, abandoned]);

  assertOnlySection(sections, 'unknown-future', 'scheduled');
  assertOnlySection(sections, 'unknown-bounded', 'live');
  assert.equal(sections.live[0]?.routeStatus.label, 'Awaiting score');
  assert.equal(
    Object.values(sections)
      .flat()
      .some((entry) => entry.bucket.game.key === 'unknown-abandoned'),
    false
  );
});

test('scheduled past kickoff uses the same per-game abandonment bound, even with completed flagged', () => {
  const bounded = item(game({ key: 'scheduled-bounded', date: '2026-09-06T12:00:00.000Z' }), {
    score: score('scheduled'),
  });
  const abandoned = item(
    game({ key: 'scheduled-abandoned', date: '2026-09-06T11:59:00.000Z', completed: true }),
    { score: score('scheduled') }
  );
  const sections = route([bounded, abandoned]);

  assertOnlySection(sections, 'scheduled-bounded', 'live');
  assert.equal(
    Object.values(sections)
      .flat()
      .some((entry) => entry.bucket.game.key === 'scheduled-abandoned'),
    false,
    'the row-level abandonment predicate must remain reachable despite provider completed=true'
  );
});

test('Time TBD placeholders never promote without usable score evidence', () => {
  const scheduled = item(
    game({ key: 'tbd-scheduled', date: '2020-01-01T00:00:00.000Z', startTimeTBD: true }),
    { score: score('scheduled') }
  );
  const unknown = item(
    game({ key: 'tbd-unknown', date: '2020-01-01T00:00:00.000Z', startTimeTBD: true })
  );
  const sections = route([scheduled, unknown]);

  assertOnlySection(sections, 'tbd-scheduled', 'scheduled');
  assertOnlySection(sections, 'tbd-unknown', 'scheduled');
});

test('attached final and in-progress scores override contradictory future or TBD kickoffs', () => {
  const final = item(game({ key: 'future-final', date: '2027-01-01T00:00:00.000Z' }), {
    score: score('final', 31, 17),
  });
  const live = item(
    game({ key: 'tbd-live', date: '2027-01-01T00:00:00.000Z', startTimeTBD: true }),
    { score: score('Q2', 0, 0) }
  );
  const sections = route([final, live]);

  assertOnlySection(sections, 'future-final', 'recentFinals');
  assertOnlySection(sections, 'tbd-live', 'live');
  assert.equal(sections.live[0]?.routeStatus.label, 'Live');
});

test('zero real ownership excludes NoClaim, undefined, and non-league roster entries', () => {
  const entries = [
    item(game({ key: 'no-claim' }), {
      awayOwner: NO_CLAIM_OWNER,
      homeOwner: NO_CLAIM_OWNER,
      score: score('final', 24, 17),
    }),
    item(game({ key: 'undefined-owner' }), {
      awayOwner: '',
      homeOwner: '',
      score: score('final', 24, 17),
    }),
    item(game({ key: 'non-league' }), {
      awayOwner: 'Truthy stale owner',
      homeOwner: 'Another stale owner',
      awayIsLeagueTeam: false,
      homeIsLeagueTeam: false,
      score: score('final', 24, 17),
    }),
  ];
  const sections = route(entries);

  assert.deepEqual(sections, { scheduled: [], live: [], recentFinals: [] });
});

test('one real owner is sufficient when the opponent is unclaimed or non-league', () => {
  const oneOwned = item(game({ key: 'one-owned' }), {
    awayOwner: 'Alice',
    homeOwner: NO_CLAIM_OWNER,
    homeIsLeagueTeam: false,
    score: score('final', 24, 17),
  });
  const sections = route([oneOwned]);

  assertOnlySection(sections, 'one-owned', 'recentFinals');
});

test('the defensive disrupted sub-case remains scheduled with its exact label', () => {
  const canceled = item(game({ key: 'canceled', rawStatus: 'STATUS_CANCELED' }), {
    score: score('STATUS_CANCELED'),
  });
  const sections = route([canceled]);

  assertOnlySection(sections, 'canceled', 'scheduled');
  assert.deepEqual(sections.scheduled[0]?.routeStatus, {
    kind: 'disrupted',
    label: 'Canceled',
  });
});

test('attached in-progress scores sort ahead of awaiting rows before the six-row cap', () => {
  const live = Array.from({ length: OVERVIEW_LIVE_LIMIT }, (_, index) =>
    item(game({ key: `scored-${index}`, date: `2026-09-06T1${index}:00:00.000Z` }), {
      awayOwner: 'Alice',
      homeOwner: NO_CLAIM_OWNER,
      score: score('Q2', 0, 0),
    })
  );
  const awaiting = item(game({ key: 'awaiting-both-owned', date: '2026-09-06T19:00:00.000Z' }));
  const sections = route([...live, awaiting]);

  assert.equal(sections.live.length, OVERVIEW_LIVE_LIMIT);
  assert.ok(sections.live.every((entry) => entry.routeStatus.kind === 'live'));
  assert.equal(
    sections.live.some((entry) => entry.bucket.game.key === 'awaiting-both-owned'),
    false
  );
});

test('Featured remains separate and a routed game never occupies two state sections', () => {
  const scheduled = item(game({ key: 'only-scheduled', date: '2026-09-07T18:00:00.000Z' }), {
    score: score('scheduled'),
  });
  const featured = item(game({ key: 'featured-final' }), { score: score('final', 24, 17) });
  const sections = route([scheduled, scheduled, featured], {
    featuredGameKeys: new Set(['featured-final']),
  });

  assertOnlySection(sections, 'only-scheduled', 'scheduled');
  assert.equal(
    Object.values(sections)
      .flat()
      .some((entry) => entry.bucket.game.key === 'featured-final'),
    false
  );
});

test('recap dedup suppresses only explicit rendered game keys and fails open when unavailable', () => {
  const scheduleGame = game({
    key: 'recapped-final',
    date: '2026-09-06T01:00:00.000Z',
    status: 'final',
    completed: true,
  });
  const lateMakeup = game({
    key: 'late-makeup',
    week: 2,
    date: '2026-09-07T01:00:00.000Z',
    status: 'final',
    completed: true,
  });
  const now = new Date('2026-09-08T16:00:00.000Z');
  const withRecap = selectOverviewGamePresentation({
    scheduleGames: [scheduleGame],
    weeklyRecap: availableRecap(['recapped-final']),
    activeSeason: true,
    now,
  });
  const deduped = route(
    [
      item(scheduleGame, { score: score('final', 24, 17) }),
      item(lateMakeup, { score: score('final', 31, 28) }),
    ],
    { presentation: withRecap, now }
  );

  assert.equal(withRecap.recap?.status, 'available');
  assert.deepEqual(
    deduped.recentFinals.map((entry) => entry.bucket.game.key),
    ['late-makeup']
  );

  const unavailable = selectOverviewGamePresentation({
    scheduleGames: [scheduleGame],
    weeklyRecap: { status: 'unavailable' },
    activeSeason: true,
    now,
  });
  const retained = route([item(scheduleGame, { score: score('final', 24, 17) })], {
    presentation: unavailable,
    now,
  });
  assertOnlySection(retained, 'recapped-final', 'recentFinals');
});

test('a mismatched recap owns no final while an available server recap survives missing schedule', () => {
  const scheduleGame = game({
    key: 'schedule-final',
    date: '2026-09-06T01:00:00.000Z',
    status: 'final',
    completed: true,
  });
  const now = new Date('2026-09-08T16:00:00.000Z');
  const mismatch = selectOverviewGamePresentation({
    scheduleGames: [scheduleGame],
    weeklyRecap: availableRecap(['schedule-final'], {
      week: 2,
      weekLabel: 'Week 2',
      latestGameDate: '2026-09-06',
    }),
    activeSeason: true,
    now,
  });
  assert.equal(mismatch.recap, null);
  assert.deepEqual([...mismatch.recapGameKeys], []);

  const scheduleUnavailable = selectOverviewGamePresentation({
    scheduleGames: [],
    weeklyRecap: availableRecap(['schedule-final']),
    activeSeason: true,
    now,
  });
  assert.equal(scheduleUnavailable.recap?.status, 'available');
  assert.deepEqual([...scheduleUnavailable.recapGameKeys], ['schedule-final']);
});

test('Recent finals clears exactly at Thursday 06:00 ET and one minute before remains visible', () => {
  const finalGame = game({
    key: 'boundary-final',
    date: '2026-09-06T01:00:00.000Z',
    status: 'final',
    completed: true,
  });
  const finalItem = item(finalGame, { score: score('final', 24, 17) });
  const before = new Date('2026-09-10T09:59:00.000Z');
  const atBoundary = new Date('2026-09-10T10:00:00.000Z');
  const beforePresentation = selectOverviewGamePresentation({
    scheduleGames: [finalGame],
    weeklyRecap: { status: 'unavailable' },
    activeSeason: true,
    now: before,
  });
  const boundaryPresentation = selectOverviewGamePresentation({
    scheduleGames: [finalGame],
    weeklyRecap: { status: 'unavailable' },
    activeSeason: true,
    now: atBoundary,
  });

  assert.equal(beforePresentation.phase, 'recap');
  assertOnlySection(
    route([finalItem], { presentation: beforePresentation, now: before }),
    'boundary-final',
    'recentFinals'
  );
  assert.equal(boundaryPresentation.phase, 'upcoming');
  assert.equal(
    route([finalItem], { presentation: boundaryPresentation, now: atBoundary }).recentFinals.length,
    0
  );
});

test('a new week final promotes immediately after the prior week Thursday expiry', () => {
  const priorFinal = game({
    key: 'prior-final',
    week: 1,
    date: '2026-09-06T01:00:00.000Z',
    status: 'final',
    completed: true,
  });
  const newFinal = game({
    key: 'new-final',
    week: 2,
    date: '2026-09-12T17:00:00.000Z',
    status: 'final',
    completed: true,
  });
  const now = new Date('2026-09-12T20:00:00.000Z');
  const presentation = selectOverviewGamePresentation({
    scheduleGames: [priorFinal, newFinal],
    weeklyRecap: { status: 'unavailable' },
    activeSeason: true,
    now,
  });
  const sections = route(
    [
      item(priorFinal, { score: score('final', 24, 17) }),
      item(newFinal, { score: score('final', 31, 28) }),
    ],
    { presentation, now }
  );

  assert.equal(presentation.phase, 'upcoming');
  assert.deepEqual([...presentation.expiredFinalWeeks], [1]);
  assertOnlySection(sections, 'new-final', 'recentFinals');
  assert.equal(
    sections.recentFinals.some((entry) => entry.bucket.game.key === 'prior-final'),
    false
  );
});

test('inactive and archived season presentation clears Recent finals', () => {
  const finalGame = game({ key: 'archived-final' });
  const presentation = selectOverviewGamePresentation({
    scheduleGames: [finalGame],
    weeklyRecap: availableRecap([]),
    activeSeason: false,
    now: DEFAULT_NOW,
  });
  const sections = route([item(finalGame, { score: score('final', 24, 17) })], {
    presentation,
  });

  assert.equal(presentation.phase, 'inactive');
  assert.equal(sections.recentFinals.length, 0);
});
