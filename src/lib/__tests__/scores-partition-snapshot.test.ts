import test from 'node:test';
import assert from 'node:assert/strict';

import type { AppGame } from '../schedule.ts';
import { fetchScoresByGame } from '../scores.ts';
import type { TeamCatalogItem } from '../teamIdentity.ts';

// PLATFORM-086B2B — exact-partition cache-read mode + durable `snapshotAt`.
// Auto ticks read only the given `(providerWeek, seasonType)` partitions via
// week-scoped URLs (never season-wide, never `refresh=1`, never admin creds),
// and score loading reports the served-freshness `snapshotAt` = the OLDEST
// durable `meta.generatedAt` across the NONEMPTY contributing responses.

const teams: TeamCatalogItem[] = [
  { school: 'Alabama', level: 'FBS', conference: 'SEC' },
  { school: 'Georgia', level: 'FBS', conference: 'SEC' },
];

function game(overrides: Partial<AppGame> & { key: string }): AppGame {
  return {
    eventId: overrides.key,
    week: 9,
    providerWeek: 9,
    canonicalWeek: 9,
    date: '2025-11-01T18:00:00.000Z',
    stage: 'regular',
    status: 'scheduled',
    stageOrder: 1,
    slotOrder: 1,
    eventKey: overrides.key,
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
        displayName: 'Alabama',
        canonicalName: 'Alabama',
        rawName: 'Alabama',
      },
      away: {
        kind: 'team',
        teamId: 'a',
        displayName: 'Georgia',
        canonicalName: 'Georgia',
        rawName: 'Georgia',
      },
    },
    csvAway: 'Georgia',
    csvHome: 'Alabama',
    canAway: 'Georgia',
    canHome: 'Alabama',
    awayConf: 'SEC',
    homeConf: 'SEC',
    ...overrides,
  };
}

type Captured = { url: string; init?: RequestInit };

function withMockFetch(
  handler: (
    url: string,
    init: RequestInit | undefined
  ) => { items?: unknown[]; meta?: unknown } | { status: number },
  run: (captured: Captured[]) => Promise<void>
): Promise<void> {
  const captured: Captured[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: URL | string, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    captured.push({ url, init });
    const result = handler(url, init);
    if ('status' in result) {
      return new Response('upstream error', { status: result.status });
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return run(captured).finally(() => {
    globalThis.fetch = original;
  });
}

test('exact-partition mode reads only the given week-scoped partitions, never season-wide or refresh', async () => {
  await withMockFetch(
    () => ({ items: [], meta: { generatedAt: '2025-11-01T18:05:00.000Z' } }),
    async (captured) => {
      await fetchScoresByGame({
        games: [game({ key: 'g1' })],
        aliasMap: {},
        season: 2025,
        teams,
        partitions: [{ providerWeek: 9, seasonType: 'regular' }],
      });
      assert.equal(captured.length, 1, 'one request per partition — no season-wide call');
      const url = new URL(captured[0]!.url, 'http://localhost');
      assert.equal(url.searchParams.get('week'), '9');
      assert.equal(url.searchParams.get('year'), '2025');
      assert.equal(url.searchParams.get('seasonType'), 'regular');
      assert.equal(url.searchParams.get('refresh'), null, 'never a refresh in auto mode');
      // Cache-only durable-freshness hint (not a refresh): skips the route's
      // per-instance in-process copy so a cross-instance cron write is visible.
      assert.equal(url.searchParams.get('live'), '1', 'live durable-read hint present');
    }
  );
});

test('a failed requested partition suppresses snapshotAt (no global freshness on partial failure)', async () => {
  await withMockFetch(
    (url) => {
      const parsed = new URL(url, 'http://localhost');
      // The postseason partition read fails; the regular one succeeds nonempty.
      if (parsed.searchParams.get('seasonType') === 'postseason') {
        return { status: 503 };
      }
      return {
        items: [
          {
            id: 'r',
            status: 'Q4',
            home: 'Alabama',
            away: 'Georgia',
            homeScore: 7,
            awayScore: 3,
            time: null,
          },
        ],
        meta: { generatedAt: '2025-11-01T18:04:00.000Z' },
      };
    },
    async () => {
      const result = await fetchScoresByGame({
        games: [game({ key: 'g1' })],
        aliasMap: {},
        season: 2025,
        teams,
        partitions: [
          { providerWeek: 9, seasonType: 'regular' },
          { providerWeek: 1, seasonType: 'postseason' },
        ],
      });
      // The successful partition's rows are still applied, but the overlay must not
      // be marked fresh while a sibling partition's rows are stale.
      assert.equal(result.snapshotAt, null, 'any partition failure suppresses global freshness');
      assert.equal(result.liveObservedAt, null, 'partial reads cannot establish live observation');
      assert.ok(result.issues.some((i) => /postseason/.test(i)));
    }
  );
});

test('exact-partition mode carries the oldest clean live observation across every target', async () => {
  const older = '2025-11-01T18:03:00.000Z';
  const newer = '2025-11-01T18:04:00.000Z';
  await withMockFetch(
    (url) => {
      const parsed = new URL(url, 'http://localhost');
      return {
        items: [
          {
            id: parsed.searchParams.get('seasonType') === 'postseason' ? 'p' : 'r',
            status: 'Q4',
            home: 'Alabama',
            away: 'Georgia',
            homeScore: 7,
            awayScore: 3,
            time: null,
          },
        ],
        meta: {
          generatedAt: newer,
          liveObservedAt: parsed.searchParams.get('seasonType') === 'postseason' ? older : newer,
        },
      };
    },
    async () => {
      const result = await fetchScoresByGame({
        games: [game({ key: 'g1' })],
        aliasMap: {},
        season: 2025,
        teams,
        partitions: [
          { providerWeek: 9, seasonType: 'regular' },
          { providerWeek: 1, seasonType: 'postseason' },
        ],
      });

      assert.equal(result.liveObservedAt, older, 'the oldest exact-scope observation is the floor');
    }
  );
});

test('one partition without clean observation suppresses the combined live observation', async () => {
  await withMockFetch(
    (url) => {
      const parsed = new URL(url, 'http://localhost');
      return {
        items: [
          {
            id: parsed.searchParams.get('seasonType') === 'postseason' ? 'p' : 'r',
            status: 'Q4',
            home: 'Alabama',
            away: 'Georgia',
            homeScore: 7,
            awayScore: 3,
            time: null,
          },
        ],
        meta:
          parsed.searchParams.get('seasonType') === 'postseason'
            ? { generatedAt: '2025-11-01T18:04:00.000Z' }
            : {
                generatedAt: '2025-11-01T18:04:00.000Z',
                liveObservedAt: '2025-11-01T18:04:00.000Z',
              },
      };
    },
    async () => {
      const result = await fetchScoresByGame({
        games: [game({ key: 'g1' })],
        aliasMap: {},
        season: 2025,
        teams,
        partitions: [
          { providerWeek: 9, seasonType: 'regular' },
          { providerWeek: 1, seasonType: 'postseason' },
        ],
      });

      assert.equal(result.liveObservedAt, null);
    }
  );
});

test('exact-partition mode ignores refresh/authHeaders — the auto path is strictly cache-only', async () => {
  await withMockFetch(
    () => ({ items: [] }),
    async (captured) => {
      await fetchScoresByGame({
        games: [game({ key: 'g1' })],
        aliasMap: {},
        season: 2025,
        teams,
        // Even if a caller mistakenly passes these, partition mode drops them.
        refresh: true,
        authHeaders: { Authorization: 'Bearer admin-secret' },
        partitions: [{ providerWeek: 9, seasonType: 'regular' }],
      });
      const url = new URL(captured[0]!.url, 'http://localhost');
      assert.equal(url.searchParams.get('refresh'), null, 'no refresh=1 in partition mode');
      const headers = new Headers(captured[0]!.init?.headers);
      assert.equal(headers.get('Authorization'), null, 'no admin credentials forwarded');
    }
  );
});

test('snapshotAt is the OLDEST durable meta.generatedAt across nonempty contributors', async () => {
  const older = '2025-11-01T18:00:00.000Z';
  const newer = '2025-11-01T18:04:00.000Z';
  await withMockFetch(
    (url) => {
      const parsed = new URL(url, 'http://localhost');
      // Regular week-9 partition is newer; postseason week-1 partition is older.
      if (parsed.searchParams.get('seasonType') === 'postseason') {
        return {
          items: [
            {
              id: 'p',
              status: 'final',
              home: 'X',
              away: 'Y',
              homeScore: 1,
              awayScore: 0,
              time: null,
            },
          ],
          meta: { generatedAt: older },
        };
      }
      return {
        items: [
          {
            id: 'r',
            status: 'Q4',
            home: 'Alabama',
            away: 'Georgia',
            homeScore: 7,
            awayScore: 3,
            time: null,
          },
        ],
        meta: { generatedAt: newer },
      };
    },
    async () => {
      const result = await fetchScoresByGame({
        games: [game({ key: 'g1' })],
        aliasMap: {},
        season: 2025,
        teams,
        partitions: [
          { providerWeek: 9, seasonType: 'regular' },
          { providerWeek: 1, seasonType: 'postseason' },
        ],
      });
      assert.equal(result.snapshotAt, older, 'the least-fresh partition sets the freshness floor');
    }
  );
});

test('an empty/suppressed response never sets snapshotAt (its request-time meta is not freshness)', async () => {
  const fresh = '2025-11-01T18:04:00.000Z';
  await withMockFetch(
    (url) => {
      const parsed = new URL(url, 'http://localhost');
      if (parsed.searchParams.get('seasonType') === 'postseason') {
        // Empty response with a request-time meta — must be ignored for freshness.
        return { items: [], meta: { generatedAt: '2025-11-01T18:05:00.000Z' } };
      }
      return {
        items: [
          {
            id: 'r',
            status: 'Q4',
            home: 'Alabama',
            away: 'Georgia',
            homeScore: 7,
            awayScore: 3,
            time: null,
          },
        ],
        meta: { generatedAt: fresh },
      };
    },
    async () => {
      const result = await fetchScoresByGame({
        games: [game({ key: 'g1' })],
        aliasMap: {},
        season: 2025,
        teams,
        partitions: [
          { providerWeek: 9, seasonType: 'regular' },
          { providerWeek: 1, seasonType: 'postseason' },
        ],
      });
      assert.equal(result.snapshotAt, fresh, 'only the nonempty partition contributes freshness');
    }
  );

  // All-empty → no durable snapshot at all.
  await withMockFetch(
    () => ({ items: [], meta: { generatedAt: '2025-11-01T18:05:00.000Z' } }),
    async () => {
      const result = await fetchScoresByGame({
        games: [game({ key: 'g1' })],
        aliasMap: {},
        season: 2025,
        teams,
        partitions: [{ providerWeek: 9, seasonType: 'regular' }],
      });
      assert.equal(
        result.snapshotAt,
        null,
        'nothing durable contributed → null (caller preserves prior)'
      );
    }
  );
});

test('season-wide (hydration) mode also threads meta.generatedAt out as snapshotAt', async () => {
  const generatedAt = '2025-11-01T17:30:00.000Z';
  await withMockFetch(
    () => ({
      items: [
        {
          id: 'r',
          status: 'final',
          home: 'Alabama',
          away: 'Georgia',
          homeScore: 21,
          awayScore: 17,
          time: null,
        },
      ],
      meta: { generatedAt },
    }),
    async (captured) => {
      const result = await fetchScoresByGame({
        games: [game({ key: 'g1' })],
        aliasMap: {},
        season: 2025,
        teams,
        // No partitions → season-wide-first hydration path.
      });
      const first = new URL(captured[0]!.url, 'http://localhost');
      assert.equal(
        first.searchParams.get('week'),
        null,
        'hydration uses the season-wide URL first'
      );
      assert.equal(result.snapshotAt, generatedAt);
      assert.equal(result.liveObservedAt, null, 'hydration is not a live observation');
    }
  );
});
