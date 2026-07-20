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
import {
  ADMIN_ROUTE_PATH,
  INSPECTION_FACADE_PATH,
  analyzeAdminRouteCapabilities,
  analyzeInspectionFacadeSurface,
} from './dormantBoundaryParser.ts';

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
// the optional dormant type declarations, the dormant durable merge service
// (PLATFORM-086H2), and the PLATFORM-086H3B dormant revision/activation/repair
// modules. Exact files only — never whole directories. `revisionStamp.ts` is
// deliberately NOT excluded: it is a pure, non-dormant primitive (no forbidden
// symbols, no dormant-module imports), so it stays scanned to prove it never
// reaches into the dormant lifecycle.
//
// PLATFORM-086H3B-DORMANT-BOUNDARY-GUARD-REMEDIATION: the admin revision route is
// NO LONGER excluded — its capabilities are actively inspected. It and its narrow
// inspection facade are SANCTIONED-SURFACE files (below): scanned by the
// parser-backed capability allowlist rather than trusted by filename, and exempt
// only from the regex symbol/module scan (which cannot tell an approved inspection
// import from a forbidden one, or a type-only import from a runtime one).
const EXCLUDED_FILES = new Set([
  'src/lib/gameStats/contract.ts',
  'src/lib/gameStats/types.ts',
  'src/lib/gameStats/durableMerge.ts',
  'src/lib/gameStats/revisionAuthority.ts',
  'src/lib/gameStats/revisionRepair.ts',
]);

// The sanctioned admin inspection surface: the ONE production connection to the
// dormant revision authority (the admin route) and its narrow facade. These are
// SCANNED (walked, and enforced by the parser-backed capability guard below), but
// exempt from the coarse regex symbol/module scan because they legitimately name
// approved inspection APIs and (for the facade) import the applied-repair function
// internally to build a dry-run-only wrapper it never re-exports.
const SANCTIONED_ADMIN_SURFACE = new Set([ADMIN_ROUTE_PATH, INSPECTION_FACADE_PATH]);

// PLATFORM-086H3B-ACTIVATION-DORMANCY-REMEDIATION: `activationControl.ts` is now
// a LIVE fence primitive (the production legacy writer in `cache.ts` routes
// through it), so it stays MODULE-scanned to prove it never imports a dormant
// module. But it DEFINES the dormant activation operations (`setActivationState`,
// `markRevisionedEvidenceCommitted`) and uses `schemaVersion` on its own record,
// so it is exempt from the forbidden-SYMBOL scan (only the symbol references
// elsewhere are violations). Module-scanned, symbol-exempt — never fully excluded.
const FORBIDDEN_SYMBOL_HOMES = new Set(['src/lib/gameStats/activationControl.ts']);

// The one non-excluded production file that DEFINES dormant game-stats
// refresh-status chronology symbols (it also hosts the LIVE generic status
// helpers used by unrelated datasets, so it stays module-scanned — only these
// specific dormant symbols are exempt in this one file). Every OTHER production
// file that references a chronology symbol is a dormancy violation.
const CHRONOLOGY_SYMBOL_HOME = 'src/lib/server/providerRefreshStatus.ts';
const DORMANT_CHRONOLOGY_SYMBOLS = [
  'beginGameStatsRefreshAttempt',
  'recordGameStatsRefreshSuccess',
  'recordGameStatsRefreshNoop',
  'recordGameStatsRefreshFailure',
  'composeGameStatsStatusPublication',
];
const CHRONOLOGY_SYMBOL_PATTERN = new RegExp(
  `\\b(${DORMANT_CHRONOLOGY_SYMBOLS.join('|')})\\b`,
  'g'
);
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
  // PLATFORM-086H3B dormant lifecycle APIs — DEFINED only in an excluded home or
  // a symbol home; forbidding the names catches any stray production reference to
  // revision allocation, the revisioned writer, the activation TRANSITION, the
  // evidence-witness setter, or applied operator repair. NOTE: the fenced legacy
  // writer (`writeLegacyGameStatsPartition`) is deliberately NOT here — the
  // remediation made it the LIVE production writer (in `cache.ts`).
  'mergeGameStatsPartitionRevisioned',
  'allocateGameStatsCommitStamp',
  'setActivationState',
  'markRevisionedEvidenceCommitted',
  'repairRevisionState',
  'inspectRevisionState',
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
  // The dormant game-stats modules: the H1 contract, the H2 durable merge, and
  // the H3B revision authority / activation-control fence / operator repair.
  // `activationControl` is NOT here — it is a LIVE fence primitive the production
  // cache writer imports (its dormant TRANSITION symbols are guarded instead).
  const DORMANT_MODULE_NAMES = ['contract', 'durableMerge', 'revisionAuthority', 'revisionRepair'];
  // Alias/absolute forms (`@/lib/gameStats/contract`, deep relative paths).
  if (DORMANT_MODULE_NAMES.some((name) => normalized.includes(`gameStats/${name}`))) {
    return true;
  }
  // Relative forms resolve against the importing file so an unrelated module
  // that merely happens to be named `contract` elsewhere never matches.
  if (!normalized.startsWith('.')) return false;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(toPosix(importerRepoRelativePath)), normalized)
  );
  // TypeScript source commonly imports with .js/.mjs/.cjs specifiers (NodeNext
  // resolution) — every supported extension resolves to the same module.
  return new RegExp(
    `^src/lib/gameStats/(${DORMANT_MODULE_NAMES.join('|')})(\\.(?:js|mjs|cjs|ts|mts|cts|tsx))?$`
  ).test(resolved);
}

type BoundaryViolation = { file: string; pattern: string; line: number };

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/** Pure scan of one production source text for dormant-boundary violations. */
function findBoundaryViolations(source: string, repoRelativePath: string): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  // The sanctioned admin surface (route + inspection facade) legitimately names
  // approved inspection APIs and (facade) imports the applied-repair function to
  // build a dry-run-only wrapper — the coarse regex cannot distinguish those from
  // a forbidden reference, so the parser-backed capability guard enforces it
  // instead. It is NOT excluded from the file walk; only these regex checks skip.
  const sanctioned = SANCTIONED_ADMIN_SURFACE.has(repoRelativePath);
  // A forbidden-symbol home DEFINES the guarded symbols (and uses `schemaVersion`
  // on its own records); it is exempt from the symbol scan but still scanned for
  // dormant-module imports and chronology symbols below.
  if (!sanctioned && !FORBIDDEN_SYMBOL_HOMES.has(repoRelativePath)) {
    for (const match of source.matchAll(SYMBOL_PATTERN)) {
      violations.push({
        file: repoRelativePath,
        pattern: `forbidden symbol "${match[1]}"`,
        line: lineOf(source, match.index),
      });
    }
  }
  // The dormant game-stats chronology symbols are forbidden EVERYWHERE except
  // their one definition home (which hosts the live generic status helpers).
  if (repoRelativePath !== CHRONOLOGY_SYMBOL_HOME) {
    for (const match of source.matchAll(CHRONOLOGY_SYMBOL_PATTERN)) {
      violations.push({
        file: repoRelativePath,
        pattern: `dormant chronology symbol "${match[1]}"`,
        line: lineOf(source, match.index),
      });
    }
  }
  if (!sanctioned) {
    for (const match of source.matchAll(SPECIFIER_PATTERN)) {
      if (specifierTargetsDormantModule(match[1]!, repoRelativePath)) {
        violations.push({
          file: repoRelativePath,
          pattern: `dormant-module import "${match[1]}"`,
          line: lineOf(source, match.index),
        });
      }
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
    // PLATFORM-086H3B lifecycle symbols.
    [
      'const r = await mergeGameStatsPartitionRevisioned(input);',
      'mergeGameStatsPartitionRevisioned',
    ],
    [
      'const a = await allocateGameStatsCommitStamp(txn, id, e, k, n);',
      'allocateGameStatsCommitStamp',
    ],
    ["await setActivationState('active');", 'setActivationState'],
    ['await markRevisionedEvidenceCommitted(txn, now);', 'markRevisionedEvidenceCommitted'],
    ['const r = await repairRevisionState(req);', 'repairRevisionState'],
    ['const i = await inspectRevisionState(id);', 'inspectRevisionState'],
  ];
  for (const [source, symbol] of cases) {
    const violations = findBoundaryViolations(source, 'src/lib/example.ts');
    assert.equal(violations.length, 1, source);
    assert.ok(violations[0]!.pattern.includes(symbol));
  }
  // The LIVE fenced legacy writer is NOT forbidden — it is the production writer.
  assert.deepEqual(
    findBoundaryViolations('await writeLegacyGameStatsPartition(stats);', 'src/lib/example.ts'),
    []
  );
});

test('scanner: game-stats chronology symbols are forbidden outside their home', () => {
  const chronologyCalls: Array<[string, string]> = [
    ['const a = await beginGameStatsRefreshAttempt(scope);', 'beginGameStatsRefreshAttempt'],
    ['await recordGameStatsRefreshSuccess(scope, r);', 'recordGameStatsRefreshSuccess'],
    ['await recordGameStatsRefreshNoop(scope);', 'recordGameStatsRefreshNoop'],
    ['await recordGameStatsRefreshFailure(scope, r);', 'recordGameStatsRefreshFailure'],
    ['const p = composeGameStatsStatusPublication(b, t);', 'composeGameStatsStatusPublication'],
  ];
  // Forbidden in any ordinary production file…
  for (const [source, symbol] of chronologyCalls) {
    const violations = findBoundaryViolations(source, 'src/app/api/cron/game-stats/route.ts');
    assert.equal(violations.length, 1, source);
    assert.ok(violations[0]!.pattern.includes(symbol), source);
  }
  // …but exempt in their one definition home (which also hosts live helpers).
  for (const [source] of chronologyCalls) {
    assert.deepEqual(findBoundaryViolations(source, CHRONOLOGY_SYMBOL_HOME), [], source);
  }
});

test('scanner: detects H3B dormant-module imports in every form', () => {
  const importer = 'src/app/api/game-stats/route.ts';
  for (const mod of ['revisionAuthority', 'revisionRepair']) {
    const forms = [
      `import { x } from '../../gameStats/${mod}';`,
      `import { x } from '@/lib/gameStats/${mod}';`,
      `const m = await import('@/lib/gameStats/${mod}');`,
      `const m = require('../../gameStats/${mod}.ts');`,
      `export * from '@/lib/gameStats/${mod}';`,
    ];
    for (const source of forms) {
      const violations = findBoundaryViolations(source, importer);
      assert.ok(
        violations.some((v) => v.pattern.startsWith('dormant-module import')),
        `${mod}: ${source}`
      );
    }
  }
  // The non-dormant primitives are NOT dormant modules — the pure stamp helper
  // AND the now-LIVE activation-control fence (the cache writer imports it).
  for (const spec of [
    `import { CommitStamp } from '@/lib/gameStats/revisionStamp';`,
    `import { classifyLegacyWrite } from '@/lib/gameStats/activationControl';`,
    `import { readActivationState } from '../../gameStats/activationControl';`,
  ]) {
    assert.deepEqual(findBoundaryViolations(spec, importer), [], spec);
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
  // Relative specifiers with JavaScript-resolution extensions (NodeNext style)
  // resolve to the same dormant modules and must be rejected identically.
  const extensionFlagged: Array<[string, string]> = [
    [`import { x } from '../gameStats/contract.js';`, importer],
    [`const m = require('../gameStats/durableMerge.mjs');`, importer],
    [`export * from '../gameStats/durableMerge.cjs';`, importer],
    [`import './contract.js';`, 'src/lib/gameStats/index.ts'],
    [`export { y } from './durableMerge.js';`, 'src/lib/gameStats/index.ts'],
  ];
  for (const [source, file] of extensionFlagged) {
    const violations = findBoundaryViolations(source, file);
    assert.equal(violations.length, 1, source);
    assert.ok(violations[0]!.pattern.startsWith('dormant-module import'), source);
  }
  // Unrelated modules with those extensions stay clean.
  assert.deepEqual(
    findBoundaryViolations(`import { z } from './contract.js';`, 'src/lib/billing/index.ts'),
    []
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
  // The intentional non-test homes of dormant names are excluded…
  for (const home of [
    'src/lib/gameStats/contract.ts',
    'src/lib/gameStats/types.ts',
    'src/lib/gameStats/durableMerge.ts',
    // PLATFORM-086H3B dormant homes.
    'src/lib/gameStats/revisionAuthority.ts',
    'src/lib/gameStats/revisionRepair.ts',
  ]) {
    assert.ok(!set.has(home), `${home} must be an excluded dormant home`);
  }
  // PLATFORM-086H3B-DORMANT-BOUNDARY-GUARD-REMEDIATION: the admin route is NO LONGER
  // excluded — it and its inspection facade are SCANNED (walked) and enforced by
  // the parser-backed capability guard; the regex only skips their symbol/module
  // false-positives.
  assert.ok(set.has(ADMIN_ROUTE_PATH), 'the admin route must be scanned, not excluded');
  assert.ok(set.has(INSPECTION_FACADE_PATH), 'the inspection facade must be scanned');
  assert.ok(SANCTIONED_ADMIN_SURFACE.has(ADMIN_ROUTE_PATH));
  assert.ok(SANCTIONED_ADMIN_SURFACE.has(INSPECTION_FACADE_PATH));
  // The activation fence is a LIVE (module-scanned) symbol home — NOT excluded.
  assert.ok(FORBIDDEN_SYMBOL_HOMES.has('src/lib/gameStats/activationControl.ts'));
  assert.ok(set.has('src/lib/gameStats/activationControl.ts'), 'activationControl must be scanned');
  // …tests and fixtures never appear…
  assert.ok(files.every((f) => !f.includes('__tests__/') && !TEST_FILE_PATTERN.test(f)));
  // …while real production seams — and the NON-dormant primitive + the
  // chronology home — are all scanned.
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
    // The pure lineage-aware stamp primitive is NOT dormant — kept scanned.
    'src/lib/gameStats/revisionStamp.ts',
    // The LIVE activation fence (symbol home) — module-scanned, symbol-exempt.
    'src/lib/gameStats/activationControl.ts',
    // Hosts the LIVE generic status helpers + the dormant game-stats chronology
    // symbols; stays scanned (only the chronology symbols are exempt here).
    CHRONOLOGY_SYMBOL_HOME,
  ]) {
    assert.ok(set.has(seam), `${seam} must be scanned`);
  }
});

test('scanner: the activation-control symbol home is module-scanned but symbol-exempt', () => {
  const home = 'src/lib/gameStats/activationControl.ts';
  // Defining the dormant transition symbols + using schemaVersion is allowed here…
  assert.deepEqual(
    findBoundaryViolations(
      `export async function setActivationState() {}\nconst r = { schemaVersion: 1 };\n` +
        `export async function markRevisionedEvidenceCommitted() {}`,
      home
    ),
    []
  );
  // …but importing a dormant MODULE from the fence is still a violation.
  const violations = findBoundaryViolations(
    `import { allocateGameStatsCommitStamp } from './revisionAuthority';`,
    home
  );
  assert.ok(violations.some((v) => v.pattern.startsWith('dormant-module import')));
});

// ===========================================================================
// PLATFORM-086H3B-DORMANT-BOUNDARY-GUARD-REMEDIATION — parser-backed capability
// guard for the sanctioned admin surface. The regex above trusts no filename for
// the route; this resolves its imports/exports with the TypeScript compiler API,
// following aliases, re-exports, and multi-hop barrels, so a forbidden lifecycle
// capability cannot reach the route by being renamed or hidden behind a barrel.
// ===========================================================================

test('parser guard: the REAL admin route and inspection facade expose only approved capabilities', () => {
  const routeSrc = readFileSync(path.join(REPO_ROOT, ADMIN_ROUTE_PATH), 'utf8');
  const facadeSrc = readFileSync(path.join(REPO_ROOT, INSPECTION_FACADE_PATH), 'utf8');
  assert.deepEqual(
    analyzeAdminRouteCapabilities(routeSrc),
    [],
    'the admin route must import only the approved allowlist (auth + inspection facade + type-only)'
  );
  assert.deepEqual(
    analyzeInspectionFacadeSurface(facadeSrc),
    [],
    'the facade must export only approved inspection/dry-run symbols'
  );
});

test('parser guard: every prohibited ROUTE import form fails', () => {
  const prohibited: Array<[string, string]> = [
    // direct forbidden import
    [
      `import { repairRevisionState } from '@/lib/gameStats/revisionRepair';`,
      'direct applied-repair import',
    ],
    // aliased forbidden named import
    [
      `import { setActivationState as go } from '@/lib/gameStats/activationControl';\ngo();`,
      'aliased activation import',
    ],
    // namespace import of a local module
    [`import * as rr from '@/lib/gameStats/revisionRepair';`, 'namespace import'],
    // default import exposing a broad object
    [`import rr from '@/lib/gameStats/revisionRepair';`, 'default import'],
    // dynamic import
    [`const m = await import('@/lib/gameStats/revisionRepair');`, 'dynamic import'],
    // require
    [`const m = require('@/lib/gameStats/durableMerge');`, 'require'],
    // chronology mutation API pulled in from its home
    [
      `import { recordGameStatsRefreshSuccess } from '@/lib/server/providerRefreshStatus';`,
      'chronology mutation import',
    ],
    // an unapproved local facade
    [`import { anything } from '@/lib/gameStats/someOtherModule';`, 'unapproved local module'],
  ];
  for (const [source, label] of prohibited) {
    assert.ok(analyzeAdminRouteCapabilities(source).length > 0, `expected a violation: ${label}`);
  }
});

test('parser guard: approved ROUTE imports (incl. type-only + external) pass', () => {
  const approved =
    `import { auth } from '@clerk/nextjs/server';\n` +
    `import { NextResponse } from 'next/server';\n` +
    `import { requireAdminAuth } from '@/lib/server/adminAuth';\n` +
    `import { inspectRevisionState, readRevisionAuditTrail, planRevisionRepair, isCfbdSeasonType } from '@/lib/gameStats/revisionRepairInspection';\n` +
    `import type { PartitionIdentity } from '@/lib/gameStats/revisionAuthority';\n` +
    `import { type RevisionRepairAction } from '@/lib/gameStats/revisionRepairInspection';`;
  assert.deepEqual(analyzeAdminRouteCapabilities(approved), []);
});

test('parser guard: applied repair cannot reach the route even though dry-run planning is allowed', () => {
  // The route may import the DRY-RUN planner…
  assert.deepEqual(
    analyzeAdminRouteCapabilities(
      `import { planRevisionRepair } from '@/lib/gameStats/revisionRepairInspection';`
    ),
    []
  );
  // …but never the applied-repair function, directly or via the facade name.
  assert.ok(
    analyzeAdminRouteCapabilities(
      `import { repairRevisionState } from '@/lib/gameStats/revisionRepairInspection';`
    ).length > 0,
    'applied repair is not on the facade allowlist'
  );
});

test('parser guard: barrels/re-exports cannot hide a forbidden capability from the FACADE surface', () => {
  const forms = [
    // one-hop export * of the whole dormant repair module
    `export * from './revisionRepair.ts';\nexport async function planRevisionRepair() {}`,
    // named re-export of applied repair
    `export { repairRevisionState } from './revisionRepair.ts';`,
    // forbidden capability RENAMED to an approved-looking export
    `export { repairRevisionState as inspectRevisionState } from './revisionRepair.ts';`,
  ];
  for (const source of forms) {
    assert.ok(
      analyzeInspectionFacadeSurface(source).length > 0,
      `facade must reject: ${source.split('\n')[0]}`
    );
  }
  // A safe facade cannot silently EXPAND its exports (adding a mutation re-export).
  const expanded =
    `export { inspectRevisionState, readRevisionAuditTrail, isCfbdSeasonType } from './revisionRepair.ts';\n` +
    `export { setActivationState } from './activationControl.ts';\n` +
    `export async function planRevisionRepair() {}`;
  assert.ok(
    analyzeInspectionFacadeSurface(expanded).length > 0,
    'facade export expansion must fail'
  );
});

test('parser guard: the Codex barrel regression fails (activationControl → export * barrel → route)', () => {
  // activationControl.ts → re-exported wholesale by a new barrel → imported (aliased)
  // by the admin route → invoked. The guard must fail on the route import.
  const virtual = new Map<string, string>([
    ['src/lib/gameStats/lifecycleBarrel.ts', `export * from './activationControl.ts';`],
  ]);
  const routeViaBarrelDirect = analyzeAdminRouteCapabilities(
    `import { setActivationState as arm } from '@/lib/gameStats/lifecycleBarrel';\narm();`,
    ADMIN_ROUTE_PATH,
    virtual
  );
  assert.ok(routeViaBarrelDirect.length > 0, 'route import from a lifecycle barrel must fail');

  // …and if the barrel is instead threaded through the FACADE (multi-hop), the
  // facade export-surface analysis resolves the exact binding and fails.
  const virtualFacade = new Map<string, string>([
    ['src/lib/gameStats/lifecycleBarrel.ts', `export * from './activationControl.ts';`],
    [
      INSPECTION_FACADE_PATH,
      `export * from './lifecycleBarrel.ts';\n` +
        `export { inspectRevisionState, readRevisionAuditTrail, isCfbdSeasonType } from './revisionRepair.ts';\n` +
        `export async function planRevisionRepair() {}`,
    ],
  ]);
  const facadeViaBarrel = analyzeInspectionFacadeSurface(
    virtualFacade.get(INSPECTION_FACADE_PATH)!,
    INSPECTION_FACADE_PATH,
    virtualFacade
  );
  assert.ok(
    facadeViaBarrel.some((v) => v.detail.includes('setActivationState')),
    'multi-hop barrel through the facade must surface the forbidden transition capability'
  );

  // A route that names an APPROVED symbol but whose facade secretly aliases it to a
  // forbidden capability must STILL fail (resolve the exact binding, don't trust the name).
  const virtualAlias = new Map<string, string>([
    [
      INSPECTION_FACADE_PATH,
      `export { repairRevisionState as inspectRevisionState, readRevisionAuditTrail, isCfbdSeasonType } from './revisionRepair.ts';\n` +
        `export async function planRevisionRepair() {}`,
    ],
  ]);
  const aliased = analyzeAdminRouteCapabilities(
    `import { inspectRevisionState } from '@/lib/gameStats/revisionRepairInspection';`,
    ADMIN_ROUTE_PATH,
    virtualAlias
  );
  assert.ok(aliased.length > 0, 'an approved-named import resolving to applied repair must fail');
});

test('parser guard: chronology-mutation and activation-transition APIs cannot enter the route', () => {
  const chronology = analyzeAdminRouteCapabilities(
    `import { composeGameStatsStatusPublication } from '@/lib/server/providerRefreshStatus';`
  );
  assert.ok(chronology.length > 0, 'chronology publication API must be rejected');
  const transition = analyzeAdminRouteCapabilities(
    `import { setActivationState } from '@/lib/gameStats/activationControl';`
  );
  assert.ok(transition.length > 0, 'activation transition API must be rejected');
  // A generic app-state editor capability is likewise rejected.
  const appState = analyzeAdminRouteCapabilities(
    `import { setAppState } from '@/lib/server/appStateStore';`
  );
  assert.ok(appState.length > 0, 'generic app-state mutation must be rejected');
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
