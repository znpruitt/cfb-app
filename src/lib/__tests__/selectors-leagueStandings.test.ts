import assert from 'node:assert/strict';
import test from 'node:test';

import { getCanonicalStandings, resolveStandingsYear } from '../selectors/leagueStandings.ts';
import type { League } from '../league.ts';
import type { SeasonArchive } from '../seasonArchive.ts';
import type { StandingsHistory, StandingsHistoryStandingRow } from '../standingsHistory.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../server/appStateStore.ts';

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

// ---------------------------------------------------------------------------
// Fixture builders (kept inline per project convention)
// ---------------------------------------------------------------------------

async function seedLeague(league: League): Promise<void> {
  await setAppState('leagues', 'registry', [league]);
}

function makeLeague(overrides: Partial<League> & { slug: string }): League {
  return {
    slug: overrides.slug,
    displayName: overrides.displayName ?? `League ${overrides.slug}`,
    year: overrides.year ?? 2025,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    ...(overrides.status ? { status: overrides.status } : {}),
    ...(overrides.foundedYear != null ? { foundedYear: overrides.foundedYear } : {}),
  };
}

function makeHistoryRow(
  owner: string,
  wins: number,
  losses: number,
  overrides?: Partial<StandingsHistoryStandingRow>
): StandingsHistoryStandingRow {
  const decisions = wins + losses;
  const winPct = decisions > 0 ? wins / decisions : 0;
  return {
    owner,
    wins,
    losses,
    ties: 0,
    winPct,
    pointsFor: overrides?.pointsFor ?? 0,
    pointsAgainst: overrides?.pointsAgainst ?? 0,
    pointDifferential:
      overrides?.pointDifferential ?? (overrides?.pointsFor ?? 0) - (overrides?.pointsAgainst ?? 0),
    gamesBack: overrides?.gamesBack ?? 0,
    finalGames: overrides?.finalGames ?? decisions,
  };
}

function emptyHistory(): StandingsHistory {
  return { weeks: [], byWeek: {}, byOwner: {} };
}

async function seedArchive(
  slug: string,
  year: number,
  finalStandings: StandingsHistoryStandingRow[],
  standingsHistory: StandingsHistory = emptyHistory()
): Promise<void> {
  const archive: SeasonArchive = {
    leagueSlug: slug,
    year,
    archivedAt: new Date().toISOString(),
    ownerRosterSnapshot: 'team,owner\n',
    standingsHistory,
    finalStandings,
    games: [],
    scoresByKey: {},
  };
  await setAppState(`standings-archive:${slug}`, String(year), archive);
}

async function seedOwnersCsv(slug: string, year: number, csvText: string): Promise<void> {
  await setAppState(`owners:${slug}:${year}`, 'csv', csvText);
}

async function seedPreseasonOwners(slug: string, year: number, owners: string[]): Promise<void> {
  await setAppState(`preseason-owners:${slug}`, String(year), owners);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('offseason with archive present: reads final standings from the archive', async () => {
  const slug = 't1-offseason-with-archive';
  await seedLeague(makeLeague({ slug, year: 2026, status: { state: 'offseason' } }));
  await seedArchive(slug, 2025, [
    makeHistoryRow('Alice', 10, 2, { pointsFor: 400, pointsAgainst: 200 }),
    makeHistoryRow('Bob', 8, 4, { pointsFor: 300, pointsAgainst: 250 }),
    makeHistoryRow('NoClaim', 50, 50, { pointsFor: 1000, pointsAgainst: 1000 }),
  ]);

  const snapshot = await getCanonicalStandings({
    slug,
    leagueStatusOverride: { state: 'offseason' },
  });

  assert.equal(snapshot.source, 'archive');
  assert.equal(snapshot.ownersRosterSource, 'archive');
  assert.equal(snapshot.archiveYearResolved, 2025);
  assert.equal(snapshot.year, 2025);
  assert.deepEqual(
    snapshot.rows.map((r) => r.owner),
    ['Alice', 'Bob']
  );
  assert.equal(snapshot.rows[0]!.wins, 10);
  assert.equal(snapshot.rows[0]!.pointsFor, 400);
  assert.notEqual(snapshot.noClaimRow, null);
  assert.equal(snapshot.noClaimRow!.owner, 'NoClaim');
  assert.equal(snapshot.standingsHistory !== null, true);
  assert.deepEqual(snapshot.ownerColorOrder, ['Alice', 'Bob']);
});

test('offseason with archive missing but live CSV: falls back to live derivation', async () => {
  const slug = 't2-offseason-live-fallback';
  await seedLeague(makeLeague({ slug, year: 2025, status: { state: 'offseason' } }));
  await seedOwnersCsv(slug, 2025, 'team,owner\nTexas,Alice\nGeorgia,Bob\nAir Force,NoClaim');

  const snapshot = await getCanonicalStandings({
    slug,
    leagueStatusOverride: { state: 'offseason' },
  });

  assert.equal(snapshot.source, 'live');
  assert.equal(snapshot.ownersRosterSource, 'csv');
  assert.equal(snapshot.archiveYearResolved, null);
  assert.equal(snapshot.year, 2025);
  // CSV-derived owners come back alphabetically at 0-0 since no games cached.
  assert.deepEqual(snapshot.rows.map((r) => r.owner).sort(), ['Alice', 'Bob']);
  assert.notEqual(snapshot.noClaimRow, null);
  assert.equal(snapshot.noClaimRow!.owner, 'NoClaim');
  assert.equal(snapshot.standingsHistory !== null, true);
  assert.equal(snapshot.standingsHistory!.weeks.length, 0);
});

test('offseason with archive missing and no CSV: empty snapshot', async () => {
  const slug = 't3-offseason-empty';
  await seedLeague(makeLeague({ slug, year: 2025, status: { state: 'offseason' } }));

  const snapshot = await getCanonicalStandings({
    slug,
    leagueStatusOverride: { state: 'offseason' },
  });

  assert.equal(snapshot.source, 'empty');
  assert.equal(snapshot.ownersRosterSource, 'none');
  assert.deepEqual(snapshot.rows, []);
  assert.equal(snapshot.noClaimRow, null);
  assert.equal(snapshot.standingsHistory, null);
});

test('season live with CSV: produces per-owner rows at the correct shape', async () => {
  const slug = 't4-season-live';
  await seedLeague(makeLeague({ slug, year: 2025, status: { state: 'season', year: 2025 } }));
  await seedOwnersCsv(
    slug,
    2025,
    [
      'team,owner',
      'Texas,Alice',
      'Georgia,Alice',
      'Oregon,Bob',
      'Michigan,Bob',
      'Air Force,NoClaim',
      'Army,NoClaim',
    ].join('\n')
  );

  const snapshot = await getCanonicalStandings({
    slug,
    leagueStatusOverride: { state: 'season', year: 2025 },
  });

  assert.equal(snapshot.source, 'live');
  assert.equal(snapshot.ownersRosterSource, 'csv');
  assert.equal(snapshot.year, 2025);
  // Two real owners; NoClaim segregated.
  assert.deepEqual(snapshot.rows.map((r) => r.owner).sort(), ['Alice', 'Bob']);
  for (const row of snapshot.rows) {
    assert.equal(row.wins, 0);
    assert.equal(row.losses, 0);
    assert.equal(row.winPct, 0);
    assert.equal(row.pointsFor, 0);
    assert.equal(row.pointsAgainst, 0);
    assert.equal(row.pointDifferential, 0);
    assert.equal(row.gamesBack, 0);
    assert.equal(row.finalGames, 0);
  }
  assert.notEqual(snapshot.noClaimRow, null);
  assert.equal(snapshot.noClaimRow!.owner, 'NoClaim');
  assert.equal(snapshot.standingsHistory !== null, true);
});

test('preseason with CSV (draft complete): live-derived 0-0 rows, NoClaim segregated', async () => {
  const slug = 't5-preseason-csv';
  const year = 2026;
  await seedLeague(makeLeague({ slug, year, status: { state: 'preseason', year } }));
  await seedOwnersCsv(
    slug,
    year,
    ['team,owner', 'Texas,Alice', 'Georgia,Bob', 'Oregon,Carol', 'Air Force,NoClaim'].join('\n')
  );

  const snapshot = await getCanonicalStandings({
    slug,
    leagueStatusOverride: { state: 'preseason', year },
  });

  assert.equal(snapshot.source, 'live');
  assert.equal(snapshot.ownersRosterSource, 'csv');
  assert.equal(snapshot.year, year);
  assert.deepEqual(snapshot.rows.map((r) => r.owner).sort(), ['Alice', 'Bob', 'Carol']);
  assert.notEqual(snapshot.noClaimRow, null);
  assert.equal(snapshot.noClaimRow!.owner, 'NoClaim');
  // Empty games → empty standingsHistory shape, not null.
  assert.equal(snapshot.standingsHistory !== null, true);
  assert.equal(snapshot.standingsHistory!.weeks.length, 0);
  assert.deepEqual(snapshot.ownerColorOrder, ['Alice', 'Bob', 'Carol']);
});

test('preseason with preseason-owners only: synthesized alphabetical 0-0 rows', async () => {
  const slug = 't6-preseason-names';
  const year = 2026;
  await seedLeague(makeLeague({ slug, year, status: { state: 'preseason', year } }));
  await seedPreseasonOwners(slug, year, [
    'charlie',
    'Alice',
    'bob',
    'ZACHARY',
    'Alice', // duplicate — should be deduped
  ]);

  const snapshot = await getCanonicalStandings({
    slug,
    leagueStatusOverride: { state: 'preseason', year },
  });

  assert.equal(snapshot.source, 'preseason-names');
  assert.equal(snapshot.ownersRosterSource, 'preseason-owners');
  assert.equal(snapshot.year, year);
  assert.equal(snapshot.noClaimRow, null);
  assert.equal(snapshot.standingsHistory, null);
  // Alphabetical case-insensitive sort — ZACHARY last.
  assert.deepEqual(
    snapshot.rows.map((r) => r.owner),
    ['Alice', 'bob', 'charlie', 'ZACHARY']
  );
  for (const row of snapshot.rows) {
    assert.equal(row.wins, 0);
    assert.equal(row.losses, 0);
    assert.equal(row.winPct, 0);
    assert.equal(row.pointDifferential, 0);
    assert.equal(row.gamesBack, 0);
  }
});

test('preseason with CSV containing only NoClaim: falls through to preseason-owners if present', async () => {
  const slug = 't6b-preseason-csv-noclaim-only';
  const year = 2026;
  await seedLeague(makeLeague({ slug, year, status: { state: 'preseason', year } }));
  // Degenerate CSV containing only NoClaim teams — technically "roster present"
  // by size but no real owners. Selector still treats it as live because roster
  // has size > 0; the resulting rows are empty (NoClaim stripped) but noClaimRow
  // populated. This captures the edge case where the CSV write path wrote only
  // the fallback rows.
  await seedOwnersCsv(slug, year, ['team,owner', 'Air Force,NoClaim', 'Army,NoClaim'].join('\n'));

  const snapshot = await getCanonicalStandings({
    slug,
    leagueStatusOverride: { state: 'preseason', year },
  });

  assert.equal(snapshot.source, 'live');
  assert.deepEqual(snapshot.rows, []);
  assert.notEqual(snapshot.noClaimRow, null);
  assert.equal(snapshot.noClaimRow!.owner, 'NoClaim');
});

test('preseason empty (nothing seeded beyond league): empty snapshot', async () => {
  const slug = 't7-preseason-empty';
  const year = 2026;
  await seedLeague(makeLeague({ slug, year, status: { state: 'preseason', year } }));

  const snapshot = await getCanonicalStandings({
    slug,
    leagueStatusOverride: { state: 'preseason', year },
  });

  assert.equal(snapshot.source, 'empty');
  assert.equal(snapshot.ownersRosterSource, 'none');
  assert.deepEqual(snapshot.rows, []);
  assert.equal(snapshot.noClaimRow, null);
  assert.equal(snapshot.standingsHistory, null);
  assert.equal(snapshot.year, year);
});

test('NoClaim in archive: stripped from rows, preserved on noClaimRow', async () => {
  const slug = 't8-noclaim-in-archive';
  await seedLeague(makeLeague({ slug, year: 2026, status: { state: 'offseason' } }));
  await seedArchive(slug, 2025, [
    makeHistoryRow('NoClaim', 100, 50, { pointsFor: 5000, pointsAgainst: 3000 }),
    makeHistoryRow('Alice', 10, 2),
  ]);

  const snapshot = await getCanonicalStandings({
    slug,
    leagueStatusOverride: { state: 'offseason' },
  });

  assert.deepEqual(
    snapshot.rows.map((r) => r.owner),
    ['Alice']
  );
  assert.notEqual(snapshot.noClaimRow, null);
  assert.equal(snapshot.noClaimRow!.owner, 'NoClaim');
  assert.equal(snapshot.noClaimRow!.wins, 100);
});

test('unknown slug: returns empty snapshot without throwing', async () => {
  const snapshot = await getCanonicalStandings({
    slug: 'does-not-exist',
    year: 2099,
  });

  assert.equal(snapshot.source, 'empty');
  assert.equal(snapshot.ownersRosterSource, 'none');
  assert.deepEqual(snapshot.rows, []);
  assert.equal(snapshot.noClaimRow, null);
});

test('react cache sanity: two calls with identical args yield deeply equal snapshots', async () => {
  // React.cache dedupes by reference-equality on primitive args. In the Node
  // test harness (no React request), the behavior may or may not cache; we
  // verify determinism — same inputs, same output — which is the property
  // consumers rely on regardless of cache state.
  const slug = 't10-cache-sanity';
  const year = 2026;
  await seedLeague(makeLeague({ slug, year, status: { state: 'preseason', year } }));
  await seedPreseasonOwners(slug, year, ['Alice', 'Bob', 'Carol']);

  const first = await getCanonicalStandings({ slug });
  const second = await getCanonicalStandings({ slug });

  assert.equal(first.source, second.source);
  assert.equal(first.ownersRosterSource, second.ownersRosterSource);
  assert.deepEqual(
    first.rows.map((r) => r.owner),
    second.rows.map((r) => r.owner)
  );
  assert.deepEqual(first.ownerColorOrder, second.ownerColorOrder);
});

test('year override: offseason uses the most-recent archive year regardless of override', async () => {
  // Year override in offseason should still resolve through the archive lookup
  // path. Seed an archive for 2024 and a league in offseason; passing year=2030
  // should still return the 2024 archive.
  const slug = 't11-offseason-year-resolution';
  await seedLeague(makeLeague({ slug, year: 2026, status: { state: 'offseason' } }));
  await seedArchive(slug, 2024, [makeHistoryRow('Alice', 12, 0)]);

  const snapshot = await getCanonicalStandings({
    slug,
    year: 2030,
    leagueStatusOverride: { state: 'offseason' },
  });

  // Override-year 2030 has no archive; selector treats 2030 as the target year
  // and falls through live derivation (no CSV for 2030) → empty.
  assert.equal(snapshot.source, 'empty');
  assert.equal(snapshot.year, 2030);

  // Without the override, selector resolves to the most-recent archived year
  // (2024) for the same slug.
  const defaultSnapshot = await getCanonicalStandings({
    slug,
    leagueStatusOverride: { state: 'offseason' },
  });
  assert.equal(defaultSnapshot.source, 'archive');
  assert.equal(defaultSnapshot.archiveYearResolved, 2024);
  assert.equal(defaultSnapshot.year, 2024);
  assert.deepEqual(
    defaultSnapshot.rows.map((r) => r.owner),
    ['Alice']
  );
  assert.equal(defaultSnapshot.rows[0]!.wins, 12);
});

test('season state with archive already written for that year: reads archive', async () => {
  const slug = 't12-season-archived-edge';
  await seedLeague(makeLeague({ slug, year: 2025, status: { state: 'season', year: 2025 } }));
  await seedArchive(slug, 2025, [
    makeHistoryRow('Alice', 12, 0, { pointsFor: 500, pointsAgainst: 200 }),
    makeHistoryRow('Bob', 6, 6),
  ]);

  const snapshot = await getCanonicalStandings({
    slug,
    leagueStatusOverride: { state: 'season', year: 2025 },
  });

  assert.equal(snapshot.source, 'archive');
  assert.equal(snapshot.archiveYearResolved, 2025);
  assert.deepEqual(
    snapshot.rows.map((r) => r.owner),
    ['Alice', 'Bob']
  );
});

test('status override resolves year from override when input.year omitted', async () => {
  const slug = 't13-status-year-resolution';
  await seedLeague(makeLeague({ slug, year: 2024 }));
  await seedOwnersCsv(slug, 2027, 'team,owner\nTexas,Zara\n');

  const snapshot = await getCanonicalStandings({
    slug,
    leagueStatusOverride: { state: 'preseason', year: 2027 },
  });

  assert.equal(snapshot.source, 'live');
  assert.equal(snapshot.year, 2027);
  assert.deepEqual(
    snapshot.rows.map((r) => r.owner),
    ['Zara']
  );
});

// ---------------------------------------------------------------------------
// resolveStandingsYear — guards FINDING-2 (Codex remediation): cache key must
// reflect the resolved year so default-year requests don't collapse onto a
// shared 'null' key across season transitions.
// ---------------------------------------------------------------------------

test('resolveStandingsYear: returns yearOverride when provided, even if league missing', async () => {
  // No league seeded; override should still pass through unchanged.
  const resolved = await resolveStandingsYear('does-not-exist', 2099);
  assert.equal(resolved, 2099);
});

test('resolveStandingsYear: returns league.status.year for season state', async () => {
  const slug = 't14-resolve-season';
  await seedLeague(makeLeague({ slug, year: 2024, status: { state: 'season', year: 2025 } }));

  const resolved = await resolveStandingsYear(slug, null);
  assert.equal(resolved, 2025);
});

test('resolveStandingsYear: returns league.status.year for preseason state', async () => {
  const slug = 't15-resolve-preseason';
  await seedLeague(makeLeague({ slug, year: 2024, status: { state: 'preseason', year: 2026 } }));

  const resolved = await resolveStandingsYear(slug, null);
  assert.equal(resolved, 2026);
});

test('resolveStandingsYear: falls back to league.year for offseason status (no year on status)', async () => {
  const slug = 't16-resolve-offseason';
  await seedLeague(makeLeague({ slug, year: 2024, status: { state: 'offseason' } }));

  const resolved = await resolveStandingsYear(slug, null);
  assert.equal(resolved, 2024);
});

test('resolveStandingsYear: falls back to league.year when status is undefined', async () => {
  const slug = 't17-resolve-no-status';
  await seedLeague(makeLeague({ slug, year: 2023 }));

  const resolved = await resolveStandingsYear(slug, null);
  assert.equal(resolved, 2023);
});

test('resolveStandingsYear: returns null for unknown slug with no override', async () => {
  // No league seeded; resolution must return null so the cache key carries
  // no spurious year, and computeCanonicalStandings handles the empty case.
  const resolved = await resolveStandingsYear('does-not-exist', null);
  assert.equal(resolved, null);
});

test('default-year request honors league status year (no cache collision across seasons)', async () => {
  // Two leagues with different status years should resolve to the correct
  // canonical year when called with the default-year shape (no `year` arg).
  // Previously, both would share cache key 'null' and could leak snapshots.
  const slugA = 't18-default-year-a';
  const slugB = 't18-default-year-b';
  await setAppState('leagues', 'registry', [
    makeLeague({ slug: slugA, year: 2024, status: { state: 'season', year: 2024 } }),
    makeLeague({ slug: slugB, year: 2024, status: { state: 'season', year: 2025 } }),
  ]);
  await seedOwnersCsv(slugA, 2024, 'team,owner\nTexas,Alice\n');
  await seedOwnersCsv(slugB, 2025, 'team,owner\nOhio State,Bob\n');

  const snapshotA = await getCanonicalStandings({ slug: slugA });
  const snapshotB = await getCanonicalStandings({ slug: slugB });

  assert.equal(snapshotA.year, 2024);
  assert.equal(snapshotB.year, 2025);
  assert.deepEqual(
    snapshotA.rows.map((r) => r.owner),
    ['Alice']
  );
  assert.deepEqual(
    snapshotB.rows.map((r) => r.owner),
    ['Bob']
  );
});

test('offseason default-year request falls back to most recent archive', async () => {
  // Regression guard: the cache wrapping must NOT pass the resolved year
  // (league.year) into computeCanonicalStandings as an explicit override.
  // resolveOffseason treats any non-null override as authoritative and
  // skips the mostRecentArchivedYear lookup. With null preserved, offseason
  // leagues fall back to the most recent archive's final standings.
  const slug = 't19-offseason-default-archive-fallback';
  await seedLeague(makeLeague({ slug, year: 2026, status: { state: 'offseason' } }));
  await seedArchive(slug, 2025, [
    makeHistoryRow('Alice', 11, 1, { pointsFor: 420, pointsAgainst: 200 }),
    makeHistoryRow('Bob', 7, 5, { pointsFor: 310, pointsAgainst: 290 }),
  ]);

  const snapshot = await getCanonicalStandings({ slug });

  assert.equal(snapshot.source, 'archive');
  assert.equal(snapshot.archiveYearResolved, 2025);
  assert.equal(snapshot.year, 2025);
  assert.deepEqual(
    snapshot.rows.map((r) => r.owner),
    ['Alice', 'Bob']
  );
});

test('resolveStandingsYear: offseason default returns most recent archive year', async () => {
  const slug = 't20-offseason-resolve-archive';
  await seedLeague(makeLeague({ slug, year: 2026, status: { state: 'offseason' } }));
  await seedArchive(slug, 2024, [makeHistoryRow('Alice', 8, 4)]);
  await seedArchive(slug, 2025, [makeHistoryRow('Alice', 10, 2)]);

  const resolved = await resolveStandingsYear(slug, null);
  assert.equal(resolved, 2025);
});

test('resolveStandingsYear: offseason with no archives falls back to league.year', async () => {
  const slug = 't21-offseason-resolve-no-archives';
  await seedLeague(makeLeague({ slug, year: 2026, status: { state: 'offseason' } }));

  const resolved = await resolveStandingsYear(slug, null);
  assert.equal(resolved, 2026);
});

test('offseason default and explicit-year requests do not collide in cache', async () => {
  // Cache-key separation: a default-year request resolves to the most
  // recent archive year (2025), while an explicit `year: league.year`
  // request resolves to 2026. They must produce distinct snapshots and
  // must not poison each other regardless of evaluation order.
  const slug = 't22-offseason-no-key-collision';
  await seedLeague(makeLeague({ slug, year: 2026, status: { state: 'offseason' } }));
  await seedArchive(slug, 2025, [
    makeHistoryRow('Alice', 12, 0, { pointsFor: 460, pointsAgainst: 180 }),
  ]);

  const defaultSnapshot = await getCanonicalStandings({ slug });
  const explicitSnapshot = await getCanonicalStandings({ slug, year: 2026 });

  // Default falls back to the 2025 archive.
  assert.equal(defaultSnapshot.source, 'archive');
  assert.equal(defaultSnapshot.archiveYearResolved, 2025);
  assert.equal(defaultSnapshot.year, 2025);
  assert.deepEqual(
    defaultSnapshot.rows.map((r) => r.owner),
    ['Alice']
  );

  // Explicit 2026 has no archive and no live CSV, so it returns an empty
  // snapshot for that target year. Critically, it must NOT inherit the
  // 2025 archive's rows, which would happen under a key collision.
  assert.equal(explicitSnapshot.year, 2026);
  assert.notEqual(explicitSnapshot.source, 'archive');
  assert.deepEqual(explicitSnapshot.rows, []);
});

test('resolveStandingsYear: missing status returns league.year (not archive year)', async () => {
  // Regression guard: leagues created via /api/admin/leagues default to no
  // status. computeCanonicalStandings synthesizes `{ state: 'season', year:
  // league.year }` for that case, so the cache key must use league.year —
  // not mostRecentArchivedYear, which would route default-year requests
  // through the archive-resolution path while the actual computation runs
  // for the active year.
  const slug = 't23-missing-status-uses-league-year';
  await seedLeague(makeLeague({ slug, year: 2026 })); // no status
  await seedArchive(slug, 2025, [makeHistoryRow('Alice', 9, 3)]);

  const resolved = await resolveStandingsYear(slug, null);
  assert.equal(resolved, 2026);
});
