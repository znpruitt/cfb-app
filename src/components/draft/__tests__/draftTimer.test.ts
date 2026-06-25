import assert from 'node:assert/strict';
import test from 'node:test';

import { computeTimerSecondsLeft } from '../draftTimer';

// Fixed "now" so the math is deterministic.
const NOW = Date.UTC(2026, 7, 1, 0, 0, 0); // 2026-08-01T00:00:00Z
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

// ---------------------------------------------------------------------------
// DRAFT-003 — optimistic display-only countdown math.
// computeTimerSecondsLeft drives the pick clock: optimistic local countdown while
// a pick POST is in flight, then the server-authoritative timerExpiresAt, always
// clamped to pickTimerSeconds and floored at 0.
// ---------------------------------------------------------------------------

test('no timer configured → null regardless of other inputs', () => {
  assert.equal(computeTimerSecondsLeft(NOW, null, NOW - 5000, 'running', iso(30_000)), null);
});

test('optimistic path: counts down from pickTimerSeconds since localStart', () => {
  // Clicked 10s ago, 60s timer → 50 left. localStart wins even with no server timer.
  assert.equal(computeTimerSecondsLeft(NOW, 60, NOW - 10_000, 'off', null), 50);
});

test('optimistic path takes precedence over a running server timer', () => {
  // Server says 30s left, but the optimistic countdown (clicked 5s ago) wins → 55.
  assert.equal(computeTimerSecondsLeft(NOW, 60, NOW - 5_000, 'running', iso(30_000)), 55);
});

test('optimistic path clamps to pickTimerSeconds when localStart is in the future (clock skew)', () => {
  // localStart slightly ahead of now would compute >60; clamp to 60.
  assert.equal(computeTimerSecondsLeft(NOW, 60, NOW + 2_000, 'off', null), 60);
});

test('optimistic path floors at 0 once the local window has elapsed', () => {
  assert.equal(computeTimerSecondsLeft(NOW, 60, NOW - 70_000, 'off', null), 0);
});

test('server path: counts down to timerExpiresAt while running', () => {
  assert.equal(computeTimerSecondsLeft(NOW, 60, null, 'running', iso(30_000)), 30);
});

test('server path clamps to pickTimerSeconds when expiry is further out than max (skew)', () => {
  assert.equal(computeTimerSecondsLeft(NOW, 60, null, 'running', iso(90_000)), 60);
});

test('server path floors at 0 after expiry', () => {
  assert.equal(computeTimerSecondsLeft(NOW, 60, null, 'running', iso(-5_000)), 0);
});

test('server path: null when not running', () => {
  assert.equal(computeTimerSecondsLeft(NOW, 60, null, 'paused', iso(30_000)), null);
  assert.equal(computeTimerSecondsLeft(NOW, 60, null, 'expired', null), null);
  assert.equal(computeTimerSecondsLeft(NOW, 60, null, 'off', null), null);
});

test('server path: null when running but no expiry timestamp', () => {
  assert.equal(computeTimerSecondsLeft(NOW, 60, null, 'running', null), null);
});

test('ceil: a partial second rounds up (29.2s remaining shows 30)', () => {
  assert.equal(computeTimerSecondsLeft(NOW, 60, null, 'running', iso(29_200)), 30);
});
