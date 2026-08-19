import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import type { AppGame } from '../../../lib/schedule';
import { EMPTY_SCORE_HYDRATION_STATE } from '../../../lib/scoreHydration';
import { useLiveRefresh } from '../useLiveRefresh';

// ---------------------------------------------------------------------------
// PLATFORM-086C3 remediation (finding 4) — regression proving the DECOUPLE: the
// live-score refresh path no longer fetches /api/odds automatically. Only an
// explicit `includeOdds: true` (the dormant authorized manual-refresh seam) does,
// and only then with refresh=1. Cache-only Odds display is owned by
// `useOddsHydration`, not this hook.
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
let fetchUrls: string[];
let scorePayload: unknown;

function game(overrides: Partial<AppGame> = {}): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? 'g',
    week: 1,
    providerWeek: 1,
    canonicalWeek: 1,
    date: overrides.date ?? null,
    stage: 'regular',
    status: 'scheduled',
    stageOrder: 1,
    slotOrder: 0,
    eventKey: 'g',
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: null,
    providerGameId: null,
    neutral: false,
    neutralDisplay: 'home_away',
    venue: null,
    isPlaceholder: false,
    participants: {
      home: {
        kind: 'team',
        teamId: 'h',
        displayName: 'Home',
        canonicalName: 'Home',
        rawName: 'Home',
      },
      away: {
        kind: 'team',
        teamId: 'a',
        displayName: 'Away',
        canonicalName: 'Away',
        rawName: 'Away',
      },
    },
    csvAway: 'Away',
    csvHome: 'Home',
    canAway: 'Away',
    canHome: 'Home',
    awayConf: 'IND',
    homeConf: 'IND',
    sources: undefined,
  };
}

function noop(): void {}

function makeParams(): Parameters<typeof useLiveRefresh>[0] {
  const g = game();
  return {
    selectedSeason: 2026,
    selectedTab: 1,
    selectedWeek: 1,
    weeks: [1],
    // scheduleLoaded:false keeps the bootstrap/timer/lazy effects inert, so the
    // ONLY /api/odds requests are the ones the manual refreshLiveData calls make.
    scheduleLoaded: false,
    games: [g],
    visibleGames: [g],
    scoreScopeGames: [g],
    scoresByKey: {},
    aliasMap: {},
    oddsUsage: null,
    scoreHydrationState: EMPTY_SCORE_HYDRATION_STATE,
    setScoreHydrationState: noop,
    setIssues: noop,
    setOddsByKey: noop,
    setScoresByKey: noop,
    setOddsUsage: noop,
    setOddsSnapshotAt: noop,
    setScoresSnapshotAt: noop,
    setScoresObservedAt: noop,
    loadingLive: false,
    setLoadingLive: noop,
    isDebug: false,
  };
}

beforeEach(() => {
  fetchUrls = [];
  scorePayload = { items: [], meta: {} };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchUrls.push(url);
    // Benign responses so refreshLiveData completes (scores errors are caught).
    if (url.includes('/api/teams')) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/api/scores')) {
      return new Response(JSON.stringify(scorePayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ items: [], meta: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function oddsUrls(): string[] {
  return fetchUrls.filter((u) => u.includes('/api/odds'));
}

test('an automatic (non-manual) live refresh never requests /api/odds', async () => {
  const { result } = renderHook(() => useLiveRefresh(makeParams()));

  // Mirrors the score-only bootstrap call — no includeOdds.
  await result.current.refreshLiveData({ manual: false, scoreScopeGamesOverride: [game()] });

  assert.equal(oddsUrls().length, 0, 'the live-refresh path must not auto-fetch odds');
});

test('an explicit includeOdds manual refresh still fetches /api/odds with refresh=1 (seam preserved)', async () => {
  const { result } = renderHook(() => useLiveRefresh(makeParams()));

  await result.current.refreshLiveData({
    manual: true,
    includeOdds: true,
    scoreScopeGamesOverride: [game()],
  });

  await waitFor(() => assert.ok(oddsUrls().length >= 1));
  assert.match(oddsUrls()[0]!, /\/api\/odds\?year=2026&refresh=1/);
});

test('POLISH-007: exact polls retain only same-poll provider observation evidence', async () => {
  const observedAt = '2026-09-05T17:03:00.000Z';
  scorePayload = {
    items: [
      {
        id: 'g',
        week: 1,
        seasonType: 'regular',
        status: 'Q2',
        home: 'Home',
        away: 'Away',
        homeScore: 10,
        awayScore: 7,
        time: 'Q2',
      },
    ],
    meta: { generatedAt: observedAt, liveObservedAt: observedAt },
  };
  const { result } = renderHook(() => useLiveRefresh(makeParams()));

  await act(async () => {
    await result.current.refreshLiveData({
      manual: false,
      scoreScopeGamesOverride: [game()],
      scorePartitions: [{ providerWeek: 1, seasonType: 'regular' }],
    });
  });

  assert.deepEqual(result.current.liveScoreObservation, {
    observedAt,
    attachedGameKeys: ['g'],
  });

  scorePayload = { items: [], meta: {} };
  await act(async () => {
    await result.current.refreshLiveData({
      manual: false,
      scoreScopeGamesOverride: [game()],
      scorePartitions: [{ providerWeek: 1, seasonType: 'regular' }],
    });
  });
  assert.equal(result.current.liveScoreObservation, null);
});
