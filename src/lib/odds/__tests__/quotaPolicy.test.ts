import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ODDS_DEFAULT_BOOKMAKERS,
  ODDS_DEFAULT_MARKETS,
} from '../../../app/api/odds/routeInternals.ts';
import {
  estimateOddsRequestCost,
  estimatePostOddsUsage,
  evaluateAutomaticOddsQuota,
  oddsAutomationMinRemaining,
  probeOddsQuota,
} from '../quotaPolicy.ts';

function usageResponse(headers: Record<string, string>, status = 200): Response {
  return new Response('[]', { status, headers });
}

test('quota #32: the canonical cost estimator returns 3', () => {
  assert.equal(estimateOddsRequestCost(ODDS_DEFAULT_MARKETS, ODDS_DEFAULT_BOOKMAKERS), 3);
  // Cost = unique markets × ceil(bookmakers/10). 3 markets, 7 bookmakers → 3×1.
  assert.equal(estimateOddsRequestCost(['h2h', 'spreads', 'totals'], new Array(7).fill('b')), 3);
  // 3 markets, 11 bookmakers → 3×2 = 6 (two region-equivalents).
  assert.equal(estimateOddsRequestCost(['h2h', 'spreads', 'totals'], new Array(11).fill('b')), 6);
  assert.equal(oddsAutomationMinRemaining(3), 53);
});

test('quota #33: fresh usage at 53 permits one /odds request', () => {
  const decision = evaluateAutomaticOddsQuota({ remaining: 53, requestCost: 3 });
  assert.deepEqual(decision, { kind: 'allowed', remaining: 53 });
});

test('quota #34: remaining 52 refuses with quota-reserve', () => {
  const decision = evaluateAutomaticOddsQuota({ remaining: 52, requestCost: 3 });
  assert.deepEqual(decision, { kind: 'refused', reason: 'quota-reserve', remaining: 52 });
});

test('quota #35: missing/malformed usage fails closed as quota-usage-untrustworthy', () => {
  for (const bad of [undefined, null, NaN, -1, 3.5, '53']) {
    const decision = evaluateAutomaticOddsQuota({ remaining: bad, requestCost: 3 });
    assert.equal(decision.kind, 'refused');
    assert.equal(decision.kind === 'refused' && decision.reason, 'quota-usage-untrustworthy');
    assert.equal(decision.kind === 'refused' && decision.remaining, null);
  }
});

test('quota #35: a probe with absent usage headers is quota-usage-untrustworthy', async () => {
  const result = await probeOddsQuota({
    apiKey: 'k',
    fetchImpl: async () => usageResponse({ 'content-type': 'application/json' }),
  });
  assert.deepEqual(result, { kind: 'quota-usage-untrustworthy' });
});

test('quota #35b: a probe with out-of-range (negative) headers fails closed', async () => {
  // A valid `remaining` alongside a malformed `-1` used/last must NOT permit an
  // automatic request (review remediation F7).
  const result = await probeOddsQuota({
    apiKey: 'k',
    fetchImpl: async () =>
      usageResponse({
        'x-requests-remaining': '53',
        'x-requests-used': '-1',
        'x-requests-last': '-1',
      }),
  });
  assert.deepEqual(result, { kind: 'quota-usage-untrustworthy' });
});

test('quota #36: a /sports transport or HTTP failure is quota-probe-failed', async () => {
  const transport = await probeOddsQuota({
    apiKey: 'k',
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  assert.deepEqual(transport, { kind: 'quota-probe-failed' });

  const http = await probeOddsQuota({
    apiKey: 'k',
    fetchImpl: async () =>
      usageResponse(
        { 'x-requests-remaining': '400', 'x-requests-used': '100', 'x-requests-last': '0' },
        500
      ),
  });
  assert.deepEqual(http, { kind: 'quota-probe-failed' });
});

test('quota #37: the automatic probe performs exactly one attempt', async () => {
  let calls = 0;
  const result = await probeOddsQuota({
    apiKey: 'secret-key',
    fetchImpl: async (input) => {
      calls += 1;
      // The apiKey rides on the URL but must never surface in the result.
      assert.ok(String(input).includes('secret-key'));
      return usageResponse({
        'x-requests-remaining': '480',
        'x-requests-used': '20',
        'x-requests-last': '3',
      });
    },
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, { kind: 'usage', used: 20, remaining: 480, lastCost: 3 });
});

test('quota #40: missing post-call headers on an uncertain billed outcome deduct the max cost', () => {
  const snapshot = estimatePostOddsUsage({
    preProbe: { used: 20, remaining: 480 },
    outcome: 'uncertain-billed',
    requestCost: 3,
  });
  assert.equal(snapshot.used, 23);
  assert.equal(snapshot.remaining, 477);
  assert.equal(snapshot.lastCost, 3);
  assert.equal(snapshot.source, 'odds-automation-estimate');
});

test('quota #41: missing post-call headers on an exact empty preserve the zero-cost balance', () => {
  const snapshot = estimatePostOddsUsage({
    preProbe: { used: 20, remaining: 480 },
    outcome: 'empty-zero-cost',
    requestCost: 3,
  });
  assert.equal(snapshot.used, 20);
  assert.equal(snapshot.remaining, 480);
  assert.equal(snapshot.lastCost, 0);
  assert.equal(snapshot.source, 'odds-automation-estimate');
});

test('quota #43: results carry no secret/provider-payload fields', async () => {
  const result = await probeOddsQuota({
    apiKey: 'top-secret',
    fetchImpl: async () =>
      usageResponse({
        'x-requests-remaining': '480',
        'x-requests-used': '20',
        'x-requests-last': '3',
      }),
  });
  assert.ok(!JSON.stringify(result).includes('top-secret'));
  const decision = evaluateAutomaticOddsQuota({ remaining: 480, requestCost: 3 });
  assert.ok(!JSON.stringify(decision).includes('top-secret'));
  // Clamp safety: an over-deduction never yields negative usage.
  const clamped = estimatePostOddsUsage({
    preProbe: { used: 0, remaining: 1 },
    outcome: 'uncertain-billed',
    requestCost: 3,
  });
  assert.equal(clamped.remaining, 0);
});
