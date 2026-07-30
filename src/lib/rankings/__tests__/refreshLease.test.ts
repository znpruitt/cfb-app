import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acquireRankingsRefreshLease,
  releaseRankingsRefreshLease,
  RANKINGS_LEASE_DURATION_MS,
  RANKINGS_REFRESH_CONTROL_SCOPE,
  normalizeRankingsRefreshControl,
} from '../refreshLease.ts';
import { refreshSeasonRankings } from '../refreshAuthority.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
  getAppState,
  setAppState,
} from '../../server/appStateStore.ts';
import { __resetSeasonRankingsCacheForTests } from '../../server/rankings.ts';
import { getProviderRefreshStatus } from '../../server/providerRefreshStatus.ts';
import { yearScope } from '../../providerRefreshScope.ts';

const YEAR = 2034;
const T0 = Date.parse('2034-08-01T12:00:00.000Z');
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetSeasonRankingsCacheForTests();
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
});

test.after(() => {
  __setAppStateKeyLockFailureForTests(null);
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
});

// 8 (lease) — a concurrent acquirer of the same year is refused.
test('a second acquirer of the same year is refused with refresh-in-progress', async () => {
  const first = await acquireRankingsRefreshLease({ year: YEAR, now: T0 });
  assert.equal(first.acquired, true);

  const second = await acquireRankingsRefreshLease({ year: YEAR, now: T0 });
  assert.equal(second.acquired, false);
  assert.equal(second.acquired === false && second.reason, 'refresh-in-progress');
});

// 8 (authority) — the losing caller makes NO provider request and begins no attempt.
test('a concurrent rankings refresh returns in-progress and makes no provider request', async () => {
  const held = await acquireRankingsRefreshLease({ year: YEAR, now: T0 });
  assert.equal(held.acquired, true);

  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const result = await refreshSeasonRankings({ year: YEAR, trigger: 'manual', now: T0 });
  assert.equal(result.status, 'in-progress');
  assert.equal(result.reason, 'refresh-in-progress');
  assert.equal(result.httpStatus, 409);
  assert.equal(result.providerCallAttempted, false);
  assert.equal(fetchCalls, 0, 'the losing caller makes no provider request');

  const status = await getProviderRefreshStatus('rankings', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, null, 'no fabricated provider-refresh attempt');

  // The winner's lease is untouched by the loser.
  const control = normalizeRankingsRefreshControl(
    (await getAppState<unknown>(RANKINGS_REFRESH_CONTROL_SCOPE, String(YEAR)))?.value
  );
  assert.equal(control.lease?.token, held.acquired && held.token, 'winner lease preserved');
});

// 9 — an expired lease is reclaimable.
test('an expired lease is reclaimable', async () => {
  const first = await acquireRankingsRefreshLease({ year: YEAR, now: T0 });
  assert.equal(first.acquired, true);

  // Still within the 5-minute window → refused.
  const tooSoon = await acquireRankingsRefreshLease({
    year: YEAR,
    now: T0 + RANKINGS_LEASE_DURATION_MS - 1000,
  });
  assert.equal(tooSoon.acquired, false);

  // Past expiry → reclaimable.
  const reclaimed = await acquireRankingsRefreshLease({
    year: YEAR,
    now: T0 + RANKINGS_LEASE_DURATION_MS + 1000,
  });
  assert.equal(reclaimed.acquired, true);
});

// 9 (malformed) — a malformed control record degrades to reclaimable state.
test('a malformed control record is reclaimable', async () => {
  await setAppState(RANKINGS_REFRESH_CONTROL_SCOPE, String(YEAR), {
    lease: { token: 42, acquiredAt: null },
  });
  const acquired = await acquireRankingsRefreshLease({ year: YEAR, now: T0 });
  assert.equal(acquired.acquired, true);
});

// 11 — a wrong token cannot release another holder's lease.
test('a wrong token cannot release another holder’s lease', async () => {
  const stale = await acquireRankingsRefreshLease({ year: YEAR, now: T0 });
  assert.equal(stale.acquired, true);
  const staleToken = stale.acquired && stale.token;

  // A newer refresh reclaims after expiry.
  const fresh = await acquireRankingsRefreshLease({
    year: YEAR,
    now: T0 + RANKINGS_LEASE_DURATION_MS + 1000,
  });
  assert.equal(fresh.acquired, true);
  const freshToken = fresh.acquired && fresh.token;

  // The stale holder tries to release using its OLD token — must NOT clear the
  // newer lease.
  await releaseRankingsRefreshLease({ year: YEAR, token: String(staleToken) });
  const control = normalizeRankingsRefreshControl(
    (await getAppState<unknown>(RANKINGS_REFRESH_CONTROL_SCOPE, String(YEAR)))?.value
  );
  assert.equal(control.lease?.token, freshToken, 'newer lease survives a stale-token release');
});

// 10 — a lease-store outage fails closed (no token; authority reports failure).
test('a lease-store outage fails closed as store-unavailable with no attempt', async () => {
  __setAppStateKeyLockFailureForTests(new Error('lease store down'));
  try {
    const acquire = await acquireRankingsRefreshLease({ year: YEAR, now: T0 });
    assert.equal(acquire.acquired, false);
    assert.equal(acquire.acquired === false && acquire.reason, 'store-unavailable');

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const result = await refreshSeasonRankings({ year: YEAR, trigger: 'automatic', now: T0 });
    assert.equal(result.status, 'failure');
    assert.equal(result.reason, 'store-unavailable');
    assert.equal(result.httpStatus, 500);
    assert.equal(result.trigger, 'automatic');
    assert.equal(result.providerCallAttempted, false);
    assert.equal(fetchCalls, 0, 'no provider work on a lease-store failure');
  } finally {
    __setAppStateKeyLockFailureForTests(null);
  }
});
