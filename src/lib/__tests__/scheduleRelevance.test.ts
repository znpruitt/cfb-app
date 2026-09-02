import assert from 'node:assert/strict';
import test from 'node:test';

import { isFbsRelevantScheduleBuildRow, isFbsRelevantScheduleRow } from '../scheduleRelevance.ts';

test('FBS relevance retains rows with one or both classifications absent', () => {
  assert.equal(isFbsRelevantScheduleRow({}), true);
  assert.equal(isFbsRelevantScheduleRow({ homeClassification: 'fcs' }), true);
  assert.equal(isFbsRelevantScheduleRow({ awayClassification: 'iii' }), true);
});

test('FBS relevance drops a row when both known classifications are non-FBS', () => {
  assert.equal(
    isFbsRelevantScheduleRow({
      homeClassification: 'fcs',
      awayClassification: 'ii',
    }),
    false
  );
});

test('FBS relevance retains an fbs-versus-iii row', () => {
  assert.equal(
    isFbsRelevantScheduleRow({
      homeClassification: 'fbs',
      awayClassification: 'iii',
    }),
    true
  );
});

test('FBS relevance normalizes uppercase provider classifications', () => {
  assert.equal(
    isFbsRelevantScheduleRow({
      homeClassification: 'FBS',
      awayClassification: 'iii',
    }),
    true
  );
});

test('FBS-focused builds retain postseason rows regardless of classification', () => {
  assert.equal(
    isFbsRelevantScheduleBuildRow({
      seasonType: 'postseason',
      homeClassification: 'fcs',
      awayClassification: 'iii',
    }),
    true
  );
});
