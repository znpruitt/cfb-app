import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../server/appStateStore.ts';
import { beginProviderRefreshAttempt } from '../../server/providerRefreshStatus.ts';
import { oddsTargetScope } from '../../providerRefreshScope.ts';
import { createTeamIdentityResolver } from '../../teamIdentity.ts';
import { executeOddsRefresh } from '../oddsRefreshExecutor.ts';
import { defaultOddsCacheKey } from '../../../app/api/odds/routeInternals.ts';
import type { SharedOddsCacheEntry } from '../../../app/api/odds/routeInternals.ts';

// ---------------------------------------------------------------------------
// PLATFORM-089 follow-up — the AUTOMATIC downgrade of an unexpected empty.
//
// When prior rows vanish and no game is near enough to expect lines, the
// automatic path records a no-op instead of a billed fault. That decision has a
// fail-closed condition: it requires POSITIVE evidence that nothing is near.
// `nearHorizonGameCount === 0` alone is ambiguous — an unreadable or empty slate
// yields zero because nothing could be counted, not because nothing is there.
//
// Tested HERE, at the executor, because it is unreachable through the cron: an
// empty slate produces no eligible game, so the cron skips before any provider
// call. The route-level suites cover the manual path, which is unchanged.
// ---------------------------------------------------------------------------

const YEAR = 2026;
const KEY = defaultOddsCacheKey(YEAR);
const SCOPE = oddsTargetScope(YEAR, 'canonical', KEY);
const ORIGINAL_FETCH = globalThis.fetch;
const IN_20_DAYS = () => new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
});

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

/** A prior-good entry holding one line for a game 20 days out. */
async function seedPriorLines(): Promise<void> {
  const entry: SharedOddsCacheEntry = {
    data: [
      {
        homeTeam: 'Georgia Bulldogs',
        awayTeam: 'Clemson Tigers',
        commenceTime: IN_20_DAYS(),
        bookmakers: [],
      },
    ] as never,
    lastFetch: Date.now() - 60_000,
    usage: null,
  };
  await setAppState('odds-cache', KEY, entry);
}

async function runAutomatic(evidence: {
  scheduleItems: unknown[] | null;
  resolver: unknown;
}): Promise<{ status: string; reason: string }> {
  const attempt = await beginProviderRefreshAttempt('odds', SCOPE, {
    startedAt: new Date().toISOString(),
  });
  const execution = await executeOddsRefresh({
    mode: 'automatic',
    season: YEAR,
    seasonScopedKey: KEY,
    isCanonical: true,
    scope: SCOPE,
    attempt,
    apiKey: 'test-key',
    query: { bookmakers: ['draftkings'], markets: ['spreads'], regions: ['us'] },
    observationAt: new Date().toISOString(),
    now: new Date().toISOString(),
    retry: {
      maxAttempts: 1,
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterRatio: 0,
      retryOnHttpStatuses: [],
    },
    emptyClassificationEvidence: evidence as never,
    resolveCanonicalInputs: async () => ({ available: true, games: [], resolver: null as never }),
  });
  return { status: execution.result.status, reason: execution.result.reason };
}

test('an UNREADABLE slate keeps the conservative fault — zero is not proof of absence', async () => {
  await seedPriorLines();
  const result = await runAutomatic({ scheduleItems: null, resolver: null });
  assert.equal(result.status, 'failure');
  assert.equal(
    result.reason,
    'odds-empty-unexpected',
    'a slate we could not read must never read as "nothing is near"'
  );
});

test('an EMPTY slate keeps the conservative fault — a real season slate is never empty', async () => {
  await seedPriorLines();
  const resolver = createTeamIdentityResolver({
    teams: [] as never,
    aliasMap: {},
    observedNames: [],
  });
  const result = await runAutomatic({ scheduleItems: [], resolver });
  assert.equal(result.status, 'failure');
  assert.equal(result.reason, 'odds-empty-unexpected');
});

// POSITIVE CONTROL — the same call downgrades when the evidence IS available and
// positively shows nothing near. Without this, the two assertions above would
// pass just as happily against a downgrade that never fires at all.
test('a POPULATED slate with nothing near downgrades to the recorded no-op', async () => {
  await seedPriorLines();
  const teamsRaw = await fs.readFile(path.join(process.cwd(), 'src/data/teams.json'), 'utf8');
  const teams = (JSON.parse(teamsRaw) as { items?: unknown[] }).items ?? [];
  const resolver = createTeamIdentityResolver({
    teams: teams as never,
    aliasMap: {},
    observedNames: ['Georgia', 'Clemson', 'Georgia Bulldogs', 'Clemson Tigers'],
  });
  const result = await runAutomatic({
    scheduleItems: [
      {
        id: 'g1',
        week: 1,
        homeTeam: 'Georgia',
        awayTeam: 'Clemson',
        startDate: IN_20_DAYS(),
        status: 'scheduled',
      },
    ],
    resolver,
  });
  assert.equal(result.status, 'no-op');
  assert.equal(result.reason, 'early-lines-withdrawn');
});
