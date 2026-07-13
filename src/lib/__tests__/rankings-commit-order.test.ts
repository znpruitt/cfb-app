import assert from 'node:assert/strict';
import test from 'node:test';

import { loadSeasonRankings, __resetSeasonRankingsCacheForTests } from '../server/rankings.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateWriteFailureForTests,
  getAppState,
  setAppState,
} from '../server/appStateStore.ts';
import { getProviderRefreshStatus } from '../server/providerRefreshStatus.ts';
import type { RankingsResponse } from '../rankings.ts';

// ---------------------------------------------------------------------------
// PLATFORM-085A — durable-first commit order for the rankings provider cache.
// An authorized rankings refresh must persist durably BEFORE publishing to the
// process-local CACHE, so a failed durable write never leaves this instance
// serving "fresh" rankings other instances can't reproduce.
// ---------------------------------------------------------------------------

const SEASON = 2026;
const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_CFBD_KEY = process.env.CFBD_API_KEY;

// A CFBD regular-season rankings payload that normalizes to a usable week (real
// team names so the identity resolver resolves them). An EMPTY payload is now a
// no-op that never persists (5th-review finding #6), so the durable-first commit
// path needs genuine content to exercise.
const RANKINGS_PAYLOAD = [
  {
    season: SEASON,
    seasonType: 'regular',
    week: 1,
    polls: [
      {
        poll: 'AP Top 25',
        ranks: [
          { rank: 1, school: 'Georgia', conference: 'SEC' },
          { rank: 2, school: 'Michigan', conference: 'Big Ten' },
        ],
      },
    ],
  },
];

// A NONEMPTY raw payload whose ranks carry no usable school, so it normalizes to
// ZERO usable weeks — schema drift, NOT valid absence (6th-review finding #1).
const DRIFT_PAYLOAD = [
  {
    season: SEASON,
    seasonType: 'regular',
    week: 1,
    polls: [{ poll: 'AP Top 25', ranks: [{ rank: 1, school: '', conference: null }] }],
  },
];

// A usable postseason payload (real team names → resolves to a usable week).
const POSTSEASON_USABLE = [
  {
    season: SEASON,
    seasonType: 'postseason',
    week: 1,
    polls: [{ poll: 'AP Top 25', ranks: [{ rank: 1, school: 'Georgia', conference: 'SEC' }] }],
  },
];

function stubRankings(opts: { regular: unknown; postseason: unknown }) {
  global.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body =
      url.searchParams.get('seasonType') === 'postseason' ? opts.postseason : opts.regular;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetSeasonRankingsCacheForTests();
  __setAppStateWriteFailureForTests(null);
  process.env.CFBD_API_KEY = 'test-cfbd-token';
  // CFBD rankings upstream returns a usable regular-season poll (empty postseason),
  // so the refresh builds and persists a nonempty response.
  global.fetch = (async (input: URL | string) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const body = url.searchParams.get('seasonType') === 'postseason' ? [] : RANKINGS_PAYLOAD;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});

test.after(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_CFBD_KEY === undefined) delete process.env.CFBD_API_KEY;
  else process.env.CFBD_API_KEY = ORIGINAL_CFBD_KEY;
  __setAppStateWriteFailureForTests(null);
  __resetSeasonRankingsCacheForTests();
});

test('rankings refresh: a durable write failure does not publish process-local fresh rankings', async () => {
  __setAppStateWriteFailureForTests(new Error('durable write unavailable'));
  try {
    await assert.rejects(() => loadSeasonRankings(SEASON, { allowRefresh: true }));
  } finally {
    __setAppStateWriteFailureForTests(null);
  }

  // Durable store never received the entry.
  assert.equal(await getAppState('rankings', String(SEASON)), null);

  // A subsequent non-refresh read must NOT serve fresh rankings from the
  // process cache (it was never populated) — with nothing cached it demands an
  // admin refresh instead of returning a poisoned hit.
  await assert.rejects(() => loadSeasonRankings(SEASON), /admin refresh required/);
});

test('rankings refresh: a successful durable write publishes to the process cache', async () => {
  const first = await loadSeasonRankings(SEASON, { allowRefresh: true });
  assert.equal(first.meta.cache, 'miss');

  // Durable persisted, and a non-refresh read is now served from the process
  // cache as a hit.
  assert.ok(await getAppState('rankings', String(SEASON)));
  const second = await loadSeasonRankings(SEASON);
  assert.equal(second.meta.cache, 'hit');
});

test('rankings refresh: a missing CFBD key records a failed attempt (rereview finding #5)', async () => {
  delete process.env.CFBD_API_KEY;
  await assert.rejects(
    () => loadSeasonRankings(SEASON, { allowRefresh: true }),
    /CFBD_API_KEY missing/
  );
  const status = await getProviderRefreshStatus('rankings');
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'cfbd-api-key-missing');
});

// ---------------------------------------------------------------------------
// 5th-review finding #6 — empty rankings responses are classified before
// persistence: pre-poll empty → no-op (never persisted as healthy coverage),
// unexpected empty over prior-good → failure (prior-good retained).
// ---------------------------------------------------------------------------

function stubEmptyRankings() {
  global.fetch = (async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

function populatedRankings(): RankingsResponse {
  return {
    weeks: [
      {
        season: SEASON,
        week: 1,
        seasonType: 'regular',
        primarySource: 'ap',
        teams: [
          {
            teamId: 'georgia',
            teamName: 'Georgia',
            rank: 1,
            rankSource: 'ap',
            primaryRank: 1,
            primaryRankSource: 'ap',
          },
        ],
        polls: { cfp: [], ap: [], coaches: [] },
      },
    ],
    latestWeek: null,
    meta: { source: 'cfbd', cache: 'miss', generatedAt: '2026-01-01T00:00:00.000Z' },
  };
}

test('rankings refresh: a valid pre-poll empty resolves as a no-op without persisting', async () => {
  stubEmptyRankings();
  const response = await loadSeasonRankings(SEASON, { allowRefresh: true });
  assert.deepEqual(response.weeks, [], 'an empty pre-poll response returns no weeks');

  // Nothing durable was written (no empty "healthy" snapshot).
  assert.equal(await getAppState('rankings', String(SEASON)), null);
  const status = await getProviderRefreshStatus('rankings');
  assert.equal(status.latestAttemptOutcome, 'no-op');
  assert.equal(status.lastSuccessAt, null, 'a no-op does not advance last-success');
});

test('rankings refresh: an unexpected empty over prior-good preserves it and records failure', async () => {
  // Prior-good durable rankings for this season.
  await setAppState('rankings', String(SEASON), {
    at: Date.parse('2026-01-01T00:00:00.000Z'),
    response: populatedRankings(),
  });
  __resetSeasonRankingsCacheForTests(); // force the durable read
  stubEmptyRankings();

  const response = await loadSeasonRankings(SEASON, { allowRefresh: true });
  // Prior-good rankings are served (stale), not replaced with an empty snapshot.
  assert.equal(response.weeks.length, 1, 'prior-good weeks are retained and served');

  const durable = await getAppState<{ response: RankingsResponse }>('rankings', String(SEASON));
  assert.equal(durable?.value?.response?.weeks?.length, 1, 'durable rankings not overwritten');

  const status = await getProviderRefreshStatus('rankings');
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'rankings-empty-replacement-rejected');
});

// ---------------------------------------------------------------------------
// 6th-review finding #1 — partitions are validated INDEPENDENTLY before combining.
// A nonempty raw payload normalizing to zero usable weeks is schema drift; one
// healthy partition can never mask a drifted one, and drift is never a no-op.
// ---------------------------------------------------------------------------

test('rankings refresh: a drifted regular partition rejects even when postseason is usable', async () => {
  // Prior-good so the reject serves stale rather than throwing.
  await setAppState('rankings', String(SEASON), {
    at: Date.parse('2026-01-01T00:00:00.000Z'),
    response: populatedRankings(),
  });
  __resetSeasonRankingsCacheForTests();
  stubRankings({ regular: DRIFT_PAYLOAD, postseason: POSTSEASON_USABLE });

  const response = await loadSeasonRankings(SEASON, { allowRefresh: true });
  // Usable postseason must NOT mask the regular drift — the aggregate is rejected
  // and prior-good is served, never a silently-incomplete (postseason-only) commit.
  assert.equal(response.weeks.length, 1, 'prior-good retained, not an incomplete commit');

  const durable = await getAppState<{ response: RankingsResponse }>('rankings', String(SEASON));
  assert.equal(durable?.value?.response?.weeks?.length, 1, 'durable rankings not overwritten');

  const status = await getProviderRefreshStatus('rankings');
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'rankings-partition-schema-drift');
  assert.deepEqual(status.failedPartitions, ['regular']);
});

test('rankings refresh: a drifted postseason partition rejects even when regular is usable', async () => {
  // No prior-good → the reject surfaces as a hard failure (throws).
  stubRankings({ regular: RANKINGS_PAYLOAD, postseason: DRIFT_PAYLOAD });
  await assert.rejects(
    () => loadSeasonRankings(SEASON, { allowRefresh: true }),
    /partition schema drift/
  );
  assert.equal(await getAppState('rankings', String(SEASON)), null, 'nothing committed');
  const status = await getProviderRefreshStatus('rankings');
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.deepEqual(status.failedPartitions, ['postseason']);
  // 7th-review finding #3: the outer catch must NOT overwrite the specific code
  // with a generic one when the drift branch already resolved the attempt.
  assert.equal(status.lastError?.code, 'rankings-partition-schema-drift');
  assert.match(status.lastError?.message ?? '', /schema drift/);
});

test('rankings refresh: both partitions drifting with no prior cache is a failure, not a no-op', async () => {
  stubRankings({ regular: DRIFT_PAYLOAD, postseason: DRIFT_PAYLOAD });
  await assert.rejects(
    () => loadSeasonRankings(SEASON, { allowRefresh: true }),
    /partition schema drift/
  );
  assert.equal(await getAppState('rankings', String(SEASON)), null, 'nothing committed');
  const status = await getProviderRefreshStatus('rankings');
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.deepEqual(status.failedPartitions, ['regular', 'postseason']);
  assert.equal(status.lastError?.code, 'rankings-partition-schema-drift');
});

test('rankings refresh: a generic provider failure still records a generic (non-drift) code', async () => {
  // A network/HTTP failure is NOT drift — it must record through the generic outer
  // catch, and must not masquerade with the drift code.
  global.fetch = (async () =>
    new Response('upstream unavailable', { status: 503 })) as typeof fetch;
  await assert.rejects(() => loadSeasonRankings(SEASON, { allowRefresh: true }));
  const status = await getProviderRefreshStatus('rankings');
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.notEqual(status.lastError?.code, 'rankings-partition-schema-drift');
});

test('rankings refresh: usable regular + genuinely empty postseason commits successfully', async () => {
  // The normal mid-season case: regular usable, postseason raw-empty (pre-bowls).
  // Empty postseason is valid absence, NOT drift — the refresh commits.
  stubRankings({ regular: RANKINGS_PAYLOAD, postseason: [] });
  const response = await loadSeasonRankings(SEASON, { allowRefresh: true });
  assert.equal(response.meta.cache, 'miss');
  assert.ok(response.weeks.length >= 1, 'usable regular weeks committed');
  const status = await getProviderRefreshStatus('rankings');
  assert.equal(status.latestAttemptOutcome, 'succeeded');
});
