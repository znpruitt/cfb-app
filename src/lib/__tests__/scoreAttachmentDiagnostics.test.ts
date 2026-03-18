import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachScoresToSchedule,
  buildScheduleIndex,
  type NormalizedScoreRow,
  type ScheduleGameForIndex,
} from '../scoreAttachment';
import {
  isActionableScoreAttachmentIssue,
  isIgnoredOutOfScopeProviderRow,
  summarizeAttachmentReasons,
} from '../scoreAttachmentDiagnostics';
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

test('out-of-scope provider rows remain ignored debug telemetry instead of actionable issues', () => {
  const index = buildScheduleIndex(
    [game({ key: 'army-navy', week: 10, canHome: 'Army', canAway: 'Navy' })],
    resolver
  );

  const result = attachScoresToSchedule({
    rows: [
      row({
        week: 10,
        home: { team: 'Nicholls', score: 1 },
        away: { team: 'Incarnate Word', score: 2 },
        status: 'final',
      }),
    ],
    scheduleIndex: index,
    resolver,
    debugTrace: true,
  });

  assert.equal(result.attachedCount, 0);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].classification, 'ignored');
  assert.equal(result.diagnostics[0].reason, 'unresolved_both_teams');
  assert.equal(result.diagnostics[0].userMessage.includes('Ignored:'), true);
  assert.equal(result.diagnostics[0].trace.plausibleScheduledGameCount, 0);
  assert.equal(isIgnoredOutOfScopeProviderRow(result.diagnostics[0]), true);
  assert.equal(isActionableScoreAttachmentIssue(result.diagnostics[0]), false);
});

test('in-scope alias failures remain actionable when they block a plausible canonical game', () => {
  const index = buildScheduleIndex(
    [game({ key: 'army-navy', week: 10, canHome: 'Army', canAway: 'Navy' })],
    resolver
  );

  const result = attachScoresToSchedule({
    rows: [
      row({
        week: 10,
        home: { team: 'Army West Point', score: 17 },
        away: { team: 'Navy', score: 10 },
        status: 'final',
      }),
    ],
    scheduleIndex: index,
    resolver,
    debugTrace: true,
  });

  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].reason, 'unresolved_home_team');
  assert.equal(result.diagnostics[0].classification, 'actionable');
  assert.equal(result.diagnostics[0].trace.plausibleScheduledGameCount, 1);
  assert.equal(isActionableScoreAttachmentIssue(result.diagnostics[0]), true);
});

test('multiple candidate conflicts remain actionable attachment anomalies', () => {
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
  assert.equal(result.diagnostics[0].classification, 'actionable');
  assert.equal(result.diagnostics[0].trace.candidateCount, 2);
});

test('summaries keep actionable and ignored reason counts available for diagnostics', () => {
  const index = buildScheduleIndex(
    [game({ key: 'army-navy', week: 10, canHome: 'Army', canAway: 'Navy' })],
    resolver
  );

  const result = attachScoresToSchedule({
    rows: [
      row({
        week: 10,
        home: { team: 'Army West Point', score: 17 },
        away: { team: 'Navy', score: 10 },
        status: 'final',
      }),
      row({
        week: 10,
        home: { team: 'Nicholls', score: 1 },
        away: { team: 'Incarnate Word', score: 2 },
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

  const actionable = result.diagnostics.filter(isActionableScoreAttachmentIssue);
  const ignored = result.diagnostics.filter(isIgnoredOutOfScopeProviderRow);

  assert.deepEqual(summarizeAttachmentReasons(actionable), { unresolved_home_team: 1 });
  assert.deepEqual(summarizeAttachmentReasons(ignored), {
    unresolved_both_teams: 1,
    no_scheduled_match: 1,
  });
});
