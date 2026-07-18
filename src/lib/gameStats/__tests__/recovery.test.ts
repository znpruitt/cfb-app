import assert from 'node:assert/strict';
import test from 'node:test';

import { planGameStatsRecovery } from '../recovery.ts';
import type { ScheduleSlateItem } from '../ingestion.ts';
import type { GameStatsRecoveryDispositionRecord } from '../recoveryDisposition.ts';
import { createTeamIdentityResolver } from '../../teamIdentity.ts';
import type { GameStats, WeeklyGameStats } from '../types.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';

const NOW = Date.parse('2026-11-20T12:00:00.000Z');
const DAYS_AGO = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();
const FUTURE = new Date(NOW + 3 * 24 * 60 * 60 * 1000).toISOString();

const RESOLVER = createTeamIdentityResolver({
  teams: [
    { school: 'Alpha State', level: 'FBS' },
    { school: 'Beta Tech', level: 'FBS' },
  ],
  aliasMap: {},
});

function item(
  overrides: Partial<ScheduleSlateItem> & { id: string; week: number }
): ScheduleSlateItem {
  return {
    seasonType: 'regular',
    startDate: DAYS_AGO(10),
    status: 'STATUS_FINAL',
    homeTeam: 'Alpha State',
    awayTeam: 'Beta Tech',
    ...overrides,
  };
}

function weekRecord(
  week: number,
  games: GameStats[],
  seasonType: 'regular' | 'postseason' = 'regular'
): WeeklyGameStats {
  return { year: 2026, week, seasonType, fetchedAt: DAYS_AGO(9), games };
}

function eligible(id: number, week: number): GameStats {
  return legacyRowFromWire(wireGame({ id }), week);
}

function disposition(
  partitionKey: string,
  overrides: Partial<GameStatsRecoveryDispositionRecord> = {}
): GameStatsRecoveryDispositionRecord {
  return {
    partitionKey,
    attemptCount: 1,
    lastAttemptAt: new Date(NOW - 60_000).toISOString(),
    lastReason: 'empty-unexpected',
    backoffTier: 0,
    nextEligibleAt: new Date(NOW + 60 * 60 * 1000).toISOString(), // 1h from now
    lastMeaningfulChangeAt: null,
    attemptToken: null,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
    coverageFingerprint: null,
    scheduleFingerprint: null,
    ...overrides,
  };
}

function plan(
  scheduleItems: ScheduleSlateItem[],
  records: WeeklyGameStats[] = [],
  dispositions?: Map<string, GameStatsRecoveryDispositionRecord>
) {
  return planGameStatsRecovery({
    year: 2026,
    scheduleItems,
    resolver: RESOLVER,
    records,
    dispositions,
    now: NOW,
    seasonRelation: 'current',
  });
}

test('recovery: slates come from the canonical schedule only', () => {
  // A stored record for a week the schedule does not define creates no slate.
  const result = plan([item({ id: '101', week: 3 })], [weekRecord(9, [eligible(901, 9)])]);
  const allWeeks = [...result.candidates, ...result.satisfied, ...result.deferred].map(
    (s) => `${s.week}:${s.seasonType}`
  );
  assert.deepEqual(allWeeks, ['3:regular']);
});

test('recovery: satisfied slates are never candidates (no repeated provider calls)', () => {
  const result = plan([item({ id: '101', week: 3 })], [weekRecord(3, [eligible(101, 3)])]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.target, null);
  assert.equal(result.satisfied.length, 1);
});

test('recovery: absent and partial slates are candidates, newest completed first', () => {
  const result = plan(
    [
      item({ id: '101', week: 1, startDate: DAYS_AGO(20) }),
      item({ id: '201', week: 2, startDate: DAYS_AGO(13) }),
      item({ id: '202', week: 2, startDate: DAYS_AGO(13) }),
      item({ id: '301', week: 3, startDate: DAYS_AGO(6) }),
    ],
    [
      weekRecord(1, [eligible(101, 1)]), // satisfied
      weekRecord(2, [eligible(201, 2)]), // partial: 202 absent
      // week 3 entirely absent
    ]
  );
  assert.deepEqual(
    result.candidates.map((s) => s.week),
    [3, 2],
    'newest completed slate first'
  );
  assert.equal(result.target?.week, 3, 'the newest eligible candidate is the per-run target');
  assert.deepEqual(result.candidates[1]!.coverage.absent, [202]);
  assert.deepEqual(
    result.satisfied.map((s) => s.week),
    [1]
  );
});

test('recovery: a backed-off newest candidate ROTATES selection to an older eligible one', () => {
  const result = plan(
    [
      item({ id: '201', week: 2, startDate: DAYS_AGO(13) }),
      item({ id: '301', week: 3, startDate: DAYS_AGO(6) }),
    ],
    [],
    new Map([['2026:3:regular', disposition('2026:3:regular')]])
  );
  assert.deepEqual(
    result.candidates.map((s) => s.week),
    [3, 2],
    'ordering still reports the newest gap first'
  );
  assert.equal(result.candidates[0]!.eligible, false, 'the newest candidate is backing off');
  assert.equal(result.target?.week, 2, 'selection rotates so the older candidate progresses');
});

test('recovery: an expired backoff window restores eligibility', () => {
  const result = plan(
    [item({ id: '301', week: 3, startDate: DAYS_AGO(6) })],
    [],
    new Map([
      [
        '2026:3:regular',
        disposition('2026:3:regular', {
          nextEligibleAt: new Date(NOW - 1000).toISOString(),
        }),
      ],
    ])
  );
  assert.equal(result.target?.week, 3);
});

test('recovery: every candidate backing off (or terminal) yields NO target this run', () => {
  const result = plan(
    [
      item({ id: '201', week: 2, startDate: DAYS_AGO(13) }),
      item({ id: '301', week: 3, startDate: DAYS_AGO(6) }),
    ],
    [],
    new Map([
      ['2026:3:regular', disposition('2026:3:regular')],
      [
        '2026:2:regular',
        disposition('2026:2:regular', { nextEligibleAt: null, terminal: 'manual-action' }),
      ],
    ])
  );
  assert.equal(result.candidates.length, 2);
  assert.equal(result.target, null, 'no eligible candidate → no provider call this run');
});

test('recovery: placeholder-only and future-only slates are deferred, never fetched', () => {
  const result = plan([
    item({ id: 'cfp-semi-a', week: 1, seasonType: 'postseason', startDate: DAYS_AGO(2) }),
    item({
      id: '7001',
      week: 1,
      seasonType: 'postseason',
      startDate: DAYS_AGO(2),
      homeTeam: 'TBD',
    }),
    item({ id: '501', week: 14, startDate: FUTURE }),
  ]);
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.deferred.map((s) => `${s.week}:${s.seasonType}`).sort(), [
    '14:regular',
    '1:postseason',
  ]);
});

test('recovery: disrupted-only slates are invisible (not applicable, no candidates)', () => {
  const result = plan([
    item({ id: '101', week: 5, status: 'Canceled', startDate: DAYS_AGO(2) }),
    item({ id: '102', week: 5, status: 'Postponed', startDate: DAYS_AGO(2) }),
  ]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.satisfied.length, 0);
  assert.equal(result.deferred.length, 0);
});

test('recovery: regular and postseason slates plan independently', () => {
  const result = plan(
    [
      item({ id: '101', week: 13, startDate: DAYS_AGO(12) }),
      item({ id: '801', week: 1, seasonType: 'postseason', startDate: DAYS_AGO(3) }),
    ],
    [weekRecord(13, [eligible(101, 13)])]
  );
  assert.deepEqual(
    result.candidates.map((s) => `${s.week}:${s.seasonType}`),
    ['1:postseason']
  );
  assert.deepEqual(
    result.satisfied.map((s) => `${s.week}:${s.seasonType}`),
    ['13:regular']
  );
});

test('recovery: a slate with only blocked gaps is satisfied for auto-recovery, typed blocked', () => {
  const blockedRow = { ...eligible(101, 3), schemaVersion: 3 } as unknown as GameStats;
  const result = plan([item({ id: '101', week: 3 })], [weekRecord(3, [blockedRow])]);
  assert.equal(result.candidates.length, 0, 'blocked evidence never triggers refetch loops');
  assert.equal(result.satisfied.length, 1);
  assert.equal(result.satisfied[0]!.coverage.state, 'blocked');
  assert.deepEqual(result.satisfied[0]!.coverage.blocked, [101]);
});
