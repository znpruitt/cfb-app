import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
} from '../../server/appStateStore.ts';
import {
  acquireOddsRefreshLease,
  backoffMsForFailureCount,
  ODDS_LEASE_DURATION_MS,
  readOddsRefreshControl,
  releaseOddsRefreshLease,
} from '../refreshLease.ts';

const KEY = '2026:bookmakers=x|markets=h2h|regions=us';
const T0 = Date.parse('2026-09-01T12:00:00.000Z');

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test('lease/control #11: first acquisition succeeds; a second while active refuses', async () => {
  const first = await acquireOddsRefreshLease({ seasonScopedKey: KEY, owner: 'manual', now: T0 });
  assert.equal(first.acquired, true);

  const second = await acquireOddsRefreshLease({ seasonScopedKey: KEY, owner: 'manual', now: T0 });
  assert.equal(second.acquired, false);
  assert.equal(second.acquired === false && second.reason, 'refresh-in-progress');
});

test('lease/control #11: simultaneous acquisitions — exactly one wins', async () => {
  const [a, b] = await Promise.all([
    acquireOddsRefreshLease({ seasonScopedKey: KEY, owner: 'manual', now: T0 }),
    acquireOddsRefreshLease({ seasonScopedKey: KEY, owner: 'automatic', now: T0 }),
  ]);
  const acquiredCount = [a, b].filter((r) => r.acquired).length;
  assert.equal(acquiredCount, 1);
  const refused = [a, b].find((r) => !r.acquired);
  assert.equal(refused && refused.acquired === false && refused.reason, 'refresh-in-progress');
});

test('lease/control #12: an expired lease is reclaimable', async () => {
  const first = await acquireOddsRefreshLease({ seasonScopedKey: KEY, owner: 'manual', now: T0 });
  assert.equal(first.acquired, true);

  // Still active one second before expiry.
  const early = await acquireOddsRefreshLease({
    seasonScopedKey: KEY,
    owner: 'manual',
    now: T0 + ODDS_LEASE_DURATION_MS - 1000,
  });
  assert.equal(early.acquired, false);

  // Reclaimable once expired.
  const reclaimed = await acquireOddsRefreshLease({
    seasonScopedKey: KEY,
    owner: 'automatic',
    now: T0 + ODDS_LEASE_DURATION_MS + 1000,
  });
  assert.equal(reclaimed.acquired, true);
});

test('lease/control #13: a token mismatch cannot release a newer lease', async () => {
  const stale = await acquireOddsRefreshLease({ seasonScopedKey: KEY, owner: 'manual', now: T0 });
  assert.equal(stale.acquired, true);
  const staleToken = stale.acquired ? stale.token : '';

  // The newer refresh reclaims after expiry.
  const fresh = await acquireOddsRefreshLease({
    seasonScopedKey: KEY,
    owner: 'automatic',
    now: T0 + ODDS_LEASE_DURATION_MS + 1000,
  });
  assert.equal(fresh.acquired, true);
  const freshToken = fresh.acquired ? fresh.token : '';

  // The stale holder finalizes late — it must NOT clear the newer lease.
  await releaseOddsRefreshLease({
    seasonScopedKey: KEY,
    token: staleToken,
    resolution: 'success',
    now: T0 + ODDS_LEASE_DURATION_MS + 2000,
  });
  const control = await readOddsRefreshControl(KEY);
  assert.ok(control?.lease);
  assert.equal(control?.lease?.token, freshToken);
});

test('lease/control #14: normal completion clears the lease and records completion', async () => {
  const acquired = await acquireOddsRefreshLease({
    seasonScopedKey: KEY,
    owner: 'manual',
    now: T0,
  });
  assert.equal(acquired.acquired, true);
  const token = acquired.acquired ? acquired.token : '';

  await releaseOddsRefreshLease({
    seasonScopedKey: KEY,
    token,
    resolution: 'success',
    now: T0 + 5000,
  });
  const control = await readOddsRefreshControl(KEY);
  assert.equal(control?.lease, null);
  assert.equal(control?.lastCompletedCheckAt, new Date(T0 + 5000).toISOString());
});

test('lease/control #15: a valid no-op advances the completed-check clock and resets backoff', async () => {
  // Prime a backoff, then a no-op resolution clears it and records a completed check.
  const failAcq = await acquireOddsRefreshLease({
    seasonScopedKey: KEY,
    owner: 'automatic',
    now: T0,
  });
  const failToken = failAcq.acquired ? failAcq.token : '';
  await releaseOddsRefreshLease({
    seasonScopedKey: KEY,
    token: failToken,
    resolution: 'billed-failure',
    now: T0,
  });
  let control = await readOddsRefreshControl(KEY);
  assert.equal(control?.automaticFailureCount, 1);

  const noopAcq = await acquireOddsRefreshLease({
    seasonScopedKey: KEY,
    owner: 'automatic',
    now: T0 + 60_000,
  });
  const noopToken = noopAcq.acquired ? noopAcq.token : '';
  await releaseOddsRefreshLease({
    seasonScopedKey: KEY,
    token: noopToken,
    resolution: 'no-op',
    now: T0 + 60_000,
  });
  control = await readOddsRefreshControl(KEY);
  assert.equal(control?.automaticFailureCount, 0);
  assert.equal(control?.automaticNotBefore, null);
  assert.equal(control?.lastCompletedCheckAt, new Date(T0 + 60_000).toISOString());
});

test('lease/control #16: billed failures advance the 1h/2h/6h/12h/24h backoff', async () => {
  const expected = [1, 2, 6, 12, 24, 24].map((h) => h * 60 * 60 * 1000);
  for (let i = 0; i < expected.length; i += 1) {
    const now = T0 + i * 60_000;
    const acq = await acquireOddsRefreshLease({ seasonScopedKey: KEY, owner: 'automatic', now });
    const token = acq.acquired ? acq.token : '';
    await releaseOddsRefreshLease({
      seasonScopedKey: KEY,
      token,
      resolution: 'billed-failure',
      now,
    });
    const control = await readOddsRefreshControl(KEY);
    assert.equal(control?.automaticFailureCount, i + 1);
    assert.equal(
      control?.automaticNotBefore,
      new Date(now + expected[i]!).toISOString(),
      `failure ${i + 1} backoff`
    );
  }
  assert.equal(backoffMsForFailureCount(7), 24 * 60 * 60 * 1000);
});

test('lease/control #17: success resets the backoff', async () => {
  const fAcq = await acquireOddsRefreshLease({ seasonScopedKey: KEY, owner: 'automatic', now: T0 });
  await releaseOddsRefreshLease({
    seasonScopedKey: KEY,
    token: fAcq.acquired ? fAcq.token : '',
    resolution: 'billed-failure',
    now: T0,
  });
  const sAcq = await acquireOddsRefreshLease({
    seasonScopedKey: KEY,
    owner: 'automatic',
    now: T0 + 60_000,
  });
  await releaseOddsRefreshLease({
    seasonScopedKey: KEY,
    token: sAcq.acquired ? sAcq.token : '',
    resolution: 'success',
    now: T0 + 60_000,
  });
  const control = await readOddsRefreshControl(KEY);
  assert.equal(control?.automaticFailureCount, 0);
  assert.equal(control?.automaticNotBefore, null);
});

test('lease/control #18: acquisition ignores backoff but still requires a free lease', async () => {
  // Prime a long backoff.
  const fAcq = await acquireOddsRefreshLease({ seasonScopedKey: KEY, owner: 'automatic', now: T0 });
  await releaseOddsRefreshLease({
    seasonScopedKey: KEY,
    token: fAcq.acquired ? fAcq.token : '',
    resolution: 'billed-failure',
    now: T0,
  });
  // A manual acquire succeeds despite the active backoff (acquire never checks it).
  const manual = await acquireOddsRefreshLease({
    seasonScopedKey: KEY,
    owner: 'manual',
    now: T0 + 1000,
  });
  assert.equal(manual.acquired, true);
  // But a second acquire while that lease is held still refuses.
  const contended = await acquireOddsRefreshLease({
    seasonScopedKey: KEY,
    owner: 'manual',
    now: T0 + 1000,
  });
  assert.equal(contended.acquired, false);
});

test('lease/control #20: a lease-store failure fails safe (no confirmed token)', async () => {
  __setAppStateKeyLockFailureForTests(new Error('lease store down'));
  try {
    const result = await acquireOddsRefreshLease({
      seasonScopedKey: KEY,
      owner: 'manual',
      now: T0,
    });
    assert.equal(result.acquired, false);
    assert.equal(result.acquired === false && result.reason, 'store-unavailable');
  } finally {
    __setAppStateKeyLockFailureForTests(null);
  }
});
