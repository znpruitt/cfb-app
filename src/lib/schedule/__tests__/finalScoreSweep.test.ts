import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachScoresToSchedule,
  buildScheduleIndex,
  type NormalizedScoreRow,
  type ScheduleGameForIndex,
} from '@/lib/scoreAttachment';
import type { CacheEntry } from '@/lib/scores/cache';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
} from '@/lib/server/appStateStore';
import { createTeamIdentityResolver } from '@/lib/teamIdentity';

import { finalScoreCandidateFromScheduleRow, sweepMissingFinalScores } from '../finalScoreSweep.ts';

const YEAR = 2031;
const NOW = Date.parse('2031-10-01T12:00:00.000Z');
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  if (ORIGINAL_DATABASE_URL === undefined) delete MUTABLE_ENV.DATABASE_URL;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __setAppStateWriteFailureForTests(null);
});

test.after(() => {
  __setAppStateWriteFailureForTests(null);
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_DATABASE_URL === undefined) delete MUTABLE_ENV.DATABASE_URL;
  else MUTABLE_ENV.DATABASE_URL = ORIGINAL_DATABASE_URL;
});

test('a score-store failure is isolated and reported by provider partition', async () => {
  const regular = finalScoreCandidateFromScheduleRow(
    {
      id: 501,
      week: 1,
      home_team: 'Texas',
      away_team: 'Rice',
      home_points: 31,
      away_points: 14,
      completed: true,
    },
    'regular'
  );
  const postseason = finalScoreCandidateFromScheduleRow(
    {
      id: 502,
      week: 2,
      home_team: 'Georgia',
      away_team: 'Clemson',
      home_points: 27,
      away_points: 24,
      completed: true,
    },
    'postseason'
  );
  assert.ok(regular && postseason);
  __setAppStateWriteFailureForTests(new Error('score store unavailable'), 'scores');

  const sweep = await sweepMissingFinalScores({
    year: YEAR,
    candidates: [regular, postseason],
    observedAtMs: NOW,
  });
  assert.equal(sweep.repaired, 0);
  assert.deepEqual(sweep.failedPartitions, [
    { week: 1, seasonType: 'regular' },
    { week: 2, seasonType: 'postseason' },
  ]);
});

test('the wire seam accepts only provider-id finals with both scores', () => {
  const base = {
    week: 7,
    home_team: 'Mystery Home',
    away_team: 'Mystery Away',
    home_points: 21,
    away_points: 17,
    completed: true,
  };

  assert.equal(
    finalScoreCandidateFromScheduleRow(base, 'regular'),
    null,
    'a fabricated schedule fallback id is not a provider score identity'
  );
  assert.equal(
    finalScoreCandidateFromScheduleRow({ ...base, id: 401, away_points: null }, 'regular'),
    null,
    'a scoreless completed row is not a usable final'
  );
  assert.equal(
    finalScoreCandidateFromScheduleRow({ ...base, id: 401, completed: false }, 'regular'),
    null,
    'numeric points without provider finality are not swept'
  );

  const candidate = finalScoreCandidateFromScheduleRow({ ...base, id: 401 }, 'regular');
  assert.ok(candidate);
  assert.deepEqual(candidate.identity, {
    providerGameId: '401',
    week: 7,
    seasonType: 'regular',
  });
});

test('an unresolved-participant final repairs and attaches when its provider id is unique', async () => {
  const candidate = finalScoreCandidateFromScheduleRow(
    {
      id: 401,
      week: 7,
      home_team: 'Mystery Home',
      away_team: 'Mystery Away',
      start_date: '2031-10-01T00:00:00Z',
      home_points: 21,
      away_points: 17,
      completed: true,
    },
    'regular'
  );
  assert.ok(candidate);

  const sweep = await sweepMissingFinalScores({
    year: YEAR,
    candidates: [candidate],
    observedAtMs: NOW,
  });
  assert.equal(sweep.repaired, 1);
  const stored = await getAppState<CacheEntry>('scores', `${YEAR}-7-regular`);
  assert.ok(stored?.value.items[0]);

  // Neither label resolves through the catalog, but provider-id attachment is
  // intentionally attempted before the team-resolution fallback. With one
  // scheduled id candidate and no known canonical side to contradict it, the
  // newly cached row attaches and closes the score gap end to end.
  const resolver = createTeamIdentityResolver({ teams: [], aliasMap: {} });
  const scheduleGame: ScheduleGameForIndex = {
    key: 'mystery-game',
    week: 7,
    providerWeek: 7,
    canonicalWeek: 7,
    date: '2031-10-01T00:00:00Z',
    stage: 'regular',
    providerGameId: '401',
    canHome: 'Mystery Home',
    canAway: 'Mystery Away',
    participants: { home: { kind: 'team' }, away: { kind: 'team' } },
  };
  const pack = stored.value.items[0]!;
  const row: NormalizedScoreRow = {
    week: pack.week,
    seasonType: pack.seasonType ?? null,
    providerEventId: pack.id?.trim() || null,
    status: pack.status,
    time: pack.time,
    date: pack.startDate ?? null,
    home: pack.home,
    away: pack.away,
  };
  const attached = attachScoresToSchedule({
    rows: [row],
    scheduleIndex: buildScheduleIndex([scheduleGame], resolver),
    resolver,
    source: 'weekly-score-sweep-test',
  });
  assert.equal(attached.attachedCount, 1);
  assert.equal(attached.scoresByKey['mystery-game']?.home.score, 21);
});

test('without a provider id, unresolved participants still produce ignored_score_row', () => {
  const resolver = createTeamIdentityResolver({ teams: [], aliasMap: {} });
  const scheduleGame: ScheduleGameForIndex = {
    key: 'mystery-game',
    week: 7,
    providerWeek: 7,
    canonicalWeek: 7,
    date: '2031-10-01T00:00:00Z',
    stage: 'regular',
    providerGameId: null,
    canHome: 'Mystery Home',
    canAway: 'Mystery Away',
    participants: { home: { kind: 'team' }, away: { kind: 'team' } },
  };
  const attached = attachScoresToSchedule({
    rows: [
      {
        week: 7,
        seasonType: 'regular',
        providerEventId: null,
        status: 'final',
        time: '2031-10-01T00:00:00Z',
        date: '2031-10-01T00:00:00Z',
        home: { team: 'Mystery Home', score: 21 },
        away: { team: 'Mystery Away', score: 17 },
      },
    ],
    scheduleIndex: buildScheduleIndex([scheduleGame], resolver),
    resolver,
    source: 'weekly-score-sweep-test',
  });
  assert.equal(attached.attachedCount, 0);
  assert.equal(attached.diagnostics[0]?.type, 'ignored_score_row');
  assert.equal(attached.diagnostics[0]?.reason, 'unresolved_both_teams');
});
