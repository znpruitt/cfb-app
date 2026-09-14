import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSeasonArchive,
  listSeasonArchives,
  saveSeasonArchive,
  seasonArchiveCacheKeyParts,
  seasonArchiveYearsCacheKeyParts,
  seasonArchiveSlugTag,
  seasonArchiveYearTag,
  isMissingRequestStore,
  type SeasonArchive,
} from '../seasonArchive.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../server/appStateStore.ts';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

// Assigning `undefined` to a `process.env` key stores the string "undefined"
// (which reads as configured); delete instead when the original was unset.
function restoreDatabaseUrl(): void {
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete MUTABLE_ENV.DATABASE_URL;
  } else {
    MUTABLE_ENV.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
}

/**
 * #778 — both readers now decline a slug no league holds, so every fixture below
 * needs a REGISTRY as well as an archive. Planting it in `beforeEach` rather
 * than weakening the guard is deliberate: a suite that could read archives for
 * leagues that do not exist was testing a state production cannot reach.
 *
 * The unknown-slug REFUSAL is not tested here — it lives in
 * `seasonArchiveUnknownSlug.test.ts`, against slugs this file never mentions.
 * (An earlier version of this comment claimed `test` was deliberately left
 * unplanted for that purpose; no test in either file uses that slug, so the
 * coupling it described did not exist.)
 */
const FIXTURE_LEAGUE_SLUGS = ['tsc', 'other'] as const;

async function plantLeagueRegistry(slugs: readonly string[]): Promise<void> {
  await setAppState(
    'leagues',
    'registry',
    slugs.map((slug) => ({
      slug,
      displayName: slug.toUpperCase(),
      year: 2025,
      createdAt: '2020-01-01T00:00:00.000Z',
      status: { state: 'season' as const, year: 2025 },
    }))
  );
}

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  restoreDatabaseUrl();
  __setAppStateReadFailureForTests(null);
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await plantLeagueRegistry(FIXTURE_LEAGUE_SLUGS);
});

test.afterEach(() => {
  __setAppStateReadFailureForTests(null);
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  restoreDatabaseUrl();
});

/**
 * Force the ARCHIVE read to throw the way a transient database failure would,
 * while the REGISTRY stays readable.
 *
 * IT USED TO BE THE GLOBAL SWITCH (`NODE_ENV=production` with no
 * `DATABASE_URL`), AND #778 MADE THAT VACUOUS — the review finding this
 * addresses, reproduced before it was believed. #778 put a registry read in
 * front of the archive read in both readers, and the global switch fails EVERY
 * scope, so the rejection these tests assert started coming from the registry
 * and `readSeasonArchiveFromStore` / `readArchiveYearsFromStore` were never
 * reached. Measured: with both readers mutated to swallow every store failure to
 * `null`/`[]`, the suite was 24/24 GREEN; removing only the two guard lines
 * turned exactly these four tests red. The property the file's longest comment
 * block exists to defend — a transient failure must reject so `unstable_cache`
 * never persists a bogus `null` under `revalidate: false` — had lost its only
 * coverage.
 *
 * The scoped seam is what restores it: it fails `standings-archive:<slug>` alone,
 * so the guard's registry read succeeds and the archive read is the one that
 * throws. `listAppStateKeys` did not honour the seam until #778 extended it,
 * which is why the global switch was used here in the first place.
 */
function forceArchiveReadFailure(slug: string): void {
  __setAppStateReadFailureForTests(new Error('archive read failed'), archiveScopeForTests(slug));
}

/** The scope string the archive readers use. `archiveScope` is private to
 * `seasonArchive.ts`, so this mirrors it — and every test below pairs the
 * failure with a control that reads the SAME scope successfully, which is what
 * proves the string is the real one rather than a drifted copy. */
function archiveScopeForTests(slug: string): string {
  return `standings-archive:${slug}`;
}

function makeArchive(
  overrides: Partial<SeasonArchive> & { leagueSlug: string; year: number }
): SeasonArchive {
  return {
    leagueSlug: overrides.leagueSlug,
    year: overrides.year,
    archivedAt: overrides.archivedAt ?? '2026-01-15T00:00:00.000Z',
    ownerRosterSnapshot: overrides.ownerRosterSnapshot ?? 'team,owner\nAlabama,Alice',
    standingsHistory: overrides.standingsHistory ?? { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: overrides.finalStandings ?? [],
    games: overrides.games ?? [],
    scoresByKey: overrides.scoresByKey ?? {},
  };
}

// ---------------------------------------------------------------------------
// Cache-key / tag helpers — the testable surface of the archive read cache.
// (unstable_cache itself falls back to direct reads under node:test, so the
// key/tag builders are where cross-league / cross-year isolation is asserted.)
// ---------------------------------------------------------------------------

test('archive cache key includes slug and year', () => {
  assert.deepEqual(seasonArchiveCacheKeyParts('tsc', 2025), ['season-archive', 'tsc', '2025']);
});

test('different leagues produce different archive cache keys', () => {
  assert.notDeepEqual(
    seasonArchiveCacheKeyParts('tsc', 2025),
    seasonArchiveCacheKeyParts('other', 2025)
  );
});

test('different years produce different archive cache keys', () => {
  assert.notDeepEqual(
    seasonArchiveCacheKeyParts('tsc', 2025),
    seasonArchiveCacheKeyParts('tsc', 2026)
  );
});

test('archive years cache key is slug-scoped', () => {
  assert.deepEqual(seasonArchiveYearsCacheKeyParts('tsc'), ['season-archive-years', 'tsc']);
  assert.notDeepEqual(
    seasonArchiveYearsCacheKeyParts('tsc'),
    seasonArchiveYearsCacheKeyParts('other')
  );
});

test('per-year archive read carries both slug and slug:year tags', () => {
  assert.equal(seasonArchiveSlugTag('tsc'), 'archive:tsc');
  assert.equal(seasonArchiveYearTag('tsc', 2025), 'archive:tsc:2025');
  // slug tag is shared across years so a single write can bust the year list.
  assert.equal(seasonArchiveSlugTag('tsc'), seasonArchiveSlugTag('tsc'));
  assert.notEqual(seasonArchiveYearTag('tsc', 2025), seasonArchiveYearTag('tsc', 2026));
});

// ---------------------------------------------------------------------------
// Read/write round-trip — the cache wrapper must not alter returned shape and
// must keep leagues / years isolated.
// ---------------------------------------------------------------------------

test('saveSeasonArchive round-trips through getSeasonArchive unchanged', async () => {
  const archive = makeArchive({ leagueSlug: 'tsc', year: 2025 });
  await saveSeasonArchive(archive);
  const read = await getSeasonArchive('tsc', 2025);
  assert.deepEqual(read, archive);
});

test('getSeasonArchive returns null for an unwritten league+year', async () => {
  assert.equal(await getSeasonArchive('tsc', 2025), null);
});

test('different leagues do not share cached archive data', async () => {
  await saveSeasonArchive(makeArchive({ leagueSlug: 'tsc', year: 2025 }));
  await saveSeasonArchive(makeArchive({ leagueSlug: 'other', year: 2025 }));

  const tsc = await getSeasonArchive('tsc', 2025);
  const other = await getSeasonArchive('other', 2025);

  assert.equal(tsc?.leagueSlug, 'tsc');
  assert.equal(other?.leagueSlug, 'other');
});

test('different years do not share cached archive data', async () => {
  await saveSeasonArchive(makeArchive({ leagueSlug: 'tsc', year: 2024 }));
  await saveSeasonArchive(makeArchive({ leagueSlug: 'tsc', year: 2025 }));

  assert.equal((await getSeasonArchive('tsc', 2024))?.year, 2024);
  assert.equal((await getSeasonArchive('tsc', 2025))?.year, 2025);
});

test('listSeasonArchives returns sorted years for the slug only', async () => {
  await saveSeasonArchive(makeArchive({ leagueSlug: 'tsc', year: 2025 }));
  await saveSeasonArchive(makeArchive({ leagueSlug: 'tsc', year: 2023 }));
  await saveSeasonArchive(makeArchive({ leagueSlug: 'tsc', year: 2024 }));
  await saveSeasonArchive(makeArchive({ leagueSlug: 'other', year: 2022 }));

  assert.deepEqual(await listSeasonArchives('tsc'), [2023, 2024, 2025]);
  assert.deepEqual(await listSeasonArchives('other'), [2022]);
});

test('listSeasonArchives returns [] for a league with no archives', async () => {
  assert.deepEqual(await listSeasonArchives('tsc'), []);
});

// ---------------------------------------------------------------------------
// Read-failure handling (Codex P1) — a transient store/database failure must
// reject and must NOT be swallowed to null/[] and cached. Only genuine
// emptiness (not-found archive, empty year list) is cacheable.
// ---------------------------------------------------------------------------

test('a store read failure propagates and is not swallowed to null', async () => {
  // CONTROL first: the archive is readable, so the rejection below can only be
  // the injected failure — not an absent fixture or a drifted scope string.
  await saveSeasonArchive(makeArchive({ leagueSlug: 'tsc', year: 2025 }));
  assert.ok(await getSeasonArchive('tsc', 2025), 'control: the archive must be readable');

  forceArchiveReadFailure('tsc');
  await assert.rejects(() => getSeasonArchive('tsc', 2025));
});

test('after a failed archive read, a subsequent successful read returns the archive', async () => {
  forceArchiveReadFailure('tsc');
  await assert.rejects(() => getSeasonArchive('tsc', 2025));

  // Store recovers: nothing bogus was cached, so the real archive is returned.
  __setAppStateReadFailureForTests(null);
  const archive = makeArchive({ leagueSlug: 'tsc', year: 2025 });
  await saveSeasonArchive(archive);

  assert.deepEqual(await getSeasonArchive('tsc', 2025), archive);
});

test('a year-list read failure propagates and is not swallowed to []', async () => {
  await saveSeasonArchive(makeArchive({ leagueSlug: 'tsc', year: 2025 }));
  assert.deepEqual(
    await listSeasonArchives('tsc'),
    [2025],
    'control: the year list must be readable'
  );

  forceArchiveReadFailure('tsc');
  await assert.rejects(() => listSeasonArchives('tsc'));
});

test('after a failed year-list read, a subsequent successful read returns the year list', async () => {
  forceArchiveReadFailure('tsc');
  await assert.rejects(() => listSeasonArchives('tsc'));

  __setAppStateReadFailureForTests(null);
  await saveSeasonArchive(makeArchive({ leagueSlug: 'tsc', year: 2024 }));
  await saveSeasonArchive(makeArchive({ leagueSlug: 'tsc', year: 2025 }));

  assert.deepEqual(await listSeasonArchives('tsc'), [2024, 2025]);
});

// ---------------------------------------------------------------------------
// Invalidation-failure discrimination (Codex P1) — saveSeasonArchive may only
// swallow the out-of-request-context `revalidateTag` Invariant; a genuine
// invalidation failure must propagate so the write is not falsely reported
// successful while stale (TTL-less) archive data lingers.
// ---------------------------------------------------------------------------

test('isMissingRequestStore recognizes the out-of-context revalidateTag Invariant', () => {
  const e263 = Object.assign(
    new Error('Invariant: static generation store missing in revalidateTag'),
    {
      __NEXT_ERROR_CODE: 'E263',
    }
  );
  assert.equal(isMissingRequestStore(e263), true);
  // Matched by message alone even if the error code shape changes.
  assert.equal(
    isMissingRequestStore(new Error('static generation store missing in revalidateTag')),
    true
  );
});

test('isMissingRequestStore rejects genuine invalidation failures and non-errors', () => {
  assert.equal(isMissingRequestStore(new Error('ECONNRESET talking to cache handler')), false);
  const unstableCacheMisuse = Object.assign(
    new Error('Route /x used "revalidateTag" inside a function cached with "unstable_cache(...)"'),
    { __NEXT_ERROR_CODE: 'E306' }
  );
  assert.equal(isMissingRequestStore(unstableCacheMisuse), false);
  assert.equal(isMissingRequestStore(undefined), false);
  assert.equal(isMissingRequestStore('static generation store missing'), false);
});

test('saveSeasonArchive tolerates the out-of-context invalidation Invariant (node:test path)', async () => {
  // node:test has no request context, so invalidateSeasonArchive throws E263;
  // the write must still succeed and be readable.
  const archive = makeArchive({ leagueSlug: 'tsc', year: 2025 });
  await assert.doesNotReject(() => saveSeasonArchive(archive));
  assert.deepEqual(await getSeasonArchive('tsc', 2025), archive);
});
