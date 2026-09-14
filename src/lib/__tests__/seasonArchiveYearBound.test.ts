import assert from 'node:assert/strict';
import test from 'node:test';

import { MIN_SEASON_YEAR } from '@/lib/league';
import { listSeasonArchives, resolveArchiveYearParam } from '@/lib/seasonArchive';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '@/lib/server/appStateStore';

/**
 * #774 — the caller-supplied archive year bound.
 *
 * WHY EVERY VALUE HERE IS A LITERAL AND NOT DERIVED FROM THE CLOCK, which is the
 * opposite of #770's suite and deliberate. #770's ceiling is
 * `maxCreatableSeasonYear(now)`, so a pinned year there would expire. This bound
 * reads no clock at all — its ceiling is the league's own operating year — so
 * literals are the honest fixture and `npm run test:clock-shift` has nothing to
 * catch. If a future change makes this suite clock-sensitive, that is itself the
 * signal that the ceiling stopped being league-relative.
 *
 * THE SCOPE LITERAL BELOW IS A VACUITY RISK, and the control is what closes it.
 * `archiveScope` is private to `seasonArchive.ts`, so these fixtures are planted
 * through a hand-written `standings-archive:<slug>` string. If that string ever
 * drifted from the real one, every "the planted archive is NOT served" assertion
 * would pass because nothing was ever planted. So each such test is paired with
 * a control that plants through the SAME helper and asserts the archive IS
 * found — which can only pass if the helper writes where the reader looks.
 */

const SLUG = 'archive-year-bound';
const OPERATING_YEAR = 2026;

/** The league fixture, shaped exactly as `resolveLeagueOperatingYear` reads it. */
const league = (year = OPERATING_YEAR) => ({
  year,
  status: { state: 'season' as const, year },
});

/**
 * Plant an archive at an arbitrary STORE KEY — including one no writer could
 * ever produce. `rolloverTargeting.ts` refuses a non-integer year before
 * `saveSeasonArchive` sees it (PLATFORM-086F2H1R4), so `2026.5` is reachable in
 * production only through the unbounded READ path this slice closes; planting it
 * by hand is how a test can stand where that read stood.
 */
async function plantArchive(slug: string, key: string): Promise<void> {
  await setAppState(`standings-archive:${slug}`, key, {
    leagueSlug: slug,
    year: Number(key),
    archivedAt: '2026-01-01T00:00:00.000Z',
    ownerRosterSnapshot: 'team,owner\nTexas,Alice\n',
    // The full `StandingsHistory` shape — `weeks`, `byWeek` AND `byOwner`. A
    // thinner fixture throws inside `selectSeasonSuperlatives` before anything
    // renders, which would leave every "refused" assertion in this file passing
    // while no control could ever prove the page serves a legitimate year.
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: [],
    games: [],
    scoresByKey: {},
  });
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

// Assigning `undefined` to a `process.env` key stores the string "undefined"
// (which reads as configured); delete instead when the original was unset.
function restoreDatabaseUrl(): void {
  if (ORIGINAL_DATABASE_URL === undefined) delete MUTABLE_ENV.DATABASE_URL;
  else MUTABLE_ENV.DATABASE_URL = ORIGINAL_DATABASE_URL;
}

/**
 * Force the store to throw on read the way a transient database failure would.
 * The same mechanism `seasonArchive.test.ts` uses: `NODE_ENV=production` with no
 * `DATABASE_URL` makes every `listAppStateKeys` call throw before it reaches any
 * backend. The dedicated `__setAppStateReadFailureForTests` seam does NOT work
 * here — measured: `listAppStateKeys` never calls `applyReadFailureSeamForTests`,
 * so injecting through it produced no rejection at all and the first cut of this
 * test passed vacuously in the wrong direction.
 */
function forceStoreReadFailure(): void {
  MUTABLE_ENV.NODE_ENV = 'production';
  delete MUTABLE_ENV.DATABASE_URL;
  __resetAppStateForTests();
}

/**
 * #778 — `listSeasonArchives` now declines a slug no league holds, and the
 * DISJUNCT below consults it. Without a registry entry for `SLUG` the disjunct
 * would read `[]` for every case and the "an archive above the operating year is
 * still served" test would fail for a reason that has nothing to do with the
 * year bound. Planted rather than the guard weakened.
 */
async function plantLeagueRegistry(): Promise<void> {
  await setAppState('leagues', 'registry', [
    {
      slug: SLUG,
      displayName: 'Archive Year Bound',
      year: OPERATING_YEAR,
      createdAt: '2020-01-01T00:00:00.000Z',
      status: { state: 'season' as const, year: OPERATING_YEAR },
    },
  ]);
}

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  restoreDatabaseUrl();
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await plantLeagueRegistry();
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  restoreDatabaseUrl();
});

test('CONTROL: the planting helper writes where the reader looks', async () => {
  // Without this, every "not served" assertion in this file could pass on a
  // fixture that was never findable. It is the first test on purpose.
  await plantArchive(SLUG, '2018');
  const resolved = await resolveArchiveYearParam(SLUG, '2018', league());

  assert.equal(resolved.ok, true);
  assert.deepEqual(
    await listSeasonArchives(SLUG),
    [2018],
    'the hand-written scope must match the one seasonArchive.ts reads'
  );
});

test('a fractional year is refused — the dense half of the defect', async () => {
  // The value that made the accepted set dense: infinitely many of these sit
  // between any two years, so no enumeration bounds them.
  for (const raw of ['2026.5', '2026.6', '2026.0000001', '2025.9999999']) {
    const resolved = await resolveArchiveYearParam(SLUG, raw, league());
    assert.equal(resolved.ok, false, `${raw} must be refused`);
  }
});

test('MUTATION: the refusal really stops the read — a planted fractional archive is NOT served', async () => {
  // The strongest form of the claim available here. An archive genuinely EXISTS
  // at key `2026.5`; before this slice `Number('2026.5')` reached the lookup and
  // would have found it, minting `season-archive/<slug>/2026.5`. A refusal that
  // still resolved the year would be indistinguishable by status alone.
  await plantArchive(SLUG, '2026.5');

  const refused = await resolveArchiveYearParam(SLUG, '2026.5', league());
  assert.equal(refused.ok, false, 'the year must never reach the cache key');

  // POSITIVE CONTROL, same fixture, same store: an integer year IS admitted, so
  // the refusal above is the bound firing and not an empty or unreachable store.
  await plantArchive(SLUG, '2025');
  const served = await resolveArchiveYearParam(SLUG, '2025', league());
  assert.deepEqual(served, { ok: true, year: 2025 });
});

test('exponential and hex notation are refused — `Number()` read both as years', async () => {
  // Measured against the pre-fix route: `2e10` became 20000000000 and `0x7E0`
  // became 2016, and each minted its own entry.
  for (const raw of ['2e10', '0x7E0', '2.6e3', '1e3']) {
    assert.equal((await resolveArchiveYearParam(SLUG, raw, league())).ok, false, raw);
  }
});

test('trailing junk, signs and empty input are refused', async () => {
  for (const raw of ['2026nonsense', 'nonsense', '+2026', '-2026', '', '  ', 'Infinity', 'NaN']) {
    assert.equal((await resolveArchiveYearParam(SLUG, raw, league())).ok, false, `"${raw}"`);
  }
});

test('THE CEILING: a year above the operating year is refused, and the operating year itself is served', async () => {
  const beyond = await resolveArchiveYearParam(SLUG, String(OPERATING_YEAR + 1), league());
  assert.equal(beyond.ok, false, 'an archive of a season that has not finished cannot exist');

  // Paired control: the boundary value one below the refusal is admitted, so the
  // test above pins a CEILING rather than a blanket refusal.
  const operating = await resolveArchiveYearParam(SLUG, String(OPERATING_YEAR), league());
  assert.deepEqual(operating, { ok: true, year: OPERATING_YEAR });
});

test('NOT #770s ceiling: `currentYear + 1` is refused when the league does not operate there', async () => {
  // #770 accepts next season because a league legitimately OPERATES in one
  // during rollover. This route serves ARCHIVES, and an archive of a future
  // season cannot exist — so the same value must be refused here. Derived from
  // the fixture's own operating year, not the clock, exactly as the header says.
  const nextSeason = await resolveArchiveYearParam(SLUG, String(OPERATING_YEAR + 1), league());
  assert.equal(nextSeason.ok, false);
});

test('THE FLOOR: MIN_SEASON_YEAR is served and the year below it is refused', async () => {
  const atFloor = await resolveArchiveYearParam(SLUG, String(MIN_SEASON_YEAR), league());
  const belowFloor = await resolveArchiveYearParam(SLUG, String(MIN_SEASON_YEAR - 1), league());

  assert.deepEqual(atFloor, { ok: true, year: MIN_SEASON_YEAR });
  assert.equal(belowFloor.ok, false);
});

test("THE OLDEST ARCHIVE IS SERVED: tsc's real 2018, well inside the range", async () => {
  // Named in #774's acceptance boundary. It is admitted by the RANGE, not the
  // disjunct — planting nothing is the point.
  const resolved = await resolveArchiveYearParam(SLUG, '2018', league());
  assert.deepEqual(resolved, { ok: true, year: 2018 });
});

test('A GAP YEAR IN RANGE IS ADMITTED, not refused — tsc genuinely has holes at 2019 and 2020', async () => {
  // This is the whole argument for the ceiling being the operating year rather
  // than the archive list. These years have no archive; the caller must still
  // reach the 404 / empty state that says so, rather than being told the year
  // was bad. Deliberately planting 2018 and 2021 AROUND the gap.
  await plantArchive(SLUG, '2018');
  await plantArchive(SLUG, '2021');

  for (const gap of ['2019', '2020']) {
    const resolved = await resolveArchiveYearParam(SLUG, gap, league());
    assert.equal(resolved.ok, true, `${gap} must be answered "no archive", never "bad year"`);
  }
});

test('THE DISJUNCT: an archive above the operating year is still served', async () => {
  // A legacy record whose operating year sits BELOW its own newest archive. The
  // range alone would refuse the league a season it genuinely holds; the archive
  // list admits it. This is what makes the guarantee structural rather than a
  // fact about today's registry.
  const desynced = league(2020);
  await plantArchive(SLUG, '2024');

  const held = await resolveArchiveYearParam(SLUG, '2024', desynced);
  assert.deepEqual(held, { ok: true, year: 2024 }, 'never refuse a year the league holds');

  // MUTATION CONTROL: the identical year, identical league record, with the
  // archive absent. Without this the pass above could mean the ceiling is simply
  // wider than the operating year rather than that the disjunct fired.
  const notHeld = await resolveArchiveYearParam(SLUG, '2025', desynced);
  assert.equal(notHeld.ok, false, 'the disjunct must admit only years actually archived');
});

test('THE DISJUNCT DOES NOT REACH BELOW 2000, because the year list itself does not', async () => {
  // FOUND BY THIS TEST FAILING, and pinned rather than fixed. The first cut
  // asserted the opposite — that a planted sub-floor archive would be admitted
  // by the disjunct — and it was wrong: `readArchiveYearsFromStore` filters
  // `n >= 2000` before `listSeasonArchives` ever returns, so no consumer of the
  // year list can see such an archive.
  //
  // Refusing it is therefore CONSISTENT rather than a new gap. The league page,
  // the history index, insights and the recap all read the same floored list, so
  // a sub-2000 archive is already invisible everywhere; admitting it here alone
  // would let one route mint a cache entry for a season no other surface agrees
  // exists. Recorded as residue on #774, not fixed inside it.
  await plantArchive(SLUG, '1998');

  const planted = await resolveArchiveYearParam(SLUG, '1998', league());
  assert.equal(planted.ok, false, 'the floored year list cannot admit it');

  // CONTROL: the archive really was planted and really is unreachable via the
  // list — not merely absent. Without this the refusal above proves nothing.
  assert.deepEqual(
    await listSeasonArchives(SLUG),
    [],
    'readArchiveYearsFromStore filters n >= 2000, so the planted 1998 never surfaces'
  );
});

test('a padded but legitimate year is served — trimmed once, one decision', async () => {
  // Measured before the fix: `/history/<slug>/%202026%20` returned 200 and
  // collapsed onto the same cache entry as the bare year, so padding is not part
  // of the defect and refusing it would be an unreviewed second change. #770
  // shipped exactly that inconsistency and had it caught at review.
  const padded = await resolveArchiveYearParam(SLUG, ' 2026 ', league());
  assert.deepEqual(padded, { ok: true, year: 2026 });

  // ...and padding does not rescue a value that is invalid on its own.
  assert.equal((await resolveArchiveYearParam(SLUG, ' 2026.5 ', league())).ok, false);
});

test('the refusal message names BOTH admitting conditions', async () => {
  const refused = await resolveArchiveYearParam(SLUG, '999999', league());
  assert.equal(refused.ok, false);
  if (refused.ok) return;

  assert.match(refused.error, /integer between 2000 and 2026/);
  assert.match(
    refused.error,
    /archived/,
    'stating only the range would misdescribe the bound to the one caller the disjunct exists for'
  );
});

test('a store failure PROPAGATES from the disjunct — it is never read as "no archives"', async () => {
  // Swallowing it would reject a year the league genuinely holds because the
  // database blinked, which is the exact property the disjunct exists to
  // guarantee. Only an out-of-range value consults the list, so that is the path
  // under test.
  // CONTROL FIRST, while the store is healthy: the SAME out-of-range value takes
  // the ordinary refusal path. Without it the rejection below could be any throw
  // on any input.
  const refused = await resolveArchiveYearParam(SLUG, '3000', league());
  assert.equal(refused.ok, false, 'the healthy path refuses rather than throwing');

  forceStoreReadFailure();
  await assert.rejects(
    () => resolveArchiveYearParam(SLUG, '3000', league()),
    /APP_STATE_PRODUCTION_CONFIG_ERROR|DATABASE_URL/,
    'a failed read must not silently become a refusal'
  );
});

test('A SUB-FLOOR YEAR NEVER CONSULTS THE STORE, so an outage cannot turn its 400 into a 500', async () => {
  // Review finding. The archive list is itself floored at 2000, so consulting it
  // for `1999` is a round-trip whose result cannot change the answer — and
  // because that read propagates failure by design, the dead path converted a
  // certain refusal into a throw. Asserting on a BROKEN store is what makes this
  // observe the absence of the read rather than infer it: if the disjunct still
  // ran, this would reject instead of returning.
  forceStoreReadFailure();

  const refused = await resolveArchiveYearParam(SLUG, '1999', league());
  assert.equal(refused.ok, false, 'a sub-floor year must refuse without reading the store');

  // CONTROL: the store really is broken, so the assertion above is about the
  // sub-floor path and not about a store that happens to be working. An
  // ABOVE-ceiling year does reach the disjunct and therefore must still throw.
  await assert.rejects(
    () => resolveArchiveYearParam(SLUG, '3000', league()),
    'the same broken store still surfaces through the path that does read it'
  );
});
