import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../route';
import { buildScoreEvidenceByProviderId } from '../../../../../lib/gameStats/scoreEvidence.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  setAppState,
} from '../../../../../lib/server/appStateStore.ts';
import type { GameStats } from '../../../../../lib/gameStats/types.ts';
import {
  completeLegacyRow,
  legacyRowFromWire,
  seedGameStatsPartitionForTests,
  seedGameStatsTeamDatabaseForTests,
  v2RowLike,
  wireGame,
} from '../../../../../lib/gameStats/__tests__/fixtures.ts';

// PLATFORM-086H3 — archive-integrity score evidence: only H1-APPROVED score
// evidence reaches the score-diff comparison. The unit matrix pins the
// eligibility rules; the route-level test proves the wired comparison uses
// them end to end.

const MUTABLE_ENV = process.env as Record<string, string | undefined>;
const ADMIN_TOKEN = 'test-admin-token';
const SLUG = 'itest';
const YEAR = 2024;

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedGameStatsTeamDatabaseForTests();
  MUTABLE_ENV.NODE_ENV = 'development';
  MUTABLE_ENV.ADMIN_API_TOKEN = ADMIN_TOKEN;
});

// === Unit matrix over the shared evidence builder ===

test('score evidence matrix: only H1-approved rows project; duplicates resolve deterministically', () => {
  const legacy = completeLegacyRow(101); // valid compatible legacy score → projects
  const v2Complete = v2RowLike({ id: 102 }) as unknown as GameStats; // strict v2 evidence → projects
  const v2NoPoints = v2RowLike({
    id: 103,
    homeOverrides: { pointsProvided: false, points: 0 },
  }) as unknown as GameStats; // v2 WITHOUT points evidence → never a real score
  const unsupported = { ...completeLegacyRow(104), schemaVersion: 3 } as unknown as GameStats;
  const malformed = { nonsense: true } as unknown as GameStats;
  const dupA = completeLegacyRow(105);
  const dupB = completeLegacyRow(105); // identical duplicate → one projection
  const conflictA = completeLegacyRow(106);
  const conflictB = legacyRowFromWire(wireGame({ id: 106, home: { points: 99 } })); // divergent → excluded

  const evidence = buildScoreEvidenceByProviderId([
    legacy,
    v2Complete,
    v2NoPoints,
    unsupported,
    malformed,
    dupA,
    dupB,
    conflictA,
    conflictB,
  ]);
  assert.deepEqual([...evidence.keys()].sort(), [101, 102, 105]);
  assert.equal(evidence.get(101)!.home.points, legacy.home.points);
  assert.equal(evidence.get(102)!.source, 'v2');
  assert.equal(
    evidence.get(105)!.home.points,
    dupA.home.points,
    'deterministic eligible duplicate'
  );
});

// === Route-level regression ===

async function seedArchiveWorld(gameStatsRows: GameStats[]) {
  // Minimal canonical archive: one game whose archived score DISAGREES with
  // the cached game-stats points (21/14 vs 20/14), so a diff appears exactly
  // when the cached row is score-eligible.
  await setAppState(`standings-archive:${SLUG}`, String(YEAR), {
    leagueSlug: SLUG,
    year: YEAR,
    archivedAt: '2025-01-15T00:00:00.000Z',
    ownerRosterSnapshot: 'Team,Owner\nAlpha State,Alice\nBeta Tech,Bob',
    standingsHistory: { weeks: [], byWeek: {} },
    finalStandings: [],
    games: [
      {
        key: 'g-5001',
        week: 5,
        stage: 'regular',
        csvHome: 'Alpha State',
        csvAway: 'Beta Tech',
        canHome: 'Alpha State',
        canAway: 'Beta Tech',
        providerGameId: '5001',
        neutral: false,
        bowlName: null,
        playoffRound: null,
      },
    ],
    scoresByKey: {
      'g-5001': {
        id: '5001',
        week: 5,
        seasonType: 'regular',
        startDate: '2024-10-05T20:00:00.000Z',
        status: 'STATUS_FINAL',
        home: { team: 'Alpha State', score: 20 },
        away: { team: 'Beta Tech', score: 14 },
        time: null,
      },
    },
  });
  await seedGameStatsPartitionForTests({
    year: YEAR,
    week: 5,
    seasonType: 'regular',
    fetchedAt: '2024-10-06T00:00:00.000Z',
    games: gameStatsRows,
  });
}

function integrityRequest(): Request {
  return new Request(
    `https://example.com/api/debug/archive-integrity?leagueSlug=${SLUG}&year=${YEAR}`,
    { headers: { 'x-admin-token': ADMIN_TOKEN } }
  );
}

test('route: an eligible cached score produces a diff against the archive', async () => {
  // completeLegacyRow(5001) has home points 31 ≠ archived 20 → diff expected.
  await seedArchiveWorld([legacyRowFromWire(wireGame({ id: 5001 }))]);
  const res = await GET(integrityRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { scoreIntegrityDiffs?: Array<{ canonicalGameId: string }> };
  assert.ok(
    (body.scoreIntegrityDiffs ?? []).some((d) => d.canonicalGameId === 'g-5001'),
    'an H1-approved cached score participates in the comparison'
  );
});

test('route: compatibility-defaulted points are NEVER interpreted as a real score', async () => {
  // A v2 row whose points carry NO evidence (pointsProvided false, defaulted 0)
  // must produce NO diff — 0 vs 20 would otherwise scream mismatch.
  const noEvidence = v2RowLike({
    id: 5001,
    homeOverrides: { pointsProvided: false, points: 0 },
    awayOverrides: { pointsProvided: false, points: 0 },
  }) as unknown as GameStats;
  await seedArchiveWorld([noEvidence]);
  const res = await GET(integrityRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { scoreIntegrityDiffs?: Array<{ canonicalGameId: string }> };
  assert.deepEqual(
    body.scoreIntegrityDiffs ?? [],
    [],
    'no fabricated diff from evidence-free points'
  );
});

test('route: unsupported schema and malformed rows never reach the comparison', async () => {
  await seedArchiveWorld([
    { ...completeLegacyRow(5001), schemaVersion: 3 } as unknown as GameStats,
    { nonsense: true } as unknown as GameStats,
  ]);
  const res = await GET(integrityRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { scoreIntegrityDiffs?: unknown[] };
  assert.deepEqual(body.scoreIntegrityDiffs ?? [], []);
});

test('route: conflicting duplicates exclude the game from score comparison', async () => {
  await seedArchiveWorld([
    legacyRowFromWire(wireGame({ id: 5001 })),
    legacyRowFromWire(wireGame({ id: 5001, home: { points: 99 } })),
  ]);
  const res = await GET(integrityRequest());
  assert.equal(res.status, 200);
  const body = (await res.json()) as { scoreIntegrityDiffs?: unknown[] };
  assert.deepEqual(body.scoreIntegrityDiffs ?? [], [], 'conflicting projections are never trusted');
});
