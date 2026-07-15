import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyEmptyScoresResponse,
  type ScheduleScoreEvidenceItem,
} from '../scores/emptyScoresClassifier.ts';

const NOW = Date.parse('2026-10-15T18:00:00.000Z');
const PAST = '2026-10-10T16:00:00.000Z'; // kicked off before NOW
const FUTURE = '2026-11-21T16:00:00.000Z'; // kicks off after NOW

function item(overrides: Partial<ScheduleScoreEvidenceItem> = {}): ScheduleScoreEvidenceItem {
  return {
    week: 7,
    seasonType: 'regular',
    startDate: PAST,
    status: 'scheduled',
    ...overrides,
  };
}

function classify(params: {
  priorGoodRowCount?: number;
  scheduleItems?: ScheduleScoreEvidenceItem[];
  seasonType?: 'regular' | 'postseason';
  week?: number | null;
}) {
  return classifyEmptyScoresResponse({
    priorGoodRowCount: params.priorGoodRowCount ?? 0,
    scheduleItems: params.scheduleItems ?? [],
    seasonType: params.seasonType ?? 'regular',
    week: params.week ?? null,
    now: NOW,
  });
}

test('no evidence at all → valid absence', () => {
  assert.deepEqual(classify({}), { kind: 'valid-absence' });
});

test('populated prior-good durable rows for the same target → unexpected empty', () => {
  const result = classify({ priorGoodRowCount: 3 });
  assert.equal(result.kind, 'unexpected-empty');
  assert.equal(result.kind === 'unexpected-empty' && result.priorGoodRowCount, 3);
});

test('a started, non-disrupted schedule game in the target → unexpected empty', () => {
  const result = classify({ scheduleItems: [item()] });
  assert.equal(result.kind, 'unexpected-empty');
  assert.equal(result.kind === 'unexpected-empty' && result.startedGameCount, 1);
});

test('future-only target (no started games) → valid absence', () => {
  assert.deepEqual(classify({ scheduleItems: [item({ startDate: FUTURE })] }), {
    kind: 'valid-absence',
  });
});

test('canceled and postponed games never independently create an expectation', () => {
  // Started kickoff times, but every disrupted status style (spaced, enum,
  // dashed) must be excluded — including UK spelling.
  const disrupted = [
    item({ status: 'canceled' }),
    item({ status: 'Cancelled' }),
    item({ status: 'STATUS_CANCELED' }),
    item({ status: 'postponed' }),
    item({ status: 'status-postponed' }),
  ];
  assert.deepEqual(classify({ scheduleItems: disrupted }), { kind: 'valid-absence' });
});

test('a disrupted game does not mask a separate started game in the same target', () => {
  const result = classify({
    scheduleItems: [item({ status: 'canceled' }), item({ status: 'scheduled' })],
  });
  assert.equal(result.kind, 'unexpected-empty');
  assert.equal(result.kind === 'unexpected-empty' && result.startedGameCount, 1);
});

test('week-scoped target only counts games in that exact week', () => {
  const items = [item({ week: 7 })];
  assert.equal(classify({ scheduleItems: items, week: 8 }).kind, 'valid-absence');
  assert.equal(classify({ scheduleItems: items, week: 7 }).kind, 'unexpected-empty');
});

test('season-wide target (week=null) counts started games from any week', () => {
  const result = classify({ scheduleItems: [item({ week: 3 }), item({ week: 9 })], week: null });
  assert.equal(result.kind, 'unexpected-empty');
  assert.equal(result.kind === 'unexpected-empty' && result.startedGameCount, 2);
});

test('season-type mismatch is never evidence (postseason games ≠ regular target)', () => {
  const postseason = [item({ seasonType: 'postseason' })];
  assert.equal(
    classify({ scheduleItems: postseason, seasonType: 'regular' }).kind,
    'valid-absence'
  );
  assert.equal(
    classify({ scheduleItems: postseason, seasonType: 'postseason' }).kind,
    'unexpected-empty'
  );
});

test('a missing/unknown schedule seasonType normalizes to regular (applicability parity)', () => {
  const untyped = [item({ seasonType: undefined })];
  assert.equal(
    classify({ scheduleItems: untyped, seasonType: 'regular' }).kind,
    'unexpected-empty'
  );
  assert.equal(
    classify({ scheduleItems: untyped, seasonType: 'postseason' }).kind,
    'valid-absence'
  );
});

test('a game with no parseable kickoff time is never started-game evidence', () => {
  const items = [item({ startDate: null }), item({ startDate: 'not-a-date' })];
  assert.deepEqual(classify({ scheduleItems: items }), { kind: 'valid-absence' });
});
