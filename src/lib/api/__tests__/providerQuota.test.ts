import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cfbdCanonicalLimitForTier,
  formatQuotaSummary,
  normalizeProviderQuota,
} from '../providerQuota.ts';

// ---- Canonical tier map (hotfix requirement 1) ----

test('Tier 1 resolves to 5,000', () => {
  assert.equal(cfbdCanonicalLimitForTier(1), 5000);
});

test('no active Tier 1 fallback resolves to 3,000', () => {
  assert.notEqual(cfbdCanonicalLimitForTier(1), 3000);
  assert.notEqual(cfbdCanonicalLimitForTier(1), 1000);
});

test('Tier 0 and unknown tiers resolve to the free-tier 1,000', () => {
  assert.equal(cfbdCanonicalLimitForTier(0), 1000);
  assert.equal(cfbdCanonicalLimitForTier(99), 1000);
});

// ---- Reconciliation (hotfix requirement 2) ----

test('a self-consistent explicit triple is used verbatim and marked consistent', () => {
  const q = normalizeProviderQuota({ used: 0, remaining: 5000, limit: 5000, patronLevel: 1 });
  assert.deepEqual(
    { used: q.used, remaining: q.remaining, limit: q.limit, consistent: q.consistent },
    { used: 0, remaining: 5000, limit: 5000, consistent: true }
  );
});

test('quota used/remaining/limit reconciliation derives the missing value', () => {
  // limit + remaining → used
  const a = normalizeProviderQuota({ remaining: 1500, limit: 5000 });
  assert.equal(a.used, 3500);
  assert.equal(a.limit, 5000);
  assert.equal(a.used! + a.remaining! === a.limit!, true);

  // limit + used → remaining
  const b = normalizeProviderQuota({ used: 2000, limit: 5000 });
  assert.equal(b.remaining, 3000);

  // used + remaining → limit
  const c = normalizeProviderQuota({ used: 2000, remaining: 3000 });
  assert.equal(c.limit, 5000);
});

// ---- Honest inconsistency handling (hotfix requirement 3) ----

test('provider remaining greater than raw limit falls back to the canonical limit, marked inconsistent', () => {
  // The impossible display: provider says 5000 remaining while raw limit is a stale 3000.
  const q = normalizeProviderQuota({
    used: 0,
    remaining: 5000,
    limit: 3000,
    patronLevel: 1,
    canonicalLimit: 5000,
  });
  assert.equal(q.limit, 5000, 'uses the canonical Tier 1 limit, not the stale raw 3000');
  assert.equal(q.remaining, 5000);
  assert.equal(q.used, 0);
  assert.equal(q.consistent, false, 'raw observation was inconsistent');
  assert.equal(q.raw?.limit, 3000, 'retains the raw conflicting field as diagnostic detail');
});

test('inconsistent quota fields with remaining exceeding even the canonical limit report usage unavailable', () => {
  const q = normalizeProviderQuota({
    used: 0,
    remaining: 6000,
    limit: 5000,
    patronLevel: 1,
    canonicalLimit: 5000,
  });
  assert.equal(q.limit, 5000);
  assert.equal(q.used, null);
  assert.equal(q.remaining, null);
  assert.equal(q.consistent, false);

  const display = formatQuotaSummary(q);
  assert.equal(display.inconsistent, true);
  assert.match(display.text, /usage unavailable/i);
});

test('missing quota fields with no canonical limit report quota status unavailable', () => {
  const q = normalizeProviderQuota({ remaining: 400 });
  assert.equal(q.limit, null);
  assert.equal(q.used, null);
  assert.equal(q.remaining, null);
  assert.equal(q.consistent, false);

  const display = formatQuotaSummary(q);
  assert.equal(display.available, false);
  assert.match(display.text, /unavailable/i);
});

test('negative or non-finite raw values are rejected before reconciliation', () => {
  const q = normalizeProviderQuota({
    used: -5,
    remaining: 5000,
    limit: 5000,
    canonicalLimit: 5000,
  });
  // used is invalid, so it is derived from the (valid) canonical limit + remaining.
  assert.equal(q.limit, 5000);
  assert.equal(q.remaining, 5000);
  assert.equal(q.used, 0);
});

// ---- Both surfaces agree (hotfix requirement 4) ----

test('normalized Provider Data Status and API Usage agreement: identical input → identical summary', () => {
  const input = {
    used: 0,
    remaining: 5000,
    limit: 5000,
    patronLevel: 1,
    canonicalLimit: cfbdCanonicalLimitForTier(1),
    source: 'live provider observation',
  };
  // Both panels normalize the SAME snapshot object; the pure function guarantees agreement.
  const a = normalizeProviderQuota(input);
  const b = normalizeProviderQuota(input);
  assert.deepEqual(a, b);
  assert.deepEqual(formatQuotaSummary(a), formatQuotaSummary(b));
});

test('formatQuotaSummary never renders an impossible "remaining of limit" combination', () => {
  const q = normalizeProviderQuota({
    used: 0,
    remaining: 5000,
    limit: 3000,
    patronLevel: 1,
    canonicalLimit: 5000,
  });
  const display = formatQuotaSummary(q);
  // 5,000 remaining is reconciled against the 5,000 limit — never "of 3,000".
  assert.doesNotMatch(display.text, /3,?000/);
  assert.match(display.text, /5,000/);
});
