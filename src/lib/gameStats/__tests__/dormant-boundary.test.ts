import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { getCachedGameStats, setCachedGameStats } from '../cache.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
} from '../../server/appStateStore.ts';
import { legacyRowFromWire, wireGame } from './fixtures.ts';

// PLATFORM-086H1: the game-stats data contract ships as a DORMANT library.
// Nothing in production may consume it until ingestion, coverage, recovery,
// durable merge, analytics projection, and truthful availability activate
// TOGETHER in the staged activation PR — activating analytics alone lets
// ingestion cache rows that analytics then silently drops (the confirmed
// adversarial-review finding).
//
// PLATFORM-086H1-COMPLETE-DORMANT-BOUNDARY-GUARD-REMEDIATION-v1: this guard
// recursively scans EVERY production source file under `src` (no manually
// maintained seam list), rejecting any reference to a dormant contract API,
// any v2 metadata name, and any static/dynamic/require/re-export path that
// resolves to the contract module. Only the contract definition itself, the
// intentionally dormant optional type declarations, tests, and fixtures are
// excluded — so ANY future indirect activation path fails this test.

// Repo root resolved deterministically from this test file's location:
// src/lib/gameStats/__tests__ → four levels up.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);
const SRC_DIR = path.join(REPO_ROOT, 'src');

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

// The only permitted non-test homes of dormant names: the contract definition,
// the optional dormant type declarations, and (PLATFORM-086H2) the dormant
// durable merge service. Exact files only — never whole directories.
const EXCLUDED_FILES = new Set([
  'src/lib/gameStats/contract.ts',
  'src/lib/gameStats/types.ts',
  'src/lib/gameStats/durableMerge.ts',
]);
const EXCLUDED_DIRS = new Set(['__tests__', '__fixtures__', 'fixtures']);
const TEST_FILE_PATTERN = /\.(test|spec)\.tsx?$/;

/** Repo-relative POSIX paths of every scannable production source file. */
function listProductionSources(): string[] {
  const results: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) walk(absolute);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || TEST_FILE_PATTERN.test(entry.name)) continue;
      const repoRelative = toPosix(path.relative(REPO_ROOT, absolute));
      if (EXCLUDED_FILES.has(repoRelative)) continue;
      results.push(repoRelative);
    }
  };
  walk(SRC_DIR);
  return results.sort();
}

const FORBIDDEN_SYMBOLS = [
  'classifyGameStatsRow',
  'hasProviderAddressableGameId',
  'isPersistableIncomingRow',
  'isCompleteStatRow',
  'isAnalyticsEligible',
  'evaluateGameStatsRow',
  'toAnalyticsGameStats',
  'selectAnalyticsRows',
  'parseV2GameObservation',
  'buildV2GameStats',
  'schemaVersion',
  'pointsProvided',
  // PLATFORM-086H2 dormant durable-merge APIs and metadata.
  'fetchStartedAt',
  'computeWeeklyGameStatsMerge',
  'mergeGameStatsPartitionDurable',
];

const SYMBOL_PATTERN = new RegExp(`\\b(${FORBIDDEN_SYMBOLS.join('|')})\\b`, 'g');
// Module specifiers in every import form: static `from '...'` (incl.
// re-exports), bare `import '...'`, dynamic `import('...')`, and `require('...')`.
const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

/** Whether a module specifier resolves to a dormant game-stats module. */
function specifierTargetsDormantModule(
  specifier: string,
  importerRepoRelativePath: string
): boolean {
  const normalized = specifier.replace(/\\/g, '/');
  // Alias/absolute forms (`@/lib/gameStats/contract`, deep relative paths).
  if (normalized.includes('gameStats/contract') || normalized.includes('gameStats/durableMerge')) {
    return true;
  }
  // Relative forms resolve against the importing file so an unrelated module
  // that merely happens to be named `contract` elsewhere never matches.
  if (!normalized.startsWith('.')) return false;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(toPosix(importerRepoRelativePath)), normalized)
  );
  return /^src\/lib\/gameStats\/(contract|durableMerge)(\.ts)?$/.test(resolved);
}

type BoundaryViolation = { file: string; pattern: string; line: number };

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** Pure scan of one production source text for dormant-boundary violations. */
function findBoundaryViolations(source: string, repoRelativePath: string): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const match of source.matchAll(SYMBOL_PATTERN)) {
    violations.push({
      file: repoRelativePath,
      pattern: `forbidden symbol "${match[1]}"`,
      line: lineOf(source, match.index),
    });
  }
  for (const match of source.matchAll(SPECIFIER_PATTERN)) {
    if (specifierTargetsDormantModule(match[1]!, repoRelativePath)) {
      violations.push({
        file: repoRelativePath,
        pattern: `dormant-module import "${match[1]}"`,
        line: lineOf(source, match.index),
      });
    }
  }
  return violations;
}

// === The guard itself ===

test('no production source references the dormant contract, its APIs, or v2 metadata', () => {
  const files = listProductionSources();
  // Sanity: the walk really covers the production tree.
  assert.ok(files.length > 100, `expected a full production scan, saw ${files.length} files`);

  const violations = files.flatMap((file) =>
    findBoundaryViolations(readFileSync(path.join(REPO_ROOT, file), 'utf8'), file)
  );
  assert.deepEqual(
    violations,
    [],
    `dormant boundary violated:\n${violations
      .map((v) => `  ${v.file}:${v.line} — ${v.pattern}`)
      .join('\n')}\nActivation must happen atomically in the staged activation PR.`
  );
});

// === Guard self-tests: prove the scanner detects representative violations ===

test('scanner: detects dormant API references and v2 metadata names', () => {
  const cases: Array<[string, string]> = [
    ['const c = classifyGameStatsRow(row);', 'classifyGameStatsRow'],
    ['if (hasProviderAddressableGameId(row)) {}', 'hasProviderAddressableGameId'],
    ['if (isPersistableIncomingRow(obs)) {}', 'isPersistableIncomingRow'],
    ['const row = { schemaVersion: 2 };', 'schemaVersion'],
    ['team.pointsProvided = true;', 'pointsProvided'],
    ['row.fetchStartedAt = now;', 'fetchStartedAt'],
    ['const r = await mergeGameStatsPartitionDurable(input);', 'mergeGameStatsPartitionDurable'],
    ['const c = computeWeeklyGameStatsMerge(existing, input);', 'computeWeeklyGameStatsMerge'],
  ];
  for (const [source, symbol] of cases) {
    const violations = findBoundaryViolations(source, 'src/lib/example.ts');
    assert.equal(violations.length, 1, source);
    assert.ok(violations[0]!.pattern.includes(symbol));
  }
});

test('scanner: detects static, dynamic, require, and re-export contract imports', () => {
  const importer = 'src/lib/insights/context.ts';
  const flagged = [
    `import { project } from '../gameStats/contract';`,
    `import '../gameStats/contract.ts';`,
    `const m = await import('@/lib/gameStats/contract');`,
    `const m = require('../gameStats/contract');`,
    `export * from '../gameStats/contract';`,
    `export { project } from '../gameStats/contract.ts';`,
  ];
  for (const source of flagged) {
    const violations = findBoundaryViolations(source, importer);
    assert.equal(violations.length, 1, source);
    assert.ok(violations[0]!.pattern.startsWith('dormant-module import'), source);
  }
  // A sibling barrel inside gameStats reaches the contract via './contract'.
  assert.equal(
    findBoundaryViolations(`export * from './contract';`, 'src/lib/gameStats/index.ts').length,
    1
  );
  // The durable merge service (PLATFORM-086H2) is guarded the same way in
  // every import form.
  const mergeFlagged = [
    `import { anything } from '../gameStats/durableMerge';`,
    `const m = await import('@/lib/gameStats/durableMerge');`,
    `const m = require('../gameStats/durableMerge.ts');`,
    `export * from '../gameStats/durableMerge';`,
  ];
  for (const source of mergeFlagged) {
    const violations = findBoundaryViolations(source, importer);
    assert.equal(violations.length, 1, source);
    assert.ok(violations[0]!.pattern.startsWith('dormant-module import'), source);
  }
  assert.equal(
    findBoundaryViolations(`export * from './durableMerge';`, 'src/lib/gameStats/index.ts').length,
    1
  );
});

test('scanner: clean and unrelated sources produce no violations', () => {
  const clean = [
    [`import { foo } from './contract';`, 'src/lib/billing/index.ts'], // unrelated module named contract
    [`const contractor = signContract();`, 'src/lib/example.ts'],
    [
      `import { aggregateOwnerGameStats } from '../gameStats/ownerStats';`,
      'src/lib/insights/context.ts',
    ],
  ] as const;
  for (const [source, file] of clean) {
    assert.deepEqual(findBoundaryViolations(source, file), [], source);
  }
});

test('scanner: exclusions are exactly the dormant homes, tests, and fixtures', () => {
  const files = listProductionSources();
  const set = new Set(files);
  // The three intentional non-test homes of dormant names are excluded…
  assert.ok(!set.has('src/lib/gameStats/contract.ts'));
  assert.ok(!set.has('src/lib/gameStats/types.ts'));
  assert.ok(!set.has('src/lib/gameStats/durableMerge.ts'));
  // …tests and fixtures never appear…
  assert.ok(files.every((f) => !f.includes('__tests__/') && !TEST_FILE_PATTERN.test(f)));
  // …while real production seams are all scanned.
  for (const seam of [
    'src/app/api/cron/game-stats/route.ts',
    'src/app/api/game-stats/route.ts',
    'src/lib/gameStats/ownerStats.ts',
    'src/lib/gameStats/cache.ts',
    'src/lib/gameStats/coverage.ts',
    'src/lib/gameStats/normalizers.ts',
    'src/lib/insights/context.ts',
    'src/lib/selectors/historySelectors.ts',
    'src/lib/server/providerDataDiagnostics.ts',
    // Hosts the generic per-key lock primitive (PLATFORM-086H2) — a production
    // file, so it MUST stay scanned (it never references merge APIs itself).
    'src/lib/server/appStateStore.ts',
  ]) {
    assert.ok(set.has(seam), `${seam} must be scanned`);
  }
});

// === Behavioral writer assertions ===

test('the legacy writer path cannot produce v2 rows', () => {
  // The only production normalization path is the unchanged legacy normalizer:
  // its rows carry no schema version and no points-evidence flag, so no current
  // writer can stamp `schemaVersion: 2`.
  const row = legacyRowFromWire(wireGame());
  assert.equal('schemaVersion' in row, false);
  assert.equal('pointsProvided' in row.home, false);
  assert.equal('pointsProvided' in row.away, false);
});

test('the production cache-writer path persists legacy rows without v2 metadata', async () => {
  // Real cache boundary (setCachedGameStats → app-state → getCachedGameStats)
  // over the test-isolated file store: nothing between normalization and the
  // durable boundary may inject dormant metadata or reshape the row.
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  const row = legacyRowFromWire(wireGame({ id: 42 }));
  await setCachedGameStats({
    year: 2024,
    week: 1,
    seasonType: 'regular',
    fetchedAt: '2024-09-02T00:00:00.000Z',
    games: [row],
  });
  const record = await getCachedGameStats(2024, 1, 'regular');
  assert.ok(record, 'cached record readable');
  const stored = record!.games[0]!;
  assert.deepEqual(stored, row);
  assert.equal('schemaVersion' in stored, false);
  assert.equal('pointsProvided' in stored.home, false);
  assert.equal('pointsProvided' in stored.away, false);
});
