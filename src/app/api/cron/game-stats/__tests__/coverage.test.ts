import assert from 'node:assert/strict';
import test from 'node:test';

// MUST precede the '../route' import: sets CFBD_API_KEY before the route captures
// it in a module-load-time constant, so the cron reaches its coverage-based skip
// decision instead of the missing-key early return (finding #3).
import './_setup/withCfbdKey';
import { GET as cronGet } from '../route';
import { GET as manualGet } from '../../../game-stats/route';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import { getCachedGameStats, setCachedGameStats } from '../../../../../lib/gameStats/cache.ts';
import type { GameStats } from '../../../../../lib/gameStats/types.ts';
import {
  beginProviderRefreshAttempt,
  getProviderRefreshStatus,
  recordProviderRefreshFailure,
} from '../../../../../lib/server/providerRefreshStatus.ts';
import { weekPartitionScope, yearScope } from '../../../../../lib/providerRefreshScope.ts';

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

// Schedule fixtures use REAL catalog teams: expected coverage now requires each
// participant to resolve canonically (catalog/alias) or classify FCS — a made-up
// label with an unknown conference is correctly non-expected.
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
        homeTeam: 'Alabama',
        awayTeam: 'Georgia',
        homeConference: 'SEC',
        awayConference: 'SEC',
        status: 'STATUS_FINAL',
      },
    ],
  });
}

type ScheduleSeed = {
  id: string;
  week: number;
  startDate: string;
  status: string;
  seasonType?: 'regular' | 'postseason';
  homeTeam?: string;
  awayTeam?: string;
  homeConference?: string;
  awayConference?: string;
};

async function seedScheduleItems(items: ScheduleSeed[]) {
  await setAppState('schedule', `${YEAR}-all-all`, {
    at: Date.now(),
    partialFailure: false,
    failedSeasonTypes: [],
    items: items.map((it) => ({
      id: it.id,
      week: it.week,
      seasonType: it.seasonType ?? 'regular',
      startDate: it.startDate,
      neutralSite: false,
      conferenceGame: false,
      // Real catalog teams by default — see seedCompletedSchedule.
      homeTeam: it.homeTeam ?? 'Alabama',
      awayTeam: it.awayTeam ?? 'Georgia',
      homeConference: it.homeConference ?? 'SEC',
      awayConference: it.awayConference ?? 'SEC',
      status: it.status,
    })),
  });
}

type CronWeekResult = {
  week: number;
  seasonType: string;
  outcome: string;
  detail?: string;
  rowsCommitted?: number;
};

type CronBody = {
  year: number;
  results: CronWeekResult[];
  gamesProcessed: number;
  skipped?: string;
  error?: string;
};

function resultFor(body: CronBody, week: number, seasonType = 'regular'): CronWeekResult {
  const found = body.results.find((r) => r.week === week && r.seasonType === seasonType);
  assert.ok(found, `expected a result for week ${week} ${seasonType}: ${JSON.stringify(body)}`);
  return found;
}

const DAYS_AGO = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

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

function stubJson(body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

function stubThrow(message: string) {
  globalThis.fetch = (async () => {
    throw new Error(message);
  }) as typeof fetch;
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
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.skipped, undefined, 'an empty cached record must not be treated as covered');
  assert.equal(body.gamesProcessed, 1, 'the cron re-fetched and persisted usable stats');
  assert.equal(resultFor(body, WEEK).outcome, 'committed');

  const stored = await getCachedGameStats(YEAR, WEEK, 'regular');
  assert.equal(stored?.games.length, 1, 'the empty record was repaired with usable content');
});

test('the cron skips a week the completeness contract proves complete (findings #3/#5)', async () => {
  await seedCompletedSchedule();
  await setCachedGameStats({
    year: YEAR,
    week: WEEK,
    seasonType: 'regular',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    games: [usableRow(5001)],
  });
  // Fetch must NOT run when every expected game already has usable coverage.
  globalThis.fetch = (async () => {
    throw new Error('cron must not fetch when the week is complete');
  }) as typeof fetch;

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200);
  assert.match(String(body.skipped ?? ''), /complete/i);
  assert.equal(resultFor(body, WEEK).outcome, 'skipped-complete');
});

// 5th-review finding #1 — disrupted-only slates are never selected for retrieval.
test('the cron does not select a disrupted-only latest slate; it picks the older eligible one', async () => {
  await seedScheduleItems([
    // Latest completed slate (week 5) is entirely disrupted → not stat-producing.
    { id: '9001', week: 5, startDate: DAYS_AGO(2), status: 'Canceled' },
    { id: '9002', week: 5, startDate: DAYS_AGO(2), status: 'Postponed' },
    // Older completed slate (week 3) has a real final game → eligible.
    { id: '5001', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
  ]);
  stubTeamStats();

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(resultFor(body, 3).outcome, 'committed', 'the eligible week 3 is recovered');
  assert.equal(
    body.results.find((r) => r.week === 5),
    undefined,
    'the disrupted-only week 5 is never a candidate'
  );
  assert.equal(body.gamesProcessed, 1);
});

test('a disrupted-only schedule yields no eligible slate and spends no provider call', async () => {
  await seedScheduleItems([
    { id: '9001', week: 5, startDate: DAYS_AGO(2), status: 'Canceled' },
    { id: '9002', week: 5, startDate: DAYS_AGO(2), status: 'Suspended' },
  ]);
  stubThrow('cron must not fetch when no stat-producing slate exists');

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as { skipped?: string };
  assert.equal(res.status, 200);
  assert.match(String(body.skipped ?? ''), /no completed weeks/i);
});

// 5th-review finding #5 — empty/nonempty-zero provider responses.
test('a genuinely empty provider response resolves as a no-op without a durable write', async () => {
  await seedCompletedSchedule();
  stubJson([]); // CFBD returns [] — stats not published yet
  const res = await cronGet(cronRequest());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.gamesProcessed, 0);
  assert.equal(resultFor(body, WEEK).outcome, 'noop');

  assert.equal(await getCachedGameStats(YEAR, WEEK, 'regular'), null, 'no empty record written');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'no-op');
  assert.equal(status.lastSuccessAt, null, 'a no-op does not advance last-success');
});

// SCOPED-STATUS review v2 #1 — the resolved week partition owns the outcome, and
// a later successful run of the same week replaces a prior failure through normal
// attempt ordering.
test('a later successful run replaces a prior failure on the same week partition', async () => {
  await seedCompletedSchedule();
  const scope = weekPartitionScope(YEAR, WEEK, 'regular');
  // A prior failed attempt on this exact week scope (e.g. an earlier missing-key run).
  const priorFail = await beginProviderRefreshAttempt('game-stats', scope, {
    attemptId: 'prior-fail',
  });
  await recordProviderRefreshFailure('game-stats', scope, {
    attempt: priorFail,
    error: 'CFBD_API_KEY not configured',
    code: 'cfbd-api-key-missing',
    status: 500,
  });
  assert.equal(
    (await getProviderRefreshStatus('game-stats', scope)).latestAttemptOutcome,
    'failed',
    'precondition: the week scope starts failed'
  );

  stubTeamStats();
  const res = await cronGet(cronRequest());
  assert.equal(res.status, 200, await res.text());

  const status = await getProviderRefreshStatus('game-stats', scope);
  assert.equal(status.latestAttemptOutcome, 'succeeded', 'the later success replaces the failure');
  assert.equal(status.lastError, null);
});

// SCOPED-STATUS review v2 #3 — a local target-resolution failure uses the
// established cron error path and never assigns the failure to an unrelated year
// or week data scope.
test('a target-resolution read failure returns 500 and mutates no game-stats scope', async () => {
  await seedCompletedSchedule();
  // Fail ONLY 'schedule' reads (findLatestCompletedWeek) while provider-refresh
  // status reads still succeed for the assertions.
  __setAppStateReadFailureForTests(new Error('schedule read down'), 'schedule');
  let res: Response;
  try {
    res = await cronGet(cronRequest());
  } finally {
    __setAppStateReadFailureForTests(null);
  }
  assert.equal(res.status, 500);

  const yearRollup = await getProviderRefreshStatus('game-stats', yearScope(YEAR));
  assert.equal(yearRollup.latestAttemptOutcome, null, 'no year-scope failure fabricated');
  const week = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(week.latestAttemptOutcome, null, 'no week-scope failure fabricated');
});

test('a nonempty payload that normalizes to zero usable rows resolves as failure (no write)', async () => {
  await seedCompletedSchedule();
  // A row missing its away team is dropped by normalization → zero usable rows.
  stubJson([{ id: 5001, teams: [{ team: 'Alpha', homeAway: 'home', points: 21, stats: [] }] }]);

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 502, JSON.stringify(body));
  assert.equal(body.error, 'game-stats-no-usable-rows');
  assert.equal(resultFor(body, WEEK).outcome, 'failed');

  assert.equal(await getCachedGameStats(YEAR, WEEK, 'regular'), null, 'no unusable record written');
  const status = await getProviderRefreshStatus(
    'game-stats',
    weekPartitionScope(YEAR, WEEK, 'regular')
  );
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'game-stats-no-usable-rows');
});

// === PLATFORM-086H — schedule-relative completeness, retry, and safe merge ===

/** Wire fixture: a usable CFBD /games/teams row for the given provider game id. */
function rawGame(id: number, home = `Home ${id}`, away = `Away ${id}`) {
  return {
    id,
    teams: [
      { teamId: id * 10 + 1, team: home, conference: 'X', homeAway: 'home', points: 21, stats: [] },
      { teamId: id * 10 + 2, team: away, conference: 'Y', homeAway: 'away', points: 14, stats: [] },
    ],
  };
}

/** Stub CFBD, serving per-week payloads and recording the requested weeks. */
function stubWeeklyPayloads(payloads: Record<string, unknown>): { requested: string[] } {
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    const key = `${url.searchParams.get('week')}:${url.searchParams.get('seasonType')}`;
    requested.push(key);
    return new Response(JSON.stringify(payloads[key] ?? []), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { requested };
}

test('a partial stored week stays incomplete and is retried; recovery merges with prior-good rows', async () => {
  // Week 3 expects two games; only 5001 is cached → partial, NOT complete.
  await seedScheduleItems([
    { id: '5001', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
    { id: '5002', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
  ]);
  await setCachedGameStats({
    year: YEAR,
    week: 3,
    seasonType: 'regular',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    games: [usableRow(5001)],
  });
  // The recovery response carries ONLY the missing game — the prior row must survive.
  stubJson([rawGame(5002)]);

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(resultFor(body, 3).outcome, 'committed');
  assert.equal(resultFor(body, 3).rowsCommitted, 1);

  const stored = await getCachedGameStats(YEAR, 3, 'regular');
  assert.deepEqual(
    stored?.games.map((g) => g.providerGameId).sort(),
    [5001, 5002],
    'the recovered row merged in; the prior-good row was not deleted'
  );
});

test('an empty recovery response for a partial week retains prior-good rows (no-op)', async () => {
  await seedScheduleItems([
    { id: '5001', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
    { id: '5002', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
  ]);
  await setCachedGameStats({
    year: YEAR,
    week: 3,
    seasonType: 'regular',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    games: [usableRow(5001)],
  });
  stubJson([]);

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(resultFor(body, 3).outcome, 'noop');

  const stored = await getCachedGameStats(YEAR, 3, 'regular');
  assert.deepEqual(
    stored?.games.map((g) => g.providerGameId),
    [5001],
    'prior-good rows survive an empty recovery response'
  );
});

test('a recovery response identical to the cached rows is a no-change (no rewrite)', async () => {
  await seedScheduleItems([
    { id: '5001', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
    { id: '5002', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
  ]);
  stubJson([rawGame(5001)]);
  // First run commits 5001 (the week stays partial — 5002 is still missing).
  const first = (await (await cronGet(cronRequest())).json()) as CronBody;
  assert.equal(resultFor(first, 3).outcome, 'committed');
  const committed = await getCachedGameStats(YEAR, 3, 'regular');

  // Second run re-fetches the still-partial week; identical data must not rewrite.
  stubJson([rawGame(5001)]);
  const second = (await (await cronGet(cronRequest())).json()) as CronBody;
  assert.equal(resultFor(second, 3).outcome, 'no-change');

  const after = await getCachedGameStats(YEAR, 3, 'regular');
  assert.equal(
    after?.fetchedAt,
    committed?.fetchedAt,
    'identical provider data does not rewrite the durable record'
  );
});

test('every incomplete completed week is a recovery candidate; complete weeks are skipped', async () => {
  // Week 4 (newest) is fully covered; weeks 3 and 2 are incomplete.
  await seedScheduleItems([
    { id: '4001', week: 4, startDate: DAYS_AGO(3), status: 'STATUS_FINAL' },
    { id: '3001', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
    { id: '2001', week: 2, startDate: DAYS_AGO(17), status: 'STATUS_FINAL' },
  ]);
  await setCachedGameStats({
    year: YEAR,
    week: 4,
    seasonType: 'regular',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    games: [usableRow(4001)],
  });
  const stub = stubWeeklyPayloads({
    '3:regular': [rawGame(3001)],
    '2:regular': [rawGame(2001)],
  });

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(resultFor(body, 4).outcome, 'skipped-complete', 'the complete week spends no call');
  assert.equal(resultFor(body, 3).outcome, 'committed');
  assert.equal(resultFor(body, 2).outcome, 'committed');
  assert.deepEqual(
    stub.requested,
    ['3:regular', '2:regular'],
    'one bounded call per incomplete week, newest first'
  );
});

test('unresolved placeholders, canceled games, and FCS-vs-FCS pairings never block completeness', async () => {
  await seedScheduleItems([
    { id: '5001', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
    // Unresolved postseason-style placeholder participant.
    { id: '5002', week: 3, startDate: DAYS_AGO(10), status: 'scheduled', awayTeam: 'TBD' },
    // Canceled: terminal, non-stat-producing.
    { id: '5003', week: 3, startDate: DAYS_AGO(10), status: 'Canceled' },
    // Positively classified FCS-vs-FCS.
    {
      id: '5004',
      week: 3,
      startDate: DAYS_AGO(10),
      status: 'STATUS_FINAL',
      homeConference: 'Big Sky',
      awayConference: 'Big Sky',
    },
  ]);
  await setCachedGameStats({
    year: YEAR,
    week: 3,
    seasonType: 'regular',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    games: [usableRow(5001)],
  });
  stubThrow('cron must not fetch: the only expected game is already covered');

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(resultFor(body, 3).outcome, 'skipped-complete');
});

test('a resolved postseason matchup is expected; its incomplete week is recovered', async () => {
  await seedScheduleItems([
    {
      id: '7001',
      week: 1,
      seasonType: 'postseason',
      startDate: DAYS_AGO(4),
      status: 'STATUS_FINAL',
      homeTeam: 'Alabama',
      awayTeam: 'Georgia',
    },
  ]);
  stubJson([rawGame(7001, 'Alabama', 'Georgia')]);

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(resultFor(body, 1, 'postseason').outcome, 'committed');
  const stored = await getCachedGameStats(YEAR, 1, 'postseason');
  assert.equal(stored?.games.length, 1);
});

// Review remediation — synthetic schedule ids (CFBD omitted `game.id`) are
// unverifiable: coverage rows can never match them, so they must not create a
// permanent expectation the cron re-fetches every week.
test('a synthetic schedule id never creates a false expectation or endless recovery', async () => {
  await seedScheduleItems([
    { id: '5001', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
    // mapCfbdScheduleGame fallback shape when CFBD omits game.id.
    { id: '3-Home-Away', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
  ]);
  await setCachedGameStats({
    year: YEAR,
    week: 3,
    seasonType: 'regular',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    games: [usableRow(5001)],
  });
  stubThrow('cron must not fetch: the only verifiable expected game is covered');

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(
    resultFor(body, 3).outcome,
    'skipped-complete',
    'the unverifiable synthetic-id row stays out of the completeness denominator'
  );
});

// Review remediation — a malformed keyless provider row (negative/non-numeric
// id) is never persisted, so repeated recovery of a still-incomplete week
// cannot accumulate duplicates.
test('a keyless malformed provider row is never persisted and cannot accumulate across runs', async () => {
  await seedScheduleItems([
    { id: '3001', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
    { id: '3002', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
  ]);
  const malformed = {
    id: -5,
    teams: [
      { teamId: 91, team: 'Junk A', conference: 'X', homeAway: 'home', points: 1, stats: [] },
      { teamId: 92, team: 'Junk B', conference: 'Y', homeAway: 'away', points: 2, stats: [] },
    ],
  };
  stubJson([rawGame(3001), malformed]);
  const first = (await (await cronGet(cronRequest())).json()) as CronBody;
  assert.equal(resultFor(first, 3).outcome, 'committed');
  assert.deepEqual(
    (await getCachedGameStats(YEAR, 3, 'regular'))?.games.map((g) => g.providerGameId),
    [3001],
    'the keyless row is dropped at merge time'
  );

  // The still-partial week is retried with the SAME malformed payload.
  stubJson([rawGame(3001), malformed]);
  const second = (await (await cronGet(cronRequest())).json()) as CronBody;
  assert.equal(resultFor(second, 3).outcome, 'no-change');
  assert.deepEqual(
    (await getCachedGameStats(YEAR, 3, 'regular'))?.games.map((g) => g.providerGameId),
    [3001],
    'repeated recovery does not accumulate malformed duplicates'
  );
});

// Review remediation — the completion cutoff applies to the WHOLE slate (shared
// deriveCompletedSlates): a finished Thursday game must not make the week a
// candidate while a Saturday game is pending or less than six hours old.
test('a split slate becomes a candidate only after its latest game passes the cutoff', async () => {
  const HOURS_AGO = (n: number) => new Date(Date.now() - n * 60 * 60 * 1000).toISOString();
  await seedScheduleItems([
    // Thursday final, long finished.
    { id: '7001', week: 7, startDate: DAYS_AGO(3), status: 'STATUS_FINAL' },
    // Saturday game only 2h old — the slate is still active.
    { id: '7002', week: 7, startDate: HOURS_AGO(2), status: 'STATUS_FINAL' },
  ]);
  stubThrow('cron must not fetch a still-active slate');

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.match(
    String(body.skipped ?? ''),
    /no completed weeks/i,
    'the Thursday final alone must not complete the week'
  );

  // Once the latest game passes the 6h cutoff, the slate is eligible.
  await seedScheduleItems([
    { id: '7001', week: 7, startDate: DAYS_AGO(3), status: 'STATUS_FINAL' },
    { id: '7002', week: 7, startDate: HOURS_AGO(7), status: 'STATUS_FINAL' },
  ]);
  stubJson([rawGame(7001), rawGame(7002)]);
  const eligible = await cronGet(cronRequest());
  const eligibleBody = (await eligible.json()) as CronBody;
  assert.equal(eligible.status, 200, JSON.stringify(eligibleBody));
  assert.equal(resultFor(eligibleBody, 7).outcome, 'committed');
});

// Review remediation — the read→merge→write critical section is shared by the
// cron and the manual route, so overlapping refreshes produce the UNION.
test('an overlapping cron and manual refresh adding different games produce the union', async () => {
  await seedScheduleItems([
    { id: '5001', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
    { id: '5002', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
  ]);
  // Serve a DIFFERENT game to each request so a lost update would be visible.
  const payloads = [[rawGame(5001)], [rawGame(5002)]];
  let call = 0;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payloads[Math.min(call++, payloads.length - 1)]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

  const priorNodeEnv = MUTABLE_ENV.NODE_ENV;
  const priorAdminToken = MUTABLE_ENV.ADMIN_API_TOKEN;
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = 'test-admin-token';
  try {
    const manualRequest = new Request(
      `https://example.com/api/game-stats?year=${YEAR}&week=3&seasonType=regular&bypassCache=1`,
      { headers: { 'x-admin-token': 'test-admin-token' } }
    );
    const [cronRes, manualRes] = await Promise.all([
      cronGet(cronRequest()),
      manualGet(manualRequest),
    ]);
    assert.equal(cronRes.status, 200, await cronRes.clone().text());
    assert.equal(manualRes.status, 200, await manualRes.clone().text());
  } finally {
    if (priorNodeEnv === undefined) delete MUTABLE_ENV.NODE_ENV;
    else MUTABLE_ENV.NODE_ENV = priorNodeEnv;
    if (priorAdminToken === undefined) delete MUTABLE_ENV.ADMIN_API_TOKEN;
    else MUTABLE_ENV.ADMIN_API_TOKEN = priorAdminToken;
  }

  const stored = await getCachedGameStats(YEAR, 3, 'regular');
  assert.deepEqual(
    stored?.games.map((g) => g.providerGameId).sort(),
    [5001, 5002],
    'neither overlapping refresh lost the other one’s row'
  );
});

test('an unusable recovery row never clobbers the usable prior row for the same game', async () => {
  await seedScheduleItems([
    { id: '5001', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
    { id: '5002', week: 3, startDate: DAYS_AGO(10), status: 'STATUS_FINAL' },
  ]);
  await setCachedGameStats({
    year: YEAR,
    week: 3,
    seasonType: 'regular',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    games: [usableRow(5001)],
  });
  // 5001 comes back with blank team identities (unusable); 5002 is usable.
  stubJson([rawGame(5001, '', ''), rawGame(5002)]);

  const res = await cronGet(cronRequest());
  const body = (await res.json()) as CronBody;
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(resultFor(body, 3).outcome, 'committed');

  const stored = await getCachedGameStats(YEAR, 3, 'regular');
  const row5001 = stored?.games.find((g) => g.providerGameId === 5001);
  assert.equal(row5001?.home.school, 'Alpha', 'the usable prior row survives the unusable update');
  assert.ok(
    stored?.games.some((g) => g.providerGameId === 5002),
    'the usable new row is merged in'
  );
});
