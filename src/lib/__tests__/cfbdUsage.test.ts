import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCfbdUsage } from '../api/cfbdUsage.ts';

test('CFBD usage tier 0 resolves to limit 1000', () => {
  const usage = resolveCfbdUsage({ patronLevel: 0, remainingCalls: 842 });

  assert.equal(usage.limit, 1000);
  assert.equal(usage.used, 158);
  assert.equal(usage.remaining, 842);
});

test('CFBD usage tier 1 resolves to limit 3000', () => {
  const usage = resolveCfbdUsage({ patronLevel: 1, remainingCalls: 2800 });

  assert.equal(usage.limit, 3000);
  assert.equal(usage.used, 200);
});

test('CFBD usage tier 2 resolves to limit 30000', () => {
  const usage = resolveCfbdUsage({ patronLevel: 2, remainingCalls: 29500 });

  assert.equal(usage.limit, 30000);
  assert.equal(usage.used, 500);
});

test('CFBD usage tier 6 resolves to limit 500000', () => {
  const usage = resolveCfbdUsage({ patronLevel: 6, remainingCalls: 499000 });

  assert.equal(usage.limit, 500000);
  assert.equal(usage.used, 1000);
});

test('CFBD usage unknown tiers safely fall back to tier 0', () => {
  const usage = resolveCfbdUsage({ patronLevel: 99, remainingCalls: 900 });

  assert.equal(usage.limit, 1000);
  assert.equal(usage.used, 100);
});

test('CFBD usage clamps used at 0 when remaining exceeds limit', () => {
  const usage = resolveCfbdUsage({ patronLevel: 0, remainingCalls: 1500 });

  assert.equal(usage.limit, 1000);
  assert.equal(usage.used, 0);
});
