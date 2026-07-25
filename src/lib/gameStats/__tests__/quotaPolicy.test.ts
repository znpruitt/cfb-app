import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CFBD_AUTOMATION_MIN_REMAINING,
  CFBD_AUTOMATION_RESERVE_CALLS,
  evaluateAutomationQuota,
  evaluateManualQuota,
} from '../quotaPolicy.ts';

// PLATFORM-086H3E2: the approved 1,000-call reserve — automation requires
// trustworthy finite usage with ≥ 1,002 remaining; unknowns fail closed and
// are never fabricated as either safe quota or zero remaining; the manual
// override is a second explicit parameter, never implied.

test('constants: the reserve is 1,000 and the automation floor is 1,002', () => {
  assert.equal(CFBD_AUTOMATION_RESERVE_CALLS, 1000);
  assert.equal(CFBD_AUTOMATION_MIN_REMAINING, 1002);
});

test('automation: allowed at exactly the floor, refused one call below it', () => {
  assert.deepEqual(evaluateAutomationQuota({ remainingCalls: 1002 }), {
    kind: 'allowed',
    remaining: 1002,
  });
  assert.deepEqual(evaluateAutomationQuota({ remainingCalls: 1001 }), {
    kind: 'refused',
    reason: 'below-reserve',
    remaining: 1001,
  });
  assert.deepEqual(evaluateAutomationQuota({ remainingCalls: 1000 }), {
    kind: 'refused',
    reason: 'below-reserve',
    remaining: 1000,
  });
  assert.deepEqual(evaluateAutomationQuota({ remainingCalls: 0 }), {
    kind: 'refused',
    reason: 'below-reserve',
    remaining: 0,
  });
});

test('automation: missing usage is unavailable — never fabricated either direction', () => {
  for (const remainingCalls of [null, undefined]) {
    assert.deepEqual(evaluateAutomationQuota({ remainingCalls }), {
      kind: 'refused',
      reason: 'usage-unavailable',
      remaining: null,
    });
  }
});

test('automation: malformed usage is untrustworthy and fails closed', () => {
  for (const remainingCalls of [
    '4000',
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1.5,
    -1,
    2 ** 53,
    true,
    {},
  ]) {
    const decision = evaluateAutomationQuota({ remainingCalls });
    assert.deepEqual(
      decision,
      { kind: 'refused', reason: 'usage-untrustworthy', remaining: null },
      String(remainingCalls)
    );
  }
});

test('automation: remaining exceeding a trustworthy limit is inconsistent → untrustworthy', () => {
  assert.deepEqual(evaluateAutomationQuota({ remainingCalls: 5001, monthlyLimit: 5000 }), {
    kind: 'refused',
    reason: 'usage-untrustworthy',
    remaining: 5001,
  });
});

test('automation: a malformed limit poisons trust even with plausible remaining', () => {
  for (const monthlyLimit of ['5000', -1, 1.5]) {
    assert.deepEqual(
      evaluateAutomationQuota({ remainingCalls: 4000, monthlyLimit }),
      { kind: 'refused', reason: 'usage-untrustworthy', remaining: 4000 },
      String(monthlyLimit)
    );
  }
});

test('automation: an absent limit is fine; a consistent limit is fine', () => {
  assert.deepEqual(evaluateAutomationQuota({ remainingCalls: 4000 }), {
    kind: 'allowed',
    remaining: 4000,
  });
  assert.deepEqual(evaluateAutomationQuota({ remainingCalls: 4000, monthlyLimit: 5000 }), {
    kind: 'allowed',
    remaining: 4000,
  });
  assert.deepEqual(evaluateAutomationQuota({ remainingCalls: 5000, monthlyLimit: 5000 }), {
    kind: 'allowed',
    remaining: 5000,
  });
});

test('manual: above the floor the override is irrelevant — plain allowed', () => {
  for (const quotaOverride of [false, true]) {
    assert.deepEqual(evaluateManualQuota({ remainingCalls: 4000 }, quotaOverride), {
      kind: 'allowed',
      remaining: 4000,
    });
  }
});

test('manual: below the reserve without the explicit override refuses with 429', () => {
  assert.deepEqual(evaluateManualQuota({ remainingCalls: 900 }, false), {
    kind: 'refused',
    reason: 'below-reserve',
    remaining: 900,
    httpStatus: 429,
  });
});

test('manual: unknown or untrustworthy usage without override refuses with 429', () => {
  assert.deepEqual(evaluateManualQuota({ remainingCalls: null }, false), {
    kind: 'refused',
    reason: 'usage-unavailable',
    remaining: null,
    httpStatus: 429,
  });
  assert.deepEqual(evaluateManualQuota({ remainingCalls: 'lots' }, false), {
    kind: 'refused',
    reason: 'usage-untrustworthy',
    remaining: null,
    httpStatus: 429,
  });
});

test('manual: the explicit override proceeds and reports the exact reason truthfully', () => {
  assert.deepEqual(evaluateManualQuota({ remainingCalls: 900 }, true), {
    kind: 'allowed-with-override',
    reason: 'below-reserve',
    remaining: 900,
  });
  assert.deepEqual(evaluateManualQuota({ remainingCalls: null }, true), {
    kind: 'allowed-with-override',
    reason: 'usage-unavailable',
    remaining: null,
  });
  assert.deepEqual(evaluateManualQuota({ remainingCalls: 5001, monthlyLimit: 5000 }, true), {
    kind: 'allowed-with-override',
    reason: 'usage-untrustworthy',
    remaining: 5001,
  });
});
