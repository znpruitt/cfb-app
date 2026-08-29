import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { useState } from 'react';
import { JSDOM } from 'jsdom';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import type { AppGame } from '../../../lib/schedule';
import { EMPTY_SCORE_HYDRATION_STATE } from '../../../lib/scoreHydration';
import type { ScorePack } from '../../../lib/scores';
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
    week: overrides.week ?? 1,
    providerWeek: overrides.providerWeek ?? 1,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 1,
    date: overrides.date ?? null,
    stage: overrides.stage ?? 'regular',
    status: 'scheduled',
    stageOrder: 1,
    slotOrder: 0,
    eventKey: overrides.eventKey ?? overrides.key ?? 'g',
    label: null,
    conference: null,
    bowlName: null,
    playoffRound: null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? overrides.key ?? 'g',
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
    scheduleGeneration: 0,
    games: [g],
    visibleGames: [g],
    scoreScopeGames: [g],
    scoresByKey: {},
    aliasMap: {},
    oddsUsage: null,
    scoreHydrationState: EMPTY_SCORE_HYDRATION_STATE,
    setScoreHydrationState: noop,
    setScoreHydrationCleanState: noop,
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

test('a clean full-scope score hydration records cleanliness for its own season type', async () => {
  let cleanState = { ...EMPTY_SCORE_HYDRATION_STATE };
  const params = makeParams();
  params.setScoreHydrationCleanState = (action) => {
    cleanState = typeof action === 'function' ? action(cleanState) : action;
  };
  const { result } = renderHook(() => useLiveRefresh(params));

  await act(async () => {
    await result.current.refreshLiveData({
      manual: false,
      scoreScopeGamesOverride: [game()],
    });
  });

  assert.deepEqual(cleanState, { regular: true, postseason: false });
});

test('a failed postseason read does not invalidate clean regular-season hydration', async () => {
  const regularGame = game({ key: 'regular' });
  const postseasonGame = game({
    key: 'postseason',
    week: 16,
    canonicalWeek: 16,
    providerWeek: 1,
    stage: 'bowl',
  });
  let cleanState = { ...EMPTY_SCORE_HYDRATION_STATE };
  let hydrationState = { ...EMPTY_SCORE_HYDRATION_STATE };
  const params = makeParams();
  params.games = [regularGame, postseasonGame];
  params.visibleGames = params.games;
  params.scoreScopeGames = params.games;
  params.setScoreHydrationCleanState = (action) => {
    cleanState = typeof action === 'function' ? action(cleanState) : action;
  };
  params.setScoreHydrationState = (action) => {
    hydrationState = typeof action === 'function' ? action(hydrationState) : action;
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchUrls.push(url);
    if (url.includes('/api/teams')) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (url.includes('/api/scores') && url.includes('seasonType=postseason')) {
      return new Response('postseason unavailable', { status: 503 });
    }
    return new Response(JSON.stringify({ items: [], meta: {} }), { status: 200 });
  }) as typeof fetch;

  const { result } = renderHook(() => useLiveRefresh(params));
  await act(async () => {
    await result.current.refreshLiveData({
      manual: false,
      scoreScopeGamesOverride: params.games,
    });
  });

  assert.deepEqual(cleanState, { regular: true, postseason: false });
  assert.deepEqual(hydrationState, { regular: true, postseason: false });
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function scoreResponse(id: string): Response {
  return new Response(
    JSON.stringify({
      items: [
        {
          id,
          week: 1,
          seasonType: 'regular',
          status: 'final',
          home: 'Home',
          away: 'Away',
          homeScore: 21,
          awayScore: 14,
          time: null,
        },
      ],
      meta: {},
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

test('a schedule rebuild discards the old in-flight hydration and retries the new generation', async () => {
  const firstScoreRead = deferred<Response>();
  const secondScoreRead = deferred<Response>();
  let scoreReadCount = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    fetchUrls.push(url);
    if (url.includes('/api/teams')) {
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }
    if (url.includes('/api/scores')) {
      scoreReadCount += 1;
      return scoreReadCount === 1 ? firstScoreRead.promise : secondScoreRead.promise;
    }
    return new Response(JSON.stringify({ items: [], meta: {} }), { status: 200 });
  }) as typeof fetch;

  const oldGame = game({ key: 'old-generation' });
  const newGame = game({ key: 'new-generation' });
  const view = renderHook(
    ({ currentGames, scheduleGeneration }) => {
      const [scores, setScores] = useState<Record<string, ScorePack>>({});
      const [hydrationState, setHydrationState] = useState({ ...EMPTY_SCORE_HYDRATION_STATE });
      const [cleanState, setCleanState] = useState({ ...EMPTY_SCORE_HYDRATION_STATE });
      const [loadingLive, setLoadingLive] = useState(false);
      const params = makeParams();
      const hook = useLiveRefresh({
        ...params,
        scheduleLoaded: true,
        scheduleGeneration,
        games: currentGames,
        visibleGames: currentGames,
        scoreScopeGames: currentGames,
        scoresByKey: scores,
        scoreHydrationState: hydrationState,
        setScoreHydrationState: setHydrationState,
        setScoreHydrationCleanState: setCleanState,
        setScoresByKey: setScores,
        loadingLive,
        setLoadingLive,
      });
      return { ...hook, scores, cleanState, hydrationState };
    },
    { initialProps: { currentGames: [oldGame], scheduleGeneration: 1 } }
  );

  await waitFor(() => assert.equal(scoreReadCount, 1));
  view.rerender({ currentGames: [newGame], scheduleGeneration: 2 });

  await act(async () => {
    firstScoreRead.resolve(scoreResponse('old-generation'));
    await firstScoreRead.promise;
  });
  await waitFor(() => assert.equal(scoreReadCount, 2));
  assert.deepEqual(
    view.result.current.scores,
    {},
    'the stale completion must not repopulate scores'
  );

  await act(async () => {
    secondScoreRead.resolve(scoreResponse('new-generation'));
    await secondScoreRead.promise;
  });
  await waitFor(() => assert.ok(view.result.current.scores['new-generation']));
  assert.equal(view.result.current.scores['old-generation'], undefined);
  assert.deepEqual(view.result.current.cleanState, { regular: true, postseason: false });
  assert.deepEqual(view.result.current.hydrationState, { regular: true, postseason: false });
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

  scorePayload = {
    items: [],
    meta: {
      generatedAt: '2026-09-05T17:06:00.000Z',
      liveObservedAt: '2026-09-05T17:06:00.000Z',
    },
  };
  await act(async () => {
    await result.current.refreshLiveData({
      manual: false,
      scoreScopeGamesOverride: [game()],
    });
  });
  assert.deepEqual(
    result.current.liveScoreObservation,
    { observedAt, attachedGameKeys: ['g'] },
    'a non-exact hydration read cannot establish or renew confidence evidence'
  );

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
