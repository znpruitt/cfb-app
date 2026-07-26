import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregateOwnerSeasonStats } from '../ownerStats.ts';
import { toAnalyticsGameStats, type AnalyticsGameStats } from '../contract.ts';
import { createTeamIdentityResolver } from '../../teamIdentity.ts';
import { completeLegacyRow, legacyRowFromWire, wireGame } from './fixtures.ts';

// PLATFORM-086H3E3: owner aggregation consumes ONLY the projected analytics
// type. The H1-era pins asserting that raw/malformed/statless rows still
// aggregate are gone BY DESIGN — exclusion now happens upstream in
// `projectAnalyticsPartition`, and the aggregation boundary makes raw
// persisted rows a compile error.

const resolver = createTeamIdentityResolver({ teams: [], aliasMap: {}, observedNames: [] });
const roster = new Map<string, string>([
  ['Alpha State', 'Alice'],
  ['Beta Tech', 'Bob'],
]);

/** A projected analytics row built through the REAL converter. */
function analyticsRow(id: number): AnalyticsGameStats {
  const converted = toAnalyticsGameStats(completeLegacyRow(id));
  assert.ok(converted, 'fixture row converts through the real analytics projection');
  return converted!;
}

test('aggregation reads the projected analytics values', () => {
  const row = analyticsRow(1);
  const stats = aggregateOwnerSeasonStats([[row]], roster, resolver, 2024);
  const alice = stats.find((s) => s.owner === 'Alice');
  assert.ok(alice);
  assert.equal(alice!.gamesPlayed, 1);
  assert.equal(alice!.points, row.home.points);
  assert.equal(alice!.totalYards, row.home.totalYards);
  assert.equal(alice!.passingYards, row.home.passingYards);
  assert.equal(alice!.possessionSeconds, row.home.possessionSeconds);
  assert.equal(alice!.pointsAgainst, row.away.points);
  const bob = stats.find((s) => s.owner === 'Bob');
  assert.ok(bob);
  assert.equal(bob!.turnoversForced, row.home.turnovers);
});

test('season aggregation accumulates across partitions', () => {
  const seasonStats = aggregateOwnerSeasonStats(
    [[analyticsRow(40)], [analyticsRow(41)]],
    roster,
    resolver,
    2024
  );
  const alice = seasonStats.find((s) => s.owner === 'Alice');
  assert.ok(alice);
  assert.equal(alice!.gamesPlayed, 2);
  assert.equal(alice!.season, 2024);
  assert.equal(alice!.totalYards, 412 * 2);
  assert.equal(alice!.turnoversForced, 2);
});

test('COMPILE boundary: raw persisted rows must not typecheck', () => {
  const raw = completeLegacyRow(1);
  // The projection's required `source` discriminant does not exist on persisted
  // rows, so handing raw partition contents to owner aggregation is a compile
  // error — the activation contract's accidental-raw-consumption seam.
  // @ts-expect-error raw persisted GameStats must never enter owner aggregation
  const stats = aggregateOwnerSeasonStats([[raw]], roster, resolver, 2024);
  // Runtime still sums whatever it was handed (fields overlap), which is
  // exactly why the boundary must be compile-time.
  assert.ok(Array.isArray(stats));
});

// ---------------------------------------------------------------------------
// PLATFORM-086-TEAM-CATALOG-DERIVED-ALIAS-SAFETY: production-shaped regression
// for the corrected catalog INPUT. A stored CFBD row labeled bare "San Diego"
// (University of San Diego, uncataloged FCS) must never be credited to the
// owner who rosters "San Diego State" — the pre-fix generated `sandiego` alt
// caused exactly that attribution. Rows convert through the real analytics
// projection first (both are complete), so the attribution seam under test is
// the same one production now runs.
// ---------------------------------------------------------------------------

import teamsCatalogForOwnerStats from '../../../data/teams.json';
import type { TeamCatalogItem } from '../../teamIdentity.ts';

test('a stored bare-"San Diego" row is not credited to the San Diego State owner', () => {
  const catalog = teamsCatalogForOwnerStats.items as unknown as TeamCatalogItem[];
  const realResolver = createTeamIdentityResolver({
    teams: catalog,
    aliasMap: {},
    observedNames: ['San Diego', 'Butler', 'San Diego State', 'Beta Tech'],
  });
  const sdsuRoster = new Map<string, string>([['San Diego State', 'SDSUOwner']]);

  const usdRow = toAnalyticsGameStats(
    legacyRowFromWire(
      wireGame({
        id: 900,
        home: { school: 'San Diego', teamId: 5001 },
        away: { school: 'Butler', teamId: 5002 },
      })
    )
  );
  assert.ok(usdRow);
  const season = aggregateOwnerSeasonStats([[usdRow!]], sdsuRoster, realResolver, 2025);
  assert.deepEqual(season, []);

  // Control: a genuine San Diego State row still credits the SDSU owner.
  const sdsuRow = toAnalyticsGameStats(
    legacyRowFromWire(
      wireGame({
        id: 901,
        home: { school: 'San Diego State', teamId: 21 },
        away: { school: 'Beta Tech', teamId: 202 },
      })
    )
  );
  assert.ok(sdsuRow);
  const controlSeason = aggregateOwnerSeasonStats([[sdsuRow!]], sdsuRoster, realResolver, 2025);
  assert.equal(controlSeason.length, 1);
  assert.equal(controlSeason[0]!.owner, 'SDSUOwner');
  assert.equal(controlSeason[0]!.gamesPlayed, 1);
});
