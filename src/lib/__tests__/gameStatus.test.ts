import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyScorePackStatus,
  classifyStatusLabel,
  formatCompactGameStatus,
  formatScheduleStatusLabel,
  formatScoreSummaryLabel,
  isDisruptedStatusLabel,
} from '../gameStatus';

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

test('classifies in-progress variants as live', () => {
  assert.equal(classifyStatusLabel('In Progress'), 'inprogress');
  assert.equal(classifyStatusLabel('Q3 5:23'), 'inprogress');
  assert.equal(classifyStatusLabel('Half'), 'inprogress');
  assert.equal(classifyStatusLabel('In OT'), 'inprogress');
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

test('formats schedule labels consistently for placeholders and canonical statuses', () => {
  assert.equal(formatScheduleStatusLabel('scheduled', { isPlaceholder: false }), 'Scheduled');
  assert.equal(formatScheduleStatusLabel('scheduled', { isPlaceholder: true }), 'Placeholder');
  assert.equal(formatScheduleStatusLabel('in_progress', { isPlaceholder: false }), 'IN PROGRESS');
  assert.equal(formatScheduleStatusLabel('matchup_set', { isPlaceholder: false }), 'Scheduled');
});
