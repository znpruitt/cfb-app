import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveCanonicalActiveViewGames } from '../activeView.ts';
import type { AppGame } from '../schedule.ts';
import { fetchScoresByGame } from '../scores.ts';
import type { TeamCatalogItem } from '../teamIdentity.ts';

const teams: TeamCatalogItem[] = [
  { school: 'Notre Dame', level: 'FBS', conference: 'Independent' },
  { school: 'Navy', level: 'FBS', conference: 'American' },
  { school: 'Alabama', level: 'FBS', conference: 'SEC' },
  { school: 'Georgia', level: 'FBS', conference: 'SEC' },
];

function game(overrides: Partial<AppGame>): AppGame {
  return {
    key: overrides.key ?? 'g',
    eventId: overrides.eventId ?? 'e',
    week: overrides.week ?? 0,
    providerWeek: overrides.providerWeek ?? overrides.week ?? 0,
    canonicalWeek: overrides.canonicalWeek ?? overrides.week ?? 0,
    date: overrides.date ?? null,
    stage: overrides.stage ?? 'regular',
    status: overrides.status ?? 'scheduled',
    stageOrder: overrides.stageOrder ?? 1,
    slotOrder: overrides.slotOrder ?? 1,
    eventKey: overrides.eventKey ?? 'event',
    label: overrides.label ?? null,
    conference: overrides.conference ?? null,
    bowlName: overrides.bowlName ?? null,
    playoffRound: overrides.playoffRound ?? null,
    postseasonRole: overrides.postseasonRole ?? null,
    providerGameId: overrides.providerGameId ?? null,
    neutral: overrides.neutral ?? false,
    neutralDisplay: overrides.neutralDisplay ?? 'home_away',
    venue: overrides.venue ?? null,
    isPlaceholder: overrides.isPlaceholder ?? false,
    participants: overrides.participants ?? {
      home: {
        kind: 'team',
        teamId: 'h',
        displayName: overrides.csvHome ?? 'Home',
        canonicalName: overrides.canHome ?? overrides.csvHome ?? 'Home',
        rawName: overrides.csvHome ?? 'Home',
      },
      away: {
        kind: 'team',
        teamId: 'a',
        displayName: overrides.csvAway ?? 'Away',
        canonicalName: overrides.canAway ?? overrides.csvAway ?? 'Away',
        rawName: overrides.csvAway ?? 'Away',
      },
    },
    csvAway: overrides.csvAway ?? 'Away',
    csvHome: overrides.csvHome ?? 'Home',
    canAway: overrides.canAway ?? overrides.csvAway ?? 'Away',
    canHome: overrides.canHome ?? overrides.csvHome ?? 'Home',
    awayConf: overrides.awayConf ?? 'IND',
    homeConf: overrides.homeConf ?? 'IND',
    sources: overrides.sources,
  };
}

test('postseason score refresh scope requests explicit postseason scores for postseason tab', async () => {
  const games = [
    game({ key: 'week-1', week: 1, csvHome: 'Notre Dame', csvAway: 'Navy' }),
    game({
      key: 'bowl-1',
      eventId: 'bowl-1',
      providerGameId: 'bowl-provider',
      week: 18,
      stage: 'bowl',
      postseasonRole: 'bowl',
      csvHome: 'Alabama',
      csvAway: 'Georgia',
      canHome: 'Alabama',
      canAway: 'Georgia',
      label: 'Sugar Bowl',
      date: '2026-01-01T01:00:00.000Z',
    }),
  ];
  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    requested.push(url);
    const req = new URL(url, 'http://localhost');

    if (req.searchParams.get('seasonType') === 'postseason') {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'bowl-provider',
              week: 18,
              seasonType: 'postseason',
              status: 'final',
              startDate: '2026-01-01T01:00:00.000Z',
              home: 'Alabama',
              away: 'Georgia',
              homeScore: 31,
              awayScore: 28,
              time: 'Final',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const fallbackScopeGames = deriveCanonicalActiveViewGames({
      games,
      selectedTab: 'postseason',
      selectedWeek: 1,
    });
    const result = await fetchScoresByGame({
      games,
      fallbackScopeGames,
      aliasMap: {},
      season: 2025,
      teams,
      debugTrace: true,
    });

    assert.deepEqual(result.debugSnapshot?.loadedSeasonTypes, ['postseason']);
    assert.deepEqual(result.debugSnapshot?.loadedWeeks, [18]);
    assert.equal(result.scoresByKey['bowl-1']?.home.score, 31);
    assert.equal(
      requested.some((url) => url.includes('seasonType=postseason')),
      true
    );
    assert.equal(
      requested.some((url) => url.includes('seasonType=regular')),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('week 0 score refresh scope stays regular-season scoped', async () => {
  const games = [
    game({
      key: 'week-0',
      eventId: 'week-0',
      providerGameId: 'week-0-provider',
      week: 0,
      csvHome: 'Notre Dame',
      csvAway: 'Navy',
      canHome: 'Notre Dame',
      canAway: 'Navy',
      date: '2025-08-24T12:00:00.000Z',
    }),
    game({
      key: 'week-1',
      eventId: 'week-1',
      providerGameId: 'week-1-provider',
      week: 1,
      csvHome: 'Alabama',
      csvAway: 'Georgia',
      canHome: 'Alabama',
      canAway: 'Georgia',
      date: '2025-08-31T12:00:00.000Z',
    }),
  ];
  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    requested.push(url);
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const fallbackScopeGames = deriveCanonicalActiveViewGames({
      games,
      selectedTab: 0,
      selectedWeek: 0,
    });
    const result = await fetchScoresByGame({
      games,
      fallbackScopeGames,
      aliasMap: {},
      season: 2025,
      teams,
      debugTrace: true,
    });

    assert.deepEqual(result.debugSnapshot?.loadedSeasonTypes, ['regular']);
    assert.deepEqual(result.debugSnapshot?.loadedWeeks, [0]);
    assert.equal(
      requested.some((url) => url.includes('seasonType=regular')),
      true
    );
    assert.equal(
      requested.some((url) => url.includes('seasonType=postseason')),
      false
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('empty filtered refresh scope does not widen back to all active-tab weeks on season fetch fallback', async () => {
  const games = [
    game({
      key: 'bowl-17',
      eventId: 'bowl-17',
      providerGameId: 'bowl-17-provider',
      week: 17,
      stage: 'bowl',
      postseasonRole: 'bowl',
      csvHome: 'Alabama',
      csvAway: 'Georgia',
      canHome: 'Alabama',
      canAway: 'Georgia',
      label: 'Orange Bowl',
      date: '2025-12-28T01:00:00.000Z',
    }),
    game({
      key: 'bowl-18',
      eventId: 'bowl-18',
      providerGameId: 'bowl-18-provider',
      week: 18,
      stage: 'bowl',
      postseasonRole: 'bowl',
      csvHome: 'Notre Dame',
      csvAway: 'Navy',
      canHome: 'Notre Dame',
      canAway: 'Navy',
      label: 'Sugar Bowl',
      date: '2026-01-01T01:00:00.000Z',
    }),
  ];
  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    requested.push(url);
    return new Response(JSON.stringify({ error: 'upstream down' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await fetchScoresByGame({
      games,
      fallbackScopeGames: [],
      aliasMap: {},
      season: 2025,
      teams,
      debugTrace: true,
    });

    assert.deepEqual(result.debugSnapshot?.loadedSeasonTypes, []);
    assert.deepEqual(result.debugSnapshot?.loadedWeeks, []);
    assert.deepEqual(requested, []);
    assert.deepEqual(result.scoresByKey, {});
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('score refresh keeps provider week 1 rows in scope for canonical week 0 games', async () => {
  const games = [
    game({
      key: 'week-0',
      eventId: 'week-0',
      providerGameId: 'week-0-provider',
      week: 0,
      canonicalWeek: 0,
      providerWeek: 1,
      csvHome: 'Notre Dame',
      csvAway: 'Navy',
      canHome: 'Notre Dame',
      canAway: 'Navy',
      date: '2025-08-24T12:00:00.000Z',
    }),
  ];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        items: [
          {
            id: null,
            week: 1,
            seasonType: 'regular',
            status: 'final',
            startDate: null,
            home: 'Notre Dame',
            away: 'Navy',
            homeScore: 17,
            awayScore: 14,
            time: 'Final',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;

  try {
    const fallbackScopeGames = deriveCanonicalActiveViewGames({
      games,
      selectedTab: 0,
      selectedWeek: 0,
    });
    const result = await fetchScoresByGame({
      games,
      fallbackScopeGames,
      aliasMap: {},
      season: 2025,
      teams,
      debugTrace: true,
    });

    assert.deepEqual(result.debugSnapshot?.loadedWeeks, [0, 1]);
    assert.equal(result.scoresByKey['week-0']?.home.score, 17);
    assert.equal(result.scoresByKey['week-0']?.away.score, 14);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// PLATFORM-075 — the public score fetch is cache-only; the admin manual refresh
// propagates refresh=1 + credentials; a suppressed (503) season response falls
// through to week-scoped cache reads instead of hiding warm week caches.
// ---------------------------------------------------------------------------

test('PLATFORM-075: manual refresh propagates refresh=1 and admin credentials to score requests', async () => {
  const games = [
    game({
      key: 'week-1',
      eventId: 'week-1',
      providerGameId: 'w1',
      week: 1,
      csvHome: 'Notre Dame',
      csvAway: 'Navy',
      canHome: 'Notre Dame',
      canAway: 'Navy',
      date: '2025-09-06T12:00:00.000Z',
    }),
  ];
  const requested: string[] = [];
  const seenAuth: Array<string | null> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    requested.push(url);
    seenAuth.push(new Headers(init?.headers).get('x-admin-token'));
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await fetchScoresByGame({
      games,
      fallbackScopeGames: games,
      aliasMap: {},
      season: 2025,
      teams,
      refresh: true,
      authHeaders: { 'x-admin-token': 'secret-token' },
    });
    assert.ok(requested.length > 0, 'a score request should have been made');
    assert.ok(
      requested.every((u) => u.includes('refresh=1')),
      'manual refresh must add refresh=1 to every score request'
    );
    assert.ok(
      seenAuth.every((t) => t === 'secret-token'),
      'admin credentials must be forwarded on the refresh'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PLATFORM-075: public score fetch omits refresh=1 (cache-only)', async () => {
  const games = [
    game({
      key: 'week-1',
      eventId: 'week-1',
      providerGameId: 'w1',
      week: 1,
      csvHome: 'Notre Dame',
      csvAway: 'Navy',
      canHome: 'Notre Dame',
      canAway: 'Navy',
      date: '2025-09-06T12:00:00.000Z',
    }),
  ];
  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    requested.push(url);
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await fetchScoresByGame({
      games,
      fallbackScopeGames: games,
      aliasMap: {},
      season: 2025,
      teams,
    });
    assert.ok(requested.length > 0, 'a score request should have been made');
    assert.ok(
      requested.every((u) => !u.includes('refresh=1')),
      'public fetch must not add refresh=1'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('PLATFORM-075: the loader falls through to week reads when the season response is not ok', async () => {
  // Real path: an authorized refresh where the season-wide request is unavailable
  // (e.g. ESPN deployment, CFBD season-wide 502) still fans out to week-scoped
  // reads, propagating refresh=1. (The public path no longer returns a non-200
  // for cold reads — the route reconciles week caches server-side instead.)
  const games = [
    game({
      key: 'week-3',
      eventId: 'week-3',
      providerGameId: 'w3',
      week: 3,
      csvHome: 'Alabama',
      csvAway: 'Georgia',
      canHome: 'Alabama',
      canAway: 'Georgia',
      date: '2025-09-20T12:00:00.000Z',
    }),
  ];
  const requested: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string) => {
    const url = typeof input === 'string' ? input : input.toString();
    requested.push(url);
    const req = new URL(url, 'http://localhost');
    // Season-wide (no week param): unavailable -> 502.
    if (!req.searchParams.has('week')) {
      return new Response(JSON.stringify({ error: 'season-wide fallback unavailable' }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Week-scoped cache warm -> 200 with data.
    return new Response(
      JSON.stringify({
        items: [
          {
            id: 'w3',
            week: 3,
            seasonType: 'regular',
            status: 'final',
            startDate: '2025-09-20T12:00:00.000Z',
            home: 'Alabama',
            away: 'Georgia',
            homeScore: 21,
            awayScore: 14,
            time: 'Final',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const result = await fetchScoresByGame({
      games,
      fallbackScopeGames: games,
      aliasMap: {},
      season: 2025,
      teams,
      refresh: true,
    });
    assert.ok(
      requested.some((u) => !new URL(u, 'http://localhost').searchParams.has('week')),
      'season-wide request fired'
    );
    const weekRequests = requested.filter((u) =>
      new URL(u, 'http://localhost').searchParams.has('week')
    );
    assert.ok(
      weekRequests.length > 0,
      'week-scoped fallback fired after the non-ok season response'
    );
    assert.ok(
      weekRequests.every((u) => u.includes('refresh=1')),
      'the refresh flag propagates to the week fallback requests'
    );
    assert.equal(
      result.scoresByKey['week-3']?.home.score,
      21,
      'the week data surfaces via the fallback'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
