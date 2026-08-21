import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TEST_LEAGUE_SLUG,
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  getAppState,
  setAppState,
  resetScheduleRouteCacheForTests,
  ORDINARY_KICKOFF,
  CRITICAL_KICKOFF,
  makeLeague,
  seedSeasonLeague,
  seedSchedule,
  fetchLog,
  providerUrlLog,
  presentationFetchLog,
  stubProvider,
  gameBody,
  runRoute,
  EARLY_FIRST_KICKOFF,
  seedProbe,
  type League,
} from './_routeHarness.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1T3 — the demo league is MANUAL-ONLY for weekly schedule
// maintenance. Labels follow AGENTS.md → Verification.
// ---------------------------------------------------------------------------

// POSITIVE CONTROL for the provider observer. Every "zero provider work"
// assertion below is worthless unless the same harness is shown recording real
// calls: it proves the observer captures the expected production year AND both
// canonical partitions. The contract pin at the end of this block exercises the
// identical fixture through the shared-year path and repeats these assertions.
test('the provider observer records the production year and both partitions', async () => {
  await seedSeasonLeague(2031);
  await seedSchedule(2031, '2020-12-01T00:00:00.000Z');
  stubProvider({ 2031: { regular: gameBody(2031), postseason: '[]' } });

  await runRoute();

  assert.ok(fetchLog.length > 0, 'the observer records calls when they happen');
  assert.deepEqual(fetchLog, ['2031:regular', '2031:postseason'], 'both partitions, that year');
  assert.ok(
    providerUrlLog.some((u) => u.includes('year=2031')),
    `the observer records the real URL; saw ${JSON.stringify(providerUrlLog)}`
  );
});

// REGRESSION TEST — verified failing with the exclusion removed.
test('a demo-only ACTIVE-SEASON year is skipped with no provider or durable work', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague(TEST_LEAGUE_SLUG, { state: 'season', year: 2031 }, 2031),
  ]);
  // A canonical schedule whose latest kickoff is long past — the shape that
  // classifies `postseason-boundary`, the pause-EXEMPT operation.
  await seedSchedule(2031, '2020-12-01T00:00:00.000Z');
  stubProvider({ 2031: { regular: gameBody(2031), postseason: '[]' } });

  const { res, events } = await runRoute();
  const body = (await res.json()) as { result: string; reason: string };

  assert.equal(res.status, 200);
  assert.equal(events[0]?.result, 'skipped');
  assert.equal(
    events[0]?.reason,
    'no-automatic-maintenance-target',
    'an active demo league exists — `no-maintenance-target` would be false'
  );
  // The response body is a SEPARATE read of `exec.reason`; QStash and manual
  // callers see this one.
  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'no-automatic-maintenance-target');
  assert.deepEqual(events[0]?.years, [], 'no per-year entry');
  assert.deepEqual(fetchLog, [], 'no billed provider call');
  assert.deepEqual(providerUrlLog, []);
  assert.deepEqual(presentationFetchLog, [], 'no presentation refresh');

  // The pause-exempt latch must not be written for a year no production league owns.
  assert.equal(
    await getAppState('schedule-weekly-control', '2031'),
    null,
    'no postseason-boundary latch'
  );
});

// REGRESSION TEST — verified failing with the exclusion removed.
test('a demo-only armed early-preseason year does no provider or probe work', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague(TEST_LEAGUE_SLUG, { state: 'preseason', year: 2031 }, 2031),
  ]);
  await seedProbe(2031, EARLY_FIRST_KICKOFF);
  await seedSchedule(2031, '2020-12-01T00:00:00.000Z');
  stubProvider({ 2031: { regular: gameBody(2031), postseason: '[]' } });

  const probeBefore = await getAppState('schedule-probe', '2031');

  const { res, events } = await runRoute();
  const body = (await res.json()) as { reason: string };

  assert.equal(events[0]?.result, 'skipped');
  assert.equal(events[0]?.reason, 'no-automatic-maintenance-target');
  assert.equal(body.reason, 'no-automatic-maintenance-target');
  assert.deepEqual(fetchLog, [], 'the armed probe would otherwise mean preseason-maintenance');
  assert.deepEqual(presentationFetchLog, []);
  // The name claims "no probe work" — observe it. A preseason year that ran
  // would re-derive `firstGameDate` after a successful refresh.
  assert.deepEqual(
    await getAppState('schedule-probe', '2031'),
    probeBefore,
    'the probe record is untouched'
  );
});

// REGRESSION TEST — verified failing when the demo is allowed to own the year.
// The demo must not PROMOTE a shared year to the pause-exempt active-season
// policy over a production league in preseason.
test('a demo season year does not override a production preseason year', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague(TEST_LEAGUE_SLUG, { state: 'season', year: 2031 }, 2031),
    makeLeague('alpha', { state: 'preseason', year: 2031 }, 2031),
  ]);
  await seedProbe(2031, EARLY_FIRST_KICKOFF);
  await seedSchedule(2031, '2020-12-01T00:00:00.000Z');
  stubProvider({ 2031: { regular: gameBody(2031), postseason: '[]' } });

  const { events } = await runRoute();
  const entry = events[0]?.years?.[0];

  assert.equal(entry?.year, 2031);
  assert.equal(
    entry?.operation,
    'preseason-maintenance',
    'production preseason policy governs — NOT the demo-promoted active-season policy'
  );
  assert.equal(
    await getAppState('schedule-weekly-control', '2031'),
    null,
    'the pause-exempt boundary latch belongs to the active-season branch only'
  );
});

// CONTRACT PIN — NOT a regression test for the exclusion, and mislabelled as one
// when first written. Verified: this case still passes with the exclusion
// removed, because the pre-existing precedence rule
// (`ownerByYear.get(year) !== 'season'`) already prevents a preseason league
// from displacing a `season` owner. Only the OPPOSITE direction is load-bearing
// for PLATFORM-086F2H1T3 — a demo `season(Y)` must not promote a production
// `preseason(Y)` to the pause-exempt active-season policy, which the test above
// covers and mutation kills. This pin exists to prove the exclusion did not
// DISTURB the precedence that was already there, and it doubles as the
// `fetchLog`/`providerUrlLog` positive control for a production-year run.
test('a demo preseason year does not disturb existing production season precedence', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague(TEST_LEAGUE_SLUG, { state: 'preseason', year: 2031 }, 2031),
    makeLeague('alpha', { state: 'season', year: 2031 }, 2031),
  ]);
  await seedSchedule(2031, '2020-12-01T00:00:00.000Z');
  stubProvider({ 2031: { regular: gameBody(2031), postseason: '[]' } });

  const { events } = await runRoute();
  const entry = events[0]?.years?.[0];

  assert.equal(entry?.operation, 'postseason-boundary', 'production active-season policy governs');
  assert.deepEqual(fetchLog, ['2031:regular', '2031:postseason'], 'production work still executes');
  assert.ok(providerUrlLog.some((u) => u.includes('year=2031')));
});

// REGRESSION TEST — verified failing with the exclusion removed.
test('a demo-only year is absent from every surface while a production year runs', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague(TEST_LEAGUE_SLUG, { state: 'season', year: 2030 }, 2030),
    makeLeague('alpha', { state: 'season', year: 2031 }, 2031),
  ]);
  await seedSchedule(2030, '2020-12-01T00:00:00.000Z');
  await seedSchedule(2031, '2020-12-01T00:00:00.000Z');
  stubProvider({
    2030: { regular: gameBody(2030), postseason: '[]' },
    2031: { regular: gameBody(2031), postseason: '[]' },
  });

  const { events } = await runRoute();

  assert.deepEqual(
    events[0]?.years?.map((y) => y.year),
    [2031],
    'the demo-only year never becomes a target'
  );
  assert.ok(
    !providerUrlLog.some((u) => u.includes('year=2030')),
    `no provider request may name the demo-only year; saw ${JSON.stringify(providerUrlLog)}`
  );
  assert.ok(
    providerUrlLog.some((u) => u.includes('year=2031')),
    'production year WAS fetched'
  );
  assert.equal(await getAppState('schedule-weekly-control', '2030'), null);
});

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1R2 — registry-container truth and structural lifecycle-year
// validity, applied BEFORE ownership and before any schedule, probe, latch,
// settings, provider, or presentation work.
//
// `status.year` reaches the ownership loop straight from durable JSON —
// `getLeagues()` performs no per-record validation — so an unusable year
// previously owned a maintenance year and drove a `schedule/<raw>-all-all` read,
// a latch or probe operation, a settings decision, a billed E1A refresh, and a
// presentation refresh.
// ---------------------------------------------------------------------------

/** An active league whose stored `status.year` is deliberately unusable. */
function makeUnusableLeague(
  slug: string,
  year: unknown,
  state: 'season' | 'preseason' = 'season'
): League {
  return {
    slug,
    displayName: `League ${slug}`,
    year: 2031,
    createdAt: '2022-01-01T00:00:00.000Z',
    status: { state, year },
  } as unknown as League;
}

// REGRESSION TEST — a corrupt container is no longer reported as an empty one.
test('R2 regression: a malformed registry reports registry-malformed with no work', async () => {
  await setAppState('leagues', 'registry', { 'league-2020': { state: 'season', year: 2020 } });
  await seedSchedule(2020, CRITICAL_KICKOFF);

  const { res, events } = await runRoute();
  const body = (await res.json()) as {
    result: string;
    reason: string;
    years: unknown[];
    invalidLifecycleTargets: number;
  };

  // Controlled operational failure — 200, exactly like every other one on this
  // route. Only authentication returns 401.
  assert.equal(res.status, 200);
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'registry-malformed');
  assert.deepEqual(body.years, []);
  assert.equal(body.invalidLifecycleTargets, 0);
  assert.equal(events[0]?.reason, 'registry-malformed');
  assert.equal(events[0]?.invalidLifecycleTargets, 0);
  assert.deepEqual(events[0]?.years, []);

  // Nothing downstream ran.
  assert.deepEqual(providerUrlLog, [], 'no provider request of any shape');
  assert.deepEqual(presentationFetchLog, [], 'no presentation refresh');
});

// CONTRACT PIN — a MISSING container keeps its pre-R2 behavior exactly, and a
// store READ failure keeps its own distinct reason.
test('R2 contract pin: missing and unreadable registries keep their existing reasons', async () => {
  const missing = await runRoute();
  const missingBody = (await missing.res.json()) as { reason: string };
  assert.equal(missingBody.reason, 'no-maintenance-target');
  assert.equal(missing.events[0]?.invalidLifecycleTargets, 0);

  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  __setAppStateReadFailureForTests(new Error('registry down'), 'leagues');
  try {
    const unreadable = await runRoute();
    const unreadableBody = (await unreadable.res.json()) as { result: string; reason: string };
    assert.equal(unreadableBody.result, 'failure');
    assert.equal(
      unreadableBody.reason,
      'canonical-context-unavailable',
      'a store outage is not a corrupt container'
    );
  } finally {
    __setAppStateReadFailureForTests(null);
  }
});

// REGRESSION TEST — every unusable-year shape is refused, for BOTH active
// lifecycle states, before ownership or any downstream work.
//
// The fixture must make the pre-R2 path genuinely reach the provider, or the
// zero-provider assertion is vacuous. That needs BOTH halves handled, and they
// differ: a `season` year needs a populated `schedule/<raw-year>-all-all` with a
// parseable kickoff, while a `preseason` year additionally needs an ARMED
// `schedule-probe/<raw-year>` — without one it classifies `season-transition-owner`,
// a deliberate provider-free deferral, and would never have called the provider
// with or without the guard.
test('R2 regression: unusable-only production years refuse without reaching the provider', async () => {
  const cases: Array<[string, unknown]> = [
    ['missing', undefined],
    ['string', '2020'],
    ['fractional', 2020.5],
    ['unsafe integer', 2 ** 53],
    ['pre-football', 1800],
    ['null', null],
  ];
  for (const state of ['season', 'preseason'] as const) {
    for (const [label, year] of cases) {
      await __deleteAppStateFileForTests();
      __resetAppStateForTests();
      resetScheduleRouteCacheForTests();
      providerUrlLog.length = 0;
      presentationFetchLog.length = 0;
      await setAppState('leagues', 'registry', [makeUnusableLeague('alpha', year, state)]);
      // The schedule the raw year WOULD have read, populated and classifiable.
      await seedSchedule(String(year) as unknown as number, CRITICAL_KICKOFF);
      if (state === 'preseason') {
        // Arm the probe so the pre-R2 path is `preseason-maintenance`, which
        // DOES call the provider — otherwise the zero-provider assertion below
        // proves nothing for this half.
        await seedProbe(String(year) as unknown as number, ORDINARY_KICKOFF);
      }
      stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });

      const { res, events } = await runRoute();
      const body = (await res.json()) as {
        result: string;
        reason: string;
        years: unknown[];
        invalidLifecycleTargets: number;
      };
      const where = `${state}/${label}`;

      assert.equal(res.status, 200, where);
      assert.equal(body.result, 'failure', where);
      assert.equal(body.reason, 'unusable-lifecycle-year', where);
      assert.equal(body.invalidLifecycleTargets, 1, where);
      assert.deepEqual(body.years, [], `${where}: no per-year entry`);
      assert.equal(events[0]?.invalidLifecycleTargets, 1, where);
      assert.deepEqual(providerUrlLog, [], `${where}: no billed provider work`);
      assert.deepEqual(presentationFetchLog, [], `${where}: no presentation refresh`);
    }
  }
});

// REGRESSION TEST — refusal DURABILITY across a mid-loop throw.
//
// The ownership loop both counts refusals and can throw: `leagues` is typed
// `League[]`, but nothing validates each element, so a non-object member throws
// on property access. Counting into a local and publishing it onto `exec` after
// the loop therefore loses every refusal already found — the response, the
// runtime event, and the receipt each report 0 unusable targets on a run that
// found one. The order in the fixture is load-bearing: the refusable league must
// come FIRST, or the throw happens before anything has been counted and the
// assertion cannot distinguish the two implementations.
test('R2 regression: refusals counted before a mid-loop throw survive into the response and event', async () => {
  await setAppState('leagues', 'registry', [
    makeUnusableLeague('alpha', 2020.5, 'season'),
    // A corrupt RECORD (not a corrupt container): reading `.status` throws.
    null,
  ]);

  const { res, events } = await runRoute();
  const body = (await res.json()) as {
    result: string;
    reason: string;
    invalidLifecycleTargets: number;
  };

  // POSITIVE CONTROL — the throw really did happen and really was caught here,
  // rather than the run ending for some other reason that would make the count
  // assertion below meaningless.
  assert.equal(body.result, 'failure');
  assert.equal(body.reason, 'canonical-context-unavailable', 'the corrupt record threw');

  assert.equal(body.invalidLifecycleTargets, 1, 'the refusal already counted is not discarded');
  assert.equal(events[0]?.invalidLifecycleTargets, 1, 'and it reaches the runtime event');
  assert.deepEqual(providerUrlLog, [], 'no billed provider work');
});

// REGRESSION TEST — ordering. An active DEMO record with a malformed year stays
// a demo exclusion; it must not be counted as an invalid production target.
test('R2 regression: an active demo league with an unusable year keeps the F2H1T3 reason', async () => {
  await setAppState('leagues', 'registry', [makeUnusableLeague(TEST_LEAGUE_SLUG, 2020.5)]);

  const { res, events } = await runRoute();
  const body = (await res.json()) as {
    result: string;
    reason: string;
    invalidLifecycleTargets: number;
  };

  assert.equal(body.result, 'skipped');
  assert.equal(body.reason, 'no-automatic-maintenance-target');
  assert.equal(body.invalidLifecycleTargets, 0, 'a demo record is never an invalid TARGET');
  assert.equal(events[0]?.invalidLifecycleTargets, 0);
  assert.deepEqual(providerUrlLog, []);
});

// CONTRACT PIN — offseason and status-less PRODUCTION records were never
// candidates, so they are not counted as invalid either.
test('R2 contract pin: inactive production records are not invalid targets', async () => {
  await setAppState('leagues', 'registry', [
    makeLeague('off', { state: 'offseason' }),
    makeLeague('nostatus', undefined),
  ]);

  const { res, events } = await runRoute();
  const body = (await res.json()) as { reason: string; invalidLifecycleTargets: number };
  assert.equal(body.reason, 'no-maintenance-target');
  assert.equal(body.invalidLifecycleTargets, 0);
  assert.equal(events[0]?.invalidLifecycleTargets, 0);
});

// REGRESSION TEST — a mixed registry: the valid year executes, the invalid one
// is absent from every surface, and all three agree on the count. The executed
// year is also the POSITIVE CONTROL for the zero-provider assertions above —
// it proves this same path does reach the provider.
test('R2 regression: a mixed registry executes the valid year and reports the refusal', async () => {
  const valid = () => makeLeague('league-2020', { state: 'season', year: 2020 }, 2020);
  const invalid = () => makeUnusableLeague('broken', 2020.5);
  // BOTH orderings. With the invalid record FIRST, a refusal that `break`s out
  // of the ownership loop instead of continuing would silently drop the valid
  // year — one invalid record must never abort the run.
  const orderings: Array<[string, League[]]> = [
    ['valid first', [valid(), invalid()]],
    ['invalid first', [invalid(), valid()]],
  ];
  for (const [label, registry] of orderings) {
    await __deleteAppStateFileForTests();
    __resetAppStateForTests();
    resetScheduleRouteCacheForTests();
    providerUrlLog.length = 0;
    await setAppState('leagues', 'registry', [...registry]);
    await seedSchedule(2020, CRITICAL_KICKOFF);
    await seedSchedule('2020.5' as unknown as number, CRITICAL_KICKOFF);
    stubProvider({ 2020: { regular: gameBody(2020), postseason: '[]' } });

    const { res, events } = await runRoute();
    const body = (await res.json()) as {
      result: string;
      years: Array<{ year: number }>;
      invalidLifecycleTargets: number;
    };

    assert.ok(providerUrlLog.length > 0, `${label}: the valid year still reached the provider`);
    assert.ok(
      !providerUrlLog.some((url) => url.includes('2020.5')),
      `${label}: no provider request names the refused year`
    );
    assert.deepEqual(
      body.years.map((y) => y.year),
      [2020],
      `${label}: only the valid year produced an entry`
    );
    assert.deepEqual(
      events[0]?.years.map((y) => y.year),
      [2020],
      label
    );
    assert.equal(body.invalidLifecycleTargets, 1, label);
    assert.equal(events[0]?.invalidLifecycleTargets, 1, label);
    // The valid year succeeded, so the refusal makes the run `partial`.
    assert.equal(body.result, 'partial', label);
    assert.equal(events[0]?.result, 'partial', label);
  }
});
