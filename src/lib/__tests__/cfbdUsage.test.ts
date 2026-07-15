import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCfbdUsage } from '../api/cfbdUsage.ts';
import {
  cfbdCanonicalLimitForTier,
  formatQuotaSummary,
  normalizeProviderQuota,
} from '../api/providerQuota.ts';

test('CFBD usage tier 0 resolves to limit 1000', () => {
  const usage = resolveCfbdUsage({ patronLevel: 0, remainingCalls: 842 });

  assert.equal(usage.limit, 1000);
  assert.equal(usage.used, 158);
  assert.equal(usage.remaining, 842);
});

test('CFBD usage tier 1 resolves to limit 5000 (corrected from a stale 3000)', () => {
  const usage = resolveCfbdUsage({ patronLevel: 1, remainingCalls: 2800 });

  assert.equal(usage.limit, 5000);
  assert.equal(usage.used, 2200);
  assert.notEqual(usage.limit, 3000);
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

test('CFBD usage unknown integer tiers safely fall back to tier 0', () => {
  const usage = resolveCfbdUsage({ patronLevel: 99, remainingCalls: 900 });

  assert.equal(usage.limit, 1000);
  assert.equal(usage.used, 100);
});

// ---------------------------------------------------------------------------
// PLATFORM-086G1 deferred finding #7 — missing or malformed CFBD quota fields
// are UNAVAILABLE (null), never coerced into an authoritative zero. A missing
// `remainingCalls` must not read as 0 remaining / full exhaustion.
// ---------------------------------------------------------------------------

test('a missing remainingCalls field is unavailable, never 0 remaining (false exhaustion)', () => {
  const usage = resolveCfbdUsage({ patronLevel: 1 });

  assert.equal(usage.remaining, null, 'missing remainingCalls must not become 0');
  assert.equal(usage.used, null, 'usage cannot be derived without a trustworthy remaining');
  assert.equal(usage.limit, 5000, 'the canonical tier limit is still known');
});

test('an entirely empty provider payload resolves to all-unavailable', () => {
  const usage = resolveCfbdUsage({});

  assert.deepEqual(usage, { patronLevel: null, used: null, remaining: null, limit: null });
});

test('malformed remainingCalls values are unavailable, not coerced numbers', () => {
  for (const remainingCalls of ['2800', 'lots', null, Number.NaN, Number.POSITIVE_INFINITY, -5]) {
    const usage = resolveCfbdUsage({ patronLevel: 1, remainingCalls });
    assert.equal(usage.remaining, null, `remainingCalls=${String(remainingCalls)} must be null`);
    assert.equal(usage.used, null, `used must not be derived from ${String(remainingCalls)}`);
  }
});

test('a malformed patronLevel yields no limit (never a guessed ceiling)', () => {
  for (const patronLevel of ['1', 1.5, -1, Number.NaN, null]) {
    const usage = resolveCfbdUsage({ patronLevel, remainingCalls: 2800 });
    assert.equal(usage.patronLevel, null, `patronLevel=${String(patronLevel)} must be null`);
    assert.equal(usage.limit, null, 'an unusable tier must not fabricate a limit');
    assert.equal(usage.remaining, 2800, 'the trustworthy raw remaining is preserved');
    assert.equal(usage.used, null, 'used is not derivable without a limit');
  }
});

test('a trustworthy zero remaining is still genuine exhaustion', () => {
  const usage = resolveCfbdUsage({ patronLevel: 1, remainingCalls: 0 });

  assert.equal(usage.remaining, 0);
  assert.equal(usage.used, 5000, 'a real 0 remaining derives used === limit');
  assert.equal(usage.limit, 5000);
});

test('remaining above the canonical limit no longer fabricates used=0', () => {
  const usage = resolveCfbdUsage({ patronLevel: 0, remainingCalls: 1500 });

  assert.equal(usage.limit, 1000);
  assert.equal(usage.remaining, 1500, 'the raw provider remaining is preserved for diagnostics');
  assert.equal(usage.used, null, 'an implausible remaining must not coerce used to 0');
});

// ---------------------------------------------------------------------------
// Serialization through the existing canonical path (normalizeProviderQuota →
// formatQuotaSummary), composed exactly as /api/admin/usage composes it.
// ---------------------------------------------------------------------------

function normalizeAsUsageRoute(usage: ReturnType<typeof resolveCfbdUsage>) {
  return normalizeProviderQuota({
    used: usage.used,
    remaining: usage.remaining,
    limit: usage.limit,
    patronLevel: usage.patronLevel,
    canonicalLimit:
      usage.patronLevel !== null ? cfbdCanonicalLimitForTier(usage.patronLevel) : null,
    source: 'live provider observation',
  });
}

test('missing quota fields normalize to unavailable, not exhausted', () => {
  const normalized = normalizeAsUsageRoute(resolveCfbdUsage({}));

  assert.equal(normalized.limit, null);
  assert.equal(normalized.remaining, null);
  assert.equal(normalized.used, null);

  const display = formatQuotaSummary(normalized);
  assert.equal(display.available, false);
  assert.match(display.text, /unavailable/i);
  assert.doesNotMatch(display.text, /\b0 remaining\b/, 'must never render false exhaustion');
});

test('missing remaining with a valid tier normalizes to limit-known / usage-unavailable', () => {
  const normalized = normalizeAsUsageRoute(resolveCfbdUsage({ patronLevel: 1 }));

  assert.equal(normalized.limit, 5000, 'canonical Tier 1 limit stays authoritative');
  assert.equal(normalized.used, null);
  assert.equal(normalized.remaining, null);

  const display = formatQuotaSummary(normalized);
  assert.equal(display.available, true, 'a trustworthy limit is still shown');
  assert.match(display.text, /usage unavailable/i);
});

test('a valid Tier 1 observation still normalizes against the canonical 5,000 limit', () => {
  const normalized = normalizeAsUsageRoute(
    resolveCfbdUsage({ patronLevel: 1, remainingCalls: 2800 })
  );

  assert.equal(normalized.limit, 5000);
  assert.equal(normalized.used, 2200);
  assert.equal(normalized.remaining, 2800);
  assert.equal(normalized.consistent, true);
});

test('a trustworthy zero remaining normalizes and renders as genuine exhaustion', () => {
  const normalized = normalizeAsUsageRoute(resolveCfbdUsage({ patronLevel: 1, remainingCalls: 0 }));

  assert.equal(normalized.remaining, 0);
  assert.equal(normalized.used, 5000);

  const display = formatQuotaSummary(normalized);
  assert.equal(display.available, true);
  assert.match(display.text, /0 remaining/);
});
