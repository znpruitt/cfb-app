import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import * as cacheModule from '../cache.ts';
import * as contractModule from '../contract.ts';
import * as ingestionModule from '../ingestion.ts';
import * as durableMergeModule from '../durableMerge.ts';
import * as partitionCoverageModule from '../partitionCoverage.ts';
import * as recoveryModule from '../recovery.ts';
import * as publicProjectionModule from '../publicProjection.ts';

// PLATFORM-086H3 — activation guards. The PLATFORM-086H1 dormant-boundary
// guard is retired: the contract and the durable merge authority are now the
// ACTIVE production lifecycle. These guards protect the activated state:
//
//   1. WRITER-BYPASS guard: no production source may write a game-stats
//      durable partition directly, reintroduce the retired blind-overwrite
//      path (`setCachedGameStats`), take the per-key transaction primitive
//      outside the merge authority, or resurrect the legacy normalizer as a
//      production parser. Explicitly documented compatibility READS remain
//      allowed — parallel WRITE ownership does not.
//   2. ACTIVATION-COMPLETENESS guard: the lifecycle is wired end to end —
//      writers route through validated ingestion into the merge authority,
//      recovery and diagnostics share the committed-state coverage model,
//      analytics consumes the canonical projection, and public reads pass
//      through the metadata-stripping projection. A partially-activated state
//      (e.g. ingestion active but coverage or analytics still on legacy-only
//      assumptions) fails here.
//
// Cache-publication ordering (durable COMMIT before any status/cache
// publication) is enforced BEHAVIORALLY by the lifecycle tests
// (`lifecycle-activation.test.ts`): a failed or indeterminate durable write
// must never record refresh success. Source-order scanning cannot prove that,
// so it is deliberately not attempted here.

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
      results.push(toPosix(path.relative(REPO_ROOT, absolute)));
    }
  };
  walk(SRC_DIR);
  return results.sort();
}

type GuardViolation = { file: string; pattern: string; line: number };

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

// --- Writer-bypass patterns ---

// The retired blind partition overwrite. Any reappearance of the NAME in
// production source is a reintroduced legacy write path.
const BLIND_OVERWRITE_NAME = /\bsetCachedGameStats\b/g;

// A direct durable write/delete against the game-stats scope. The scope
// string may legitimately appear in read paths (cache.ts) and inside the
// merge authority's lock (durableMerge.ts); what is forbidden everywhere is a
// WRITE primitive invoked with it.
const DIRECT_SCOPE_WRITE =
  /\b(?:setAppState|deleteAppState)\s*(?:<[^>]*>)?\s*\(\s*['"`]game-stats['"`]/g;

// The per-key transaction primitive: only its definition (appStateStore) and
// the durable merge authority may reference it. An independent lock user is a
// parallel serialization domain — a bypass of writer convergence.
const KEY_TRANSACTION_NAME = /\bwithAppStateKeyTransaction\b/g;
const KEY_TRANSACTION_ALLOWED = new Set([
  'src/lib/server/appStateStore.ts',
  'src/lib/gameStats/durableMerge.ts',
]);

// The lenient legacy normalizer module: fixture-only since activation. Any
// production import is a resurrected parallel parser/writer input path.
// Specifiers are captured in every import form and RESOLVED against the
// importing file, so `src/lib/scores/normalizers.ts` (an unrelated module
// that shares the basename) never false-positives.
const MODULE_SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;
const NORMALIZERS_SELF = 'src/lib/gameStats/normalizers.ts';

function specifierTargetsLegacyNormalizer(
  specifier: string,
  importerRepoRelativePath: string
): boolean {
  const normalized = specifier.replace(/\\/g, '/');
  if (normalized.includes('gameStats/normalizers')) return true;
  if (!normalized.startsWith('.')) return false;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(toPosix(importerRepoRelativePath)), normalized)
  );
  return /^src\/lib\/gameStats\/normalizers(\.(?:js|mjs|cjs|ts|mts|cts|tsx))?$/.test(resolved);
}

/** Pure scan of one production source text for writer-bypass violations. */
function findWriterBypassViolations(source: string, repoRelativePath: string): GuardViolation[] {
  const violations: GuardViolation[] = [];
  for (const match of source.matchAll(BLIND_OVERWRITE_NAME)) {
    violations.push({
      file: repoRelativePath,
      pattern: 'retired blind overwrite "setCachedGameStats"',
      line: lineOf(source, match.index),
    });
  }
  for (const match of source.matchAll(DIRECT_SCOPE_WRITE)) {
    violations.push({
      file: repoRelativePath,
      pattern: 'direct game-stats durable write',
      line: lineOf(source, match.index),
    });
  }
  if (!KEY_TRANSACTION_ALLOWED.has(repoRelativePath)) {
    for (const match of source.matchAll(KEY_TRANSACTION_NAME)) {
      violations.push({
        file: repoRelativePath,
        pattern: 'per-key transaction primitive outside the merge authority',
        line: lineOf(source, match.index),
      });
    }
  }
  if (repoRelativePath !== NORMALIZERS_SELF) {
    for (const match of source.matchAll(MODULE_SPECIFIER)) {
      if (!specifierTargetsLegacyNormalizer(match[1]!, repoRelativePath)) continue;
      violations.push({
        file: repoRelativePath,
        pattern: `legacy-normalizer import "${match[1]}"`,
        line: lineOf(source, match.index),
      });
    }
  }
  return violations;
}

// === 1. Writer-bypass guard ===

test('no production source bypasses the durable game-stats merge authority', () => {
  const files = listProductionSources();
  assert.ok(files.length > 100, `expected a full production scan, saw ${files.length} files`);

  const violations = files.flatMap((file) =>
    findWriterBypassViolations(readFileSync(path.join(REPO_ROOT, file), 'utf8'), file)
  );
  assert.deepEqual(
    violations,
    [],
    `game-stats writer bypass detected:\n${violations
      .map((v) => `  ${v.file}:${v.line} — ${v.pattern}`)
      .join(
        '\n'
      )}\nEvery production game-stats write must flow through the durable merge authority.`
  );
});

test('the read-only cache module exports no write path', () => {
  const exported = Object.keys(cacheModule).sort();
  assert.deepEqual(exported, [
    'getCachedGameStats',
    'getGameStatsKey',
    'listCachedGameStats',
    'listCachedGameStatsWeeks',
  ]);
});

test('the game-stats writer routes reference no durable write primitive', () => {
  for (const file of ['src/app/api/cron/game-stats/route.ts', 'src/app/api/game-stats/route.ts']) {
    const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    assert.ok(
      !/\b(?:setAppState|deleteAppState)\b/.test(source),
      `${file} must not reference durable write primitives directly`
    );
    assert.ok(
      /from '@\/lib\/gameStats\/ingestion'/.test(source),
      `${file} must route provider payloads through the validated ingestion service`
    );
  }
});

// === 2. Activation-completeness guard ===

test('the lifecycle wiring is complete: ingestion → merge → coverage → recovery → projection', () => {
  const read = (file: string) => readFileSync(path.join(REPO_ROOT, file), 'utf8');

  // Ingestion feeds the durable merge authority (not any other writer).
  const ingestion = read('src/lib/gameStats/ingestion.ts');
  assert.match(ingestion, /from '\.\/durableMerge\.ts'/);
  assert.match(ingestion, /mergeGameStatsPartitionDurable\(/);

  // The scheduled writer plans schedule-relative recovery over committed state.
  const cron = read('src/app/api/cron/game-stats/route.ts');
  assert.match(cron, /from '@\/lib\/gameStats\/recovery'/);
  assert.match(cron, /planGameStatsRecovery\(/);
  assert.match(cron, /ingestGameStatsObservations\(/);

  // The manual writer derives schedule expectations and ingests through the
  // same authority; ordinary reads serve the metadata-stripping projection.
  const route = read('src/app/api/game-stats/route.ts');
  assert.match(route, /deriveSlateExpectation\(/);
  assert.match(route, /ingestGameStatsObservations\(/);
  assert.match(route, /from '@\/lib\/gameStats\/publicProjection'/);
  assert.match(route, /toPublicWeeklyGameStats\(/);

  // Coverage is shared: recovery and diagnostics evaluate the SAME committed-
  // state model — no parallel coverage implementations.
  const recovery = read('src/lib/gameStats/recovery.ts');
  assert.match(recovery, /evaluateGameStatsPartitionCoverage\(/);
  const diagnostics = read('src/lib/server/providerDataDiagnostics.ts');
  assert.match(diagnostics, /from '\.\.\/gameStats\/partitionCoverage\.ts'/);
  assert.match(diagnostics, /evaluateGameStatsPartitionCoverage\(/);

  // Analytics consumes the canonical projection, never raw category
  // interpretation of its own.
  const ownerStats = read('src/lib/gameStats/ownerStats.ts');
  assert.match(ownerStats, /from '\.\/contract\.ts'/);
  assert.match(ownerStats, /selectAnalyticsRows\(/);
});

test('the activated modules expose the lifecycle surface end to end', () => {
  assert.equal(typeof ingestionModule.validateGameStatsPayload, 'function');
  assert.equal(typeof ingestionModule.deriveSlateExpectation, 'function');
  assert.equal(typeof ingestionModule.ingestGameStatsObservations, 'function');
  assert.equal(typeof durableMergeModule.mergeGameStatsPartitionDurable, 'function');
  assert.equal(typeof durableMergeModule.computeWeeklyGameStatsMerge, 'function');
  assert.equal(typeof partitionCoverageModule.evaluateGameStatsPartitionCoverage, 'function');
  assert.equal(typeof partitionCoverageModule.isPartitionRecoverySatisfied, 'function');
  assert.equal(typeof recoveryModule.planGameStatsRecovery, 'function');
  assert.equal(typeof publicProjectionModule.toPublicWeeklyGameStats, 'function');
  assert.equal(typeof contractModule.selectAnalyticsRows, 'function');
  assert.equal(typeof contractModule.toAnalyticsGameStats, 'function');
});

// === Guard self-tests: prove the scanner detects representative bypasses ===

test('scanner: detects the retired blind-overwrite name', () => {
  const violations = findWriterBypassViolations(
    `await setCachedGameStats(result);`,
    'src/app/api/example/route.ts'
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.pattern, /setCachedGameStats/);
});

test('scanner: detects direct durable writes against the game-stats scope', () => {
  const flagged = [
    `await setAppState('game-stats', key, value);`,
    `await setAppState("game-stats", key, value);`,
    `await setAppState<WeeklyGameStats>('game-stats', key, value);`,
    `await deleteAppState('game-stats', key);`,
  ];
  for (const source of flagged) {
    const violations = findWriterBypassViolations(source, 'src/lib/example.ts');
    assert.equal(violations.length, 1, source);
    assert.equal(violations[0]!.pattern, 'direct game-stats durable write');
  }
  // Reads and OTHER scopes stay clean.
  const clean = [
    `await getAppState('game-stats', key);`,
    `await setAppState('schedule', key, value);`,
    `const SCOPE = 'game-stats';`,
  ];
  for (const source of clean) {
    assert.deepEqual(findWriterBypassViolations(source, 'src/lib/example.ts'), [], source);
  }
});

test('scanner: detects an independent per-key transaction user', () => {
  const violations = findWriterBypassViolations(
    `await withAppStateKeyTransaction('game-stats', key, fn);`,
    'src/lib/example.ts'
  );
  assert.equal(violations.length, 1);
  assert.match(violations[0]!.pattern, /transaction primitive/);
  // The two sanctioned homes stay clean for the same source.
  for (const allowed of KEY_TRANSACTION_ALLOWED) {
    assert.deepEqual(
      findWriterBypassViolations(`withAppStateKeyTransaction(scope, key, fn)`, allowed),
      [],
      allowed
    );
  }
});

test('scanner: detects resurrected production imports of the legacy normalizer', () => {
  const flagged = [
    `import { normalizeGameTeamStats } from '../gameStats/normalizers';`,
    `import { normalizeGameTeamStats } from './normalizers.ts';`,
    `const m = await import('@/lib/gameStats/normalizers');`,
    `const m = require('../gameStats/normalizers.js');`,
  ];
  for (const source of flagged) {
    const violations = findWriterBypassViolations(source, 'src/lib/gameStats/coverage.ts');
    assert.equal(violations.length, 1, source);
    assert.match(violations[0]!.pattern, /legacy-normalizer import/);
  }
  // The defining module itself and unrelated modules stay clean.
  assert.deepEqual(
    findWriterBypassViolations(`export function normalizeGameTeamStats() {}`, NORMALIZERS_SELF),
    []
  );
  assert.deepEqual(
    findWriterBypassViolations(`import { x } from './normalizers';`, 'src/lib/scores/cache.ts'),
    []
  );
});

test('scanner: production seams are all scanned; tests and fixtures are not', () => {
  const files = listProductionSources();
  const set = new Set(files);
  for (const seam of [
    'src/app/api/cron/game-stats/route.ts',
    'src/app/api/game-stats/route.ts',
    'src/lib/gameStats/ingestion.ts',
    'src/lib/gameStats/durableMerge.ts',
    'src/lib/gameStats/partitionCoverage.ts',
    'src/lib/gameStats/recovery.ts',
    'src/lib/gameStats/publicProjection.ts',
    'src/lib/gameStats/ownerStats.ts',
    'src/lib/gameStats/cache.ts',
    'src/lib/gameStats/normalizers.ts',
    'src/lib/insights/context.ts',
    'src/lib/server/providerDataDiagnostics.ts',
    'src/lib/server/appStateStore.ts',
  ]) {
    assert.ok(set.has(seam), `${seam} must be scanned`);
  }
  assert.ok(files.every((f) => !f.includes('__tests__/') && !TEST_FILE_PATTERN.test(f)));
});
