import assert from 'node:assert/strict';
import test from 'node:test';

import { buildV2GameStats, parseV2GameObservation } from '../contract.ts';
import { aggregateOwnerGameStats, aggregateOwnerSeasonStats } from '../ownerStats.ts';
import type { GameStats } from '../types.ts';
import { createTeamIdentityResolver } from '../../teamIdentity.ts';
import {
  completeLegacyRow,
  explicitZeroLegacyRow,
  leadingSpacePossessionLegacyRow,
  malformedOptionalLegacyRow,
  malformedRequiredLegacyRow,
  normalizedMismatchLegacyRow,
  statlessLegacyRow,
  v2RowLike,
  wireGame,
} from './fixtures.ts';

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

test('legacy parity: aggregation equals the stored normalized values production served', () => {
  // Production-faithful legacy rows (written through the real legacy
  // normalizer), including the observed leading-space possession clock and the
  // observed malformed OPTIONAL fourthDownEff — the exact inventory shapes that
  // must keep serving identical owner analytics.
  const rows: GameStats[] = [
    completeLegacyRow(1),
    leadingSpacePossessionLegacyRow(2),
    malformedOptionalLegacyRow(3),
  ];

  const stats = aggregateOwnerGameStats(rows, roster, resolver);
  const alice = ownerRow(stats, 'Alice');

  // Expected values computed from the STORED normalized fields — the pre-086H1
  // aggregation input. Exact agreement is the inventory-proven parity claim.
  const homes = rows.map((r) => r.home);
  assert.equal(alice.gamesPlayed, rows.length);
  assert.equal(
    alice.points,
    homes.reduce((sum, h) => sum + h.points, 0)
  );
  assert.equal(
    alice.totalYards,
    homes.reduce((sum, h) => sum + h.totalYards, 0)
  );
  assert.equal(
    alice.passingYards,
    homes.reduce((sum, h) => sum + h.passingYards, 0)
  );
  assert.equal(
    alice.turnovers,
    homes.reduce((sum, h) => sum + h.turnovers, 0)
  );
  assert.equal(
    alice.possessionSeconds,
    homes.reduce((sum, h) => sum + h.possessionSeconds, 0)
  );
  const conversions = homes.reduce((sum, h) => sum + h.thirdDownConversions, 0);
  const attempts = homes.reduce((sum, h) => sum + h.thirdDownAttempts, 0);
  assert.equal(alice.thirdDownPct, conversions / attempts);

  const bob = ownerRow(stats, 'Bob');
  assert.equal(bob.gamesPlayed, rows.length);
  assert.equal(
    bob.points,
    rows.reduce((sum, r) => sum + r.away.points, 0)
  );
});

test('explicit-zero legacy rows stay eligible and count as played games', () => {
  const stats = aggregateOwnerGameStats([explicitZeroLegacyRow(9)], roster, resolver);
  const alice = ownerRow(stats, 'Alice');
  assert.equal(alice.gamesPlayed, 1);
  assert.equal(alice.points, 0);
  assert.equal(alice.totalYards, 0);
  assert.equal(alice.thirdDownPct, 0);
});

test('ineligible rows contribute nothing — no fabricated zero games', () => {
  const stats = aggregateOwnerGameStats(
    [
      completeLegacyRow(1),
      statlessLegacyRow(10),
      malformedRequiredLegacyRow(11),
      normalizedMismatchLegacyRow(12),
      v2RowLike({ id: 13, homeRaw: { turnovers: '1' }, awayRaw: { turnovers: '2' } }) as GameStats,
      v2RowLike({ id: 14, schemaVersion: 3 }) as GameStats,
    ],
    roster,
    resolver
  );
  // Only the single eligible game may appear.
  assert.equal(ownerRow(stats, 'Alice').gamesPlayed, 1);
});

test('current legacy and v2 rows for different games aggregate together', () => {
  const parsed = parseV2GameObservation(wireGame({ id: 21 }));
  assert.ok(parsed.ok);
  const v2Row = buildV2GameStats(parsed.ok ? parsed.observation : (null as never), 6, 'regular');
  const stats = aggregateOwnerGameStats([completeLegacyRow(20), v2Row], roster, resolver);
  const alice = ownerRow(stats, 'Alice');
  assert.equal(alice.gamesPlayed, 2);
  assert.equal(alice.totalYards, 412 * 2);
});

test('duplicate selection flows through aggregation: v2 wins, twins count once, conflicts drop', () => {
  const id = 30;
  const legacy = completeLegacyRow(id);
  const v2Replacement = v2RowLike({ id }) as GameStats;
  const withReplacement = aggregateOwnerGameStats([legacy, v2Replacement], roster, resolver);
  assert.equal(ownerRow(withReplacement, 'Alice').gamesPlayed, 1);

  const twins = aggregateOwnerGameStats([legacy, completeLegacyRow(id)], roster, resolver);
  assert.equal(ownerRow(twins, 'Alice').gamesPlayed, 1);

  const conflicting = {
    ...legacy,
    home: { ...legacy.home, totalYards: 500, raw: { ...legacy.home.raw, totalYards: '500' } },
  };
  const conflicted = aggregateOwnerGameStats(
    [legacy, conflicting, completeLegacyRow(31)],
    roster,
    resolver
  );
  // The conflicted game is excluded entirely; the clean game still counts.
  assert.equal(ownerRow(conflicted, 'Alice').gamesPlayed, 1);
});

test('season aggregation selects across the whole scope, not per week', () => {
  const id = 40;
  const seasonStats = aggregateOwnerSeasonStats(
    // The same provider game id cached in two partitions must count once.
    [[completeLegacyRow(id)], [completeLegacyRow(id), completeLegacyRow(41)]],
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
