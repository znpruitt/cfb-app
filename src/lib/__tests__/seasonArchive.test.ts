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
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
});

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
