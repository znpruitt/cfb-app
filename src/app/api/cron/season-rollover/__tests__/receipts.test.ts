import assert from 'node:assert/strict';
import test from 'node:test';

// Install the global AsyncLocalStorage before the Next storage module loads so
// the route's `revalidateTag` (via invalidateStandings) runs under node:test.
import '../../../draft/[slug]/[year]/__tests__/_setup/installAsyncLocalStorage';
import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { GET } from '../route';
import type { League } from '../../../../../lib/league.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  __setAppStateWriteFailureForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import {
  __resetTeamDatabaseStoreForTests,
  setTeamDatabaseFile,
} from '../../../../../lib/server/teamDatabaseStore.ts';
import {
  installSchedulerReceiptDeferrer,
  readSchedulerReceipt,
  RECEIPT_KEYS,
} from '../../../../../test/schedulerReceiptTestHarness.ts';
import {
  buildSchedulerExecutionReceipt,
  parseSchedulerExecutionReceipt,
  recordSchedulerExecutionReceipt,
} from '../../../../../lib/server/schedulerExecutionStatus.ts';
import { summarizeReceiptTarget } from '../../../../../components/admin/systemHealth/systemHealthPresentation.ts';
import type { SeasonRolloverCronExecutionEvent } from '../../../../../lib/lifecycleCronExecutionLog.ts';

// PLATFORM-086F2E2A — durable receipts + one secret-safe runtime event for the
// season-rollover lifecycle cron. Existing rollover behavior stays pinned by
// route.test.ts unchanged; this suite proves ONLY the event + receipt contract.
// Rollover is cache-only, so `providerCallAttempted` is always false.

const CRON_SECRET = 'test-cron-secret';
const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_CONSOLE_LOG = console.log;

// A championship well past the 7-day rollover gate relative to the real clock.
const PAST_CHAMP = '2024-01-08T00:00:00.000Z';

let deferrer: ReturnType<typeof installSchedulerReceiptDeferrer>;

function makeLeague(slug: string, status: League['status'], year: number): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2022-01-01T00:00:00.000Z',
    status,
  };
}

/** Seed a structured, (optionally) final CFP championship for `year`. */
async function seedChampionship(year: number, champDate: string, final = true): Promise<void> {
  await setAppState('schedule', `${year}-all-all`, {
    items: [
      {
        id: `${year}0752`,
        week: 15,
        startDate: champDate,
        neutralSite: true,
        conferenceGame: false,
        homeTeam: 'Alpha U',
        awayTeam: 'Beta U',
        homeConference: 'SEC',
        awayConference: 'Big Ten',
        status: 'final',
        seasonType: 'postseason',
        gamePhase: 'postseason',
        postseasonSubtype: 'playoff',
        playoffRound: 'national_championship',
        playoffCompetition: 'College Football Playoff',
        playoffRoundSource: 'cfbd-structured',
      },
    ],
  });
  await setAppState('scores', `${year}-all-postseason`, {
    at: Date.parse(champDate),
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    items: [
      {
        id: `${year}0752`,
        seasonType: 'postseason',
        startDate: champDate,
        week: 15,
        status: final ? 'final' : 'in progress',
        home: { team: 'Alpha U', score: final ? 34 : 14 },
        away: { team: 'Beta U', score: final ? 21 : 10 },
        time: null,
      },
    ],
  });
}

async function seedTeams(): Promise<void> {
  await setTeamDatabaseFile({
    source: 'cfbd',
    updatedAt: '2023-01-01T00:00:00.000Z',
    items: [
      { school: 'Alpha U', conference: 'SEC' },
      { school: 'Beta U', conference: 'Big Ten' },
    ],
  });
}

function cronRequest(secret: string | null = CRON_SECRET): Request {
  const headers: Record<string, string> = {};
  if (secret) headers['authorization'] = `Bearer ${secret}`;
  return new Request('https://example.com/api/cron/season-rollover', { headers });
}

async function runRoute(req: Request = cronRequest()): Promise<{
  res: Response | null;
  event: SeasonRolloverCronExecutionEvent;
  threw: unknown;
  raw: string[];
}> {
  const raw: string[] = [];
  console.log = ((...args: unknown[]) => {
    raw.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }) as typeof console.log;
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  let res: Response | null = null;
  let threw: unknown = null;
  try {
    res = await workAsyncStorage.run(store as never, () => GET(req));
  } catch (error) {
    threw = error;
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }
  const events: SeasonRolloverCronExecutionEvent[] = [];
  for (const line of raw) {
    try {
      const parsed = JSON.parse(line) as { event?: string };
      if (parsed?.event === 'season-rollover-cron')
        events.push(parsed as SeasonRolloverCronExecutionEvent);
    } catch {
      /* not an event line */
    }
  }
  assert.equal(events.length, 1, `exactly one season-rollover-cron event (got ${events.length})`);
  return { res, event: events[0]!, threw, raw };
}

/**
 * Run GET WITHOUT a Next work store so `invalidateStandings` (revalidateTag)
 * throws — the app-state mutations (archive/status) still succeed, so a league
 * rolls but its standings invalidation fails.
 */
async function runRouteNoStore(req: Request = cronRequest()): Promise<{
  res: Response | null;
  event: SeasonRolloverCronExecutionEvent;
}> {
  const raw: string[] = [];
  console.log = ((...args: unknown[]) => {
    raw.push(args.map((a) => (typeof a === 'string' ? a : String(a))).join(' '));
  }) as typeof console.log;
  let res: Response | null = null;
  try {
    res = await GET(req);
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }
  const events: SeasonRolloverCronExecutionEvent[] = [];
  for (const line of raw) {
    try {
      const parsed = JSON.parse(line) as { event?: string };
      if (parsed?.event === 'season-rollover-cron')
        events.push(parsed as SeasonRolloverCronExecutionEvent);
    } catch {
      /* not an event line */
    }
  }
  assert.equal(events.length, 1, `exactly one season-rollover-cron event (got ${events.length})`);
  return { res, event: events[0]! };
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __resetTeamDatabaseStoreForTests();
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  deferrer = installSchedulerReceiptDeferrer();
});

test.afterEach(() => {
  deferrer.restore();
  __setAppStateReadFailureForTests(null);
  __setAppStateWriteFailureForTests(null);
  console.log = ORIGINAL_CONSOLE_LOG;
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  if (ORIGINAL_CRON_SECRET === undefined) delete MUTABLE_ENV.CRON_SECRET;
  else MUTABLE_ENV.CRON_SECRET = ORIGINAL_CRON_SECRET;
  console.log = ORIGINAL_CONSOLE_LOG;
});

async function seedPriorReceipt() {
  const receipt = buildSchedulerExecutionReceipt({
    job: 'season-rollover',
    invocationId: '33333333-3333-4333-8333-333333333333',
    startedAtMs: Date.now() - 60_000,
    completedAtMs: Date.now() - 59_000,
    result: 'success',
    reason: 'rollover-complete',
    providerCallAttempted: false,
    target: {
      kind: 'season-rollover-years',
      totalYears: 1,
      truncated: false,
      invalidLifecycleTargets: 0,
      years: [{ year: 2023, targetLeagues: 1, rolledOverLeagues: 1 }],
    },
  });
  assert.ok(receipt);
  await recordSchedulerExecutionReceipt(receipt);
  const stored = await readSchedulerReceipt('season-rollover');
  assert.ok(stored);
  return stored;
}

// 1 — auth failures: unchanged 401, one event, no receipt.
test('missing and invalid cron authorization: unchanged 401, one event, no receipt', async () => {
  const before = await seedPriorReceipt();

  delete MUTABLE_ENV.CRON_SECRET;
  const missing = await runRoute(cronRequest('anything'));
  assert.equal(missing.res!.status, 401);
  assert.equal(missing.event.result, 'failure');
  assert.equal(missing.event.reason, 'cron-secret-not-configured');
  assert.deepEqual(missing.event.years, []);

  MUTABLE_ENV.CRON_SECRET = CRON_SECRET;
  const invalid = await runRoute(cronRequest('wrong'));
  assert.equal(invalid.res!.status, 401);
  assert.equal(invalid.event.reason, 'cron-authorization-invalid');

  assert.equal(deferrer.count(), 0);
  await deferrer.flush();
  assert.deepEqual(
    await readSchedulerReceipt('season-rollover'),
    before,
    'prior receipt preserved'
  );
});

// 2 — no season groups: skipped event + receipt with zero years.
test('no season leagues: skipped/no-season-leagues event and receipt with zero years', async () => {
  await setAppState('leagues', 'registry', []);
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'no-season-leagues');
  assert.deepEqual(event.years, []);

  await deferrer.flush();
  const stored = await readSchedulerReceipt('season-rollover');
  assert.ok(stored);
  assert.deepEqual(Object.keys(stored.value).slice().sort(), RECEIPT_KEYS);
  assert.equal(stored.value.source, 'vercel-cron');
  assert.equal(stored.value.result, 'skipped');
  assert.equal(stored.value.reason, 'no-season-leagues');
  assert.equal(stored.value.providerCallAttempted, false);
  assert.deepEqual(stored.value.target, {
    kind: 'season-rollover-years',
    totalYears: 0,
    truncated: false,
    invalidLifecycleTargets: 0,
    years: [],
  });
});

// 3 — a championship-gate skip reason remains visible.
test('a not-final championship is a skipped year carrying the exact skip reason', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, false); // not final → skip
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'skipped');
  const year = event.years[0]!;
  assert.equal(year.result, 'skipped');
  assert.equal(year.reason, 'not-final');
  assert.equal(year.providerCallAttempted, false);
  assert.equal(year.rolledOverLeagues, 0);
});

// 4 — eligibility durable-read failure → failure / read-failed.
test('an eligibility read failure is failure/read-failed', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);
  __setAppStateReadFailureForTests(new Error('schedule read boom'), 'schedule');
  const { res, event } = await runRoute();
  __setAppStateReadFailureForTests(null);
  assert.equal(res!.status, 200, 'a per-year read failure is the detailed 200 response');
  assert.equal(event.result, 'failure');
  const year = event.years[0]!;
  assert.equal(year.result, 'failure');
  assert.equal(year.reason, 'read-failed');
});

// 5/9 — complete rollover → success/rollover-complete with truthful counts, provider flag false.
test('a complete rollover is success/rollover-complete with truthful counts and a provider-free receipt', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'success');
  const year = event.years[0]!;
  assert.equal(year.result, 'success');
  assert.equal(year.reason, 'rollover-complete');
  assert.equal(year.targetLeagues, 1);
  assert.equal(year.rolledOverLeagues, 1);
  assert.equal(year.providerCallAttempted, false);

  await deferrer.flush();
  const stored = await readSchedulerReceipt('season-rollover');
  assert.equal(stored?.value.result, 'success');
  assert.equal(stored?.value.providerCallAttempted, false);
  assert.deepEqual(stored?.value.target, {
    kind: 'season-rollover-years',
    totalYears: 1,
    truncated: false,
    invalidLifecycleTargets: 0,
    years: [{ year: 2023, targetLeagues: 1, rolledOverLeagues: 1 }],
  });
});

// 6 — mixed-year eligible + skipped aggregate to success (skip never degrades).
test('a mixed eligible/skipped multi-year run aggregates to success', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('rolls', { state: 'season', year: 2023 }, 2023),
    makeLeague('waits', { state: 'season', year: 2022 }, 2022),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true); // eligible → rolls
  await seedChampionship(2022, PAST_CHAMP, false); // not final → skip
  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'success', 'a skipped sibling never degrades the rolled year');
  assert.equal(event.years.length, 2);
  const byYear = new Map(event.years.map((y) => [y.year, y]));
  assert.equal(byYear.get(2023)!.result, 'success');
  assert.equal(byYear.get(2022)!.result, 'skipped');
  assert.equal(byYear.get(2022)!.reason, 'not-final');
});

// 7 — partial per-league rollover → partial / rollover-partial.
test('one league failing its archive while another rolls is partial/rollover-partial', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
    makeLeague('beta', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);
  // Fail ONLY beta's per-league archive write; alpha rolls cleanly.
  __setAppStateWriteFailureForTests(new Error('archive boom'), 'standings-archive:beta');
  const { res, event } = await runRoute();
  __setAppStateWriteFailureForTests(null);
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'partial');
  const year = event.years[0]!;
  assert.equal(year.result, 'partial');
  assert.equal(year.reason, 'rollover-partial');
  assert.equal(year.targetLeagues, 2);
  assert.equal(year.rolledOverLeagues, 1);

  await deferrer.flush();
  assert.equal((await readSchedulerReceipt('season-rollover'))?.value.reason, 'rollover-partial');
});

// 8 — all eligible work failing → failure / rollover-failed.
test('every league failing its archive is failure/rollover-failed', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);
  __setAppStateWriteFailureForTests(new Error('archive boom'), 'standings-archive:alpha');
  const { res, event } = await runRoute();
  __setAppStateWriteFailureForTests(null);
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'failure');
  const year = event.years[0]!;
  assert.equal(year.result, 'failure');
  assert.equal(year.reason, 'rollover-failed');
  assert.equal(year.rolledOverLeagues, 0);
});

// 10 — a throwing logger changes no response, and the receipt is still scheduled.
test('a throwing logger still schedules the receipt and changes no response or rollover', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);
  const store = {
    route: '/test',
    incrementalCache: {},
    pendingRevalidatedTags: [] as string[],
    pathWasRevalidated: false,
  };
  console.log = (() => {
    throw new Error('logger boom');
  }) as typeof console.log;
  let res: Response;
  try {
    res = await workAsyncStorage.run(store as never, () => GET(cronRequest()));
  } finally {
    console.log = ORIGINAL_CONSOLE_LOG;
  }
  const body = (await res.json()) as { success?: boolean; leaguesRolledOver?: string[] };
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.deepEqual(body.leaguesRolledOver, ['alpha'], 'the rollover still happened');
  assert.equal(deferrer.count(), 1);
  await deferrer.flush();
  assert.equal((await readSchedulerReceipt('season-rollover'))?.value.result, 'success');
});

// 11 — a receipt-store failure changes no response/archive/transition, and no marker leaks.
test('a receipt-store failure changes no response, and no slug/credential/error leaks', async () => {
  const CRON_MARKER = 'sekret-cron-MARKER';
  MUTABLE_ENV.CRON_SECRET = CRON_MARKER;
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('secret-slug-MARKER', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);
  __setAppStateWriteFailureForTests(new Error('receipt write boom'), 'scheduler-execution-status');
  const { res, event, raw } = await runRoute(cronRequest(CRON_MARKER));
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'success');
  await deferrer.flush();
  __setAppStateWriteFailureForTests(null);
  // The receipt-store write failed, so nothing persisted.
  assert.equal(await readSchedulerReceipt('season-rollover'), null);
  const serialized = raw.join('\n');
  assert.equal(
    Object.keys(event.years[0]!).slice().sort().join(','),
    [
      'providerCallAttempted',
      'reason',
      'result',
      'rolledOverLeagues',
      'suppressionCleared',
      'targetLeagues',
      'year',
    ]
      .sort()
      .join(',')
  );
  for (const marker of [CRON_MARKER, 'secret-slug-MARKER']) {
    assert.ok(!serialized.includes(marker), `no leak of ${marker}`);
  }
});

// Codex r3 finding A — a resolution THROW (structurally malformed cached
// schedule) records the failing year rather than omitting it from the receipt.
test('a championship-resolution throw records the failing year in the event/receipt', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  // A malformed schedule cache: a null item makes structured-championship
  // resolution throw AFTER the cache read succeeds (not a read-failed return).
  await setAppState('schedule', `2023-all-all`, { items: [null] });
  const { res, event, threw } = await runRoute();
  // The outer catch preserves the same 500; the event/receipt still include the year.
  assert.ok(res!.status === 500 || threw, 'a resolution throw is the existing 500 / propagation');
  assert.equal(event.years.length, 1, 'the failing year is NOT omitted');
  assert.equal(event.years[0]!.year, 2023);
  assert.equal(event.years[0]!.result, 'failure');
  assert.equal(event.years[0]!.reason, 'unexpected-error');

  await deferrer.flush();
  const stored = await readSchedulerReceipt('season-rollover');
  const target = stored!.value.target as { totalYears: number; years: Array<{ year: number }> };
  assert.equal(target.totalYears, 1, 'the receipt target retains the failing year');
  assert.deepEqual(
    target.years.map((y) => y.year),
    [2023]
  );
});

// Codex r3 finding B — a rolled league whose invalidateStandings throws is a
// per-year PARTIAL (not complete), consistent with the response's success:false.
test('an invalidation failure on a rolled league is partial/rollover-partial, not complete', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);
  // Running with no work store makes invalidateStandings (revalidateTag) throw
  // AFTER the league rolled (archive + status committed).
  const { res, event } = await runRouteNoStore();
  const body = (await res!.json()) as {
    success?: boolean;
    leaguesRolledOver?: string[];
    suppressionClearedFor?: string[];
  };
  assert.equal(res!.status, 200);
  assert.equal(body.success, false, 'the response reports the invalidation failure');
  assert.deepEqual(body.leaguesRolledOver, ['alpha'], 'the league still rolled');
  // The event/receipt must NOT claim complete when the response says failure.
  assert.equal(event.result, 'partial');
  const year = event.years[0]!;
  assert.equal(year.result, 'partial');
  assert.equal(year.reason, 'rollover-partial');
  assert.equal(year.rolledOverLeagues, 1);

  // CONTRACT PIN (PLATFORM-086F2H2B) — a cache-invalidation fault must not
  // suppress the DURABLE suppression clear. Before the `try/catch` split these
  // shared one catch ending in `continue`, so `suppressionCleared` was 0 here
  // and the outgoing season's insights suppression outlived the rollover. The
  // stated rule is "only after archive AND status succeeded"; both succeeded,
  // so clearing must run. This asserts the reported counter, not just the code
  // path — it is an operator-facing field on a durable receipt.
  assert.deepEqual(
    body.suppressionClearedFor,
    ['alpha'],
    'suppression clearing is not coupled to cache invalidation'
  );
  assert.equal(year.suppressionCleared, 1, 'the event reports the clear that happened');

  await deferrer.flush();
  assert.equal((await readSchedulerReceipt('season-rollover'))?.value.reason, 'rollover-partial');
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1R4 — the refusal count on the durable receipt.
//
// Routed through the REAL parser: the harness's `readSchedulerReceipt` is a raw
// read that validates nothing, so a "still parses" claim made against it would
// prove nothing.
// ---------------------------------------------------------------------------

/** A parse clock just after the hand-authored fixtures' `completedAt`. */
const R4_PARSE_NOW_MS = Date.parse('2026-01-20T00:00:05.000Z');

function legacyRolloverReceipt(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    job: 'season-rollover',
    invocationId: '77777777-7777-4777-8777-777777777777',
    source: 'vercel-cron',
    result: 'success',
    reason: 'rollover-complete',
    providerCallAttempted: false,
    startedAt: '2026-01-20T00:00:00.000Z',
    completedAt: '2026-01-20T00:00:01.000Z',
    durationMs: 1000,
    target: {
      kind: 'season-rollover-years',
      totalYears: 1,
      truncated: false,
      // `invalidLifecycleTargets` DELIBERATELY absent — the pre-R4 shape.
      years: [{ year: 2025, targetLeagues: 1, rolledOverLeagues: 1 }],
      ...(overrides.target as Record<string, unknown> | undefined),
    },
  };
}

// CONTRACT PIN — the TOP-LEVEL event key set, exactly.
//
// The per-year entry keys were already pinned, but nothing asserted the event's
// own key set — so R4 added a top-level field with no allowlist covering it. A
// future field carrying a slug or an unusable year value into the log line is
// precisely the leak class these allowlists exist to prevent.
test('R4 contract pin: the season-rollover event carries exactly the allowlisted top-level keys', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2025 }, 2025),
  ]);
  await seedTeams();

  const { event } = await runRoute();

  assert.deepEqual(Object.keys(event).sort(), [
    'durationMs',
    'event',
    'invalidLifecycleTargets',
    'reason',
    'result',
    'years',
  ]);
  const serialized = JSON.stringify(event);
  for (const canary of [CRON_SECRET, 'Bearer ', 'authorization']) {
    assert.ok(!serialized.includes(canary), `event must not contain ${canary}`);
  }
});

// CONTRACT PIN — a LEGACY receipt written before R4 omits the field and must
// still parse, normalizing to 0. Rejecting it would degrade the System Health
// row to `invalid` until the next cron run rewrote it.
test('R4 contract pin: a legacy rollover receipt omitting the count parses and normalizes to 0', () => {
  const parsed = parseSchedulerExecutionReceipt(
    legacyRolloverReceipt(),
    'season-rollover',
    R4_PARSE_NOW_MS
  );
  assert.ok(parsed, 'a pre-R4 receipt still parses');
  assert.equal(parsed.target.kind, 'season-rollover-years');
  if (parsed.target.kind !== 'season-rollover-years') return;
  assert.equal(parsed.target.invalidLifecycleTargets, 0, 'normalized, not rejected');
});

// REGRESSION TEST — an invalid PRESENT value rejects the whole record.
// Optional-on-read must not become "ignored on read": a corrupt count is
// corruption, and normalizing it would launder bad data into a clean row.
test('R4 regression: an invalid present count rejects the rollover receipt', () => {
  for (const bad of [-1, 1.5, '2', null, {}]) {
    const receipt = legacyRolloverReceipt({
      target: {
        kind: 'season-rollover-years',
        totalYears: 1,
        truncated: false,
        invalidLifecycleTargets: bad,
        years: [{ year: 2025, targetLeagues: 1, rolledOverLeagues: 1 }],
      },
    });
    assert.equal(
      parseSchedulerExecutionReceipt(receipt, 'season-rollover', R4_PARSE_NOW_MS),
      null,
      `a present ${JSON.stringify(bad)} is corruption, not absence`
    );
  }
});

// REGRESSION TEST — an all-refused run writes a receipt the real parser accepts
// with zero year entries and a truthful count.
test('R4 regression: an all-refused run writes a parseable receipt with the count', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: '2025' } as unknown as League['status'], 2025),
    makeLeague('bravo', { state: 'season', year: 2025.5 } as unknown as League['status'], 2025),
  ]);
  await seedTeams();

  const { event } = await runRoute();
  await deferrer.flush();

  assert.equal(event.reason, 'unusable-lifecycle-year');
  assert.equal(event.invalidLifecycleTargets, 2);

  const stored = await readSchedulerReceipt('season-rollover');
  assert.ok(stored, 'a receipt was written');
  const parsed = parseSchedulerExecutionReceipt(stored.value, 'season-rollover', Date.now());
  assert.ok(parsed, 'the REAL parser accepts it');
  assert.equal(parsed.target.kind, 'season-rollover-years');
  if (parsed.target.kind !== 'season-rollover-years') return;
  assert.equal(parsed.target.invalidLifecycleTargets, 2);
  assert.deepEqual(parsed.target.years, [], 'no year entry to poison the receipt');
});

// REGRESSION TEST — the System Health summary. The all-refused case closes the
// LAST branch of the dangling-colon deferral (R1 season-transition, R2
// schedule, R3 rankings, R4 rollover).
test('R4 regression: the rollover target summary handles clean, mixed, and all-refused', () => {
  assert.equal(
    summarizeReceiptTarget({
      kind: 'season-rollover-years',
      totalYears: 1,
      truncated: false,
      invalidLifecycleTargets: 0,
      years: [{ year: 2025, targetLeagues: 2, rolledOverLeagues: 2 }],
    }),
    '1 year(s): 2025 (2/2 leagues)',
    'a clean run renders exactly as it did pre-R4'
  );
  assert.equal(
    summarizeReceiptTarget({
      kind: 'season-rollover-years',
      totalYears: 1,
      truncated: false,
      invalidLifecycleTargets: 3,
      years: [{ year: 2025, targetLeagues: 2, rolledOverLeagues: 2 }],
    }),
    '1 year(s): 2025 (2/2 leagues) · 3 unusable lifecycle target(s)',
    'mixed appends the count at RUN level'
  );
  assert.equal(
    summarizeReceiptTarget({
      kind: 'season-rollover-years',
      totalYears: 0,
      truncated: false,
      invalidLifecycleTargets: 2,
      years: [],
    }),
    '0 year(s) · 2 unusable lifecycle target(s)',
    'all-refused: no dangling separator'
  );
});

// REGRESSION TEST (PLATFORM-086F2H2B) — the demo-only zero-target shape on the
// EVENT and the RECEIPT, not just the response body.
//
// The existing `no-season-leagues` test above seeds an EMPTY registry, where the
// reason is TRUE — which is precisely why this falsehood survived four merged
// R-slices that each touched this branch. The response body and the event carry
// the reason through separate expressions, so both must be pinned or a change to
// one alone ships silently.
test('F2H2B regression: a demo-only season registry reports the exclusion on the event and receipt', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('test', { state: 'season', year: 2025 }, 2025),
    makeLeague('alpha', { state: 'preseason', year: 2026 }, 2026),
  ]);

  const { event } = await runRoute();
  await deferrer.flush();

  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'no-automatic-season-leagues');
  assert.notEqual(
    event.reason,
    'no-season-leagues',
    'the demo IS in season — the event must not assert otherwise'
  );
  assert.deepEqual(event.years, [], 'no per-year entry is produced');

  const stored = await readSchedulerReceipt('season-rollover');
  assert.ok(stored, 'the receipt is still written');
  assert.equal(stored.value.reason, 'no-automatic-season-leagues', 'and carries the same truth');
});

// CONTRACT PIN — the honest reason survives on the event for a genuinely empty
// season registry, so the new branch cannot swallow the true case.
test('F2H2B contract pin: no season league at all still reports no-season-leagues on the event', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'preseason', year: 2026 }, 2026),
  ]);

  const { event } = await runRoute();
  assert.equal(event.reason, 'no-season-leagues');
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H4 — the STOP CONDITION for retiring `/admin/season`.
//
// `SeasonRolloverPanel` was the only surface that spelled out WHY a rollover was
// waiting (`describeManualRolloverReason` over `ChampionshipRolloverSkipReason`).
// Deleting it is only safe if that answer already survives on the durable
// receipt, which is what System Health's scheduler row renders.
//
// Proven here rather than argued from the type union: `SeasonRolloverCronYearReason`
// includes `ChampionshipRolloverSkipReason`, but a type is not evidence that the
// value survives the receipt writer's own validation and rebuild.
//
// The single-production-league case is the one that matters, because the
// run-level reason is `aggregateLifecycleCronReason` over the per-year entries —
// with one year it IS that year's reason, which is exactly the shape an operator
// with one league sees.
test('F2H4 stop condition: a waiting-period skip reaches the durable receipt reason', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  // Championship played, final — but inside the seven-day waiting period, so the
  // shared gate skips. `Date.now()` keeps this relative to the clock rather than
  // pinned to a date that would silently stop testing the waiting period.
  const justPlayed = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  await seedChampionship(2023, justPlayed, true);

  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'waiting-period', 'the run-level reason names the actual condition');

  await deferrer.flush();
  const stored = await readSchedulerReceipt('season-rollover');
  assert.equal(
    stored?.value.reason,
    'waiting-period',
    'and it survives onto the receipt System Health renders — so deleting the panel loses nothing'
  );
});

// POSITIVE CONTROL — the same fixture OUTSIDE the waiting period rolls over, so
// the assertion above is about the waiting period and not about this fixture
// being unable to roll at all.
test('F2H4 stop control: the same league past the waiting period does roll over', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
  ]);
  await seedChampionship(2023, PAST_CHAMP, true);

  const { res, event } = await runRoute();
  assert.equal(res!.status, 200);
  assert.notEqual(event.reason, 'waiting-period');
  assert.equal(event.result, 'success');
});

// PLATFORM-086F2H4 — the LIMIT of the stop condition above, pinned so it is a
// known gap rather than a rediscovery.
//
// The single-production-year case is the ordinary one, and there the run reason
// IS that year's reason. When production years disagree AND their gates skip for
// different reasons, `aggregateLifecycleCronReason` records `year-results` and
// the receipt target carries no per-year reason — so System Health cannot say
// why either year is waiting. The per-year reasons ARE still on the runtime
// event, so the information exists; it is not on the dashboard.
//
// This test documents the boundary. It does not endorse it: persisting per-year
// reasons onto the receipt is a recorded follow-up.
test('F2H4 known gap: mixed multi-year skips collapse to year-results on the receipt', async () => {
  await seedTeams();
  await setAppState('leagues', 'registry', [
    makeLeague('alpha', { state: 'season', year: 2023 }, 2023),
    makeLeague('bravo', { state: 'season', year: 2024 }, 2024),
  ]);
  // 2023 skips for `not-final`; 2024 skips inside the waiting period.
  await seedChampionship(2023, PAST_CHAMP, false);
  await seedChampionship(2024, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), true);

  const { event } = await runRoute();
  assert.equal(event.result, 'skipped');
  assert.equal(event.reason, 'year-results', 'the run reason cannot name two different causes');

  // The per-year reasons DO survive on the event — this is what keeps the gap a
  // dashboard limitation rather than a loss of information.
  assert.deepEqual(
    event.years.map((y) => y.reason).sort(),
    ['not-final', 'waiting-period'],
    'the runtime event still explains each year'
  );

  await deferrer.flush();
  const stored = await readSchedulerReceipt('season-rollover');
  assert.equal(stored?.value.reason, 'year-results');
  const target = stored!.value.target as { years: Array<Record<string, unknown>> };
  assert.ok(
    target.years.every((y) => !('reason' in y)),
    'the receipt target carries no per-year reason — that is the gap'
  );
});
