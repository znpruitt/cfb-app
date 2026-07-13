import assert from 'node:assert/strict';
import test from 'node:test';

import { describeFreshness, formatRelativeTimestamp } from '../freshness.ts';

const NOW = Date.parse('2026-07-12T12:00:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test('formatRelativeTimestamp: recent, minutes, hours', () => {
  assert.equal(formatRelativeTimestamp(NOW - 10 * 1000, NOW), 'just now');
  assert.equal(formatRelativeTimestamp(NOW - 3 * MIN, NOW), '3m ago');
  assert.equal(formatRelativeTimestamp(NOW - 5 * HOUR, NOW), '5h ago');
});

test('formatRelativeTimestamp: yesterday and weekday within a week', () => {
  assert.equal(formatRelativeTimestamp(NOW - 30 * HOUR, NOW), 'yesterday');
  // 3 days ago (2026-07-09) is a Thursday.
  const weekday = formatRelativeTimestamp(NOW - 3 * DAY, NOW);
  assert.ok(
    ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].includes(
      weekday ?? ''
    ),
    `expected a weekday name, got ${weekday}`
  );
});

test('formatRelativeTimestamp: a week or more falls back to an absolute short date', () => {
  const older = formatRelativeTimestamp(NOW - 20 * DAY, NOW);
  assert.match(older ?? '', /^[A-Z][a-z]{2} \d{1,2}$/);
});

test('formatRelativeTimestamp: null/undefined/invalid returns null', () => {
  assert.equal(formatRelativeTimestamp(null, NOW), null);
  assert.equal(formatRelativeTimestamp(undefined, NOW), null);
  assert.equal(formatRelativeTimestamp('not-a-date', NOW), null);
});

test('formatRelativeTimestamp: accepts ISO strings and Date', () => {
  assert.equal(formatRelativeTimestamp(new Date(NOW - 2 * MIN).toISOString(), NOW), '2m ago');
  assert.equal(formatRelativeTimestamp(new Date(NOW - 2 * MIN), NOW), '2m ago');
});

test('describeFreshness: missing timestamp → missing tone', () => {
  const d = describeFreshness(null, { now: NOW });
  assert.equal(d.tone, 'missing');
  assert.equal(d.text, 'Not yet updated');
  assert.equal(d.ageMs, null);
});

test('describeFreshness: tones respect thresholds', () => {
  const fresh = describeFreshness(NOW - 1 * MIN, {
    now: NOW,
    freshWithinMs: 5 * MIN,
    staleAfterMs: HOUR,
  });
  assert.equal(fresh.tone, 'fresh');

  const aging = describeFreshness(NOW - 30 * MIN, {
    now: NOW,
    freshWithinMs: 5 * MIN,
    staleAfterMs: HOUR,
  });
  assert.equal(aging.tone, 'aging');

  const stale = describeFreshness(NOW - 2 * HOUR, {
    now: NOW,
    freshWithinMs: 5 * MIN,
    staleAfterMs: HOUR,
  });
  assert.equal(stale.tone, 'stale');
});

test('describeFreshness: whole-label text uses the relative phrase', () => {
  const d = describeFreshness(NOW - 3 * MIN, { now: NOW });
  assert.equal(d.text, 'Updated 3m ago');
});
