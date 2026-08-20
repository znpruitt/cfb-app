import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyGameConclusionEvidence,
  classifyScorePackStatus,
  classifyStatusLabel,
  formatCompactGameStatus,
  formatScheduleStatusLabel,
  formatScoreSummaryLabel,
  isCanceledOrPostponedStatusLabel,
  isCanceledStatusLabel,
  isDisruptedStatusLabel,
} from '../gameStatus';

const canceledScore = {
  status: 'STATUS_CANCELED',
  away: { team: 'A', score: null },
  home: { team: 'B', score: null },
  time: null,
};

const finalScore = {
  status: 'STATUS_FINAL',
  away: { team: 'A', score: 17 },
  home: { team: 'B', score: 24 },
  time: 'Final',
};

test('classifies final statuses consistently', () => {
  assert.equal(classifyStatusLabel('Final'), 'final');
  assert.equal(
    classifyScorePackStatus({
      status: 'FINAL',
      away: { team: 'A', score: 1 },
      home: { team: 'B', score: 2 },
      time: null,
    }),
    'final'
  );
  assert.equal(
    formatScoreSummaryLabel({
      status: 'Final',
      away: { team: 'A', score: 1 },
      home: { team: 'B', score: 2 },
      time: null,
    }),
    'FINAL'
  );
});

test('a final score outranks a conflicting canceled schedule label', () => {
  assert.equal(
    classifyGameConclusionEvidence(
      { status: 'scheduled', rawStatus: 'STATUS_CANCELED', completed: false },
      finalScore
    ),
    'score-required'
  );
});

test('schedule score-bearing evidence outranks a conflicting canceled score label', () => {
  for (const game of [
    { status: 'scheduled', completed: true },
    { status: 'final', completed: false },
  ]) {
    assert.equal(
      classifyGameConclusionEvidence(game, canceledScore),
      'score-required',
      `${game.status}/${String(game.completed)} should fail closed`
    );
  }
});

test('classifies in-progress variants as live', () => {
  assert.equal(classifyStatusLabel('In Progress'), 'inprogress');
  assert.equal(classifyStatusLabel('Q3 5:23'), 'inprogress');
  assert.equal(classifyStatusLabel('Half'), 'inprogress');
  assert.equal(classifyStatusLabel('In OT'), 'inprogress');
  assert.equal(classifyStatusLabel('OT'), 'inprogress');
  assert.equal(classifyStatusLabel('2OT'), 'inprogress');
  assert.equal(classifyStatusLabel('End 2OT'), 'inprogress');
});

test('pregame labels are not misclassified as live via overtime substring collisions', () => {
  assert.equal(classifyStatusLabel('Not Started'), 'scheduled');
  assert.equal(classifyStatusLabel('NOT_STARTED'), 'scheduled');
  assert.equal(
    formatScoreSummaryLabel({
      status: 'Not Started',
      away: { team: 'A', score: null },
      home: { team: 'B', score: null },
      time: null,
    }),
    'Not Started'
  );
  assert.equal(
    formatCompactGameStatus({
      status: 'NOT_STARTED',
      away: { team: 'A', score: null },
      home: { team: 'B', score: null },
      time: null,
    }),
    'NOT_STARTED'
  );
});

test('classifies disrupted statuses and preserves display labels', () => {
  assert.equal(isDisruptedStatusLabel('Postponed'), true);
  assert.equal(classifyStatusLabel('Canceled - weather'), 'disrupted');
  assert.equal(
    formatCompactGameStatus({
      status: 'Delayed',
      away: { team: 'A', score: null },
      home: { team: 'B', score: null },
      time: null,
    }),
    'Delayed'
  );
  assert.equal(
    formatScoreSummaryLabel({
      status: 'Suspended',
      away: { team: 'A', score: null },
      home: { team: 'B', score: null },
      time: null,
    }),
    'Suspended'
  );
});

test('normalizes underscore/hyphen/spaced provider enum status labels (finding #3)', () => {
  // `_` is a regex WORD character, so a bare \b matcher would MISS these enum
  // forms (`\bcanceled\b` never fires inside `status_canceled`). All separator
  // styles must classify identically.
  for (const canceled of [
    'STATUS_CANCELED',
    'STATUS_CANCELLED',
    'status-canceled',
    'Status Canceled',
    'status canceled',
  ]) {
    assert.equal(isCanceledStatusLabel(canceled), true, `${canceled} should be canceled`);
    assert.equal(isDisruptedStatusLabel(canceled), true, `${canceled} should be disrupted`);
    assert.equal(classifyStatusLabel(canceled), 'disrupted', `${canceled} bucket`);
  }
  // Postponed / suspended / delayed are disrupted but NOT canceled/terminal —
  // score diagnostics must still treat them as missing a final result.
  for (const disrupted of ['STATUS_POSTPONED', 'STATUS_SUSPENDED', 'STATUS_DELAYED']) {
    assert.equal(isDisruptedStatusLabel(disrupted), true, `${disrupted} disrupted`);
    assert.equal(isCanceledStatusLabel(disrupted), false, `${disrupted} not canceled`);
    assert.equal(classifyStatusLabel(disrupted), 'disrupted', `${disrupted} bucket`);
  }
  assert.equal(classifyStatusLabel('STATUS_FINAL'), 'final');
  assert.equal(classifyStatusLabel('STATUS_IN_PROGRESS'), 'inprogress');
  // Unknown enum → scheduled (no false disruption / no false live).
  assert.equal(classifyStatusLabel('STATUS_SCHEDULED'), 'scheduled');
  assert.equal(isDisruptedStatusLabel('STATUS_SCHEDULED'), false);
  assert.equal(isCanceledStatusLabel('STATUS_SCHEDULED'), false);
});

test('canceled-or-postponed polling semantics exclude only terminal disruptions', () => {
  for (const terminal of ['canceled', 'Cancelled', 'STATUS_POSTPONED', 'status-postponed']) {
    assert.equal(
      isCanceledOrPostponedStatusLabel(terminal),
      true,
      `${terminal} should end polling`
    );
  }
  for (const nonterminal of ['STATUS_DELAYED', 'STATUS_SUSPENDED', 'scheduled', null]) {
    assert.equal(
      isCanceledOrPostponedStatusLabel(nonterminal),
      false,
      `${nonterminal} should not end polling`
    );
  }
});

test('formats schedule labels consistently for placeholders and canonical statuses', () => {
  assert.equal(formatScheduleStatusLabel('scheduled', { isPlaceholder: false }), 'Scheduled');
  assert.equal(formatScheduleStatusLabel('scheduled', { isPlaceholder: true }), 'Placeholder');
  assert.equal(formatScheduleStatusLabel('in_progress', { isPlaceholder: false }), 'IN PROGRESS');
  assert.equal(formatScheduleStatusLabel('matchup_set', { isPlaceholder: false }), 'Scheduled');
});
