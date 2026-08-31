import assert from 'node:assert/strict';
import test from 'node:test';

import { yearScope } from '../../providerRefreshScope.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  getAppState,
  setAppState,
} from '../../server/appStateStore.ts';
import { getProviderRefreshStatus } from '../../server/providerRefreshStatus.ts';
import { setDatasetAutoRefreshEnabled } from '../../server/providerRefreshSettings.ts';
import {
  normalizeTeamRecordsPayload,
  readTeamRecordsCache,
  type TeamRecordsCacheEntry,
} from '../teamRecordsCache.ts';
import {
  refreshTeamRecords,
  TEAM_RECORDS_MAX_CACHE_AGE_MS,
  TEAM_RECORDS_MIN_REFRESH_INTERVAL_MS,
  TEAM_RECORDS_REFRESH_CONTROL_SCOPE,
} from '../teamRecordsRefresh.ts';

const YEAR = 2026;
const NOW = Date.parse('2026-09-06T06:00:00.000Z');
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.CFBD_API_KEY;

function providerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    year: YEAR,
    teamId: 333,
    team: 'Alabama',
    classification: 'fbs',
    conference: 'SEC',
    total: { games: 2, wins: 2, losses: 0, ties: 0 },
    homeGames: { games: 1, wins: 1, losses: 0, ties: 0 },
    rawProviderField: 'must not persist',
    ...overrides,
  };
}

function stubRecords(payload: unknown): string[] {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return urls;
}

function normalizedItem(): TeamRecordsCacheEntry['items'][number] {
  const normalized = normalizeTeamRecordsPayload([providerRow()], YEAR);
  assert.equal(normalized.kind, 'rows');
  if (normalized.kind !== 'rows' || !normalized.items[0]) {
    throw new Error('expected provider row to normalize');
  }
  return normalized.items[0];
}

test.beforeEach(async () => {
  process.env.CFBD_API_KEY = 'test-cfbd-key';
  globalThis.fetch = ORIGINAL_FETCH;
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.CFBD_API_KEY;
  else process.env.CFBD_API_KEY = ORIGINAL_KEY;
});

test('normalization persists only the year/team/classification/conference/total allowlist', () => {
  const normalized = normalizeTeamRecordsPayload([providerRow()], YEAR);
  assert.equal(normalized.kind, 'rows');
  if (normalized.kind !== 'rows') return;
  assert.deepEqual(normalized.items, [
    {
      year: YEAR,
      teamId: 333,
      team: 'Alabama',
      classification: 'fbs',
      conference: 'SEC',
      total: { games: 2, wins: 2, losses: 0, ties: 0 },
    },
  ]);
  assert.ok(!JSON.stringify(normalized.items).includes('rawProviderField'));
  assert.ok(!JSON.stringify(normalized.items).includes('homeGames'));
});

test('non-array is invalid and nonempty all-invalid rows are schema drift', () => {
  assert.deepEqual(normalizeTeamRecordsPayload({ data: [] }, YEAR), {
    kind: 'invalid-payload',
  });
  assert.deepEqual(normalizeTeamRecordsPayload([{ wrong: 'shape' }], YEAR), {
    kind: 'schema-drift',
  });
  assert.deepEqual(normalizeTeamRecordsPayload([], YEAR), { kind: 'rows', items: [] });
});

test('the reader passes a conforming row and preserves ties in the outcome sum', async () => {
  const tied = normalizedItem();
  tied.total = { games: 3, wins: 1, losses: 1, ties: 1 };
  await setAppState('team-records', String(YEAR), {
    at: NOW,
    year: YEAR,
    items: [tied],
  });

  const cache = await readTeamRecordsCache(YEAR);
  assert.equal(cache?.items[0]?.teamId, tied.teamId);
  assert.equal(cache?.items[0]?.total.ties, 1);
  assert.deepEqual(cache?.uncreditableTeamIds, []);
});

test('the reader distinguishes an absent cache from a present uncreditable row', async () => {
  assert.equal(await readTeamRecordsCache(YEAR), null);

  const pendingOutcome = normalizedItem();
  pendingOutcome.total = { games: 1, wins: 0, losses: 0, ties: 0 };
  await setAppState('team-records', String(YEAR), {
    at: NOW,
    year: YEAR,
    items: [pendingOutcome],
  });

  const cache = await readTeamRecordsCache(YEAR);
  assert.ok(cache, 'a provider snapshot remains present even when no row is creditable');
  assert.deepEqual(cache.items, []);
  assert.deepEqual(cache.uncreditableTeamIds, [pendingOutcome.teamId]);
});

test('a year refresh writes the cache and its independent year status', async () => {
  const urls = stubRecords([providerRow()]);

  const result = await refreshTeamRecords({
    year: YEAR,
    clock: () => NOW,
  });

  assert.equal(result.reason, 'written-clean');
  assert.equal(result.providerCallAttempted, true);
  assert.equal(result.rowsCommitted, 1);
  assert.deepEqual(urls, [`https://api.collegefootballdata.com/records?year=${YEAR}`]);
  const cache = await readTeamRecordsCache(YEAR);
  assert.equal(cache?.at, NOW);
  assert.equal(cache?.items[0]?.total.wins, 2);
  const status = await getProviderRefreshStatus('records', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'succeeded');
  assert.equal(status.rowsCommitted, 1);
  assert.equal(
    await getProviderRefreshStatus('scores', yearScope(YEAR)).then(
      (scoreStatus) => scoreStatus.latestAttemptOutcome
    ),
    null,
    'records success cannot establish scores health'
  );
});

test('the durable floor starts at the actual records call, not the cron entry instant', async () => {
  const urls = stubRecords([providerRow()]);
  const providerCallAt = NOW + 40_000;
  let clockReads = 0;

  const result = await refreshTeamRecords({
    year: YEAR,
    // First read models route/refresh entry; the second is immediately before
    // the durable provider-call claim after upstream score work has completed.
    clock: () => (clockReads++ === 0 ? NOW : providerCallAt),
  });

  assert.equal(result.reason, 'written-clean');
  assert.equal(
    (await readTeamRecordsCache(YEAR))?.at,
    providerCallAt,
    'the cache observation is anchored to the actual /records request'
  );
  const control = await getAppState<{ lastProviderCallAt: number }>(
    TEAM_RECORDS_REFRESH_CONTROL_SCOPE,
    String(YEAR)
  );
  assert.equal(
    control?.value.lastProviderCallAt,
    providerCallAt,
    'the six-hour floor is anchored to the actual /records request'
  );

  const tooSoon = await refreshTeamRecords({
    year: YEAR,
    clock: () => providerCallAt + SIX_HOURS_MS - 1,
  });
  assert.equal(tooSoon.reason, 'fresh-cache');
  assert.equal(urls.length, 1);
});

test('an arbitrary completed prior year refreshes without canonical schedule or season context', async () => {
  const priorYear = 2024;
  const urls = stubRecords([providerRow({ year: priorYear })]);

  const result = await refreshTeamRecords({
    year: priorYear,
    clock: () => NOW,
  });

  assert.equal(result.reason, 'written-clean');
  assert.deepEqual(urls, [`https://api.collegefootballdata.com/records?year=${priorYear}`]);
  assert.equal((await readTeamRecordsCache(priorYear))?.items[0]?.teamId, 333);
  assert.equal(
    (await getProviderRefreshStatus('records', yearScope(priorYear))).latestAttemptOutcome,
    'succeeded'
  );
  assert.equal(
    await getAppState('schedule', `${priorYear}-all-all`),
    null,
    'the refresh neither requires nor creates canonical schedule context'
  );
});

test('a records failure marks only records unhealthy, never scores', async () => {
  const urls = stubRecords({ wrong: 'top-level shape' });

  const result = await refreshTeamRecords({
    year: YEAR,
    clock: () => NOW,
  });

  assert.equal(result.reason, 'invalid-payload');
  assert.equal(urls.length, 1);
  const recordsStatus = await getProviderRefreshStatus('records', yearScope(YEAR));
  assert.equal(recordsStatus.latestAttemptOutcome, 'failed');
  assert.equal(recordsStatus.lastError?.code, 'records-invalid-payload');
  const scoresStatus = await getProviderRefreshStatus('scores', yearScope(YEAR));
  assert.equal(
    scoresStatus.latestAttemptOutcome,
    null,
    'a records-only provider failure must not mark scores unhealthy'
  );
});

test('the records operator toggle suppresses only the records call', async () => {
  await setDatasetAutoRefreshEnabled('records', false);
  const urls = stubRecords([providerRow()]);

  const result = await refreshTeamRecords({
    year: YEAR,
    clock: () => NOW,
  });

  assert.equal(result.reason, 'automation-paused-or-disabled');
  assert.deepEqual(urls, []);
  assert.equal(
    (await getProviderRefreshStatus('records', yearScope(YEAR))).latestAttemptOutcome,
    null
  );
});

test('the durable lease prevents overlapping calls for the same year', async () => {
  let releaseProvider!: () => void;
  const providerGate = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    await providerGate;
    return new Response(JSON.stringify([providerRow()]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  const first = refreshTeamRecords({
    year: YEAR,
    clock: () => NOW,
  });
  for (let i = 0; i < 50 && urls.length === 0; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(urls.length, 1, 'the first invocation reached the provider under its lease');

  const overlapping = await refreshTeamRecords({
    year: YEAR,
    clock: () => NOW + 1,
  });
  assert.equal(overlapping.reason, 'refresh-in-progress');
  assert.equal(urls.length, 1, 'the overlapping invocation spent no second provider call');

  releaseProvider();
  assert.equal((await first).reason, 'written-clean');
});

test('the six-hour floor suppresses a dense-Saturday finalisation call', async () => {
  assert.equal(
    TEAM_RECORDS_MIN_REFRESH_INTERVAL_MS,
    SIX_HOURS_MS,
    'the production cadence floor stays fixed at six hours'
  );
  const prior: TeamRecordsCacheEntry = {
    at: NOW - SIX_HOURS_MS + 1,
    year: YEAR,
    items: [normalizedItem()],
  };
  await setAppState('team-records', String(YEAR), prior);
  const urls = stubRecords([providerRow({ total: { games: 3, wins: 3, losses: 0, ties: 0 } })]);

  const result = await refreshTeamRecords({
    year: YEAR,
    clock: () => NOW,
  });

  assert.equal(result.reason, 'fresh-cache');
  assert.deepEqual(urls, []);
  assert.equal((await readTeamRecordsCache(YEAR))?.at, prior.at);
});

test('the twelve-hour ceiling refreshes without a finalisation observation', async () => {
  assert.equal(
    TEAM_RECORDS_MAX_CACHE_AGE_MS,
    TWELVE_HOURS_MS,
    'the independent production cache-age ceiling stays fixed at twelve hours'
  );
  const prior: TeamRecordsCacheEntry = {
    at: NOW - TWELVE_HOURS_MS,
    year: YEAR,
    items: [normalizedItem()],
  };
  await setAppState('team-records', String(YEAR), prior);
  const urls = stubRecords([providerRow({ total: { games: 3, wins: 3, losses: 0, ties: 0 } })]);

  const result = await refreshTeamRecords({
    year: YEAR,
    finalizationObserved: false,
    clock: () => NOW,
  });

  assert.equal(
    result.reason,
    'written-clean',
    'only the ceiling can make a no-finalisation invocation refresh'
  );
  assert.equal(result.providerCallAttempted, true);
  assert.equal(urls.length, 1);
});

test('a failed provider call still starts the durable six-hour floor', async () => {
  const urls = stubRecords({ wrong: 'top-level shape' });

  const first = await refreshTeamRecords({ year: YEAR, clock: () => NOW });
  const second = await refreshTeamRecords({
    year: YEAR,
    clock: () => NOW + 3 * 60 * 1000,
  });

  assert.equal(first.reason, 'invalid-payload');
  assert.equal(second.reason, 'provider-call-floor-active');
  assert.equal(
    urls.length,
    1,
    'a failed records response cannot retry every three-minute cron run'
  );
});

test('a zero-row response cannot overwrite a populated prior-good cache', async () => {
  const normalized = normalizeTeamRecordsPayload([providerRow()], YEAR);
  assert.equal(normalized.kind, 'rows');
  if (normalized.kind !== 'rows') return;
  const prior: TeamRecordsCacheEntry = {
    at: NOW - SIX_HOURS_MS,
    year: YEAR,
    items: normalized.items,
  };
  await setAppState('team-records', String(YEAR), prior);
  const urls = stubRecords([]);

  const result = await refreshTeamRecords({
    year: YEAR,
    clock: () => NOW,
  });

  assert.equal(result.reason, 'empty-replacement-rejected');
  assert.equal(urls.length, 1);
  assert.deepEqual(await readTeamRecordsCache(YEAR), {
    ...prior,
    uncreditableTeamIds: [],
  });
  const status = await getProviderRefreshStatus('records', yearScope(YEAR));
  assert.equal(status.latestAttemptOutcome, 'failed');
  assert.equal(status.lastError?.code, 'records-empty-replacement-rejected');
});
