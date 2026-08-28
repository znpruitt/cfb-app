import assert from 'node:assert/strict';
import test from 'node:test';

import type { ScorePack } from '../../scores.ts';
import type { AppGame } from '../../schedule.ts';
import {
  isWeeklyRecapActiveSeason,
  selectWeeklyRecapFacts,
  selectWeeklyRecapTargetWeek,
} from '../weeklyRecapFacts.ts';

function game(args: {
  key: string;
  week: number;
  date: string | null;
  providerWeek?: number;
  stage?: AppGame['stage'];
  status?: AppGame['status'];
  completed?: boolean;
  startTimeTBD?: boolean;
  away?: string;
  home?: string;
}): AppGame {
  const away = args.away ?? `${args.key}-away`;
  const home = args.home ?? `${args.key}-home`;

  return {
    key: args.key,
    eventId: args.key,
    eventKey: args.key,
    week: args.week,
    canonicalWeek: args.week,
    providerWeek: args.providerWeek ?? args.week,
    stage: args.stage ?? 'regular',
    stageOrder: 1,
    slotOrder: 0,
    date: args.date,
    status: args.status ?? 'scheduled',
    rawStatus: args.status ?? 'scheduled',
    completed: args.completed,
    startTimeTBD: args.startTimeTBD,
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: args.key,
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    participants: {
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
    csvAway: away,
    csvHome: home,
    canAway: away,
    canHome: home,
    awayConf: '',
    homeConf: '',
  };
}

function finalScore(away: number, home: number): ScorePack {
  return {
    status: 'final',
    away: { team: 'away', score: away },
    home: { team: 'home', score: home },
    time: null,
  };
}

test('request-time recaps exist only for the matching active season', () => {
  assert.equal(
    isWeeklyRecapActiveSeason({
      leagueStatus: { state: 'season', year: 2026 },
      seasonYear: 2026,
    }),
    true
  );
  assert.equal(
    isWeeklyRecapActiveSeason({
      leagueStatus: { state: 'season', year: 2025 },
      seasonYear: 2026,
    }),
    false
  );
  assert.equal(
    isWeeklyRecapActiveSeason({
      leagueStatus: { state: 'preseason', year: 2026 },
      seasonYear: 2026,
    }),
    false
  );
  assert.equal(
    isWeeklyRecapActiveSeason({ leagueStatus: { state: 'offseason' }, seasonYear: 2026 }),
    false
  );
});

test('target week stays on the previous slate after an early current-week final', () => {
  const games = [
    game({ key: 'w1', week: 1, date: '2026-08-30T20:00:00.000Z' }),
    game({
      key: 'w2-thu',
      week: 2,
      date: '2026-09-04T00:00:00.000Z',
      status: 'final',
    }),
    game({ key: 'w2-sat', week: 2, date: '2026-09-06T00:00:00.000Z' }),
  ];

  assert.deepEqual(selectWeeklyRecapTargetWeek(games, new Date('2026-09-04T16:00:00.000Z')), {
    week: 1,
    latestGameDate: '2026-08-30',
  });
});

test('06:00 ET cutoff clears a 23:00 ET kickoff on the final game-date', () => {
  const games = [game({ key: 'late', week: 4, date: '2026-09-06T03:00:00.000Z' })];

  assert.equal(selectWeeklyRecapTargetWeek(games, new Date('2026-09-06T09:59:00.000Z')), null);
  assert.deepEqual(selectWeeklyRecapTargetWeek(games, new Date('2026-09-06T10:00:00.000Z')), {
    week: 4,
    latestGameDate: '2026-09-05',
  });
});

test('a Monday-night week becomes eligible Tuesday morning, not Monday night', () => {
  const games = [game({ key: 'monday', week: 2, date: '2026-09-08T03:00:00.000Z' })];

  assert.equal(selectWeeklyRecapTargetWeek(games, new Date('2026-09-08T09:59:00.000Z')), null);
  assert.equal(selectWeeklyRecapTargetWeek(games, new Date('2026-09-08T10:00:00.000Z'))?.week, 2);
});

test('bye weeks are skipped and future all-TBD weeks do not advance the target', () => {
  const games = [
    game({ key: 'w1', week: 1, date: '2026-09-02T00:00:00.000Z' }),
    game({
      key: 'w3-tbd',
      week: 3,
      date: '2026-09-20T00:00:00.000Z',
      startTimeTBD: true,
    }),
  ];

  assert.equal(selectWeeklyRecapTargetWeek(games, new Date('2026-09-10T16:00:00.000Z'))?.week, 1);
});

test('selection uses built canonical postseason weeks rather than provider week numbers', () => {
  const games = [
    game({ key: 'regular', week: 15, date: '2026-12-06T00:00:00.000Z' }),
    game({
      key: 'bowl',
      week: 16,
      providerWeek: 1,
      stage: 'bowl',
      date: '2026-12-20T00:00:00.000Z',
    }),
  ];

  assert.equal(selectWeeklyRecapTargetWeek(games, new Date('2026-12-22T16:00:00.000Z'))?.week, 16);
});

test('Week 0 and a Labor Day Week 1 remain distinct calendar targets', () => {
  const games = [
    game({ key: 'week-zero', week: 0, date: '2026-08-30T00:00:00.000Z' }),
    game({ key: 'labor-day', week: 1, date: '2026-09-08T00:00:00.000Z' }),
  ];

  assert.equal(selectWeeklyRecapTargetWeek(games, new Date('2026-09-01T16:00:00.000Z'))?.week, 0);
  assert.equal(selectWeeklyRecapTargetWeek(games, new Date('2026-09-09T16:00:00.000Z'))?.week, 1);
});

test('an old never-played game remains eligible and missing dates create no target', () => {
  const neverPlayed = game({
    key: 'never-played',
    week: 5,
    date: '2026-09-27T00:00:00.000Z',
    status: 'scheduled',
  });
  const missingDate = game({ key: 'missing', week: 6, date: null, startTimeTBD: true });

  assert.equal(
    selectWeeklyRecapTargetWeek([neverPlayed, missingDate], new Date('2026-10-01T16:00:00.000Z'))
      ?.week,
    5
  );
  assert.equal(
    selectWeeklyRecapTargetWeek([missingDate], new Date('2026-10-01T16:00:00.000Z')),
    null
  );
});

test('weekly owner results aggregate multiple teams with distinct PF and PA', () => {
  const games = [
    game({
      key: 'one',
      week: 1,
      date: '2026-09-06T00:00:00.000Z',
      away: 'Alpha',
      home: 'Beta',
    }),
    game({
      key: 'two',
      week: 1,
      date: '2026-09-06T01:00:00.000Z',
      away: 'Gamma',
      home: 'Delta',
    }),
  ];
  const facts = selectWeeklyRecapFacts({
    games,
    rosterByTeam: new Map([
      ['Alpha', 'Alice'],
      ['Delta', 'Alice'],
      ['Beta', 'Bob'],
    ]),
    scoresByKey: {
      one: finalScore(24, 10),
      two: finalScore(28, 31),
    },
    now: new Date('2026-09-07T16:00:00.000Z'),
  });

  assert.ok(facts);
  assert.deepEqual(facts.ownerResults, [
    {
      owner: 'Alice',
      wins: 2,
      losses: 0,
      gamesPlayed: 2,
      pointsFor: 55,
      pointsAgainst: 38,
      pointDifferential: 17,
    },
    {
      owner: 'Bob',
      wins: 0,
      losses: 1,
      gamesPlayed: 1,
      pointsFor: 10,
      pointsAgainst: 24,
      pointDifferential: -14,
    },
  ]);
});

test('owner facts exclude NoClaim while uncertainty stays scoped to real-owner games', () => {
  const games = [
    game({
      key: 'owned-final',
      week: 1,
      date: '2026-09-06T00:00:00.000Z',
      away: 'Alpha',
      home: 'Beta',
    }),
    game({
      key: 'no-claim-final',
      week: 1,
      date: '2026-09-06T00:30:00.000Z',
      away: 'Gamma',
      home: 'Delta',
    }),
    game({
      key: 'no-claim-missing',
      week: 1,
      date: '2026-09-06T00:45:00.000Z',
      status: 'final',
      completed: true,
      away: 'Gamma',
      home: 'Delta',
    }),
    game({
      key: 'unrelated-pending',
      week: 1,
      date: '2026-09-06T01:00:00.000Z',
      startTimeTBD: true,
      away: 'Epsilon',
      home: 'Zeta',
    }),
    game({
      key: 'owned-pending',
      week: 1,
      date: '2026-09-06T01:30:00.000Z',
      startTimeTBD: true,
      away: 'Alpha',
      home: 'Gamma',
    }),
  ];
  const facts = selectWeeklyRecapFacts({
    games,
    rosterByTeam: new Map([
      ['Alpha', 'Alice'],
      ['Beta', 'Bob'],
      ['Gamma', 'NoClaim'],
      ['Delta', 'NoClaim'],
    ]),
    scoresByKey: {
      'owned-final': finalScore(31, 17),
      'no-claim-final': finalScore(24, 10),
    },
    now: new Date('2026-09-07T16:00:00.000Z'),
  });

  assert.ok(facts);
  assert.deepEqual(
    facts.ownerResults.map(({ owner }) => owner),
    ['Alice', 'Bob']
  );
  assert.equal(facts.unresolvedCount, 1, 'the real-owner pending game remains visible');
  assert.equal(facts.abandonedCount, 0, 'the unrelated national game contributes no count');
  assert.equal(facts.missingResultCount, 0);
});

test('the calendar-wide target still advances across a week with no real-owner games', () => {
  const facts = selectWeeklyRecapFacts({
    games: [
      game({
        key: 'owned-week-one',
        week: 1,
        date: '2026-08-30T00:00:00.000Z',
        away: 'Alpha',
        home: 'Beta',
      }),
      game({
        key: 'national-week-two',
        week: 2,
        date: '2026-09-06T00:00:00.000Z',
        away: 'Gamma',
        home: 'Delta',
      }),
    ],
    rosterByTeam: new Map([
      ['Alpha', 'Alice'],
      ['Beta', 'Bob'],
    ]),
    scoresByKey: {
      'owned-week-one': finalScore(31, 17),
    },
    now: new Date('2026-09-07T16:00:00.000Z'),
  });

  assert.ok(facts);
  assert.equal(facts.targetWeek.week, 2);
  assert.deepEqual(facts.ownerResults, []);
  assert.equal(facts.unresolvedCount, 0);
  assert.equal(facts.abandonedCount, 0);
  assert.equal(facts.missingResultCount, 0);
});

test('a concluded real-owner game without a usable score is reported outside the totals', () => {
  const concluded = game({
    key: 'missing-result',
    week: 1,
    date: '2026-09-06T00:00:00.000Z',
    status: 'final',
    completed: true,
    away: 'Alpha',
    home: 'Beta',
  });
  const facts = selectWeeklyRecapFacts({
    games: [concluded],
    rosterByTeam: new Map([
      ['Alpha', 'Alice'],
      ['Beta', 'Bob'],
    ]),
    scoresByKey: {},
    now: new Date('2026-09-07T16:00:00.000Z'),
  });

  assert.ok(facts);
  assert.deepEqual(facts.ownerResults, []);
  assert.equal(facts.unresolvedCount, 0);
  assert.equal(facts.abandonedCount, 0);
  assert.equal(facts.missingResultCount, 1);
});

test('an unexpected tied final is not mislabeled as missing score coverage', () => {
  const tied = game({
    key: 'tied-final',
    week: 1,
    date: '2026-09-06T00:00:00.000Z',
    away: 'Alpha',
    home: 'Beta',
  });
  const facts = selectWeeklyRecapFacts({
    games: [tied],
    rosterByTeam: new Map([
      ['Alpha', 'Alice'],
      ['Beta', 'Bob'],
    ]),
    scoresByKey: { 'tied-final': finalScore(24, 24) },
    now: new Date('2026-09-07T16:00:00.000Z'),
  });

  assert.ok(facts);
  assert.deepEqual(facts.ownerResults, []);
  assert.equal(facts.unresolvedCount, 0);
  assert.equal(facts.abandonedCount, 0);
  assert.equal(facts.missingResultCount, 0);
});

test('one unresolved sibling keeps every pending league game outside the abandonment allowance', () => {
  const games = [
    game({
      key: 'unresolved',
      week: 1,
      date: '2026-09-06T00:00:00.000Z',
      startTimeTBD: true,
    }),
    game({
      key: 'abandoned',
      week: 1,
      date: '2026-09-06T01:00:00.000Z',
    }),
  ];
  const facts = selectWeeklyRecapFacts({
    games,
    rosterByTeam: new Map([
      ['unresolved-away', 'Alice'],
      ['abandoned-home', 'Bob'],
    ]),
    scoresByKey: {},
    now: new Date('2026-09-07T16:00:00.000Z'),
  });

  assert.ok(facts);
  assert.deepEqual(facts.ownerResults, []);
  assert.equal(facts.unresolvedCount, 2);
  assert.equal(facts.abandonedCount, 0);
  assert.equal(facts.missingResultCount, 0);
});

test('pending league games are abandoned only when the complete pending population clears the gate', () => {
  const games = [
    game({
      key: 'abandoned-one',
      week: 1,
      date: '2026-09-06T00:00:00.000Z',
    }),
    game({
      key: 'abandoned-two',
      week: 1,
      date: '2026-09-06T01:00:00.000Z',
    }),
  ];
  const facts = selectWeeklyRecapFacts({
    games,
    rosterByTeam: new Map([
      ['abandoned-one-away', 'Alice'],
      ['abandoned-two-home', 'Bob'],
    ]),
    scoresByKey: {},
    now: new Date('2026-09-07T16:00:00.000Z'),
  });

  assert.ok(facts);
  assert.deepEqual(facts.ownerResults, []);
  assert.equal(facts.unresolvedCount, 0);
  assert.equal(facts.abandonedCount, 2);
  assert.equal(facts.missingResultCount, 0);
});
