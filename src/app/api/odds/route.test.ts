import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __deleteOddsUsageStoreFileForTests,
  __resetOddsUsageStoreForTests,
  getLatestKnownOddsUsage,
} from '../../../lib/server/oddsUsageStore.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../../lib/server/appStateStore.ts';
import {
  __deleteDurableOddsStoreFileForTests,
  __resetDurableOddsStoreForTests,
  getDurableOddsRecord,
  setDurableOddsStore,
} from '../../../lib/server/durableOddsStore.ts';

import { GET, __resetOddsRouteCacheForTests, resolveDefaultSeason } from './route.ts';

const DURABLE_ODDS_TEST_SEASON = 2026;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await __deleteOddsUsageStoreFileForTests();
  __resetOddsUsageStoreForTests();
  await __deleteDurableOddsStoreFileForTests(DURABLE_ODDS_TEST_SEASON);
  __resetDurableOddsStoreForTests();
  __resetOddsRouteCacheForTests();
  process.env.ODDS_API_KEY = 'test-key';
});

function buildScheduleItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'game-1',
    week: 1,
    startDate: '2026-09-01T19:30:00.000Z',
    neutralSite: false,
    conferenceGame: false,
    homeTeam: 'Georgia',
    awayTeam: 'Clemson',
    homeConference: 'SEC',
    awayConference: 'ACC',
    status: 'scheduled',
    seasonType: 'regular',
    gamePhase: 'regular',
    ...overrides,
  };
}

function buildOddsEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    home_team: 'Georgia Bulldogs',
    away_team: 'Clemson Tigers',
    bookmakers: [
      {
        key: 'draftkings',
        title: 'DraftKings',
        markets: [
          {
            key: 'spreads',
            outcomes: [
              { name: 'Georgia', point: -3.5, price: -110 },
              { name: 'Clemson', point: 3.5, price: -110 },
            ],
          },
          {
            key: 'h2h',
            outcomes: [
              { name: 'Georgia', price: -150 },
              { name: 'Clemson', price: 130 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

test('default odds season follows football season year before July when no env override is set', () => {
  const priorSeasonEnv = process.env.NEXT_PUBLIC_SEASON;
  delete process.env.NEXT_PUBLIC_SEASON;

  try {
    assert.equal(resolveDefaultSeason(new Date('2026-03-19T12:00:00.000Z')), 2025);
    assert.equal(resolveDefaultSeason(new Date('2026-09-01T12:00:00.000Z')), 2026);
  } finally {
    if (priorSeasonEnv === undefined) {
      delete process.env.NEXT_PUBLIC_SEASON;
    } else {
      process.env.NEXT_PUBLIC_SEASON = priorSeasonEnv;
    }
  }
});

test('NEXT_PUBLIC_SEASON override still wins for odds default season', () => {
  const priorSeasonEnv = process.env.NEXT_PUBLIC_SEASON;
  process.env.NEXT_PUBLIC_SEASON = '2031';

  try {
    assert.equal(resolveDefaultSeason(new Date('2026-03-19T12:00:00.000Z')), 2031);
  } finally {
    if (priorSeasonEnv === undefined) {
      delete process.env.NEXT_PUBLIC_SEASON;
    } else {
      process.env.NEXT_PUBLIC_SEASON = priorSeasonEnv;
    }
  }
});

test('explicit request year stays authoritative when filters are combined', async () => {
  const originalFetch = global.fetch;
  const cases = [
    { label: 'year only', query: '?year=2025' },
    { label: 'year + markets', query: '?year=2025&markets=h2h' },
    { label: 'year + bookmakers', query: '?year=2025&bookmakers=draftkings' },
    { label: 'year + regions', query: '?year=2025&regions=us' },
    {
      label: 'year + combined filters',
      query: '?year=2025&markets=h2h,spreads&bookmakers=draftkings&regions=us',
    },
  ];

  try {
    for (const testCase of cases) {
      __resetOddsRouteCacheForTests();
      await __deleteDurableOddsStoreFileForTests(2025);
      await __deleteDurableOddsStoreFileForTests(2026);
      const seenScheduleYears: number[] = [];

      global.fetch = (async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === 'string' ? input : input.toString());
        if (url.pathname === '/api/schedule') {
          seenScheduleYears.push(Number(url.searchParams.get('year')));
          return new Response(JSON.stringify({ items: [buildScheduleItem()] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url.pathname === '/api/conferences') {
          return new Response(JSON.stringify({ items: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify([buildOddsEvent()]), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-requests-used': '5',
            'x-requests-remaining': '495',
            'x-requests-last': '1',
          },
        });
      }) as typeof fetch;

      const res = await GET(new Request(`http://localhost/api/odds${testCase.query}`));
      assert.equal(res.status, 200, testCase.label);
      const json = (await res.json()) as {
        items: Array<{ canonicalGameId: string }>;
        meta: { season: number };
      };

      assert.deepEqual(
        seenScheduleYears,
        [2025],
        `${testCase.label} should fetch the requested year`
      );
      assert.equal(json.meta.season, 2025, `${testCase.label} should report the requested year`);
      assert.ok(json.items[0]?.canonicalGameId);

      const persisted = await getDurableOddsRecord(2025, json.items[0]!.canonicalGameId);
      const shouldPersist =
        testCase.query === '?year=2025' || testCase.query === '?year=2025&regions=us';
      if (shouldPersist) {
        assert.ok(persisted, `${testCase.label} should populate the canonical durable store`);
      } else {
        assert.equal(
          persisted,
          null,
          `${testCase.label} should not overwrite the canonical durable store`
        );
      }

      assert.equal(await getDurableOddsRecord(2026, json.items[0]!.canonicalGameId), null);
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('402 with valid usage headers persists authoritative header-derived snapshot', async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ message: 'payment required' }), {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
        'x-requests-used': '500',
        'x-requests-remaining': '0',
        'x-requests-last': '3',
      },
    })) as typeof fetch;

  try {
    const res = await GET(new Request('http://localhost/api/odds?markets=h2h,spreads'));
    assert.equal(res.status, 402);

    const usage = await getLatestKnownOddsUsage();
    assert.equal(usage?.source, 'odds-response-headers');
    assert.equal(usage?.remaining, 0);
    assert.equal(usage?.lastCost, 3);
  } finally {
    global.fetch = originalFetch;
  }
});

test('429 without usable usage headers persists fallback-labeled depleted snapshot', async () => {
  const originalFetch = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ message: 'too many requests' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
      },
    })) as typeof fetch;

  try {
    const res = await GET(new Request('http://localhost/api/odds?markets=totals'));
    assert.equal(res.status, 429);

    const usage = await getLatestKnownOddsUsage();
    assert.equal(usage?.source, 'quota-error-fallback');
    assert.equal(usage?.remaining, 0);
    assert.equal(usage?.limit, 500);
  } finally {
    global.fetch = originalFetch;
  }
});

test('filtered odds requests do not overwrite the shared durable store with partial markets', async () => {
  const originalFetch = global.fetch;

  await setDurableOddsStore(DURABLE_ODDS_TEST_SEASON, {
    '1-georgia-clemson-H': {
      canonicalGameId: '1-georgia-clemson-H',
      latestSnapshot: {
        capturedAt: '2026-09-01T18:00:00.000Z',
        bookmakerKey: 'draftkings',
        favorite: 'Georgia',
        source: 'DraftKings',
        spread: -3.5,
        homeSpread: -3.5,
        awaySpread: 3.5,
        spreadPriceHome: -110,
        spreadPriceAway: -110,
        moneylineHome: -150,
        moneylineAway: 130,
        total: 52.5,
        overPrice: -108,
        underPrice: -112,
      },
      closingSnapshot: null,
      closingFrozenAt: null,
    },
  });

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());

    if (url.pathname === '/api/schedule') {
      return new Response(JSON.stringify({ items: [buildScheduleItem()] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/api/conferences') {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(
      JSON.stringify([
        buildOddsEvent({
          bookmakers: [
            {
              key: 'draftkings',
              title: 'DraftKings',
              markets: [
                {
                  key: 'h2h',
                  outcomes: [
                    { name: 'Georgia', price: -155 },
                    { name: 'Clemson', price: 135 },
                  ],
                },
              ],
            },
          ],
        }),
      ]),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-requests-used': '5',
          'x-requests-remaining': '495',
          'x-requests-last': '1',
        },
      }
    );
  }) as typeof fetch;

  try {
    const res = await GET(
      new Request(`http://localhost/api/odds?year=${DURABLE_ODDS_TEST_SEASON}&markets=h2h`)
    );
    assert.equal(res.status, 200);

    const json = (await res.json()) as {
      items: Array<{
        canonicalGameId: string;
        odds: { spread: number | null; total: number | null; mlHome: number | null };
      }>;
    };

    assert.equal(json.items[0]?.odds.spread, null);
    assert.equal(json.items[0]?.odds.total, null);
    assert.equal(json.items[0]?.odds.mlHome, -155);

    const persisted = await getDurableOddsRecord(DURABLE_ODDS_TEST_SEASON, '1-georgia-clemson-H');

    assert.equal(persisted?.latestSnapshot?.spread, -3.5);
    assert.equal(persisted?.latestSnapshot?.total, 52.5);
    assert.equal(persisted?.latestSnapshot?.moneylineHome, -150);
  } finally {
    global.fetch = originalFetch;
  }
});

test('successful fetch attaches odds to canonical schedule games and persists latestSnapshot', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/schedule')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'game-1',
              week: 1,
              startDate: '2026-09-01T19:30:00.000Z',
              neutralSite: false,
              conferenceGame: false,
              homeTeam: 'Georgia',
              awayTeam: 'Clemson',
              homeConference: 'SEC',
              awayConference: 'ACC',
              status: 'scheduled',
              seasonType: 'regular',
              gamePhase: 'regular',
            },
          ],
          meta: { source: 'cfbd', cache: 'miss', generatedAt: '2026-09-01T18:00:00.000Z' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify([
        {
          home_team: 'Georgia Bulldogs',
          away_team: 'Clemson Tigers',
          bookmakers: [
            {
              key: 'draftkings',
              title: 'DraftKings',
              markets: [
                {
                  key: 'spreads',
                  outcomes: [
                    { name: 'Georgia', point: -3.5, price: -110 },
                    { name: 'Clemson', point: 3.5, price: -110 },
                  ],
                },
                {
                  key: 'h2h',
                  outcomes: [
                    { name: 'Georgia', price: -150 },
                    { name: 'Clemson', price: 130 },
                  ],
                },
                {
                  key: 'totals',
                  outcomes: [
                    { name: 'Over', point: 52.5, price: -108 },
                    { name: 'Under', point: 52.5, price: -112 },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-requests-used': '5',
          'x-requests-remaining': '495',
          'x-requests-last': '1',
        },
      }
    );
  }) as typeof fetch;

  try {
    const res = await GET(
      new Request(`http://localhost/api/odds?year=${DURABLE_ODDS_TEST_SEASON}`)
    );
    assert.equal(res.status, 200);

    const json = (await res.json()) as {
      items: Array<{
        canonicalGameId: string;
        odds: { spread: number | null; lineSourceStatus: string };
      }>;
    };

    assert.equal(json.items.length, 1);
    assert.equal(json.items[0]?.odds.spread, -3.5);
    assert.equal(json.items[0]?.odds.lineSourceStatus, 'latest');

    const persisted = await getDurableOddsRecord(
      DURABLE_ODDS_TEST_SEASON,
      json.items[0]!.canonicalGameId
    );

    assert.equal(persisted?.latestSnapshot?.spread, -3.5);
    assert.equal(persisted?.closingSnapshot, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('odds canonicalization uses conference records so tracked games match schedule eligibility', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());

    if (url.pathname === '/api/schedule') {
      return new Response(
        JSON.stringify({
          items: [
            buildScheduleItem({
              id: 'reg-aac-vs-fcs',
              week: 2,
              startDate: '2026-09-06T20:00:00Z',
              homeTeam: 'Navy',
              awayTeam: 'UC Davis',
              homeConference: 'AAC',
              awayConference: 'Patriot',
            }),
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.pathname === '/api/conferences') {
      return new Response(
        JSON.stringify({
          items: [
            {
              name: 'American Athletic Conference',
              shortName: 'American Athletic',
              abbreviation: 'AAC',
              classification: 'fbs',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify([
        buildOddsEvent({
          home_team: 'Navy',
          away_team: 'UC Davis',
        }),
      ]),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-requests-used': '5',
          'x-requests-remaining': '495',
          'x-requests-last': '1',
        },
      }
    );
  }) as typeof fetch;

  try {
    const res = await GET(new Request('http://localhost/api/odds?year=2026&refresh=1'));
    assert.equal(res.status, 200);

    const json = (await res.json()) as {
      items: Array<{ canonicalGameId: string }>;
      meta: { season: number };
    };

    assert.equal(json.meta.season, 2026);
    assert.equal(json.items.length, 1);
    assert.equal(json.items[0]?.canonicalGameId, '2-navy-ucdavis-H');
  } finally {
    global.fetch = originalFetch;
  }
});

test('post-kickoff refresh freezes closingSnapshot and later refreshes do not overwrite it', async () => {
  const originalFetch = global.fetch;

  let oddsSpread = -3.5;
  const scheduleStatus = 'final';
  const scheduleKickoff = '2026-03-01T19:30:00.000Z';

  await setDurableOddsStore(DURABLE_ODDS_TEST_SEASON, {
    '1-georgia-clemson-H': {
      canonicalGameId: '1-georgia-clemson-H',
      latestSnapshot: {
        capturedAt: '2026-03-01T19:00:00.000Z',
        bookmakerKey: 'draftkings',
        favorite: 'Georgia',
        source: 'DraftKings',
        spread: -3.5,
        homeSpread: -3.5,
        awaySpread: 3.5,
        spreadPriceHome: -110,
        spreadPriceAway: -110,
        moneylineHome: -150,
        moneylineAway: 130,
        total: 52.5,
        overPrice: -108,
        underPrice: -112,
      },
      closingSnapshot: null,
      closingFrozenAt: null,
    },
  });

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/schedule')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'game-1',
              week: 1,
              startDate: scheduleKickoff,
              neutralSite: false,
              conferenceGame: false,
              homeTeam: 'Georgia',
              awayTeam: 'Clemson',
              homeConference: 'SEC',
              awayConference: 'ACC',
              status: scheduleStatus,
              seasonType: 'regular',
              gamePhase: 'regular',
            },
          ],
          meta: { source: 'cfbd', cache: 'miss', generatedAt: new Date().toISOString() },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify([
        {
          home_team: 'Georgia',
          away_team: 'Clemson',
          bookmakers: [
            {
              key: 'draftkings',
              title: 'DraftKings',
              markets: [
                {
                  key: 'spreads',
                  outcomes: [
                    { name: 'Georgia', point: oddsSpread, price: -110 },
                    { name: 'Clemson', point: Math.abs(oddsSpread), price: -110 },
                  ],
                },
                {
                  key: 'h2h',
                  outcomes: [
                    { name: 'Georgia', price: -150 },
                    { name: 'Clemson', price: 130 },
                  ],
                },
                {
                  key: 'totals',
                  outcomes: [
                    { name: 'Over', point: 52.5, price: -108 },
                    { name: 'Under', point: 52.5, price: -112 },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-requests-used': '5',
          'x-requests-remaining': '495',
          'x-requests-last': '1',
        },
      }
    );
  }) as typeof fetch;

  try {
    const json = (await (
      await GET(new Request(`http://localhost/api/odds?year=${DURABLE_ODDS_TEST_SEASON}`))
    ).json()) as {
      items: Array<{ canonicalGameId: string; odds: { lineSourceStatus: string } }>;
    };

    const canonicalGameId = json.items[0]!.canonicalGameId;

    let persisted = await getDurableOddsRecord(DURABLE_ODDS_TEST_SEASON, canonicalGameId);
    assert.equal(persisted?.closingSnapshot?.spread, -3.5);
    assert.equal(typeof persisted?.closingFrozenAt, 'string');

    oddsSpread = -7.5;
    await GET(new Request(`http://localhost/api/odds?year=${DURABLE_ODDS_TEST_SEASON}`));

    persisted = await getDurableOddsRecord(DURABLE_ODDS_TEST_SEASON, canonicalGameId);
    assert.equal(persisted?.closingSnapshot?.spread, -3.5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('first seen after kickoff does not persist a closing snapshot fallback', async () => {
  const originalFetch = global.fetch;

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/schedule')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'game-1',
              week: 1,
              startDate: '2000-09-01T19:30:00.000Z',
              neutralSite: false,
              conferenceGame: false,
              homeTeam: 'Georgia',
              awayTeam: 'Clemson',
              homeConference: 'SEC',
              awayConference: 'ACC',
              status: 'final',
              seasonType: 'regular',
              gamePhase: 'regular',
            },
          ],
          meta: { source: 'cfbd', cache: 'miss', generatedAt: new Date().toISOString() },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify([
        {
          home_team: 'Georgia',
          away_team: 'Clemson',
          bookmakers: [
            {
              key: 'draftkings',
              title: 'DraftKings',
              markets: [
                {
                  key: 'spreads',
                  outcomes: [
                    { name: 'Georgia', point: -3.5, price: -110 },
                    { name: 'Clemson', point: 3.5, price: -110 },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-requests-used': '5',
          'x-requests-remaining': '495',
          'x-requests-last': '1',
        },
      }
    );
  }) as typeof fetch;

  try {
    const res = await GET(
      new Request(`http://localhost/api/odds?year=${DURABLE_ODDS_TEST_SEASON}`)
    );
    assert.equal(res.status, 200);

    const json = (await res.json()) as { items: Array<{ canonicalGameId: string }> };
    assert.equal(json.items.length, 0);

    const persisted = await getDurableOddsRecord(DURABLE_ODDS_TEST_SEASON, '1-georgia-clemson-H');
    assert.equal(persisted, null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('kickoff delays reopen an early frozen line and allow a later pre-kickoff refresh to replace latestSnapshot', async () => {
  const originalFetch = global.fetch;

  let scheduleKickoff = '2026-09-01T19:30:00.000Z';
  let oddsSpread = -3.5;

  await setDurableOddsStore(DURABLE_ODDS_TEST_SEASON, {
    '1-georgia-clemson-H': {
      canonicalGameId: '1-georgia-clemson-H',
      latestSnapshot: {
        capturedAt: '2026-03-01T19:00:00.000Z',
        bookmakerKey: 'draftkings',
        favorite: 'Georgia',
        source: 'DraftKings',
        spread: -3.5,
        homeSpread: -3.5,
        awaySpread: 3.5,
        spreadPriceHome: -110,
        spreadPriceAway: -110,
        moneylineHome: -150,
        moneylineAway: 130,
        total: 52.5,
        overPrice: -108,
        underPrice: -112,
      },
      closingSnapshot: {
        capturedAt: '2026-03-01T19:00:00.000Z',
        bookmakerKey: 'draftkings',
        favorite: 'Georgia',
        source: 'DraftKings',
        spread: -3.5,
        homeSpread: -3.5,
        awaySpread: 3.5,
        spreadPriceHome: -110,
        spreadPriceAway: -110,
        moneylineHome: -150,
        moneylineAway: 130,
        total: 52.5,
        overPrice: -108,
        underPrice: -112,
      },
      closingFrozenAt: '2026-03-01T19:31:00.000Z',
    },
  });

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/schedule')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'game-1',
              week: 1,
              startDate: scheduleKickoff,
              neutralSite: false,
              conferenceGame: false,
              homeTeam: 'Georgia',
              awayTeam: 'Clemson',
              homeConference: 'SEC',
              awayConference: 'ACC',
              status: 'scheduled',
              seasonType: 'regular',
              gamePhase: 'regular',
            },
          ],
          meta: { source: 'cfbd', cache: 'miss', generatedAt: new Date().toISOString() },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify([
        {
          home_team: 'Georgia',
          away_team: 'Clemson',
          bookmakers: [
            {
              key: 'draftkings',
              title: 'DraftKings',
              markets: [
                {
                  key: 'spreads',
                  outcomes: [
                    { name: 'Georgia', point: oddsSpread, price: -110 },
                    { name: 'Clemson', point: Math.abs(oddsSpread), price: -110 },
                  ],
                },
                {
                  key: 'h2h',
                  outcomes: [
                    { name: 'Georgia', price: -150 },
                    { name: 'Clemson', price: 130 },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-requests-used': '5',
          'x-requests-remaining': '495',
          'x-requests-last': '1',
        },
      }
    );
  }) as typeof fetch;

  try {
    scheduleKickoff = '2999-09-01T21:00:00.000Z';
    oddsSpread = -7.5;

    const res = await GET(
      new Request(`http://localhost/api/odds?year=${DURABLE_ODDS_TEST_SEASON}`)
    );
    assert.equal(res.status, 200);

    const persisted = await getDurableOddsRecord(DURABLE_ODDS_TEST_SEASON, '1-georgia-clemson-H');
    assert.equal(persisted?.closingSnapshot, null);
    assert.equal(persisted?.latestSnapshot?.spread, -7.5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('repeat matchup odds persist independently for regular season and conference championship identities', async () => {
  const originalFetch = global.fetch;

  await setDurableOddsStore(DURABLE_ODDS_TEST_SEASON, {
    '1-georgia-clemson-H': {
      canonicalGameId: '1-georgia-clemson-H',
      latestSnapshot: {
        capturedAt: '2026-03-01T19:00:00.000Z',
        bookmakerKey: 'draftkings',
        favorite: 'Georgia',
        source: 'DraftKings',
        spread: -3.5,
        homeSpread: -3.5,
        awaySpread: 3.5,
        spreadPriceHome: -110,
        spreadPriceAway: -110,
        moneylineHome: -150,
        moneylineAway: 130,
        total: 52.5,
        overPrice: -108,
        underPrice: -112,
      },
      closingSnapshot: {
        capturedAt: '2026-03-01T19:00:00.000Z',
        bookmakerKey: 'draftkings',
        favorite: 'Georgia',
        source: 'DraftKings',
        spread: -3.5,
        homeSpread: -3.5,
        awaySpread: 3.5,
        spreadPriceHome: -110,
        spreadPriceAway: -110,
        moneylineHome: -150,
        moneylineAway: 130,
        total: 52.5,
        overPrice: -108,
        underPrice: -112,
      },
      closingFrozenAt: '2026-03-01T19:31:00.000Z',
    },
  });

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.includes('/api/schedule')) {
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'regular-1',
              week: 1,
              startDate: '2026-03-01T19:30:00.000Z',
              neutralSite: false,
              conferenceGame: false,
              homeTeam: 'Georgia',
              awayTeam: 'Clemson',
              homeConference: 'SEC',
              awayConference: 'ACC',
              status: 'final',
              seasonType: 'regular',
              gamePhase: 'regular',
            },
            {
              id: 'ccg-1',
              week: 14,
              startDate: '2999-12-05T20:00:00.000Z',
              neutralSite: true,
              conferenceGame: true,
              homeTeam: 'Georgia',
              awayTeam: 'Clemson',
              homeConference: 'SEC',
              awayConference: 'SEC',
              status: 'scheduled',
              seasonType: 'regular',
              gamePhase: 'conference_championship',
              regularSubtype: 'conference_championship',
              conferenceChampionshipConference: 'SEC',
              eventKey: 'sec-championship',
              label: 'SEC Championship',
            },
          ],
          meta: { source: 'cfbd', cache: 'miss', generatedAt: new Date().toISOString() },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify([
        {
          home_team: 'Georgia',
          away_team: 'Clemson',
          bookmakers: [
            {
              key: 'draftkings',
              title: 'DraftKings',
              markets: [
                {
                  key: 'spreads',
                  outcomes: [
                    { name: 'Georgia', point: -6.5, price: -110 },
                    { name: 'Clemson', point: 6.5, price: -110 },
                  ],
                },
                {
                  key: 'h2h',
                  outcomes: [
                    { name: 'Georgia', price: -220 },
                    { name: 'Clemson', price: 180 },
                  ],
                },
              ],
            },
          ],
        },
      ]),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-requests-used': '5',
          'x-requests-remaining': '495',
          'x-requests-last': '1',
        },
      }
    );
  }) as typeof fetch;

  try {
    const res = await GET(
      new Request(`http://localhost/api/odds?year=${DURABLE_ODDS_TEST_SEASON}`)
    );
    assert.equal(res.status, 200);

    const json = (await res.json()) as {
      items: Array<{
        canonicalGameId: string;
        odds: { spread: number | null; lineSourceStatus: string };
      }>;
    };

    const regular = json.items.find((item) => item.canonicalGameId === '1-georgia-clemson-H');
    const championship = json.items.find(
      (item) => item.canonicalGameId === '2026-sec-championship'
    );

    assert.equal(regular?.odds.lineSourceStatus, 'closing');
    assert.equal(regular?.odds.spread, -3.5);
    assert.equal(championship?.odds.lineSourceStatus, 'latest');
    assert.equal(championship?.odds.spread, -6.5);

    const persistedRegular = await getDurableOddsRecord(
      DURABLE_ODDS_TEST_SEASON,
      '1-georgia-clemson-H'
    );
    const persistedChampionship = await getDurableOddsRecord(
      DURABLE_ODDS_TEST_SEASON,
      '2026-sec-championship'
    );

    assert.equal(persistedRegular?.closingSnapshot?.spread, -3.5);
    assert.equal(persistedChampionship?.latestSnapshot?.spread, -6.5);
    assert.equal(persistedChampionship?.closingSnapshot, null);
  } finally {
    global.fetch = originalFetch;
  }
});
