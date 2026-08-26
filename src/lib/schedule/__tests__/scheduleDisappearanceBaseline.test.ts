import assert from 'node:assert/strict';
import test from 'node:test';

import { loadScheduleDisappearanceFallback } from '../scheduleDisappearanceBaseline.ts';

function record(value: unknown) {
  return { value, updatedAt: '2031-08-01T12:00:00.000Z' };
}

test('a populated aggregate gates partition reads', async () => {
  const keys: string[] = [];
  const result = await loadScheduleDisappearanceFallback({
    year: 2031,
    aggregateValue: { items: [{ id: 'A1' }] },
    readState: async (_scope, key) => {
      keys.push(key);
      return record({ items: [{ id: 'P1' }] });
    },
  });
  assert.deepEqual(result, []);
  assert.deepEqual(keys, [], 'neither partition is read when the aggregate is populated');
});

test('an absent or empty aggregate captures both partition snapshots without consulting at', async () => {
  const values = new Map<string, unknown>([
    ['2031-all-regular', { at: Number.MAX_SAFE_INTEGER, items: [{ id: 'P1' }] }],
    ['2031-all-postseason', { at: -1, items: [{ id: 'P2' }] }],
  ]);
  const readState = async (_scope: string, key: string) => record(values.get(key));

  const absent = await loadScheduleDisappearanceFallback({
    year: 2031,
    aggregateValue: null,
    readState,
  });
  assert.deepEqual(
    absent.map((item) => (item as { id: string }).id),
    ['P1', 'P2']
  );

  const empty = await loadScheduleDisappearanceFallback({
    year: 2031,
    aggregateValue: { items: [] },
    readState,
  });
  assert.deepEqual(
    empty.map((item) => (item as { id: string }).id),
    ['P1', 'P2']
  );
});

test('one malformed partition suppresses the whole fallback with a path-matched control', async () => {
  const validRead = async (_scope: string, key: string) =>
    record({ items: [{ id: key.endsWith('regular') ? 'P1' : 'P2' }] });
  const control = await loadScheduleDisappearanceFallback({
    year: 2031,
    aggregateValue: null,
    readState: validRead,
  });
  assert.equal(control.length, 2, 'the same partition branch produces a usable baseline');

  const malformed = await loadScheduleDisappearanceFallback({
    year: 2031,
    aggregateValue: null,
    readState: async (_scope, key) =>
      key.endsWith('regular') ? record({ items: [{ id: 'P1' }] }) : record({ items: 'bad' }),
  });
  assert.deepEqual(malformed, []);
});

test('a partition read failure suppresses the fallback without escaping', async () => {
  const control = await loadScheduleDisappearanceFallback({
    year: 2031,
    aggregateValue: null,
    readState: async () => record({ items: [{ id: 'P1' }] }),
  });
  assert.equal(control.length, 2, 'the same read path proves a baseline is observable');

  const failed = await loadScheduleDisappearanceFallback({
    year: 2031,
    aggregateValue: null,
    readState: async () => {
      throw new Error('store unavailable');
    },
  });
  assert.deepEqual(failed, []);
});
