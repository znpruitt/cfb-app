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
