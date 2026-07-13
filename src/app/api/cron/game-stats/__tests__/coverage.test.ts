import assert from 'node:assert/strict';
import test from 'node:test';

// MUST precede the '../route' import: sets CFBD_API_KEY before the route captures
// it in a module-load-time constant, so the cron reaches its coverage-based skip
// decision instead of the missing-key early return (finding #3).
import './_setup/withCfbdKey';
import { GET as cronGet } from '../route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { getCachedGameStats, setCachedGameStats } from '../../../../../lib/gameStats/cache.ts';
import type { GameStats } from '../../../../../lib/gameStats/types.ts';

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const CRON_SECRET = 'test-cron-secret';
const ORIGINAL_FETCH = globalThis.fetch;

// Compute the season year exactly as the route does (seasonYearForToday), so the
// seeded schedule lands under the key the cron will read regardless of run date.
const YEAR = (() => {
  const d = new Date();
  const m = d.getUTCMonth();
  const y = d.getUTCFullYear();
  return m >= 6 ? y : y - 1;
})();
const WEEK = 3;
const COMPLETED_KICKOFF = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

function cronRequest(): Request {
  return new Request('https://example.com/api/cron/game-stats', {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}

function usableRow(providerGameId: number): GameStats {
  return {
    providerGameId,
    week: WEEK,
    seasonType: 'regular',
    home: { school: 'Alpha' } as GameStats['home'],
    away: { school: 'Beta' } as GameStats['away'],
  };
}

async function seedCompletedSchedule() {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: [
      {
        id: '5001',
        week: WEEK,
        seasonType: 'regular',
        startDate: COMPLETED_KICKOFF,
        neutralSite: false,
        conferenceGame: false,
        homeTeam: 'Alpha',
        awayTeam: 'Beta',
        homeConference: 'X',
        awayConference: 'Y',
        status: 'STATUS_FINAL',
      },
    ],
  });
}

function stubTeamStats() {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify([
        {
          id: 5001,
          teams: [
            { teamId: 1, team: 'Alpha', conference: 'X', homeAway: 'home', points: 21, stats: [] },
            { teamId: 2, team: 'Beta', conference: 'Y', homeAway: 'away', points: 14, stats: [] },
          ],
        },
      ]),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  globalThis.fetch = ORIGINAL_FETCH;
});

test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('the cron re-fetches a week whose cached record is empty (games:[]), not skips it (finding #3)', async () => {
  await seedCompletedSchedule();
  // A prior empty record must NOT count as coverage — the empty week should repair.
  await setCachedGameStats({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: '2020-01-01T00:00:00.000Z',
    games: [],
  });
  stubTeamStats();

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string; gamesProcessed?: number };
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.skipped, undefined, 'an empty cached record must not be treated as covered');
  assert.equal(body.gamesProcessed, 1, 'the cron re-fetched and persisted usable stats');

  const stored = await getCachedGameStats(YEAR, WEEK, 'regular');
  assert.equal(stored?.games.length, 1, 'the empty record was repaired with usable content');
});

test('the cron skips a week that already has usable cached stats (finding #3)', async () => {
  await seedCompletedSchedule();
  await setCachedGameStats({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    games: [usableRow(5001)],
  });
  // Fetch must NOT run when usable coverage already exists.
  globalThis.fetch = (async () => {
    throw new Error('cron must not fetch when usable stats already exist');
  }) as typeof fetch;

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.equal(res.status, 200);
  assert.match(String(body.skipped ?? ''), /already cached/i);
});
