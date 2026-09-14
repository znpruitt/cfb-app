import assert from 'node:assert/strict';
import test from 'node:test';

import { getSeasonArchive, listSeasonArchives, type SeasonArchive } from '../seasonArchive.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateReadFailureForTests,
  setAppState,
} from '../server/appStateStore.ts';

/**
 * #778 — the unknown-slug guard in the archive authority.
 *
 * WHAT MAKES EVERY REFUSAL TEST HERE NON-VACUOUS, stated first because it is the
 * only thing that keeps this file honest. A test that asserts `null` for an
 * unknown slug passes just as happily when the archive was never planted, when
 * the scope string drifted, or when the reader is broken outright — three ways
 * to be green while proving nothing. So every refusal below PLANTS A REAL
 * ARCHIVE AT THE SAME STORE KEY and is paired with a control that plants the
 * league too and asserts the archive IS served. The control can only pass if the
 * fixture reaches the reader, which means the refusal's `null` can only come
 * from the guard.
 *
 * THE SCOPE LITERAL IS HAND-WRITTEN because `archiveScope` is private to
 * `seasonArchive.ts` — the same constraint `seasonArchiveYearBound.test.ts`
 * works under, and the same control closes it.
 */

const KNOWN_SLUG = 'unknown-slug-known';
const UNKNOWN_SLUG = 'unknown-slug-absent';
const YEAR = 2024;

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;
const MUTABLE_ENV = process.env as Record<string, string | undefined>;

// Assigning `undefined` to a `process.env` key stores the string "undefined"
// (which reads as configured); delete instead when the original was unset.
function restoreDatabaseUrl(): void {
  if (ORIGINAL_DATABASE_URL === undefined) delete MUTABLE_ENV.DATABASE_URL;
  else MUTABLE_ENV.DATABASE_URL = ORIGINAL_DATABASE_URL;
}

function archive(slug: string, year: number): SeasonArchive {
  return {
    leagueSlug: slug,
    year,
    archivedAt: '2025-01-01T00:00:00.000Z',
    ownerRosterSnapshot: 'team,owner\nTexas,Alice\n',
    standingsHistory: { weeks: [], byWeek: {}, byOwner: {} },
    finalStandings: [],
    games: [],
    scoresByKey: {},
  } as unknown as SeasonArchive;
}

/** Plant an archive at the store key the reader looks under, registry or not. */
async function plantArchive(slug: string, year: number): Promise<void> {
  await setAppState(`standings-archive:${slug}`, String(year), archive(slug, year));
}

/** Plant a registry holding exactly the given slugs — and nothing else. */
async function plantRegistry(slugs: readonly string[]): Promise<void> {
  await setAppState(
    'leagues',
    'registry',
    slugs.map((slug) => ({
      slug,
      displayName: slug,
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
});

test.afterEach(() => {
  __setAppStateReadFailureForTests(null);
});

test.after(() => {
  MUTABLE_ENV.NODE_ENV = ORIGINAL_NODE_ENV;
  restoreDatabaseUrl();
});

// ---------------------------------------------------------------------------
// getSeasonArchive
// ---------------------------------------------------------------------------

test('CONTROL: a planted archive IS served when a league holds the slug', async () => {
  await plantRegistry([KNOWN_SLUG]);
  await plantArchive(KNOWN_SLUG, YEAR);

  const read = await getSeasonArchive(KNOWN_SLUG, YEAR);
  assert.equal(
    read?.year,
    YEAR,
    'the fixture must reach the reader, or every refusal below proves nothing'
  );
});

test('#778: getSeasonArchive returns null for a slug NO league holds, archive present', async () => {
  // The registry holds a DIFFERENT league, so the read is refused for naming an
  // absent one — not because the registry is empty.
  await plantRegistry([KNOWN_SLUG]);
  await plantArchive(UNKNOWN_SLUG, YEAR);

  assert.equal(
    await getSeasonArchive(UNKNOWN_SLUG, YEAR),
    null,
    'an archive sitting at the store key must NOT be served under a slug no league holds'
  );
});

// ---------------------------------------------------------------------------
// listSeasonArchives — the sibling that mints its own cache identity under the
// same `archive:<slug>` tag, and the reason the refusal went into the authority
// rather than into the two routes.
// ---------------------------------------------------------------------------

test('CONTROL: listSeasonArchives returns the years when a league holds the slug', async () => {
  await plantRegistry([KNOWN_SLUG]);
  await plantArchive(KNOWN_SLUG, 2022);
  await plantArchive(KNOWN_SLUG, 2023);

  assert.deepEqual(
    await listSeasonArchives(KNOWN_SLUG),
    [2022, 2023],
    'the fixture must reach the reader, or the refusal below proves nothing'
  );
});

test('#778: listSeasonArchives returns [] for a slug NO league holds, archives present', async () => {
  await plantRegistry([KNOWN_SLUG]);
  await plantArchive(UNKNOWN_SLUG, 2022);
  await plantArchive(UNKNOWN_SLUG, 2023);

  assert.deepEqual(
    await listSeasonArchives(UNKNOWN_SLUG),
    [],
    'years sitting in the store must NOT be listed under a slug no league holds'
  );
});

// ---------------------------------------------------------------------------
// The guard must not swallow an outage.
//
// This is the property most easily lost. `getLeague` returns `null` for a league
// that is absent AND the store read for it can THROW — so a guard written as
// `try { ... } catch { return null }` would turn "the database is down" into
// "this league does not exist", and `unstable_cache` would then persist that
// `null` under `revalidate: false`. The guard deliberately does not catch.
// ---------------------------------------------------------------------------

test('#778: a REGISTRY read failure propagates — an outage is never read as "unknown league"', async () => {
  await plantRegistry([KNOWN_SLUG]);
  await plantArchive(KNOWN_SLUG, YEAR);

  // Scoped to the registry alone, so this test is about the read the GUARD
  // makes. The first version used the global `NODE_ENV=production` switch, which
  // fails every scope — it could not distinguish the guard's read from the
  // archive read, and that ambiguity is exactly what made four pre-existing
  // tests in `seasonArchive.test.ts` vacuous when #778 landed. Both properties
  // are real and now each has its own test: the archive read's failure
  // propagates (there), the registry read's does (here).
  __setAppStateReadFailureForTests(new Error('registry read failed'), 'leagues');

  await assert.rejects(
    () => getSeasonArchive(KNOWN_SLUG, YEAR),
    'a registry read failure must reject, never resolve to null'
  );
  await assert.rejects(
    () => listSeasonArchives(KNOWN_SLUG),
    'a registry read failure must reject, never resolve to []'
  );

  // And the same fixture reads cleanly once the store is back — proving the
  // rejection was the outage and not a permanently broken fixture.
  __setAppStateReadFailureForTests(null);
  assert.equal((await getSeasonArchive(KNOWN_SLUG, YEAR))?.year, YEAR);
  assert.deepEqual(await listSeasonArchives(KNOWN_SLUG), [YEAR]);
});

// ---------------------------------------------------------------------------
// An ABSENT registry is not an outage, and the behaviour is worth pinning
// because it is the one case where the guard changes a previously-working read.
// ---------------------------------------------------------------------------

test('#778: with NO registry at all, archives are unreadable — recorded, not incidental', async () => {
  // `readLeagueRegistry` classifies an absent record as `missing` and
  // `getLeagues` flattens that to `[]`, so no slug is held and every archive
  // read declines. Nothing in production reaches this: every page and the
  // rollover cron resolve a league from this same registry first, so a store
  // with archives and no registry has no surface that could ask for one. Pinned
  // so a future change to that flattening has to come past this assertion.
  await plantArchive(KNOWN_SLUG, YEAR);

  assert.equal(await getSeasonArchive(KNOWN_SLUG, YEAR), null);
  assert.deepEqual(await listSeasonArchives(KNOWN_SLUG), []);

  // Control: the identical fixture is served the moment a registry exists, so
  // the two assertions above are about the registry and nothing else.
  await plantRegistry([KNOWN_SLUG]);
  assert.equal((await getSeasonArchive(KNOWN_SLUG, YEAR))?.year, YEAR);
  assert.deepEqual(await listSeasonArchives(KNOWN_SLUG), [YEAR]);
});

test('#778: a MALFORMED registry THROWS rather than reading as "no such league"', async () => {
  // Review finding. `getLeagues()` flattens `missing` and `malformed` alike to
  // `[]`, so the obvious guard would answer a CORRUPT registry with a confident
  // "this league does not exist" — and `debug/archive-audit`, the tool for
  // diagnosing that corruption, would say `404 league-not-found` and send the
  // operator hunting a slug typo. The two states are discriminated deliberately:
  // `missing` is absence (pinned above), `malformed` is a fault.
  await plantArchive(KNOWN_SLUG, YEAR);
  await setAppState('leagues', 'registry', { notAnArray: true });

  await assert.rejects(
    () => getSeasonArchive(KNOWN_SLUG, YEAR),
    /malformed/,
    'a corrupt registry must not read as "this league has no archive"'
  );
  await assert.rejects(
    () => listSeasonArchives(KNOWN_SLUG),
    /malformed/,
    'a corrupt registry must not read as "this league has no archives"'
  );

  // Control: the SAME fixture reads cleanly once the registry is well-formed, so
  // the rejections above are the malformed value and not the archive.
  await plantRegistry([KNOWN_SLUG]);
  assert.equal((await getSeasonArchive(KNOWN_SLUG, YEAR))?.year, YEAR);
  assert.deepEqual(await listSeasonArchives(KNOWN_SLUG), [YEAR]);
});
