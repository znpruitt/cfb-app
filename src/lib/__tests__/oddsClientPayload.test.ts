import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeFresherOddsUsage, type OddsUsageSnapshot } from '../apiUsage.ts';
import { applyOddsResponse, type OddsClientResponse } from '../oddsClientPayload.ts';
import type { CombinedOdds } from '../odds.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086C3 remediation — freshness-aware odds-usage merge (finding 2) and
// the shared odds-response applier (finding 3).
// ---------------------------------------------------------------------------

function usage(overrides: Partial<OddsUsageSnapshot> = {}): OddsUsageSnapshot {
  return {
    used: 100,
    remaining: 400,
    lastCost: 3,
    limit: 500,
    capturedAt: '2026-06-01T00:00:00.000Z',
    source: 'odds-response-headers',
    ...overrides,
  };
}

test('mergeFresherOddsUsage: null incoming never overwrites a known snapshot', () => {
  const prev = usage({ remaining: 400 });
  assert.equal(mergeFresherOddsUsage(prev, null), prev);
});

test('mergeFresherOddsUsage: fills from null prior', () => {
  const next = usage({ remaining: 250 });
  assert.equal(mergeFresherOddsUsage(null, next), next);
});

test('mergeFresherOddsUsage: an OLDER incoming never overwrites a newer prior', () => {
  const prev = usage({ remaining: 490, capturedAt: '2026-06-10T00:00:00.000Z' });
  const older = usage({ remaining: 300, capturedAt: '2026-06-01T00:00:00.000Z' });
  assert.equal(mergeFresherOddsUsage(prev, older), prev);
});

test('mergeFresherOddsUsage: a newer-or-equal incoming wins', () => {
  const prev = usage({ remaining: 490, capturedAt: '2026-06-01T00:00:00.000Z' });
  const newer = usage({ remaining: 300, capturedAt: '2026-06-10T00:00:00.000Z' });
  assert.equal(mergeFresherOddsUsage(prev, newer), newer);
  const equal = usage({ remaining: 275, capturedAt: '2026-06-01T00:00:00.000Z' });
  assert.equal(mergeFresherOddsUsage(prev, equal), equal);
});

test('mergeFresherOddsUsage: a validly-timestamped snapshot beats an untimestamped one', () => {
  const valid = usage({ remaining: 400, capturedAt: '2026-06-01T00:00:00.000Z' });
  const bad = usage({ remaining: 111, capturedAt: 'not-a-date' });
  assert.equal(mergeFresherOddsUsage(valid, bad), valid);
  assert.equal(mergeFresherOddsUsage(bad, valid), valid);
});

test('applyOddsResponse: decodes items/meta and merges usage freshness-aware', () => {
  const odds: CombinedOdds = {
    favorite: 'Georgia',
    spread: -7.5,
    homeSpread: -7.5,
    awaySpread: 7.5,
    spreadPriceHome: -110,
    spreadPriceAway: -110,
    total: 52.5,
    mlHome: -280,
    mlAway: 230,
    overPrice: -110,
    underPrice: -110,
    source: 'DraftKings',
    bookmakerKey: 'draftkings',
    capturedAt: '2026-06-01T00:00:00.000Z',
    lineSourceStatus: 'latest',
  };
  const payload: OddsClientResponse = {
    items: [{ canonicalGameId: 'game-1', odds }],
    meta: {
      usage: usage({ remaining: 200, capturedAt: '2026-05-01T00:00:00.000Z' }),
      snapshotCapturedAt: '2026-06-01T00:00:00.000Z',
    },
  };

  let byKey: Record<string, CombinedOdds> = {};
  let snapshotAt: string | null = null;
  // Seed a NEWER prior usage — the applier's freshness merge must retain it.
  let usageState: OddsUsageSnapshot | null = usage({
    remaining: 480,
    capturedAt: '2026-06-10T00:00:00.000Z',
  });

  applyOddsResponse(payload, {
    setOddsByKey: (u) => {
      byKey = typeof u === 'function' ? u(byKey) : u;
    },
    setOddsSnapshotAt: (u) => {
      snapshotAt = typeof u === 'function' ? u(snapshotAt) : u;
    },
    setOddsUsage: (u) => {
      usageState = typeof u === 'function' ? u(usageState) : u;
    },
  });

  assert.equal(byKey['game-1']?.favorite, 'Georgia');
  assert.equal(snapshotAt, '2026-06-01T00:00:00.000Z');
  assert.equal(usageState?.remaining, 480); // newer prior retained over the older payload usage
});

test('applyOddsResponse: an empty response installs empty lookup + null snapshot, keeps prior usage', () => {
  let byKey: Record<string, CombinedOdds> = { stale: {} as CombinedOdds };
  let snapshotAt: string | null = '2020-01-01T00:00:00.000Z';
  let usageState: OddsUsageSnapshot | null = usage({ remaining: 480 });

  applyOddsResponse(
    { items: [], meta: { snapshotCapturedAt: null } },
    {
      setOddsByKey: (u) => {
        byKey = typeof u === 'function' ? u(byKey) : u;
      },
      setOddsSnapshotAt: (u) => {
        snapshotAt = typeof u === 'function' ? u(snapshotAt) : u;
      },
      setOddsUsage: (u) => {
        usageState = typeof u === 'function' ? u(usageState) : u;
      },
    }
  );

  assert.deepEqual(byKey, {});
  assert.equal(snapshotAt, null);
  assert.equal(usageState?.remaining, 480); // null incoming usage did not clobber prior
});
