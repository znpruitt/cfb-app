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
  type SeasonArchive,
} from '../seasonArchive.ts';
import { __deleteAppStateFileForTests, __resetAppStateForTests } from '../server/appStateStore.ts';

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

test.beforeEach(async () => {
  MUTABLE_ENV.NODE_ENV = 'development';
  restoreDatabaseUrl();
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  restoreDatabaseUrl();
});

/**
 * Force the app-state store to throw on read the way a transient database
 * failure would: `NODE_ENV=production` without `DATABASE_URL` makes every
 * `getAppState`/`listAppStateKeys` call throw `APP_STATE_PRODUCTION_CONFIG_ERROR`
 * before it touches any backend. Used to prove read failures propagate rather
 * than being swallowed to `null`/`[]` and cached.
 */
function forceStoreReadFailure(): void {
  MUTABLE_ENV.NODE_ENV = 'production';
  delete MUTABLE_ENV.DATABASE_URL;
  __resetAppStateForTests();
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
  forceStoreReadFailure();
  await assert.rejects(() => getSeasonArchive('tsc', 2025));
});

test('after a failed archive read, a subsequent successful read returns the archive', async () => {
  forceStoreReadFailure();
  await assert.rejects(() => getSeasonArchive('tsc', 2025));

  // Store recovers: nothing bogus was cached, so the real archive is returned.
  MUTABLE_ENV.NODE_ENV = 'development';
  restoreDatabaseUrl();
  __resetAppStateForTests();
  const archive = makeArchive({ leagueSlug: 'tsc', year: 2025 });
  await saveSeasonArchive(archive);

  assert.deepEqual(await getSeasonArchive('tsc', 2025), archive);
});

test('a year-list read failure propagates and is not swallowed to []', async () => {
  forceStoreReadFailure();
  await assert.rejects(() => listSeasonArchives('tsc'));
});

test('after a failed year-list read, a subsequent successful read returns the year list', async () => {
  forceStoreReadFailure();
  await assert.rejects(() => listSeasonArchives('tsc'));

  MUTABLE_ENV.NODE_ENV = 'development';
  restoreDatabaseUrl();
  __resetAppStateForTests();
  await saveSeasonArchive(makeArchive({ leagueSlug: 'tsc', year: 2024 }));
  await saveSeasonArchive(makeArchive({ leagueSlug: 'tsc', year: 2025 }));

  assert.deepEqual(await listSeasonArchives('tsc'), [2024, 2025]);
});
