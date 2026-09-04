import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
import { JSDOM } from 'jsdom';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import type { AppGame } from '../../../lib/schedule';
import type { ScorePack } from '../../../lib/scores';
import type { TeamCatalogItem } from '../../../lib/teamIdentity';
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
const originalDateNow = Date.now;
const originalSetTimeout = globalThis.setTimeout;
const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');
let fetchUrls: string[];
let scorePayload: unknown;
let scoreFetchGate: Promise<void> | null;

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

function makeParams(
  overrides: Partial<Parameters<typeof useLiveRefresh>[0]> = {}
): Parameters<typeof useLiveRefresh>[0] {
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
    // Item 128: the catalog the schedule bootstrap already holds. Non-empty here
    // so the hook takes the reuse path; the positive control below overrides it.
    // Typed as `TeamCatalogItem`, NOT cast: an earlier version wrote `teamId`,
    // which is not a field on that type, and an `as never` cast on the very
    // parameter this change introduces suppressed the error that would have said so.
    teamCatalog: [{ id: 'h', school: 'Home' } satisfies TeamCatalogItem],
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
    ...overrides,
  };
}

beforeEach(() => {
  fetchUrls = [];
  scorePayload = { items: [], meta: {} };
  scoreFetchGate = null;
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
      if (scoreFetchGate) await scoreFetchGate;
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
  Date.now = originalDateNow;
  globalThis.setTimeout = originalSetTimeout;
  if (originalVisibilityDescriptor) {
    Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor);
  } else {
    Reflect.deleteProperty(document, 'visibilityState');
  }
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

test('a live refresh reuses the supplied team catalog instead of refetching it', async () => {
  // Item 128. `fetchTeamsCatalog` sets `cache: 'no-store'`, so the old
  // unconditional call was a real `/api/teams` function invocation on EVERY tick
  // — reading the whole durable catalog record, then normalizing, filtering,
  // sorting and serializing every team the client already had in memory. At the
  // 90-second cadence of Item 95 portion 1 that doubles, which is why the two
  // are sequenced together.
  const { result } = renderHook(() => useLiveRefresh(makeParams()));

  await act(async () => {
    await result.current.refreshLiveData({
      manual: false,
      scoreScopeGamesOverride: [game()],
    });
  });

  assert.equal(
    fetchUrls.filter((url) => url.includes('/api/teams')).length,
    0,
    'no team-catalog request is issued when the caller supplies one'
  );
  assert.ok(
    fetchUrls.some((url) => url.includes('/api/scores')),
    'and the refresh genuinely ran — the scores read still happened'
  );
});

test('POSITIVE CONTROL: an empty catalog still falls back to fetching it', async () => {
  // Proves the assertion above can actually observe an `/api/teams` request, and
  // pins the degenerate path: an empty array is forwarded as `undefined`, so
  // `fetchScoresByGame` fetches one itself. Note this is a deliberate CHANGE, not
  // a preservation — the old code passed `[]`, and `??` does not fire on `[]`, so
  // it attached scores against an empty catalog with no retry.
  const { result } = renderHook(() => useLiveRefresh(makeParams({ teamCatalog: [] })));

  await act(async () => {
    await result.current.refreshLiveData({
      manual: false,
      scoreScopeGamesOverride: [game()],
    });
  });

  assert.equal(
    fetchUrls.filter((url) => url.includes('/api/teams')).length,
    1,
    'the fallback still reaches /api/teams, so the harness can see such a request'
  );
});

test('a catalog replaced after mount is used on the NEXT poll, not the mount-time one', async () => {
  // Review finding: `teamCatalog` was read inside `refreshLiveData` but omitted
  // from its `useCallback` deps, and `react-hooks/exhaustive-deps` is not enabled
  // in this repo, so nothing caught it. It was masked because both
  // `setTeamCatalog` call sites are paired with a `setGames` that produces a fresh
  // array, and `games` IS a dep — but `loadScheduleFromApi` sets the catalog
  // BEFORE building the schedule, so if that build throws, the catch touches
  // neither `games` nor `scheduleLoaded`. On an in-place reload the component
  // would then hold the new catalog while every later poll resolved identities
  // against the previous one, for the life of the tab.
  //
  // Observable here as a request: starting empty forces the fetch fallback, so if
  // the callback is stale it keeps fetching after a real catalog arrives.
  // EVERY other dependency is held stable across the rerender by building the
  // params ONCE. Two earlier versions of this test passed with the defect still in
  // place: the first let `makeParams()` rebuild `games` per render, the second
  // still rebuilt `aliasMap` and `weeks` — each recreated the callback on its own
  // and hid the stale dep. That is the same masking described above, reproduced
  // accidentally, twice.
  const base = makeParams();
  const { result, rerender } = renderHook(
    (props: { teamCatalog: TeamCatalogItem[] }) =>
      useLiveRefresh({ ...base, teamCatalog: props.teamCatalog }),
    { initialProps: { teamCatalog: [] as TeamCatalogItem[] } }
  );

  await act(async () => {
    await result.current.refreshLiveData({ manual: false, scoreScopeGamesOverride: base.games });
  });
  assert.equal(
    fetchUrls.filter((url) => url.includes('/api/teams')).length,
    1,
    'the empty mount-time catalog falls back to fetching'
  );

  // Replace ONLY the catalog — `games` is deliberately untouched, which is what
  // made the stale dep invisible in the masked case.
  rerender({ teamCatalog: [{ id: 'h', school: 'Home' } satisfies TeamCatalogItem] });

  await act(async () => {
    await result.current.refreshLiveData({ manual: false, scoreScopeGamesOverride: base.games });
  });
  assert.equal(
    fetchUrls.filter((url) => url.includes('/api/teams')).length,
    1,
    'the second poll sees the NEW catalog and issues no further request'
  );
  // Pin that the second poll actually RAN. Without this, "no further /api/teams
  // request" is also satisfied by the refresh never happening at all, so a future
  // early-return on the auto path would make this test vacuous again while the
  // defect it guards quietly returned.
  assert.equal(
    fetchUrls.filter((url) => url.includes('/api/scores')).length,
    2,
    'and it genuinely polled — two score reads, one per refresh'
  );
});

test('a just-kicked-off game with no score pack polls every full eligible partition at 90 seconds', async () => {
  const nowBase = Date.parse('2026-09-05T17:00:00.000Z');
  let nowMs = nowBase;
  Date.now = () => nowMs;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

  const regularFinal: AppGame = {
    ...game({ key: 'regular-final', date: new Date(nowBase).toISOString() }),
    eventKey: 'regular-final',
    week: 16,
    canonicalWeek: 16,
    providerWeek: 16,
    rawStatus: 'STATUS_FINAL',
  };
  const postseasonJustKickedOff: AppGame = {
    ...game({ key: 'postseason-live', date: new Date(nowBase).toISOString() }),
    eventKey: 'postseason-live',
    stage: 'bowl',
    week: 17,
    canonicalWeek: 17,
    providerWeek: 1,
    rawStatus: 'scheduled',
  };
  const games = [regularFinal, postseasonJustKickedOff];
  const scoresByKey: Record<string, ScorePack> = {
    'regular-final': {
      status: 'final',
      home: { team: 'Home', score: 24 },
      away: { team: 'Away', score: 17 },
      time: null,
    },
    // Intentionally no postseason-live pack: kickoff alone must select 90s.
  };
  let loading = false;
  const loadingWrites: boolean[] = [];
  const params = makeParams({
    scheduleLoaded: true,
    selectedTab: 16,
    selectedWeek: 16,
    weeks: [16],
    games,
    visibleGames: games,
    scoreScopeGames: games,
    scoresByKey,
    setLoadingLive: (action) => {
      loading = typeof action === 'function' ? action(loading) : action;
      loadingWrites.push(loading);
    },
  });
  renderHook(() => useLiveRefresh(params));

  // The season-wide bootstrap completes at t=0 and seeds the shared poll clock.
  await waitFor(() => assert.deepEqual(loadingWrites, [true, false]));
  fetchUrls = [];
  loadingWrites.length = 0;

  nowMs = nowBase + 90 * 1000;
  act(() => {
    window.dispatchEvent(new dom.window.Event('focus'));
  });
  await waitFor(() => assert.deepEqual(loadingWrites, [true, false]));

  assert.deepEqual(
    fetchUrls.filter((url) => url.includes('/api/scores')),
    [
      '/api/scores?week=16&year=2026&seasonType=regular&live=1',
      '/api/scores?week=1&year=2026&seasonType=postseason&live=1',
    ],
    'the fast tier changes only timing and retains every main-branch eligible partition'
  );
});

test('a final-only window waits 180 seconds and requests the same full partition set', async () => {
  const nowBase = Date.parse('2026-09-05T17:00:00.000Z');
  let nowMs = nowBase;
  Date.now = () => nowMs;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

  const regularFinal: AppGame = {
    ...game({ key: 'regular-final', date: new Date(nowBase).toISOString() }),
    eventKey: 'regular-final',
    week: 16,
    canonicalWeek: 16,
    providerWeek: 16,
    rawStatus: 'STATUS_FINAL',
  };
  const postseasonFinal: AppGame = {
    ...game({ key: 'postseason-final', date: new Date(nowBase).toISOString() }),
    eventKey: 'postseason-final',
    stage: 'bowl',
    week: 17,
    canonicalWeek: 17,
    providerWeek: 1,
    rawStatus: 'STATUS_FINAL',
  };
  const games = [regularFinal, postseasonFinal];
  const finalPack: ScorePack = {
    status: 'final',
    home: { team: 'Home', score: 24 },
    away: { team: 'Away', score: 17 },
    time: null,
  };
  let loading = false;
  const loadingWrites: boolean[] = [];
  const params = makeParams({
    scheduleLoaded: true,
    selectedTab: 16,
    selectedWeek: 16,
    weeks: [16],
    games,
    visibleGames: games,
    scoreScopeGames: games,
    scoresByKey: { 'regular-final': finalPack, 'postseason-final': finalPack },
    setLoadingLive: (action) => {
      loading = typeof action === 'function' ? action(loading) : action;
      loadingWrites.push(loading);
    },
  });
  renderHook(() => useLiveRefresh(params));

  await waitFor(() => assert.deepEqual(loadingWrites, [true, false]));
  fetchUrls = [];
  loadingWrites.length = 0;

  nowMs = nowBase + 90 * 1000;
  act(() => {
    window.dispatchEvent(new dom.window.Event('focus'));
  });
  assert.deepEqual(
    fetchUrls.filter((url) => url.includes('/api/scores')),
    [],
    'the completed bootstrap clock suppresses the abandoned extra t+90s read'
  );

  nowMs = nowBase + 180 * 1000;
  act(() => {
    window.dispatchEvent(new dom.window.Event('focus'));
  });
  await waitFor(() => assert.deepEqual(loadingWrites, [true, false]));

  assert.deepEqual(
    fetchUrls.filter((url) => url.includes('/api/scores')),
    [
      '/api/scores?week=16&year=2026&seasonType=regular&live=1',
      '/api/scores?week=1&year=2026&seasonType=postseason&live=1',
    ],
    'the normal tier retains the same complete eligible partition set as the fast tier'
  );
});

test('bootstrap completion re-anchors the heartbeat after nonzero fetch latency', async () => {
  const nowBase = Date.parse('2026-09-05T17:00:00.000Z');
  let nowMs = nowBase;
  Date.now = () => nowMs;
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });

  const heartbeatDelays: number[] = [];
  const observingSetTimeout = (
    ...parameters: Parameters<typeof setTimeout>
  ): ReturnType<typeof setTimeout> => {
    if (parameters[1] === 90 * 1000) heartbeatDelays.push(parameters[1]);
    return originalSetTimeout(...parameters);
  };
  globalThis.setTimeout = observingSetTimeout as typeof setTimeout;

  let releaseBootstrap!: () => void;
  scoreFetchGate = new Promise<void>((resolve) => {
    releaseBootstrap = () => {
      scoreFetchGate = null;
      resolve();
    };
  });

  let loading = false;
  const loadingWrites: boolean[] = [];
  const kickoff = game({ key: 'kickoff', date: new Date(nowBase).toISOString() });
  renderHook(() =>
    useLiveRefresh(
      makeParams({
        scheduleLoaded: true,
        games: [kickoff],
        visibleGames: [kickoff],
        scoreScopeGames: [kickoff],
        setLoadingLive: (action) => {
          loading = typeof action === 'function' ? action(loading) : action;
          loadingWrites.push(loading);
        },
      })
    )
  );

  await waitFor(() => assert.deepEqual(loadingWrites, [true]));
  assert.equal(heartbeatDelays.length, 1, 'mount arms the initial heartbeat');

  nowMs = nowBase + 1_500;
  await act(async () => {
    releaseBootstrap();
  });
  await waitFor(() => assert.deepEqual(loadingWrites, [true, false]));

  assert.equal(
    heartbeatDelays.length,
    2,
    'completion clears the mount-aligned heartbeat and re-arms 90 seconds from the stamped clock'
  );
});
