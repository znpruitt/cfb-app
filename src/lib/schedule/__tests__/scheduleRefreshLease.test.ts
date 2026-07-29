import assert from 'node:assert/strict';
import test from 'node:test';

import '../../../app/api/draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';

import {
  acquireScheduleRefreshLease,
  releaseScheduleRefreshLease,
  SCHEDULE_LEASE_DURATION_MS,
  SCHEDULE_REFRESH_CONTROL_SCOPE,
  normalizeScheduleRefreshControl,
} from '../scheduleRefreshLease.ts';
import { refreshFullSeasonSchedule } from '../fullSeasonScheduleRefresh.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
  getAppState,
} from '../../server/appStateStore.ts';

const YEAR = 2033;
const T0 = Date.parse('2033-08-01T12:00:00.000Z');
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_CFBD_API_KEY = process.env.CFBD_API_KEY;
const ORIGINAL_FETCH = globalThis.fetch;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.CFBD_API_KEY = 'test-cfbd-token';
});

test.after(() => {
  __setAppStateKeyLockFailureForTests(null);
  if (ORIGINAL_CFBD_API_KEY === undefined) delete MUTABLE_ENV.CFBD_API_KEY;
  else MUTABLE_ENV.CFBD_API_KEY = ORIGINAL_CFBD_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
});

// 10 (lease) — a concurrent caller receives refresh-in-progress.
test('a second acquirer of the same year is refused with refresh-in-progress', async () => {
  const first = await acquireScheduleRefreshLease({ year: YEAR, now: T0 });
  assert.equal(first.acquired, true);

  const second = await acquireScheduleRefreshLease({ year: YEAR, now: T0 });
  assert.equal(second.acquired, false);
  assert.equal(second.acquired === false && second.reason, 'refresh-in-progress');
});

// 10 (authority) — the losing caller makes NO provider request and spends no call.
test('a concurrent full-season refresh returns in-progress and makes no provider request', async () => {
  const held = await acquireScheduleRefreshLease({ year: YEAR, now: T0 });
  assert.equal(held.acquired, true);

  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const result = await refreshFullSeasonSchedule({ year: YEAR, now: T0 });
  assert.equal(result.status, 'in-progress');
  assert.equal(result.reason, 'refresh-in-progress');
  assert.equal(fetchCalls, 0, 'the losing caller makes no provider request');

  // The winner's lease is untouched by the loser.
  const control = normalizeScheduleRefreshControl(
    (await getAppState<unknown>(SCHEDULE_REFRESH_CONTROL_SCOPE, String(YEAR)))?.value
  );
  assert.equal(control.lease?.token, held.acquired && held.token, 'winner lease preserved');
});

// 11 — an expired lease is reclaimable.
test('an expired lease is reclaimable', async () => {
  const first = await acquireScheduleRefreshLease({ year: YEAR, now: T0 });
  assert.equal(first.acquired, true);

  // Still within the 5-minute window → refused.
  const tooSoon = await acquireScheduleRefreshLease({
    year: YEAR,
    now: T0 + SCHEDULE_LEASE_DURATION_MS - 1000,
  });
  assert.equal(tooSoon.acquired, false);

  // Past expiry → reclaimable.
  const reclaimed = await acquireScheduleRefreshLease({
    year: YEAR,
    now: T0 + SCHEDULE_LEASE_DURATION_MS + 1000,
  });
  assert.equal(reclaimed.acquired, true);
});

// 12 — a wrong token cannot release another lease.
test('a wrong token cannot release another holder’s lease', async () => {
  const stale = await acquireScheduleRefreshLease({ year: YEAR, now: T0 });
  assert.equal(stale.acquired, true);
  const staleToken = stale.acquired && stale.token;

  // A newer refresh reclaims after expiry.
  const fresh = await acquireScheduleRefreshLease({
    year: YEAR,
    now: T0 + SCHEDULE_LEASE_DURATION_MS + 1000,
  });
  assert.equal(fresh.acquired, true);
  const freshToken = fresh.acquired && fresh.token;

  // The stale holder tries to release using its OLD token — must NOT clear the
  // newer lease.
  await releaseScheduleRefreshLease({ year: YEAR, token: String(staleToken) });
  const control = normalizeScheduleRefreshControl(
    (await getAppState<unknown>(SCHEDULE_REFRESH_CONTROL_SCOPE, String(YEAR)))?.value
  );
  assert.equal(control.lease?.token, freshToken, 'newer lease survives a stale-token release');
});

// bonus — a lease-store outage fails safe (no token; authority reports a failure).
test('a lease-store outage fails safe (store-unavailable → durable-commit-failed)', async () => {
  __setAppStateKeyLockFailureForTests(new Error('lease store down'));
  try {
    const acquire = await acquireScheduleRefreshLease({ year: YEAR, now: T0 });
    assert.equal(acquire.acquired, false);
    assert.equal(acquire.acquired === false && acquire.reason, 'store-unavailable');

    const result = await refreshFullSeasonSchedule({ year: YEAR, now: T0 });
    assert.equal(result.status, 'failure');
    assert.equal(result.reason, 'durable-commit-failed');
    assert.equal(result.httpStatus, 503);
  } finally {
    __setAppStateKeyLockFailureForTests(null);
  }
});
