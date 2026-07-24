import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregateOwnerGameStats, aggregateOwnerSeasonStats } from '../ownerStats.ts';
import { createTeamIdentityResolver } from '../../teamIdentity.ts';
import {
  completeLegacyRow,
  malformedRequiredLegacyRow,
  prototypeNamedCategoryLegacyRow,
  statlessLegacyRow,
} from './fixtures.ts';

// PLATFORM-086H1-DORMANT-CONTRACT-BOUNDARY-REMEDIATION-v1: production owner
// aggregation is the UNCHANGED main behavior — it reads stored normalized
// fields for every row and applies NO contract eligibility, selection, or
// duplicate handling. These regressions pin that boundary: if the strict
// contract (selectAnalyticsRows / toAnalyticsGameStats) is ever wired into
// aggregation, they fail — the signal that activation must instead happen
// atomically with ingestion, coverage, and recovery in the staged activation
// PR, not piecemeal here.

const resolver = createTeamIdentityResolver({ teams: [], aliasMap: {}, observedNames: [] });
const roster = new Map<string, string>([
  ['Alpha State', 'Alice'],
  ['Beta Tech', 'Bob'],
]);

function ownerRow(stats: ReturnType<typeof aggregateOwnerGameStats>, owner: string) {
  const row = stats.find((s) => s.owner === owner);
  assert.ok(row, `owner ${owner} aggregated`);
  return row!;
}

test('aggregation reads stored normalized values for a compatible legacy row', () => {
  const row = completeLegacyRow(1);
  const stats = aggregateOwnerGameStats([row], roster, resolver);
  const alice = ownerRow(stats, 'Alice');
  assert.equal(alice.gamesPlayed, 1);
  assert.equal(alice.points, row.home.points);
  assert.equal(alice.totalYards, row.home.totalYards);
  assert.equal(alice.passingYards, row.home.passingYards);
  assert.equal(alice.possessionSeconds, row.home.possessionSeconds);
});

test('main behavior: rows the strict contract would exclude still contribute', () => {
  // A row missing/failing a required category still aggregates via its stored
  // normalized fields (including fallback zeroes), and a statless row still
  // counts as a played game — the pre-086H1 production behavior. Contract-based
  // exclusion would report gamesPlayed 1 here.
  const stats = aggregateOwnerGameStats(
    [completeLegacyRow(1), malformedRequiredLegacyRow(2), statlessLegacyRow(3)],
    roster,
    resolver
  );
  assert.equal(ownerRow(stats, 'Alice').gamesPlayed, 3);
});

test('main behavior: duplicate provider game ids are not deduplicated', () => {
  // Deterministic duplicate selection is a dormant helper only; production
  // aggregation still counts each row it is handed.
  const stats = aggregateOwnerGameStats(
    [completeLegacyRow(5), completeLegacyRow(5)],
    roster,
    resolver
  );
  assert.equal(ownerRow(stats, 'Alice').gamesPlayed, 2);
});

test('a prototype-named category row cannot crash aggregation', () => {
  // Main aggregation never parses raw categories, so prototype-named keys are
  // inert here; this stays as a guard for the eventual activation.
  const stats = aggregateOwnerGameStats(
    [completeLegacyRow(1), prototypeNamedCategoryLegacyRow(2)],
    roster,
    resolver
  );
  assert.equal(ownerRow(stats, 'Alice').gamesPlayed, 2);
});

test('season aggregation matches the main per-week accumulation', () => {
  const seasonStats = aggregateOwnerSeasonStats(
    [[completeLegacyRow(40)], [completeLegacyRow(41)]],
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

// ---------------------------------------------------------------------------
// PLATFORM-086-TEAM-CATALOG-DERIVED-ALIAS-SAFETY: production-shaped regression
// for the corrected catalog INPUT (ownerStats.ts itself is unchanged). A stored
// CFBD row labeled bare "San Diego" (University of San Diego, uncataloged FCS)
// must never be credited to the owner who rosters "San Diego State" — the
// pre-fix generated `sandiego` alt caused exactly that attribution.
// ---------------------------------------------------------------------------

import teamsCatalogForOwnerStats from '../../../data/teams.json';
import type { TeamCatalogItem } from '../../teamIdentity.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';

test('a stored bare-"San Diego" row is not credited to the San Diego State owner', () => {
  const catalog = teamsCatalogForOwnerStats.items as unknown as TeamCatalogItem[];
  // The real production resolver inputs: regenerated catalog, no manual
  // aliases, the stored row labels as observed names.
  const realResolver = createTeamIdentityResolver({
    teams: catalog,
    aliasMap: {},
    observedNames: ['San Diego', 'Butler', 'San Diego State', 'Beta Tech'],
  });
  const sdsuRoster = new Map<string, string>([['San Diego State', 'SDSUOwner']]);

  const usdRow = legacyRowFromWire(
    wireGame({
      id: 900,
      home: { school: 'San Diego', teamId: 5001 },
      away: { school: 'Butler', teamId: 5002 },
    })
  );
  // Neither weekly nor season aggregation credits the USD row.
  const weekly = aggregateOwnerGameStats([usdRow], sdsuRoster, realResolver);
  assert.deepEqual(weekly, []);
  const season = aggregateOwnerSeasonStats([[usdRow]], sdsuRoster, realResolver, 2025);
  assert.deepEqual(season, []);

  // Control: a genuine San Diego State row still credits the SDSU owner.
  const sdsuRow = legacyRowFromWire(
    wireGame({
      id: 901,
      home: { school: 'San Diego State', teamId: 21 },
      away: { school: 'Beta Tech', teamId: 202 },
    })
  );
  const controlWeekly = aggregateOwnerGameStats([sdsuRow], sdsuRoster, realResolver);
  assert.equal(controlWeekly.length, 1);
  assert.equal(controlWeekly[0]!.owner, 'SDSUOwner');
  assert.equal(controlWeekly[0]!.gamesPlayed, 1);
  const controlSeason = aggregateOwnerSeasonStats([[sdsuRow]], sdsuRoster, realResolver, 2025);
  assert.equal(controlSeason.length, 1);
  assert.equal(controlSeason[0]!.owner, 'SDSUOwner');
});
