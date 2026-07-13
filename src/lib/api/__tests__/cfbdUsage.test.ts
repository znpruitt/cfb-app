import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCfbdUsage } from '../cfbdUsage.ts';

// PLATFORM-086A guardrail: CFBD usage MUST NOT assume a hardcoded 1,000-call
// limit. The limit is derived from the provider-reported patron tier, and
// `remaining` is provider-authoritative — so an upgraded tier surfaces a higher
// limit rather than a stale 1,000 ceiling.

test('tier 0 maps to the free-tier 1,000 limit', () => {
  const usage = resolveCfbdUsage({ patronLevel: 0, remainingCalls: 900 });
  assert.equal(usage.limit, 1000);
  assert.equal(usage.remaining, 900);
  assert.equal(usage.used, 100);
});

test('an upgraded tier surfaces a limit well above 1,000 (not hardcoded)', () => {
  const usage = resolveCfbdUsage({ patronLevel: 2, remainingCalls: 100 });
  assert.ok(usage.limit > 1000, `expected limit > 1000, got ${usage.limit}`);
  assert.equal(usage.used, usage.limit - 100);
});

test('remaining is taken from the provider response, not inferred from a 1,000 ceiling', () => {
  const usage = resolveCfbdUsage({ patronLevel: 1, remainingCalls: 2500 });
  assert.equal(usage.remaining, 2500);
  // used never goes negative even if remaining exceeds a lower assumed ceiling.
  assert.ok(usage.used >= 0);
});
