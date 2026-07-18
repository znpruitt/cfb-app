import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregateOwnerGameStats, aggregateOwnerSeasonStats } from '../ownerStats.ts';
import { createTeamIdentityResolver } from '../../teamIdentity.ts';
import {
  completeLegacyRow,
  malformedRequiredLegacyRow,
  prototypeNamedCategoryLegacyRow,
  statlessLegacyRow,
  v2RowLike,
  wireGame,
  legacyRowFromWire,
} from './fixtures.ts';
import type { GameStats } from '../types.ts';

// PLATFORM-086H3: owner aggregation consumes the canonical analytics
// projection (selectAnalyticsRows → toAnalyticsGameStats) EXCLUSIVELY. These
// tests pin the ACTIVATED behavior: eligible rows aggregate from strictly
// re-parsed evidence, ineligible rows are excluded instead of contributing
// fabricated zeroes, and duplicates resolve deterministically.

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

test('a compatible legacy row aggregates values equal to its stored normalized fields', () => {
  // For legacy-compatible rows the projection re-parses raw evidence that
  // rebuilds EXACTLY the stored normalized fields (mismatches are quarantined),
  // so activation preserves existing public analytics behavior.
  const row = completeLegacyRow(1);
  const stats = aggregateOwnerGameStats([row], roster, resolver);
  const alice = ownerRow(stats, 'Alice');
  assert.equal(alice.gamesPlayed, 1);
  assert.equal(alice.points, row.home.points);
  assert.equal(alice.totalYards, row.home.totalYards);
  assert.equal(alice.passingYards, row.home.passingYards);
  assert.equal(alice.possessionSeconds, row.home.possessionSeconds);
  const bob = ownerRow(stats, 'Bob');
  assert.equal(bob.points, row.away.points);
  assert.equal(bob.turnoverMargin, row.home.turnovers - row.away.turnovers);
});

test('a complete v2 row aggregates identically to its legacy-equivalent evidence', () => {
  const legacy = completeLegacyRow(7);
  const v2 = v2RowLike({ id: 8 }) as unknown as GameStats;
  const fromLegacy = ownerRow(aggregateOwnerGameStats([legacy], roster, resolver), 'Alice');
  const fromV2 = ownerRow(aggregateOwnerGameStats([v2], roster, resolver), 'Alice');
  assert.equal(fromV2.points, 31);
  assert.equal(fromV2.totalYards, fromLegacy.totalYards);
  assert.equal(fromV2.passingYards, fromLegacy.passingYards);
});

test('ineligible rows are EXCLUDED, never aggregated as fabricated zeroes', () => {
  // A row missing/failing a required category and a statless row cannot be
  // trusted as evidence: the projection excludes them instead of counting a
  // played game with zero-filled stats.
  const stats = aggregateOwnerGameStats(
    [completeLegacyRow(1), malformedRequiredLegacyRow(2), statlessLegacyRow(3)],
    roster,
    resolver
  );
  assert.equal(ownerRow(stats, 'Alice').gamesPlayed, 1);
});

test('identical duplicate provider game ids count once; divergent duplicates are excluded', () => {
  const identical = aggregateOwnerGameStats(
    [completeLegacyRow(5), completeLegacyRow(5)],
    roster,
    resolver
  );
  assert.equal(ownerRow(identical, 'Alice').gamesPlayed, 1, 'identical duplicates deduplicate');

  const divergent = aggregateOwnerGameStats(
    [completeLegacyRow(6), legacyRowFromWire(wireGame({ id: 6, home: { points: 99 } }))],
    roster,
    resolver
  );
  assert.equal(
    divergent.find((s) => s.owner === 'Alice'),
    undefined,
    'conflicting projections exclude the game rather than guessing'
  );
});

test('a prototype-named category row cannot crash or pollute aggregation', () => {
  const stats = aggregateOwnerGameStats(
    [completeLegacyRow(1), prototypeNamedCategoryLegacyRow(2)],
    roster,
    resolver
  );
  // The prototype-named row has no valid required evidence → excluded.
  assert.equal(ownerRow(stats, 'Alice').gamesPlayed, 1);
});

test('season aggregation matches per-week accumulation and dedupes across weeks', () => {
  const seasonStats = aggregateOwnerSeasonStats(
    [[completeLegacyRow(40)], [completeLegacyRow(41)], [completeLegacyRow(41)]],
    roster,
    resolver,
    2024
  );
  const alice = seasonStats.find((s) => s.owner === 'Alice');
  assert.ok(alice);
  assert.equal(alice!.gamesPlayed, 2, 'the cross-week duplicate of game 41 counts once');
  assert.equal(alice!.season, 2024);
  assert.equal(alice!.totalYards, 412 * 2);
  assert.equal(alice!.turnoversForced, 2);
});
