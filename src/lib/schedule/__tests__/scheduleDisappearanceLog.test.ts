import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emitScheduleGamesVanishedEvent,
  findVanishedScheduleGames,
} from '../scheduleDisappearanceLog.ts';

function row(id: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    week: 4,
    seasonType: 'regular',
    startDate: '2031-09-20T00:00:00Z',
    homeTeam: 'Texas',
    awayTeam: 'Rice',
    ...overrides,
  };
}

function captureEventLines(fn: () => void): string[] {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    if (args.length === 1 && typeof args[0] === 'string') lines.push(args[0]);
  };
  try {
    fn();
    return lines;
  } finally {
    console.log = originalLog;
  }
}

test('numeric record identity detects disappearance while same-id rewrites stay silent', () => {
  const vanished = findVanishedScheduleGames([row('601'), row('602')], [row('602')]);
  assert.deepEqual(vanished, {
    count: 1,
    games: [
      {
        providerGameId: 601,
        week: 4,
        seasonType: 'regular',
        startDate: '2031-09-20T00:00:00Z',
        homeTeam: 'Texas',
        awayTeam: 'Rice',
      },
    ],
    truncated: false,
  });

  const rewritten = findVanishedScheduleGames(
    [row('601')],
    [
      row('601', {
        week: 9,
        startDate: '2031-11-01T12:00:00Z',
        homeTeam: 'Michigan',
        awayTeam: 'Ohio State',
        venue: 'New venue',
      }),
    ]
  );
  assert.equal(rewritten.count, 0, 'the same numeric provider record is not a disappearance');
});

test('duplicate prior rows are deduplicated and the event payload is capped at 25 games', () => {
  const duplicate = findVanishedScheduleGames([row('601'), row('601')], []);
  assert.equal(duplicate.count, 1);
  assert.equal(duplicate.games.length, 1);

  const twentyFive = findVanishedScheduleGames(
    Array.from({ length: 25 }, (_, index) => row(String(index + 1))),
    []
  );
  assert.equal(twentyFive.count, 25);
  assert.equal(twentyFive.games.length, 25);
  assert.equal(twentyFive.truncated, false);

  const twentySix = findVanishedScheduleGames(
    Array.from({ length: 26 }, (_, index) => row(String(index + 1))),
    []
  );
  assert.equal(twentySix.count, 26);
  assert.equal(twentySix.games.length, 25);
  assert.equal(twentySix.truncated, true);
});

test('malformed rows are rejected individually and synthetic next ids do not hide numeric loss', () => {
  const malformed: unknown[] = [
    null,
    [],
    {},
    row('0'),
    row('-1'),
    row('abc'),
    row('01'),
    row('601'),
  ];
  const result = findVanishedScheduleGames(malformed, [row('7-Texas-Rice')]);
  assert.equal(result.count, 1, 'the valid sibling survives malformed rows');
  assert.equal(result.games[0]?.providerGameId, 601);
});

test('event identity fields are bounded and invalid metadata becomes null', () => {
  const longTeam = 'T'.repeat(200);
  const result = findVanishedScheduleGames(
    [
      row('601', {
        week: -1,
        seasonType: 'spring',
        startDate: 123,
        homeTeam: longTeam,
        awayTeam: '   ',
      }),
      row('602', { week: 0, seasonType: 'postseason' }),
    ],
    []
  );
  assert.equal(result.games[0]?.homeTeam, 'T'.repeat(160));
  assert.equal(result.games[0]?.awayTeam, null);
  assert.equal(result.games[0]?.startDate, null);
  assert.equal(result.games[0]?.week, null);
  assert.equal(result.games[0]?.seasonType, null);
  assert.equal(result.games[1]?.week, 0);
  assert.equal(result.games[1]?.seasonType, 'postseason');
});

test('the emitter writes one allowlisted JSON event and stays silent when identity is retained', () => {
  const lines = captureEventLines(() => {
    emitScheduleGamesVanishedEvent({
      year: 2031,
      observedAt: '2031-08-01T12:00:00.000Z',
      priorItems: [row('601')],
      nextItems: [],
    });
    emitScheduleGamesVanishedEvent({
      year: 2031,
      observedAt: '2031-08-01T12:00:00.000Z',
      priorItems: [row('602')],
      nextItems: [row('602')],
    });
  });

  assert.equal(lines.length, 1, 'the first call proves the observer for the silent second call');
  const event = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.deepEqual(Object.keys(event).sort(), [
    'event',
    'observedAt',
    'truncated',
    'vanishedGameCount',
    'vanishedGames',
    'year',
  ]);
  assert.deepEqual(Object.keys((event.vanishedGames as Record<string, unknown>[])[0]!).sort(), [
    'awayTeam',
    'homeTeam',
    'providerGameId',
    'seasonType',
    'startDate',
    'week',
  ]);
});

test('the emitter excludes non-allowlisted secrets and swallows logging failures', () => {
  const secret = 'test-cfbd-token-never-log';
  const lines = captureEventLines(() => {
    emitScheduleGamesVanishedEvent({
      year: 2031,
      observedAt: '2031-08-01T12:00:00.000Z',
      priorItems: [
        row('601', {
          apiKey: secret,
          authorization: `Bearer ${secret}`,
          rawPayload: { url: 'https://api.collegefootballdata.com/games', secret },
        }),
      ],
      nextItems: [],
    });
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.includes(secret), false);
  assert.equal(lines[0]?.includes('collegefootballdata'), false);

  const originalLog = console.log;
  console.log = () => {
    throw new Error('log sink down');
  };
  try {
    assert.doesNotThrow(() =>
      emitScheduleGamesVanishedEvent({
        year: 2031,
        observedAt: '2031-08-01T12:00:00.000Z',
        priorItems: [row('601')],
        nextItems: [],
      })
    );
  } finally {
    console.log = originalLog;
  }
});
