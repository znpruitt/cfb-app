import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOddsUsageSnapshot,
  getOddsQuotaGuardState,
  parseOddsUsageHeaders,
} from '../api/oddsUsage';

test('parses authoritative odds usage headers', () => {
  const parsed = parseOddsUsageHeaders(
    new Headers({
      'x-requests-used': '112',
      'x-requests-remaining': '388',
      'x-requests-last': '3',
    })
  );

  assert.deepEqual(parsed, { used: 112, remaining: 388, lastCost: 3 });
});

test('returns null when required usage headers are missing/invalid', () => {
  const parsed = parseOddsUsageHeaders(new Headers({ 'x-requests-used': 'NaN' }));
  assert.equal(parsed, null);
});

test('builds usage snapshot with context and capturedAt', () => {
  const snapshot = buildOddsUsageSnapshot(
    new Headers({
      'x-requests-used': '25',
      'x-requests-remaining': '475',
      'x-requests-last': '0',
    }),
    {
      sportKey: 'americanfootball_ncaaf',
      markets: ['h2h', 'totals'],
      regions: ['us'],
      endpointType: 'odds',
      cacheStatus: 'miss',
    }
  );

  assert.equal(snapshot?.lastCost, 0);
  assert.equal(snapshot?.source, 'odds-response-headers');
  assert.ok(snapshot?.capturedAt);
  assert.deepEqual(snapshot?.markets, ['h2h', 'totals']);
});

test('quota guard thresholds map to expected states', () => {
  assert.deepEqual(getOddsQuotaGuardState(26), {
    warning: false,
    disableAutoRefresh: false,
    manualWarningOnly: false,
  });

  assert.deepEqual(getOddsQuotaGuardState(25), {
    warning: true,
    disableAutoRefresh: false,
    manualWarningOnly: false,
  });

  assert.deepEqual(getOddsQuotaGuardState(10), {
    warning: true,
    disableAutoRefresh: true,
    manualWarningOnly: false,
  });

  assert.deepEqual(getOddsQuotaGuardState(5), {
    warning: true,
    disableAutoRefresh: true,
    manualWarningOnly: true,
  });
});
