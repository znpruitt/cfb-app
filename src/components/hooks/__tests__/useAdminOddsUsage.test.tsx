import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import type { Dispatch, SetStateAction } from 'react';
import { JSDOM } from 'jsdom';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

import type { OddsUsageSnapshot } from '../../../lib/apiUsage';
import { useAdminOddsUsage } from '../useAdminOddsUsage';

// ---------------------------------------------------------------------------
// PLATFORM-020 — odds usage is admin-only. The hydration hook must never fetch
// /api/admin/odds-usage for non-admin views, and must fetch + hydrate for admins.
// ---------------------------------------------------------------------------

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://example.test/',
});
(globalThis as { window: Window }).window = dom.window as unknown as Window;
(globalThis as { document: Document }).document = dom.window.document;
(globalThis as { self: Window }).self = dom.window as unknown as Window;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  writable: true,
  configurable: true,
});

const ODDS_USAGE_PATH = '/api/admin/odds-usage';
const originalFetch = globalThis.fetch;

let fetchCalls: string[];

beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push(url);
    if (url.includes(ODDS_USAGE_PATH)) {
      return new Response(
        JSON.stringify({
          usage: {
            used: 100,
            remaining: 400,
            lastCost: 1,
            limit: 500,
            capturedAt: '2026-01-01T00:00:00.000Z',
            source: 'odds-response-headers',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function oddsUsageCalls(): number {
  return fetchCalls.filter((url) => url.includes(ODDS_USAGE_PATH)).length;
}

/**
 * A Dispatch-compatible mock setter with backing state, so the hook's FRESHNESS-AWARE
 * functional update (`setOddsUsage(prev => mergeFresherOddsUsage(prev, snapshot))`)
 * resolves against a real prior value (PLATFORM-086C3).
 */
function makeUsageSetter(initial: OddsUsageSnapshot | null = null) {
  let current = initial;
  const snapshots: Array<OddsUsageSnapshot | null> = [];
  const setOddsUsage: Dispatch<SetStateAction<OddsUsageSnapshot | null>> = (u) => {
    current =
      typeof u === 'function'
        ? (u as (p: OddsUsageSnapshot | null) => OddsUsageSnapshot | null)(current)
        : u;
    snapshots.push(current);
  };
  return { setOddsUsage, snapshots, get: () => current };
}

test('non-admin views never fetch /api/admin/odds-usage', async () => {
  const { setOddsUsage, snapshots } = makeUsageSetter();

  renderHook(() => useAdminOddsUsage(false, setOddsUsage));

  // Allow any (incorrectly-scheduled) effect + fetch to settle.
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(oddsUsageCalls(), 0, 'non-admin must not request the admin odds-usage endpoint');
  assert.equal(snapshots.length, 0, 'non-admin must not hydrate odds usage');
});

test('admin views fetch /api/admin/odds-usage and hydrate the snapshot', async () => {
  const { setOddsUsage, snapshots } = makeUsageSetter();

  renderHook(() => useAdminOddsUsage(true, setOddsUsage));

  await waitFor(() => {
    assert.ok(snapshots.length >= 1, 'admin should hydrate odds usage');
  });

  assert.ok(oddsUsageCalls() >= 1, 'admin should request the admin odds-usage endpoint');
  assert.equal(snapshots[0]?.remaining, 400);
});

test('PLATFORM-086C3: a staler admin snapshot never clobbers a newer prior reading', async () => {
  // The stub admin snapshot is captured at 2026-01-01; seed a NEWER prior reading
  // (e.g. written by a fresher useOddsHydration cache meta). The freshness-aware
  // merge must keep the newer prior rather than overwriting it with the stale poll.
  const newer: OddsUsageSnapshot = {
    used: 10,
    remaining: 490,
    lastCost: 1,
    limit: 500,
    capturedAt: '2026-06-01T00:00:00.000Z',
    source: 'odds-response-headers',
  };
  const { setOddsUsage, get } = makeUsageSetter(newer);

  renderHook(() => useAdminOddsUsage(true, setOddsUsage));

  await waitFor(() => assert.ok(oddsUsageCalls() >= 1));
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(get()?.remaining, 490, 'newer prior reading retained over the staler admin poll');
});
