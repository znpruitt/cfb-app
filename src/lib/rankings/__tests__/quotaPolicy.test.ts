import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateRankingsAutomationQuota,
  RANKINGS_AUTOMATION_CALL_ALLOWANCE,
  RANKINGS_AUTOMATION_MIN_REMAINING,
} from '../quotaPolicy.ts';
import {
  CFBD_AUTOMATION_MIN_REMAINING,
  CFBD_AUTOMATION_RESERVE_CALLS,
  evaluateAutomationQuota,
} from '../../gameStats/quotaPolicy.ts';

// 40 — the rankings allowance: reserve 1,000 + 1 /info + 3 + 3 attempts = 1,007.
test('the rankings automation minimum is the reserve plus the 7-call allowance', () => {
  assert.equal(RANKINGS_AUTOMATION_CALL_ALLOWANCE, 7);
  assert.equal(RANKINGS_AUTOMATION_MIN_REMAINING, 1007);
  assert.equal(RANKINGS_AUTOMATION_MIN_REMAINING, CFBD_AUTOMATION_RESERVE_CALLS + 7);
});

test('remaining 1007 is allowed; 1006 is refused below-reserve', () => {
  assert.deepEqual(evaluateRankingsAutomationQuota({ remainingCalls: 1007 }), {
    kind: 'allowed',
    remaining: 1007,
  });
  assert.deepEqual(evaluateRankingsAutomationQuota({ remainingCalls: 1006 }), {
    kind: 'refused',
    reason: 'below-reserve',
    remaining: 1006,
  });
});

// 41 — untrustworthy usage fails closed with the shared vocabulary.
test('missing usage fails closed as usage-unavailable', () => {
  assert.deepEqual(evaluateRankingsAutomationQuota({ remainingCalls: null }), {
    kind: 'refused',
    reason: 'usage-unavailable',
    remaining: null,
  });
  assert.deepEqual(evaluateRankingsAutomationQuota({ remainingCalls: undefined }), {
    kind: 'refused',
    reason: 'usage-unavailable',
    remaining: null,
  });
});

test('malformed or inconsistent usage fails closed as usage-untrustworthy', () => {
  for (const remainingCalls of ['4000', 12.5, -3, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    const decision = evaluateRankingsAutomationQuota({ remainingCalls });
    assert.equal(decision.kind, 'refused');
    assert.equal(decision.kind === 'refused' && decision.reason, 'usage-untrustworthy');
  }

  // A remaining count above a trustworthy limit is inconsistent.
  const aboveLimit = evaluateRankingsAutomationQuota({
    remainingCalls: 6000,
    monthlyLimit: 5000,
  });
  assert.equal(aboveLimit.kind === 'refused' && aboveLimit.reason, 'usage-untrustworthy');
});

// 42 — the shared game-stats/live-score threshold is UNCHANGED.
test('the default CFBD automation threshold remains 1002', () => {
  assert.equal(CFBD_AUTOMATION_MIN_REMAINING, 1002);
  assert.deepEqual(evaluateAutomationQuota({ remainingCalls: 1002 }), {
    kind: 'allowed',
    remaining: 1002,
  });
  assert.deepEqual(evaluateAutomationQuota({ remainingCalls: 1001 }), {
    kind: 'refused',
    reason: 'below-reserve',
    remaining: 1001,
  });
});
