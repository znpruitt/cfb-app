import assert from 'node:assert/strict';
import test from 'node:test';

import type { ScheduleWireItem } from '../../schedule.ts';
import type { CacheEntry } from '../../scores/cache.ts';
import {
  __getTeamIdentityRegistryCacheSizeForTests,
  __resetTeamIdentityRegistryCacheForTests,
} from '../../teamIdentity.ts';
import type { TeamRecordsCacheEntry } from '../../teamRecords/teamRecordsCache.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../appStateStore.ts';
import { loadTeamRecordsClientProps } from '../teamRecordsClient.ts';

const YEAR = 2026;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  if (ORIGINAL_DATABASE_URL === undefined) delete MUTABLE_ENV.DATABASE_URL;
  else MUTABLE_ENV.DATABASE_URL = ORIGINAL_DATABASE_URL;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamIdentityRegistryCacheForTests();
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_DATABASE_URL === undefined) delete MUTABLE_ENV.DATABASE_URL;
  else MUTABLE_ENV.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

function game(overrides: Partial<ScheduleWireItem> = {}): ScheduleWireItem {
  return {
    id: 'game-1',
    week: 1,
    startDate: '2026-09-05T18:00:00.000Z',
    neutralSite: false,
    conferenceGame: false,
    awayTeam: 'Navy',
    homeTeam: 'Army',
    awayId: 1,
    homeId: 2,
    awayConference: 'American Athletic',
    homeConference: 'American Athletic',
    status: 'scheduled',
    completed: false,
    seasonType: 'regular',
    ...overrides,
  };
}

async function seed(params: { scheduleItems?: ScheduleWireItem[]; includeScores?: boolean } = {}) {
  const scheduleItems = params.scheduleItems ?? [game()];
  await setAppState('schedule', `${YEAR}-all-all`, { items: scheduleItems });
  const records: TeamRecordsCacheEntry = {
    at: Date.UTC(YEAR, 8, 5, 17),
    year: YEAR,
    items: [
      {
        year: YEAR,
        teamId: 1,
        team: 'Navy',
        classification: 'fbs',
        conference: 'American Athletic',
        total: { games: 0, wins: 0, losses: 0, ties: 0 },
      },
      {
        year: YEAR,
        teamId: 2,
        team: 'Army',
        classification: 'fbs',
        conference: 'American Athletic',
        total: { games: 0, wins: 0, losses: 0, ties: 0 },
      },
    ],
  };
  await setAppState('team-records', String(YEAR), records);
  await setAppState('team-database', 'current', {
    source: 'cfbd',
    updatedAt: new Date().toISOString(),
    items: [
      { school: 'Navy', level: 'FBS' },
      { school: 'Army', level: 'FBS' },
    ],
  });
  if (params.includeScores !== false) {
    const scores: CacheEntry = {
      at: Date.UTC(YEAR, 8, 5, 21),
      source: 'cfbd',
      cfbdFallbackReason: 'none',
      items: [
        {
          id: 'game-1',
          seasonType: 'regular',
          startDate: '2026-09-05T18:00:00.000Z',
          week: 1,
          status: 'final',
          away: { team: 'Navy', score: 17 },
          home: { team: 'Army', score: 24 },
          time: null,
        },
      ],
    };
    await setAppState('scores', `${YEAR}-1-regular`, scores);
  }
}

async function captureErrors<T>(run: () => Promise<T>): Promise<{ value: T; errors: unknown[][] }> {
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    return { value: await run(), errors };
  } finally {
    console.error = originalError;
  }
}

test('server projection includes a first-seen final in the record it ships', async () => {
  await seed();
  const props = await loadTeamRecordsClientProps({ leagueSlug: 'tsc', year: YEAR });

  assert.deepEqual(props.teamRecordsByProviderGameId['game-1'], {
    away: { wins: 0, losses: 1 },
    home: { wins: 1, losses: 0 },
  });
  assert.equal(
    __getTeamIdentityRegistryCacheSizeForTests(),
    0,
    'request-varying tail names must never enter the process-global resolver cache'
  );
});

test('a score-store read failure logs uncertainty and preserves stored records', async () => {
  await seed({ includeScores: false });
  const { value: props, errors } = await captureErrors(() =>
    loadTeamRecordsClientProps(
      { leagueSlug: 'tsc', year: YEAR },
      {
        loadScores: async () => {
          throw new Error('score store unavailable');
        },
      }
    )
  );
  assert.deepEqual(props.teamRecordsByProviderGameId['game-1'], {
    away: { wins: 0, losses: 0 },
    home: { wins: 0, losses: 0 },
  });
  assert.equal(errors.length, 1);
  assert.match(String(errors[0]?.[0]), /team-record-reconciliation/);
  assert.equal((errors[0]?.[1] as { kind?: string })?.kind, 'score-store');
});

test('a team-record read failure keeps the established blank-record contract', async () => {
  await seed();
  __setAppStateReadFailureForTests(new Error('record store unavailable'), 'team-records');
  const { value: props, errors } = await captureErrors(() =>
    loadTeamRecordsClientProps({ leagueSlug: 'tsc', year: YEAR })
  );
  assert.deepEqual(props.teamRecordsByProviderGameId, {});
  assert.equal((errors[0]?.[1] as { kind?: string })?.kind, 'record-store');
});

test('a schedule read failure is logged while a genuinely absent record cache stays silent', async () => {
  await seed();
  const scheduleFailure = await captureErrors(() =>
    loadTeamRecordsClientProps(
      { leagueSlug: 'tsc', year: YEAR },
      {
        loadSchedule: async () => {
          throw new Error('schedule store unavailable');
        },
      }
    )
  );
  assert.deepEqual(scheduleFailure.value.teamRecordsByProviderGameId, {});
  assert.equal((scheduleFailure.errors[0]?.[1] as { kind?: string })?.kind, 'schedule-store');

  const recordAbsence = await captureErrors(() =>
    loadTeamRecordsClientProps({ leagueSlug: 'tsc', year: YEAR }, { loadRecords: async () => null })
  );
  assert.deepEqual(recordAbsence.value.teamRecordsByProviderGameId, {});
  assert.equal(recordAbsence.errors.length, 0);
});

test('a malformed duplicate schedule id logs and returns empty enrichment', async () => {
  await seed({ scheduleItems: [game(), game()] });
  const { value: props, errors } = await captureErrors(() =>
    loadTeamRecordsClientProps({ leagueSlug: 'tsc', year: YEAR })
  );
  assert.deepEqual(props.teamRecordsByProviderGameId, {});
  assert.equal((errors[0]?.[1] as { kind?: string })?.kind, 'guard');
});

test('an equal-time score conflict is logged while a genuinely empty score view stays silent', async () => {
  await seed({ includeScores: false });
  const conflict = await captureErrors(() =>
    loadTeamRecordsClientProps(
      { leagueSlug: 'tsc', year: YEAR },
      {
        loadScores: async () => ({
          byProviderGameId: new Map(),
          ambiguousProviderGameIds: new Set(['game-1']),
          entryCount: 2,
          itemOccurrences: 2,
        }),
      }
    )
  );
  assert.equal((conflict.errors[0]?.[1] as { kind?: string })?.kind, 'score-conflict');
  assert.deepEqual(conflict.value.teamRecordsByProviderGameId['game-1'], {
    away: { wins: 0, losses: 0 },
    home: { wins: 0, losses: 0 },
  });

  const absence = await captureErrors(() =>
    loadTeamRecordsClientProps(
      { leagueSlug: 'tsc', year: YEAR },
      {
        loadScores: async () => ({
          byProviderGameId: new Map(),
          ambiguousProviderGameIds: new Set(),
          entryCount: 0,
          itemOccurrences: 0,
        }),
      }
    )
  );
  assert.equal(absence.errors.length, 0);
});

test('a score-only final with the wrong opponent is logged and cannot change the record', async () => {
  await seed({ includeScores: false });
  const scorePack = {
    id: 'game-1',
    seasonType: 'regular' as const,
    startDate: '2026-09-05T18:00:00.000Z',
    week: 1,
    status: 'final',
    away: { team: 'Howard', score: 17 },
    home: { team: 'Army', score: 24 },
    time: null,
  };
  const { value: props, errors } = await captureErrors(() =>
    loadTeamRecordsClientProps(
      { leagueSlug: 'tsc', year: YEAR },
      {
        loadScores: async () => ({
          byProviderGameId: new Map([
            ['game-1', { score: scorePack, effectiveAt: Date.UTC(YEAR, 8, 5, 21) }],
          ]),
          ambiguousProviderGameIds: new Set(),
          entryCount: 1,
          itemOccurrences: 1,
        }),
      }
    )
  );

  assert.equal((errors[0]?.[1] as { kind?: string })?.kind, 'score-participant-mismatch');
  assert.deepEqual(props.teamRecordsByProviderGameId['game-1'], {
    away: { wins: 0, losses: 0 },
    home: { wins: 0, losses: 0 },
  });
});

test('schedule, records, and scores begin in the same read phase', async () => {
  const invoked: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const loading = loadTeamRecordsClientProps(
    { leagueSlug: 'tsc', year: YEAR },
    {
      loadSchedule: async () => {
        invoked.push('schedule');
        await gate;
        return [];
      },
      loadRecords: async () => {
        invoked.push('records');
        await gate;
        return null;
      },
      loadScores: async () => {
        invoked.push('scores');
        await gate;
        return {
          byProviderGameId: new Map(),
          ambiguousProviderGameIds: new Set(),
          entryCount: 0,
          itemOccurrences: 0,
        };
      },
    }
  );
  await Promise.resolve();
  assert.deepEqual(invoked.sort(), ['records', 'schedule', 'scores']);
  release();
  await loading;
});
