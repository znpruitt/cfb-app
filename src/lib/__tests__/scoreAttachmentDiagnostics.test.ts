import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachScoresToSchedule,
  buildScheduleIndex,
  type NormalizedScoreRow,
  type ScheduleGameForIndex,
} from '../scoreAttachment';
import { summarizeAttachmentReasons } from '../scoreAttachmentDiagnostics';
import { createTeamIdentityResolver } from '../teamIdentity';

const teams = [
  { school: 'Army', level: 'FBS' },
  { school: 'Navy', level: 'FBS' },
  { school: 'Boise State', level: 'FBS' },
  { school: 'Washington State', level: 'FBS' },
  { school: 'South Carolina', level: 'FBS' },
];

const resolver = createTeamIdentityResolver({ aliasMap: {}, teams });

function game(
  input: Partial<ScheduleGameForIndex> &
    Pick<ScheduleGameForIndex, 'key' | 'week' | 'canHome' | 'canAway'>
): ScheduleGameForIndex {
  return {
    key: input.key,
    week: input.week,
    date: input.date ?? null,
    stage: input.stage ?? 'regular',
    providerGameId: input.providerGameId ?? null,
    canHome: input.canHome,
    canAway: input.canAway,
    participants: { home: { kind: 'team' }, away: { kind: 'team' } },
  };
}

function row(
  input: Partial<NormalizedScoreRow> & Pick<NormalizedScoreRow, 'home' | 'away' | 'status'>
): NormalizedScoreRow {
  return {
    week: input.week ?? null,
    seasonType: input.seasonType ?? 'regular',
    providerEventId: input.providerEventId ?? null,
    status: input.status,
    time: input.time ?? null,
    date: input.date ?? null,
    home: input.home,
    away: input.away,
  };
}

test('attachScoresToSchedule emits unresolved and no-match diagnostics with trace metadata', () => {
  const index = buildScheduleIndex(
    [game({ key: 'army-navy', week: 10, canHome: 'Army', canAway: 'Navy' })],
    resolver
  );

  const result = attachScoresToSchedule({
    rows: [
      row({
        week: 10,
        home: { team: 'Unknown U', score: 1 },
        away: { team: 'Navy', score: 2 },
        status: 'final',
      }),
      row({
        week: 10,
        home: { team: 'Boise State', score: 3 },
        away: { team: 'Washington State', score: 4 },
        status: 'final',
      }),
    ],
    scheduleIndex: index,
    resolver,
    debugTrace: true,
  });

  assert.equal(result.attachedCount, 0);
  assert.equal(result.diagnostics.length, 2);
  assert.equal(result.diagnostics[0].reason, 'unresolved_home_team');
  assert.equal(result.diagnostics[0].trace.candidateCount, 0);
  assert.equal(result.diagnostics[1].reason, 'no_scheduled_match');
});

test('multiple candidate conflicts return multiple_candidate_matches', () => {
  const index = buildScheduleIndex(
    [
      game({ key: 'g1', week: 1, canHome: 'Army', canAway: 'Navy', providerGameId: 'dup' }),
      game({
        key: 'g2',
        week: 2,
        canHome: 'Boise State',
        canAway: 'Washington State',
        providerGameId: 'dup',
      }),
    ],
    resolver
  );

  const result = attachScoresToSchedule({
    rows: [
      row({
        week: 1,
        providerEventId: 'dup',
        home: { team: 'Army', score: 7 },
        away: { team: 'Navy', score: 3 },
        status: 'final',
      }),
    ],
    scheduleIndex: index,
    resolver,
    debugTrace: true,
  });

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].reason, 'multiple_candidate_matches');
  assert.equal(result.diagnostics[0].trace.candidateCount, 2);
});

test('summarizeAttachmentReasons aggregates diagnostics by reason', () => {
  const summary = summarizeAttachmentReasons([
    {
      type: 'ignored_score_row',
      reason: 'unresolved_home_team',
      provider: {
        source: 'test',
        week: 1,
        seasonType: 'regular',
        status: 'final',
        homeTeamRaw: 'X',
        awayTeamRaw: 'Y',
      },
      normalization: { homeTeamNormalized: 'x', awayTeamNormalized: 'y' },
      resolution: {
        homeCanonical: null,
        awayCanonical: 'Army',
        homeResolved: false,
        awayResolved: true,
      },
      trace: { candidateCount: 0 },
    },
    {
      type: 'ignored_score_row',
      reason: 'unresolved_home_team',
      provider: {
        source: 'test',
        week: 1,
        seasonType: 'regular',
        status: 'final',
        homeTeamRaw: 'X2',
        awayTeamRaw: 'Y2',
      },
      normalization: { homeTeamNormalized: 'x2', awayTeamNormalized: 'y2' },
      resolution: {
        homeCanonical: null,
        awayCanonical: 'Army',
        homeResolved: false,
        awayResolved: true,
      },
      trace: { candidateCount: 0 },
    },
    {
      type: 'ignored_score_row',
      reason: 'no_scheduled_match',
      provider: {
        source: 'test',
        week: 1,
        seasonType: 'regular',
        status: 'final',
        homeTeamRaw: 'A',
        awayTeamRaw: 'B',
      },
      normalization: { homeTeamNormalized: 'a', awayTeamNormalized: 'b' },
      resolution: {
        homeCanonical: 'A',
        awayCanonical: 'B',
        homeResolved: true,
        awayResolved: true,
      },
      trace: { candidateCount: 0 },
    },
  ]);

  assert.equal(summary.unresolved_home_team, 2);
  assert.equal(summary.no_scheduled_match, 1);
});
