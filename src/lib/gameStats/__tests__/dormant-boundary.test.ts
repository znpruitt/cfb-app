import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { legacyRowFromWire, wireGame } from './fixtures.ts';

// PLATFORM-086H1-DORMANT-CONTRACT-BOUNDARY-REMEDIATION-v1: the game-stats data
// contract ships as a DORMANT library. Nothing in production may consume it
// until ingestion, coverage, recovery, durable merge, analytics projection, and
// truthful availability activate TOGETHER in the staged activation PR —
// activating analytics alone lets ingestion cache rows that analytics then
// silently drops (the confirmed adversarial-review finding). These assertions
// pin the boundary at the exact seams that must flip atomically.

const PRODUCTION_SEAMS = [
  'src/app/api/cron/game-stats/route.ts',
  'src/app/api/game-stats/route.ts',
  'src/lib/gameStats/ownerStats.ts',
  'src/lib/insights/context.ts',
];

const DORMANT_CONTRACT_APIS = [
  'gameStats/contract',
  'selectAnalyticsRows',
  'toAnalyticsGameStats',
  'classifyGameStatsRow',
  'isAnalyticsEligible',
  'isCompleteStatRow',
  'evaluateGameStatsRow',
  'parseV2GameObservation',
  'buildV2GameStats',
  'schemaVersion',
];

test('no production seam imports or calls the dormant contract', () => {
  for (const seam of PRODUCTION_SEAMS) {
    const source = readFileSync(path.join(process.cwd(), seam), 'utf8');
    for (const api of DORMANT_CONTRACT_APIS) {
      assert.ok(
        !source.includes(api),
        `${seam} must not reference "${api}" until the atomic activation PR`
      );
    }
  }
});

test('the legacy writer path cannot produce v2 rows', () => {
  // The only production normalization path is the unchanged legacy normalizer:
  // its rows carry no schema version and no points-evidence flag, so no current
  // writer can stamp `schemaVersion: 2`.
  const row = legacyRowFromWire(wireGame());
  assert.equal('schemaVersion' in row, false);
  assert.equal('pointsProvided' in row.home, false);
  assert.equal('pointsProvided' in row.away, false);
});
