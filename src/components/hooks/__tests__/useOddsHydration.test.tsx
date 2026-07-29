import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { JSDOM } from 'jsdom';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

import { buildOddsLookup, type CanonicalOddsItem, type CombinedOdds } from '../../../lib/odds';
import type { OddsUsageSnapshot } from '../../../lib/apiUsage';
import { useOddsHydration, ODDS_HYDRATION_ISSUE } from '../useOddsHydration';

// ---------------------------------------------------------------------------
// PLATFORM-086C3 — cache-only Odds hydration, decoupled from the kickoff window.
// The hook must hydrate every cached canonical line regardless of game time,
// spend no provider quota (no refresh=1, no auth header), and fire ONCE per
// selected season (navigation/re-render never re-triggers it).
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

const originalFetch = globalThis.fetch;

function combinedOdds(overrides: Partial<CombinedOdds> = {}): CombinedOdds {
  return {
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
    capturedAt: '2026-08-01T00:00:00.000Z',
    lineSourceStatus: 'latest',
    ...overrides,
  };
}

const USAGE: OddsUsageSnapshot = {
  used: 100,
  remaining: 400,
  lastCost: 3,
  limit: 500,
  capturedAt: '2026-08-01T00:00:00.000Z',
  source: 'odds-response-headers',
};

type OddsResponseBody = {
  items?: CanonicalOddsItem[];
  meta?: { usage?: OddsUsageSnapshot | null; snapshotCapturedAt?: string | null };
};

type FetchRecord = { url: string; init?: RequestInit };

let fetchCalls: FetchRecord[];

/**
 * Install a fetch stub that answers `/api/odds` from `responder`. Non-odds URLs
 * 404. `responder` receives the requested season (parsed from the URL) so tests
 * can return season-specific bodies and deferred promises.
 */
function installOddsFetch(responder: (season: number) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchCalls.push({ url, init });
    if (url.includes('/api/odds')) {
      const season = Number(new URL(url, 'https://example.test').searchParams.get('year'));
      return responder(season);
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

function oddsResponse(body: OddsResponseBody, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function oddsCalls(): FetchRecord[] {
  return fetchCalls.filter((c) => c.url.includes('/api/odds'));
}

type HarnessState = {
  oddsByKey: Record<string, CombinedOdds>;
  oddsSnapshotAt: string | null;
  oddsUsage: OddsUsageSnapshot | null;
  issues: string[];
};

type SetLike<T> = (updater: T | ((prev: T) => T)) => void;

/**
 * Closure-backed state with STABLE setter identities (mirrors React's stable
 * useState setters), so a re-render never changes the hook's effect deps.
 */
function makeHarness(initial: {
  selectedSeason: number;
  scheduleLoaded: boolean;
  hasGames: boolean;
  scheduleGeneration?: number;
}) {
  const state: HarnessState = { oddsByKey: {}, oddsSnapshotAt: null, oddsUsage: null, issues: [] };
  const apply = <T,>(prev: T, updater: T | ((p: T) => T)): T =>
    typeof updater === 'function' ? (updater as (p: T) => T)(prev) : updater;
  const setOddsByKey: SetLike<Record<string, CombinedOdds>> = (u) => {
    state.oddsByKey = apply(state.oddsByKey, u);
  };
  const setOddsSnapshotAt: SetLike<string | null> = (u) => {
    state.oddsSnapshotAt = apply(state.oddsSnapshotAt, u);
  };
  const setOddsUsage: SetLike<OddsUsageSnapshot | null> = (u) => {
    state.oddsUsage = apply(state.oddsUsage, u);
  };
  const setIssues: SetLike<string[]> = (u) => {
    state.issues = apply(state.issues, u);
  };
  const props = {
    selectedSeason: initial.selectedSeason,
    scheduleLoaded: initial.scheduleLoaded,
    hasGames: initial.hasGames,
    scheduleGeneration: initial.scheduleGeneration ?? 1,
    setOddsByKey,
    setOddsSnapshotAt,
    setOddsUsage,
    setIssues,
  };
  return { state, props };
}

beforeEach(() => {
  fetchCalls = [];
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

test('#1: a far-future-only schedule still performs one cache-only Odds hydration', async () => {
  // Every game is >7 days out — the retired window would have suppressed odds.
  const items: CanonicalOddsItem[] = [
    { canonicalGameId: '1-georgia-clemson-H', odds: combinedOdds() },
  ];
  installOddsFetch(() => oddsResponse({ items, meta: { usage: USAGE, snapshotCapturedAt: null } }));
  const { state, props } = makeHarness({
    selectedSeason: 2026,
    scheduleLoaded: true,
    hasGames: true,
  });

  renderHook((p) => useOddsHydration(p), { initialProps: props });

  await waitFor(() => assert.ok(Object.keys(state.oddsByKey).length >= 1));
  assert.equal(oddsCalls().length, 1);
  assert.ok(state.oddsByKey['1-georgia-clemson-H']);
});

test('#2: a completed/historical schedule hydrates cached closing Odds', async () => {
  const items: CanonicalOddsItem[] = [
    { canonicalGameId: 'done-1', odds: combinedOdds({ lineSourceStatus: 'closing', total: 61.5 }) },
  ];
  installOddsFetch(() =>
    oddsResponse({ items, meta: { snapshotCapturedAt: '2026-09-01T00:00:00.000Z' } })
  );
  const { state, props } = makeHarness({
    selectedSeason: 2025,
    scheduleLoaded: true,
    hasGames: true,
  });

  renderHook((p) => useOddsHydration(p), { initialProps: props });

  await waitFor(() => assert.ok(state.oddsByKey['done-1']));
  assert.equal(state.oddsByKey['done-1']?.lineSourceStatus, 'closing');
  assert.equal(state.oddsByKey['done-1']?.total, 61.5);
});

test('#3: the request is exactly /api/odds?year=<season> with no refresh=1 and no auth header', async () => {
  installOddsFetch(() => oddsResponse({ items: [] }));
  const { props } = makeHarness({ selectedSeason: 2026, scheduleLoaded: true, hasGames: true });

  renderHook((p) => useOddsHydration(p), { initialProps: props });

  await waitFor(() => assert.equal(oddsCalls().length, 1));
  const call = oddsCalls()[0]!;
  assert.match(call.url, /\/api\/odds\?year=2026$/);
  assert.doesNotMatch(call.url, /refresh=1/);
  const headers = new Headers(call.init?.headers ?? {});
  assert.equal(headers.has('authorization'), false);
  assert.equal(headers.has('x-admin-token'), false);
});

test('#4: canonical items populate oddsByKey through buildOddsLookup', async () => {
  const items: CanonicalOddsItem[] = [
    { canonicalGameId: 'a', odds: combinedOdds({ favorite: 'A' }) },
    { canonicalGameId: 'b', odds: combinedOdds({ favorite: 'B' }) },
  ];
  installOddsFetch(() => oddsResponse({ items }));
  const { state, props } = makeHarness({
    selectedSeason: 2026,
    scheduleLoaded: true,
    hasGames: true,
  });

  renderHook((p) => useOddsHydration(p), { initialProps: props });

  await waitFor(() => assert.equal(Object.keys(state.oddsByKey).length, 2));
  assert.deepEqual(state.oddsByKey, buildOddsLookup(items));
});

test('#5: snapshot freshness and usage metadata are applied from the served response', async () => {
  installOddsFetch(() =>
    oddsResponse({
      items: [],
      meta: { usage: USAGE, snapshotCapturedAt: '2026-08-15T12:00:00.000Z' },
    })
  );
  const { state, props } = makeHarness({
    selectedSeason: 2026,
    scheduleLoaded: true,
    hasGames: true,
  });

  renderHook((p) => useOddsHydration(p), { initialProps: props });

  await waitFor(() => assert.equal(state.oddsSnapshotAt, '2026-08-15T12:00:00.000Z'));
  assert.equal(state.oddsUsage?.remaining, 400);
});

test('#6: a successful empty cache response installs empty state without an error', async () => {
  installOddsFetch(() => oddsResponse({ items: [], meta: { snapshotCapturedAt: null } }));
  const { state, props } = makeHarness({
    selectedSeason: 2030,
    scheduleLoaded: true,
    hasGames: true,
  });

  renderHook((p) => useOddsHydration(p), { initialProps: props });

  await waitFor(() => assert.equal(oddsCalls().length, 1));
  await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual(state.oddsByKey, {});
  assert.equal(state.oddsSnapshotAt, null);
  assert.equal(state.issues.length, 0);
});

test('#7: a failed request preserves prior-good Odds and reports a generic, body-free issue', async () => {
  installOddsFetch(() => new Response('internal boom detail SECRET', { status: 500 }));
  const { state, props } = makeHarness({
    selectedSeason: 2026,
    scheduleLoaded: true,
    hasGames: true,
  });
  // Seed prior-good client odds that must survive the failed hydration.
  state.oddsByKey = { prior: combinedOdds({ favorite: 'PRIOR' }) };

  renderHook((p) => useOddsHydration(p), { initialProps: props });

  await waitFor(() => assert.ok(state.issues.includes(ODDS_HYDRATION_ISSUE)));
  assert.equal(state.oddsByKey['prior']?.favorite, 'PRIOR'); // prior-good preserved
  assert.ok(!state.issues.some((i) => i.includes('SECRET'))); // no response body leaked
});

test('#8: a stale/aborted season response cannot overwrite the current season', async () => {
  // Season 2026 resolves SLOWLY; the hook rerenders to 2027 (fast) first. The
  // 2026 effect is aborted on cleanup, so its late response must be dropped.
  const gate: { resolve2026: (() => void) | null } = { resolve2026: null };
  installOddsFetch((season) => {
    if (season === 2026) {
      return new Promise<Response>((res) => {
        gate.resolve2026 = () =>
          res(oddsResponse({ items: [{ canonicalGameId: 'stale-2026', odds: combinedOdds() }] }));
      });
    }
    return oddsResponse({ items: [{ canonicalGameId: 'fresh-2027', odds: combinedOdds() }] });
  });
  const { state, props } = makeHarness({
    selectedSeason: 2026,
    scheduleLoaded: true,
    hasGames: true,
  });

  const view = renderHook((p) => useOddsHydration(p), { initialProps: props });
  view.rerender({ ...props, selectedSeason: 2027 });

  await waitFor(() => assert.ok(state.oddsByKey['fresh-2027']));
  // Now let the stale 2026 response arrive — it must NOT replace the 2027 data.
  gate.resolve2026?.();
  await new Promise((r) => setTimeout(r, 25));
  assert.ok(state.oddsByKey['fresh-2027'], 'current season retained');
  assert.ok(!state.oddsByKey['stale-2026'], 'stale prior-season response dropped');
});

test('#9: re-renders (navigation) do not cause repeated Odds requests', async () => {
  installOddsFetch(() => oddsResponse({ items: [{ canonicalGameId: 'g', odds: combinedOdds() }] }));
  const { state, props } = makeHarness({
    selectedSeason: 2026,
    scheduleLoaded: true,
    hasGames: true,
  });

  const view = renderHook((p) => useOddsHydration(p), { initialProps: props });
  await waitFor(() => assert.ok(state.oddsByKey['g']));

  // Simulate week/tab/subview navigation and score-timer activity: the parent
  // re-renders repeatedly, but none of this hook's inputs change.
  for (let i = 0; i < 5; i += 1) view.rerender({ ...props });
  await new Promise((r) => setTimeout(r, 15));

  assert.equal(oddsCalls().length, 1, 'exactly one hydration across many re-renders');
});

test('#10: a schedule rebuild (generation bump) re-hydrates against the new schedule', async () => {
  // A with-games in-place schedule reload leaves selectedSeason/scheduleLoaded/hasGames
  // unchanged; the scheduleGeneration bump is what re-arms hydration so odds never
  // stay keyed to stale schedule data (PLATFORM-086C3 review remediation, finding).
  let call = 0;
  installOddsFetch(() => {
    call += 1;
    return oddsResponse({ items: [{ canonicalGameId: `gen-${call}`, odds: combinedOdds() }] });
  });
  const { state, props } = makeHarness({
    selectedSeason: 2026,
    scheduleLoaded: true,
    hasGames: true,
    scheduleGeneration: 1,
  });

  const view = renderHook((p) => useOddsHydration(p), { initialProps: props });
  await waitFor(() => assert.ok(state.oddsByKey['gen-1']));
  assert.equal(oddsCalls().length, 1);

  // The schedule was rebuilt in place (same season/loaded/hasGames) — only the
  // generation changed. This must trigger a fresh hydration.
  view.rerender({ ...props, scheduleGeneration: 2 });
  await waitFor(() => assert.equal(oddsCalls().length, 2));
  await waitFor(() => assert.ok(state.oddsByKey['gen-2']));
});

test('#11: a successful re-hydration clears the prior failure warning', async () => {
  // The first hydration fails (issue raised); a schedule rebuild re-arms the hook
  // and the retry succeeds — the stale "odds unavailable" warning must be cleared,
  // since score-only live ticks preserve odds issues by design and would otherwise
  // leave it up forever (PLATFORM-086C3 review remediation).
  let call = 0;
  installOddsFetch(() => {
    call += 1;
    if (call === 1) return new Response('boom', { status: 500 });
    return oddsResponse({ items: [{ canonicalGameId: 'recovered', odds: combinedOdds() }] });
  });
  const { state, props } = makeHarness({
    selectedSeason: 2026,
    scheduleLoaded: true,
    hasGames: true,
    scheduleGeneration: 1,
  });

  const view = renderHook((p) => useOddsHydration(p), { initialProps: props });
  await waitFor(() => assert.ok(state.issues.includes(ODDS_HYDRATION_ISSUE)));

  // Schedule rebuild → retry succeeds → odds applied AND the warning cleared.
  view.rerender({ ...props, scheduleGeneration: 2 });
  await waitFor(() => assert.ok(state.oddsByKey['recovered']));
  assert.ok(!state.issues.includes(ODDS_HYDRATION_ISSUE), 'stale warning cleared on recovery');
});
