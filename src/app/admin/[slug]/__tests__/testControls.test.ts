import assert from 'node:assert/strict';
import test from 'node:test';

// `runWithRevalidateContext` installs the global AsyncLocalStorage before the
// Next storage module loads, so the server actions' `revalidatePath` runs under
// the bare node:test runner. Imported rather than re-implemented — the store
// shape is a Next internal, and one copy is enough to maintain.
import {
  runCapturingRevalidatedTags,
  runWithRevalidateContext as runInNextContext,
} from '../../../api/draft/[slug]/[year]/__tests__/_setup/revalidateContext';
import { __withAdminActionAuthorizerForTests } from '../../../../lib/auth/requireAdminAction.ts';
import { standingsSlugTag } from '../../../../lib/selectors/leagueStandings.ts';

/**
 * Authorized run with NO Next revalidation context — the realistic post-commit
 * cache fault.
 *
 * The first version of this helper made only the standings TAG fail, by
 * overriding `push` for `standings:*`. Review caught that: `revalidateTag` and
 * `revalidatePath` share one store, so the fault that actually occurs takes
 * BOTH, and an isolated tag failure is not something production produces. Under
 * the old code the unguarded `revalidatePath` then threw and the action
 * rejected, so `cacheStale` was unreachable outside that artificial fixture.
 *
 * Running with no store at all reproduces the real shape.
 */
function runWithBrokenRevalidation<T>(fn: () => Promise<T>): Promise<T> {
  return __withAdminActionAuthorizerForTests(() => true, fn);
}

/** Authorized variant that also reports the tags the action revalidated. */
function runAuthorizedCapturingTags<T>(fn: () => Promise<T>) {
  return __withAdminActionAuthorizerForTests(
    () => true,
    () => runCapturingRevalidatedTags(fn)
  );
}

/**
 * PLATFORM-086F2H1SB — every action in this suite now authorizes itself, and
 * the bare test runner has no Clerk request context. Authorize once here so the
 * existing behavioral assertions keep testing what they were written to test.
 * Refusal is covered separately, against the REAL fail-closed authorizer.
 */
function runWithRevalidateContext<T>(fn: () => Promise<T>): Promise<T> {
  return __withAdminActionAuthorizerForTests(
    () => true,
    () => runInNextContext(fn)
  );
}

import { autoCompleteDraft, resetTestLeague, setTestLeagueStatus } from '../actions';
import { TEST_LEAGUE_SLUG, type League } from '../../../../lib/league.ts';
import { TEST_LEAGUE_RESET_YEAR } from '../../../../lib/leagueRegistry.ts';
import { draftScope, type DraftState } from '../../../../lib/draft.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
  getAppState,
  setAppState,
} from '../../../../lib/server/appStateStore.ts';
import type { ScheduleProbeState } from '../../../../lib/scheduleProbe.ts';
import { isDraftPublished } from '../../../../lib/selectors/draftPublication.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1T1 — the demo-league sandbox controls.
//
// Two properties are load-bearing:
//   1. The lifecycle year is derived by the AUTHORITY under the registry lock,
//      and the action clears state for the year the authority returned — never
//      a locally recomputed one, and never before the commit is confirmed.
//   2. A demo reset touches demo-SCOPED state only. It previously deleted
//      `schedule-probe/<year>`, which is keyed by year alone and shared with
//      every production league.
// ---------------------------------------------------------------------------

function makeLeague(slug: string, year: number, status?: League['status']): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...(status !== undefined ? { status } : {}),
  };
}

async function seed(...leagues: League[]): Promise<void> {
  await setAppState('leagues', 'registry', leagues);
}

async function readRegistry(): Promise<League[]> {
  const record = await getAppState<League[]>('leagues', 'registry');
  return record?.value ?? [];
}

async function readLeague(slug: string): Promise<League | undefined> {
  return (await readRegistry()).find((l) => l.slug === slug);
}

/** A started demo draft with no picks, ready for `autoCompleteDraft`. */
async function seedLiveDemoDraft(year: number): Promise<void> {
  await setAppState(draftScope(TEST_LEAGUE_SLUG), String(year), {
    leagueSlug: TEST_LEAGUE_SLUG,
    year,
    phase: 'live',
    owners: ['Alice', 'Bob'],
    settings: {
      style: 'snake',
      draftOrder: ['Alice', 'Bob'],
      pickTimerSeconds: null,
      timerExpiryBehavior: 'pause-and-prompt',
      totalRounds: 1,
      scheduledAt: null,
    },
    picks: [],
    currentPickIndex: 0,
    timerState: 'off',
    timerExpiresAt: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  });
}

/** Seed the demo-scoped records the controls are expected to clear. */
async function seedDemoScopes(year: number): Promise<void> {
  await setAppState(`preseason-owners:${TEST_LEAGUE_SLUG}`, String(year), ['Alice', 'Bob']);
  await setAppState(`owners:${TEST_LEAGUE_SLUG}:${year}`, 'csv', 'team,owner\nTexas,Alice');
  await setAppState(draftScope(TEST_LEAGUE_SLUG), String(year), { phase: 'complete' });
}

async function demoScopesPresent(year: number): Promise<boolean[]> {
  return [
    (await getAppState(`preseason-owners:${TEST_LEAGUE_SLUG}`, String(year))) !== null,
    (await getAppState(`owners:${TEST_LEAGUE_SLUG}:${year}`, 'csv')) !== null,
    (await getAppState(draftScope(TEST_LEAGUE_SLUG), String(year))) !== null,
  ];
}

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(() => {
  __resetAppStateForTests();
});

// CONTRACT PIN, not a mutation-verified regression guard. The retired local
// derivation and the authority's produce the SAME year for every stored shape
// (season, preseason, offseason, missing), so no single-threaded test can tell
// them apart — the change is WHERE derivation happens (inside the registry lock
// rather than from a React-`cache`d read), and only concurrency demonstrates
// that. What this pins is that cleanup follows the authority's answer and
// touches no other year.
test('preseason cleanup targets the year the AUTHORITY resolved', async () => {
  // Deliberately desynchronized: `league.year` (2019) is NOT the authoritative
  // year, so a cleanup keyed off `league.year` would target 2020.
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2019, { state: 'season', year: 2025 }));
  await seedDemoScopes(2026);
  await seedDemoScopes(2020); // the year a stale local derivation would target

  await runWithRevalidateContext(() => setTestLeagueStatus('preseason'));

  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, {
    state: 'preseason',
    year: 2026,
  });
  assert.deepEqual(await demoScopesPresent(2026), [false, false, false], 'resolved year cleared');
  assert.deepEqual(
    await demoScopesPresent(2020),
    [true, true, true],
    'no other year is touched by a locally recomputed value'
  );
});

// Risk: state is cleared for a lifecycle write that never landed.
test('a refused lifecycle write clears nothing', async () => {
  // An unusable stored year refuses inside the transaction.
  await seed(makeLeague(TEST_LEAGUE_SLUG, 1800, { state: 'season', year: 1800 }));
  await seedDemoScopes(1801);
  await seedDemoScopes(2026);
  const before = await readRegistry();

  // PLATFORM-086F2H3B1 — a refusal RETURNS a typed result instead of throwing,
  // so the operator can be told which condition occurred. In production a thrown
  // Server Action message is redacted, which is why the reason had to move onto
  // the return value rather than into the error text.
  const refusal = await runWithRevalidateContext(() => setTestLeagueStatus('preseason'));
  assert.deepEqual(refusal, { kind: 'refused', reason: 'unusable-lifecycle' });

  assert.deepEqual(await readRegistry(), before, 'the registry is untouched');
  assert.deepEqual(await demoScopesPresent(1801), [true, true, true], 'no cleanup on refusal');
  assert.deepEqual(await demoScopesPresent(2026), [true, true, true]);
});

test('an absent demo league clears nothing and reports not found', async () => {
  await seed(makeLeague('alpha', 2025, { state: 'season', year: 2025 }));
  await seedDemoScopes(2026);

  assert.deepEqual(await runWithRevalidateContext(() => setTestLeagueStatus('preseason')), {
    kind: 'refused',
    reason: 'league-not-found',
  });
  assert.deepEqual(await runWithRevalidateContext(() => resetTestLeague()), {
    kind: 'refused',
    reason: 'league-not-found',
  });

  assert.deepEqual(await demoScopesPresent(2026), [true, true, true]);
  assert.equal((await readRegistry()).length, 1, 'no league was created');
});

// Risk: THE REGRESSION — a demo reset disarms the schedule probe that
// production leagues depend on, re-handing that year between crons.
test('reset preserves the shared schedule probe byte-for-byte', async () => {
  const probeYear = TEST_LEAGUE_RESET_YEAR + 1;
  const probe: ScheduleProbeState = {
    year: probeYear,
    baseCachedAt: '2026-01-01T00:00:00.000Z',
    firstGameDate: '2026-08-29T00:00:00.000Z',
  };
  await seed(
    makeLeague(TEST_LEAGUE_SLUG, 2031, { state: 'preseason', year: 2031 }),
    makeLeague('alpha', probeYear, { state: 'preseason', year: probeYear })
  );
  await setAppState('schedule-probe', String(probeYear), probe);

  await runWithRevalidateContext(() => resetTestLeague());

  const stored = await getAppState<ScheduleProbeState>('schedule-probe', String(probeYear));
  assert.ok(stored, 'the shared probe still exists');
  assert.deepEqual(
    stored.value,
    probe,
    'a demo reset must never disarm the probe production leagues depend on'
  );
  assert.deepEqual((await readLeague('alpha'))?.status, {
    state: 'preseason',
    year: probeYear,
  });
});

// Risk: the cleanup year and the reset year drift apart silently.
test('reset cleanup follows TEST_LEAGUE_RESET_YEAR rather than a literal', async () => {
  // Derived from the exported constant, so the assertion moves with it. A
  // hardcoded cleanup year passes only while the constant equals today's value;
  // once the reset season is bumped, the action would clear the CURRENT demo
  // season instead of the next preseason — wiping live owners/draft state and
  // orphaning the real next-preseason records.
  const nextPreseason = TEST_LEAGUE_RESET_YEAR + 1;
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2031, { state: 'preseason', year: 2031 }));
  await seedDemoScopes(nextPreseason);
  await seedDemoScopes(TEST_LEAGUE_RESET_YEAR);

  await runWithRevalidateContext(() => resetTestLeague());

  const stored = await readLeague(TEST_LEAGUE_SLUG);
  assert.deepEqual(stored?.status, { state: 'season', year: TEST_LEAGUE_RESET_YEAR });
  assert.equal(stored?.year, TEST_LEAGUE_RESET_YEAR, 'projection synchronized');
  assert.deepEqual(
    await demoScopesPresent(nextPreseason),
    [false, false, false],
    `the season after ${TEST_LEAGUE_RESET_YEAR} is cleared`
  );
  assert.deepEqual(
    await demoScopesPresent(TEST_LEAGUE_RESET_YEAR),
    [true, true, true],
    'the season the reset just installed is NOT cleared'
  );
});

// Risk: a production league is mutated through the demo control surface.
test('no production league can be mutated through the test-control API', async () => {
  await seed(
    makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }),
    makeLeague('alpha', 2025, { state: 'season', year: 2025 }),
    makeLeague('bravo', 2026, { state: 'preseason', year: 2026 })
  );

  await runWithRevalidateContext(() => setTestLeagueStatus('preseason'));
  await runWithRevalidateContext(() => setTestLeagueStatus('season'));
  await runWithRevalidateContext(() => setTestLeagueStatus('offseason'));
  await runWithRevalidateContext(() => resetTestLeague());

  assert.deepEqual((await readLeague('alpha'))?.status, { state: 'season', year: 2025 });
  assert.equal((await readLeague('alpha'))?.year, 2025);
  assert.deepEqual((await readLeague('bravo'))?.status, { state: 'preseason', year: 2026 });
  assert.equal((await readLeague('bravo'))?.year, 2026);
});

// Risk: the migration changes what the operator's dry-run cycle does.
test('the three sandbox transitions still compose into a full dry-run cycle', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }));

  await runWithRevalidateContext(() => setTestLeagueStatus('preseason'));
  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, {
    state: 'preseason',
    year: 2026,
  });

  // Re-requesting preseason must not double-increment.
  await runWithRevalidateContext(() => setTestLeagueStatus('preseason'));
  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, {
    state: 'preseason',
    year: 2026,
  });

  await runWithRevalidateContext(() => setTestLeagueStatus('season'));
  assert.deepEqual(
    (await readLeague(TEST_LEAGUE_SLUG))?.status,
    { state: 'season', year: 2026 },
    'the preseason increment is preserved into season'
  );

  await runWithRevalidateContext(() => setTestLeagueStatus('offseason'));
  const offseason = await readLeague(TEST_LEAGUE_SLUG);
  assert.deepEqual(offseason?.status, { state: 'offseason' });
  assert.equal(offseason?.year, 2026, 'the archived season year is retained');
});

// Risk: dropping the preseason condition would make every transition wipe the
// current year's owners/draft — destructive on a plain 'Set: Season' click, and
// invisible without this test.
test('season and offseason transitions delete no demo state', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'preseason', year: 2026 }));
  await seedDemoScopes(2026);
  await seedDemoScopes(2025);

  await runWithRevalidateContext(() => setTestLeagueStatus('season'));
  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, { state: 'season', year: 2026 });
  assert.deepEqual(await demoScopesPresent(2026), [true, true, true], 'season deletes nothing');
  assert.deepEqual(await demoScopesPresent(2025), [true, true, true]);

  await runWithRevalidateContext(() => setTestLeagueStatus('offseason'));
  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, { state: 'offseason' });
  assert.deepEqual(await demoScopesPresent(2026), [true, true, true], 'offseason deletes nothing');
  assert.deepEqual(await demoScopesPresent(2025), [true, true, true]);
});

// REGRESSION TEST — verified failing with the new `invalidateStandings` call
// removed.
//
// Risk it protects: F2H1T2 excluded the demo league from the season-transition
// cron, which had been the only thing invalidating its standings on the flip to
// season. `resolveStandingsYear` returns `status.year` for BOTH preseason and
// season, so the cache key does not change, and the snapshot is tag-only with
// `revalidate: false`. Without this invalidation the demo league would serve a
// stale PRESEASON standings view indefinitely after `Set: Season`.
test('the manual season transition invalidates the demo league standings', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'preseason', year: 2026 }));

  const { threw, tags } = await runAuthorizedCapturingTags(() => setTestLeagueStatus('season'));

  assert.equal(threw, false, 'the control resolves');
  assert.deepEqual(
    (await readLeague(TEST_LEAGUE_SLUG))?.status,
    { state: 'season', year: 2026 },
    'the lifecycle write committed'
  );
  assert.ok(
    tags.includes(standingsSlugTag(TEST_LEAGUE_SLUG)),
    `the demo standings tag must be busted; saw ${JSON.stringify(tags)}`
  );
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H3B1 — the typed result the controls now return.
// ---------------------------------------------------------------------------

// REGRESSION TEST — the state/year reported come from the AUTHORITY's resolved
// status, not from the requested state or a locally recomputed year.
test('an applied change reports the year the authority resolved', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }));

  const result = await runWithRevalidateContext(() => setTestLeagueStatus('preseason'));

  assert.deepEqual(result, { kind: 'applied', state: 'preseason', year: 2026, cacheStale: false });
  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, {
    state: 'preseason',
    year: 2026,
  });
});

// REGRESSION TEST — these controls make an idempotent request easy to issue, and
// "Moved to Season 2025" for a league already there is false. The prior status
// can only be observed under the registry lock, which is why the authority
// returns it rather than the action re-reading it.
test('an idempotent request reports no-change, not applied', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }));

  const result = await runWithRevalidateContext(() => setTestLeagueStatus('season'));
  assert.deepEqual(result, { kind: 'no-change', state: 'season', year: 2025 });

  // POSITIVE CONTROL — the SAME control on the same league reports `applied`
  // when the lifecycle actually moves, so `no-change` above is a real
  // discrimination and not this action's only answer.
  const moved = await runWithRevalidateContext(() => setTestLeagueStatus('offseason'));
  assert.equal(moved.kind, 'applied');
});

// A re-request of `preseason` keeps the year but DROPS `setupComplete`, because
// `decideTestLeagueStatus` rebuilds the status without it. That is a real change
// to the record, so reporting "already in Preseason 2026" would be false.
test('re-requesting preseason after setup completes is applied, not no-change', async () => {
  await seed(
    makeLeague(TEST_LEAGUE_SLUG, 2026, { state: 'preseason', year: 2026, setupComplete: true })
  );

  const result = await runWithRevalidateContext(() => setTestLeagueStatus('preseason'));

  assert.equal(result.kind, 'applied', 'clearing setupComplete is a change');
  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, {
    state: 'preseason',
    year: 2026,
  });
});

// REGRESSION TEST — a post-commit invalidation failure must NOT be reported as a
// refusal. The lifecycle write is already durable; only the cache is stale.
test('a failed post-commit revalidation still reports the committed change', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'preseason', year: 2026 }));

  const result = await runWithBrokenRevalidation(() => setTestLeagueStatus('season'));

  assert.deepEqual(result, { kind: 'applied', state: 'season', year: 2026, cacheStale: true });
  assert.deepEqual(
    (await readLeague(TEST_LEAGUE_SLUG))?.status,
    { state: 'season', year: 2026 },
    'the transition is durable — the operator must not be told it failed'
  );
});

// POSITIVE CONTROL for the test above: the identical fixture under a healthy
// store reports `cacheStale: false`, proving the flag tracks the injected
// failure rather than being set on every season transition.
test('the same transition under a healthy cache reports cacheStale false', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'preseason', year: 2026 }));

  const result = await runWithRevalidateContext(() => setTestLeagueStatus('season'));

  assert.deepEqual(result, { kind: 'applied', state: 'season', year: 2026, cacheStale: false });
});

// CONTRACT PIN — the reset ALWAYS reports applied, even from the reset state,
// because it also clears demo-scoped preseason/owners/draft state. Telling an
// operator "already in Season 2025" would deny cleanup that just ran, which is
// why `TestLeagueResetOutcome` carries no `previousStatus`.
test('reset reports applied even when the lifecycle is already at the reset year', async () => {
  await seed(
    makeLeague(TEST_LEAGUE_SLUG, TEST_LEAGUE_RESET_YEAR, {
      state: 'season',
      year: TEST_LEAGUE_RESET_YEAR,
    })
  );
  await seedDemoScopes(TEST_LEAGUE_RESET_YEAR + 1);

  const result = await runWithRevalidateContext(() => resetTestLeague());

  assert.deepEqual(result, {
    kind: 'applied',
    state: 'season',
    year: TEST_LEAGUE_RESET_YEAR,
    cacheStale: false,
  });
  assert.deepEqual(
    await demoScopesPresent(TEST_LEAGUE_RESET_YEAR + 1),
    [false, false, false],
    'cleanup ran — which is why this is never reported as "no change"'
  );
});

// REGRESSION TEST — `no-change` requires an unmoved lifecycle AND no cleanup.
//
// A repeated `preseason` request keeps the year, so the LIFECYCLE is unchanged —
// but the action deletes that year's demo owners, roster CSV, and draft on the
// way through. "Already in Preseason 2026" after wiping a populated draft is the
// same falsehood `resetTestLeague` is deliberately never allowed to tell, and
// the `setupComplete`-absent shape is the common one, because
// `decideTestLeagueStatus` never sets that flag.
test('a repeated preseason request reports applied, because it destroyed that year', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2026, { state: 'preseason', year: 2026 }));
  await seedDemoScopes(2026);

  const result = await runWithRevalidateContext(() => setTestLeagueStatus('preseason'));

  assert.equal(result.kind, 'applied', 'cleanup ran — this is not "no change"');
  assert.deepEqual(
    await demoScopesPresent(2026),
    [false, false, false],
    'the year the operator would have been told was unchanged was in fact wiped'
  );
  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, {
    state: 'preseason',
    year: 2026,
  });
});

// POSITIVE CONTROL — `no-change` is still reachable, on a transition that clears
// nothing. Without this the fix above could have been "never report no-change".
test('a repeated season request still reports no-change, because nothing is cleared', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'season', year: 2025 }));
  await seedDemoScopes(2025);

  const result = await runWithRevalidateContext(() => setTestLeagueStatus('season'));

  assert.deepEqual(result, { kind: 'no-change', state: 'season', year: 2025 });
  assert.deepEqual(await demoScopesPresent(2025), [true, true, true], 'nothing was cleared');
});

// REGRESSION TEST — the reset installs `season(RESET_YEAR)` from any state, the
// same transition `setTestLeagueStatus` invalidates standings for, and it carries
// the same hazard: `resolveStandingsYear` returns `status.year` for preseason AND
// season, so a reset from `preseason(2025)` leaves the cache key unchanged. It
// previously invalidated nothing while reporting `cacheStale: false` — asserting
// a freshness it had not established.
test('reset invalidates the demo standings and reports the cache truthfully', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'preseason', year: 2025 }));

  const { result, tags } = await runAuthorizedCapturingTags(() => resetTestLeague());

  assert.ok(
    tags.includes(standingsSlugTag(TEST_LEAGUE_SLUG)),
    `the demo standings tag must be busted; saw ${JSON.stringify(tags)}`
  );
  assert.deepEqual(result, {
    kind: 'applied',
    state: 'season',
    year: TEST_LEAGUE_RESET_YEAR,
    cacheStale: false,
  });
});

test('a reset whose revalidation fails reports the committed change as stale', async () => {
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'preseason', year: 2025 }));

  const result = await runWithBrokenRevalidation(() => resetTestLeague());

  assert.deepEqual(result, {
    kind: 'applied',
    state: 'season',
    year: TEST_LEAGUE_RESET_YEAR,
    cacheStale: true,
  });
  assert.deepEqual((await readLeague(TEST_LEAGUE_SLUG))?.status, {
    state: 'season',
    year: TEST_LEAGUE_RESET_YEAR,
  });
});

test('autoCompleteDraft publishes — it records the picks it wrote', async () => {
  // PLATFORM-094. This demo control writes the owners CSV itself, so it IS a
  // publication. Without the digest the demo league would drive itself into the
  // state readiness refuses: a complete draft beside a roster nothing claims to
  // have published, with Confirm hidden and no way forward.
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'preseason', year: 2025 }));
  await seedLiveDemoDraft(2025);

  const outcome = await runWithRevalidateContext(() => autoCompleteDraft());
  assert.equal(outcome.kind, 'completed', JSON.stringify(outcome));

  const draft = (await getAppState<DraftState>(draftScope(TEST_LEAGUE_SLUG), '2025'))?.value;
  const roster = await getAppState<string>(`owners:${TEST_LEAGUE_SLUG}:2025`, 'csv');

  assert.equal(draft?.phase, 'complete');
  assert.equal(isDraftPublished(draft), true, 'the demo draft records its publication');
  assert.ok(typeof roster?.value === 'string' && roster.value.includes('Alice'));
});

test('a demo publication that cannot commit writes NOTHING', async () => {
  // The draft and the roster it publishes were two independent writes, so a
  // failure between them left the demo league recording a publication it never
  // performed — and a retry then refused as already-complete.
  //
  // Failing lock acquisition is the observable form: under one transaction
  // neither record moves. The test above is the positive control — the same
  // reads see both records written on the success path.
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'preseason', year: 2025 }));
  await seedLiveDemoDraft(2025);

  __setAppStateKeyLockFailureForTests(new Error('injected lock failure'));
  try {
    await assert.rejects(() => runWithRevalidateContext(() => autoCompleteDraft()));
  } finally {
    __setAppStateKeyLockFailureForTests(null);
  }

  const draft = (await getAppState<DraftState>(draftScope(TEST_LEAGUE_SLUG), '2025'))?.value;
  const roster = await getAppState<string>(`owners:${TEST_LEAGUE_SLUG}:2025`, 'csv');

  assert.equal(draft?.phase, 'live', 'the draft was not completed');
  assert.equal(isDraftPublished(draft), false, 'no publication recorded');
  assert.ok(!roster?.value, 'no roster written');
});

test('autoCompleteDraft fills a vacated slot rather than publishing without it', async () => {
  // PLATFORM-096. `remainingSlots` counts an empty slot as taken and the CSV
  // writer dropped it, so auto-complete published a roster one owner short while
  // stamping `publishedPicks` — bypassing the confirm route's unassigned guard
  // and breaking the invariant the whole feature rests on. The comment here used
  // to call a null unreachable; this feature is what made it reachable.
  await seed(makeLeague(TEST_LEAGUE_SLUG, 2025, { state: 'preseason', year: 2025 }));
  await seedLiveDemoDraft(2025);
  const started = (await getAppState<DraftState>(draftScope(TEST_LEAGUE_SLUG), '2025'))!.value!;
  await setAppState(draftScope(TEST_LEAGUE_SLUG), '2025', {
    ...started,
    picks: [
      {
        pickNumber: 1,
        round: 0,
        roundPick: 0,
        owner: 'Alice',
        team: null,
        pickedAt: '2025-01-01T00:00:00.000Z',
        autoSelected: false,
      },
    ],
    currentPickIndex: 1,
  });

  const outcome = await runWithRevalidateContext(() => autoCompleteDraft());
  assert.equal(outcome.kind, 'completed', JSON.stringify(outcome));

  const draft = (await getAppState<DraftState>(draftScope(TEST_LEAGUE_SLUG), '2025'))?.value;
  assert.ok(
    draft?.picks.every((p) => p.team !== null),
    'every slot is filled before publishing'
  );
  assert.equal(isDraftPublished(draft), true);
});
