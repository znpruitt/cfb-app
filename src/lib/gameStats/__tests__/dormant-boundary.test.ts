import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { getCachedGameStats, setCachedGameStats } from '../cache.ts';
import { seedLegacyWriterControl } from './writerControlSeed.ts';
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
// the optional dormant type declarations, (PLATFORM-086H2) the dormant durable
// merge service, (PLATFORM-086H3C1) the four dormant canonical evidence
// read-model modules, (PLATFORM-086H3C2) the dormant ingestion coordinator
// that adapts one provider response into H1 parsing + H2 merging, and
// (PLATFORM-086H3D) the dormant writer-control transition authority whose only
// caller is the operator CLI in `scripts/` (outside this production scan).
// Exact files only — never whole directories. The shared RFC 3339 fence parser
// (`observationFence.ts`) and the LIVE writer fence (`writerFence.ts`,
// `cache.ts`) are not dormant homes, so they stay SCANNED (not excluded).
//
// PLATFORM-086H3E1 adds ONE exact, allowlisted production crossing (below):
// the archive snapshot module (`slateSnapshot.ts`) may import `canonicalSlate`
// and reference `deriveCanonicalGameStatsSlateFromBuild` ONLY, so archive
// construction can snapshot the slate of its own exact build. The module
// itself stays SCANNED — every other dormant surface remains forbidden to it,
// and the crossing is forbidden to every other file.
const EXCLUDED_FILES = new Set([
  'src/lib/gameStats/contract.ts',
  'src/lib/gameStats/types.ts',
  'src/lib/gameStats/durableMerge.ts',
  'src/lib/gameStats/canonicalSlate.ts',
  'src/lib/gameStats/evidenceAuthority.ts',
  'src/lib/gameStats/partitionCoverage.ts',
  'src/lib/gameStats/publicProjection.ts',
  'src/lib/gameStats/ingestionCoordinator.ts',
  'src/lib/gameStats/writerControlTransition.ts',
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
  'parseV2GameObservation',
  'buildV2GameStats',
  'schemaVersion',
  'pointsProvided',
  // PLATFORM-086H2 dormant durable-merge APIs and metadata.
  'fetchStartedAt',
  'computeWeeklyGameStatsMerge',
  'mergeGameStatsPartitionDurable',
  // PLATFORM-086H3C1 dormant canonical evidence read-model entry points. A live
  // consumer must not import or re-export these until activation wires them.
  // (`deriveCanonicalGameStatsSlateFromBuild` is PLATFORM-086H3E1's exact-build
  // derivation entry — forbidden everywhere except the allowlisted archive
  // snapshot seam below.)
  'buildCanonicalGameStatsSlate',
  'deriveCanonicalGameStatsSlateFromBuild',
  'loadCanonicalGameStatsSlate',
  'selectCanonicalPartition',
  'selectGameEvidence',
  'evidenceEquivalent',
  'evaluatePartitionCoverage',
  'evaluatePartitionCoverageFromResult',
  'projectPublicPartition',
  'projectPublicFromCoverage',
  'projectAnalyticsPartition',
  // PLATFORM-086H3C2 dormant ingestion-coordinator entry point. A live consumer
  // must not import or reference it until activation (E) wires ingestion.
  'ingestGameStatsPartitionResponse',
  // PLATFORM-086H3D dormant writer-control transition authority. Only the
  // operator CLI (scripts/, unscanned) may invoke it; a live consumer must not
  // import or reference it — production transitions are E's manual runbook.
  'transitionWriterControl',
  'isAllowedWriterControlTransition',
];

const SYMBOL_PATTERN = new RegExp(`\\b(${FORBIDDEN_SYMBOLS.join('|')})\\b`, 'g');
// Module specifiers in every statically-resolvable import form: static
// `from '...'` (incl. re-exports), bare `import '...'`, dynamic
// `import('...')`, `require('...')`, and the template-literal spellings of
// each (`import(\`...\`)`). A template WITH interpolation is not statically
// resolvable and stays out of scope — the `$`-exclusion below keeps a partial
// prefix from ever matching a dormant module by accident.
const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"`]([^'"`$]+)['"`]/g;

// Every dormant game-stats module, by basename. Importing ANY of these from a
// live production file is a boundary violation.
const DORMANT_MODULE_BASENAMES = [
  'contract',
  'durableMerge',
  'canonicalSlate',
  'evidenceAuthority',
  'partitionCoverage',
  'publicProjection',
  'ingestionCoordinator',
  'writerControlTransition',
];
const DORMANT_MODULE_RESOLVED = new RegExp(
  `^src/lib/gameStats/(${DORMANT_MODULE_BASENAMES.join('|')})(\\.(?:js|mjs|cjs|ts|mts|cts|tsx))?$`
);

// PLATFORM-086H3E1: the ONLY permitted production crossings of the dormant
// boundary, exact (file → module basename) and (file → symbol) pairs. The
// archive snapshot module derives the slate of the archive's own exact
// canonical build; every other dormant module and symbol stays forbidden to it,
// and these crossings stay forbidden to every other production file.
//
// The allowance is POSITIONAL and FORM-STRICT, not blanket. The allowlisted
// module may appear only in a SANCTIONED import statement: a plain named
// import (`import { … } from '<module>'`, optionally `import type`), where
// every non-`type` name is an allowlisted symbol, with no `as` aliasing, no
// default or namespace clause, and no inline comments. The allowlisted symbol
// may appear only inside that sanctioned statement or in direct call
// position. Everything else flags: `export … from`, renamed or namespace
// imports, dynamic `import(...)`/`require(...)`, value aliasing
// (`const x = derive…;`), and value exports. Statement boundaries are found
// on a comment/string-masked copy of the source, so semicolons inside
// comments or string literals can neither hide a re-export nor break a
// legitimate import.
//
// HONEST STATIC SCOPE: this is a textual scanner. It rejects every static
// laundering FORM above, but it cannot judge semantics — an exported function
// in the allowlisted file that CALLS the dormant entry and returns derived
// data is the sanctioned purpose of the crossing, and distinguishing that
// from a semantic re-exposure of raw capability belongs to review and to the
// E3 activation guard, never to this scanner.
const ALLOWED_DORMANT_IMPORTS = new Map<string, ReadonlySet<string>>([
  ['src/lib/gameStats/slateSnapshot.ts', new Set(['canonicalSlate'])],
]);
const ALLOWED_DORMANT_SYMBOLS = new Map<string, ReadonlySet<string>>([
  ['src/lib/gameStats/slateSnapshot.ts', new Set(['deriveCanonicalGameStatsSlateFromBuild'])],
]);

/**
 * The dormant module basename a specifier resolves to, or `null` when the
 * specifier targets no dormant module. Returning the basename (not a boolean)
 * lets the scanner apply the exact per-file allowlist above.
 */
function dormantModuleTarget(specifier: string, importerRepoRelativePath: string): string | null {
  const normalized = specifier.replace(/\\/g, '/');
  // Alias/absolute forms (`@/lib/gameStats/contract`, deep relative paths).
  for (const base of DORMANT_MODULE_BASENAMES) {
    if (normalized.includes(`gameStats/${base}`)) return base;
  }
  // Relative forms resolve against the importing file so an unrelated module
  // that merely happens to be named `contract` elsewhere never matches.
  if (!normalized.startsWith('.')) return null;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(toPosix(importerRepoRelativePath)), normalized)
  );
  // TypeScript source commonly imports with .js/.mjs/.cjs specifiers (NodeNext
  // resolution) — every supported extension resolves to the same module.
  const match = DORMANT_MODULE_RESOLVED.exec(resolved);
  return match ? match[1]! : null;
}

type BoundaryViolation = { file: string; pattern: string; line: number };

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/**
 * One-pass textual mask: comment contents and string/template-literal
 * contents become spaces (newlines and the quote characters themselves are
 * kept), so semicolons inside them stop acting as statement boundaries.
 * Identifiers, braces, and keywords survive untouched. Textual, not a real
 * lexer — regex literals and interpolated templates are out of scope, and the
 * bias is fail-safe: a mis-mask can only cause a false FLAG for the
 * allowlisted file, never a false allow of a non-import form.
 */
function maskCommentsAndStrings(source: string): string {
  const out = source.split('');
  let state: 'code' | 'line' | 'block' | 'single' | 'double' | 'template' = 'code';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    const next = source[i + 1];
    if (state === 'code') {
      if (ch === '/' && next === '/') {
        state = 'line';
        out[i] = ' ';
      } else if (ch === '/' && next === '*') {
        state = 'block';
        out[i] = ' ';
      } else if (ch === "'") state = 'single';
      else if (ch === '"') state = 'double';
      else if (ch === '`') state = 'template';
    } else if (state === 'line') {
      if (ch === '\n') state = 'code';
      else out[i] = ' ';
    } else if (state === 'block') {
      if (ch === '*' && next === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 1;
        state = 'code';
      } else if (ch !== '\n') out[i] = ' ';
    } else {
      const closer = state === 'single' ? "'" : state === 'double' ? '"' : '`';
      if (ch === '\\' && next !== undefined && next !== '\n') {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 1;
      } else if (ch === closer) state = 'code';
      else if (ch !== '\n') out[i] = ' ';
    }
  }
  return out.join('');
}

/**
 * Whether the statement containing `index` is a SANCTIONED import of an
 * allowlisted module: a plain named import (optionally `import type`) whose
 * every non-`type` name is an allowlisted symbol — no `as` aliasing, no
 * default or namespace clause, no inline comments. Statement boundaries come
 * from the masked source; the statement text (specifier included) comes from
 * the original.
 */
function sanctionedImportStatement(
  source: string,
  masked: string,
  index: number,
  repoRelativePath: string,
  allowedModules: ReadonlySet<string> | undefined,
  allowedSymbols: ReadonlySet<string> | undefined
): boolean {
  if (!allowedModules) return false;
  const boundary = masked.lastIndexOf(';', index - 1) + 1;
  const endIdx = masked.indexOf(';', index);
  const end = endIdx === -1 ? source.length : endIdx + 1;
  // Skip leading whitespace AND leading comments (spaces in the mask).
  let start = boundary;
  while (start < end && /\s/.test(masked[start]!)) start += 1;
  const statement = source.slice(start, end);
  const clause = /^import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"`]([^'"`$]+)['"`]\s*;?\s*$/.exec(
    statement
  );
  if (!clause) return false;
  const target = dormantModuleTarget(clause[3]!, repoRelativePath);
  if (target === null || !allowedModules.has(target)) return false;
  const typeOnlyImport = clause[1] !== undefined;
  const entries = clause[2]!
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const entry of entries) {
    if (/^type\s+[A-Za-z_$][\w$]*$/.test(entry)) continue;
    if (!/^[A-Za-z_$][\w$]*$/.test(entry)) return false; // aliasing / anything exotic
    if (typeOnlyImport) continue; // a pure type import carries no capability
    if (!allowedSymbols?.has(entry)) return false;
  }
  return true;
}

/** Pure scan of one production source text for dormant-boundary violations. */
function findBoundaryViolations(source: string, repoRelativePath: string): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const allowedSymbols = ALLOWED_DORMANT_SYMBOLS.get(repoRelativePath);
  const allowedImports = ALLOWED_DORMANT_IMPORTS.get(repoRelativePath);
  // The mask exists only to place statement boundaries for the allowlisted
  // file's positional rules; non-allowlisted files never consult it.
  const masked = allowedSymbols || allowedImports ? maskCommentsAndStrings(source) : null;
  for (const match of source.matchAll(SYMBOL_PATTERN)) {
    if (allowedSymbols?.has(match[1]!) && masked !== null) {
      // Positional allowance only: a direct call, or the name inside the
      // sanctioned import statement. Re-exports, renamed imports, aliasing,
      // and value exports fall through and flag as laundering.
      const isDirectCall = /^\s*\(/.test(source.slice(match.index + match[1]!.length));
      if (
        isDirectCall ||
        sanctionedImportStatement(
          source,
          masked,
          match.index,
          repoRelativePath,
          allowedImports,
          allowedSymbols
        )
      ) {
        continue;
      }
    }
    violations.push({
      file: repoRelativePath,
      pattern: `forbidden symbol "${match[1]}"`,
      line: lineOf(source, match.index),
    });
  }
  for (const match of source.matchAll(SPECIFIER_PATTERN)) {
    const target = dormantModuleTarget(match[1]!, repoRelativePath);
    if (target === null) continue;
    // The specifier is allowed ONLY inside the fully sanctioned import form —
    // `export * from`, `export { … } from`, namespace/renamed/default
    // clauses, dynamic `import(...)`, and `require(...)` all still flag.
    if (
      masked !== null &&
      allowedImports?.has(target) &&
      sanctionedImportStatement(
        source,
        masked,
        match.index,
        repoRelativePath,
        allowedImports,
        allowedSymbols
      )
    ) {
      continue;
    }
    violations.push({
      file: repoRelativePath,
      pattern: `dormant-module import "${match[1]}"`,
      line: lineOf(source, match.index),
    });
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
    // PLATFORM-086H3C1 canonical evidence read-model entry points.
    ['const s = await loadCanonicalGameStatsSlate({ year, now });', 'loadCanonicalGameStatsSlate'],
    ['const d = selectGameEvidence(game, rows, resolveKey);', 'selectGameEvidence'],
    ['const c = evaluatePartitionCoverage(slate, w, st, rec);', 'evaluatePartitionCoverage'],
    ['const w = projectPublicPartition(slate, w, st, read);', 'projectPublicPartition'],
    // PLATFORM-086H3C2 ingestion-coordinator entry point.
    [
      'const r = await ingestGameStatsPartitionResponse(input);',
      'ingestGameStatsPartitionResponse',
    ],
    // PLATFORM-086H3D writer-control transition authority entry points.
    [
      'const t = await transitionWriterControl({ expected, to, apply });',
      'transitionWriterControl',
    ],
    ['if (isAllowedWriterControlTransition(a, b)) {}', 'isAllowedWriterControlTransition'],
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
  // The four PLATFORM-086H3C1 read-model modules are guarded the same way.
  const c1Flagged = [
    `import { buildCanonicalGameStatsSlate } from '../gameStats/canonicalSlate';`,
    `const m = await import('@/lib/gameStats/evidenceAuthority');`,
    `const m = require('../gameStats/partitionCoverage.ts');`,
    `export * from '../gameStats/publicProjection';`,
  ];
  for (const source of c1Flagged) {
    const violations = findBoundaryViolations(source, importer);
    assert.ok(
      violations.some((v) => v.pattern.startsWith('dormant-module import')),
      source
    );
  }
  for (const base of [
    'canonicalSlate',
    'evidenceAuthority',
    'partitionCoverage',
    'publicProjection',
  ]) {
    assert.equal(
      findBoundaryViolations(`export * from './${base}';`, 'src/lib/gameStats/index.ts').length,
      1,
      base
    );
  }
  // The PLATFORM-086H3C2 ingestion coordinator is guarded the same way in every
  // import form.
  const c2Flagged = [
    `import { ingestGameStatsPartitionResponse } from '../gameStats/ingestionCoordinator';`,
    `const m = await import('@/lib/gameStats/ingestionCoordinator');`,
    `const m = require('../gameStats/ingestionCoordinator.ts');`,
    `export * from '../gameStats/ingestionCoordinator';`,
  ];
  for (const source of c2Flagged) {
    const violations = findBoundaryViolations(source, importer);
    assert.ok(
      violations.some((v) => v.pattern.startsWith('dormant-module import')),
      source
    );
  }
  assert.equal(
    findBoundaryViolations(`export * from './ingestionCoordinator';`, 'src/lib/gameStats/index.ts')
      .length,
    1
  );
  // The PLATFORM-086H3D transition authority is guarded the same way in every
  // import form.
  const transitionFlagged = [
    `import { transitionWriterControl } from '../gameStats/writerControlTransition';`,
    `const m = await import('@/lib/gameStats/writerControlTransition');`,
    `const m = require('../gameStats/writerControlTransition.ts');`,
    `export * from '../gameStats/writerControlTransition';`,
  ];
  for (const source of transitionFlagged) {
    const violations = findBoundaryViolations(source, importer);
    assert.ok(
      violations.some((v) => v.pattern.startsWith('dormant-module import')),
      source
    );
  }
  assert.equal(
    findBoundaryViolations(
      `export * from './writerControlTransition';`,
      'src/lib/gameStats/index.ts'
    ).length,
    1
  );
  // The shared fence parser is a benign primitive — importing it is NOT a
  // boundary violation.
  assert.deepEqual(
    findBoundaryViolations(
      `import { parseObservationFenceMs } from './observationFence';`,
      importer
    ),
    []
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

test('scanner: the E1 archive-snapshot allowlist is exact — file, module, and symbol', () => {
  const snapshotModule = 'src/lib/gameStats/slateSnapshot.ts';
  const crossing = `import { deriveCanonicalGameStatsSlateFromBuild } from './canonicalSlate.ts';`;

  // The allowlisted crossing itself is clean (both the specifier and the symbol).
  assert.deepEqual(findBoundaryViolations(crossing, snapshotModule), []);

  // The SAME source from any other production file flags BOTH ways.
  const elsewhere = findBoundaryViolations(
    `import { deriveCanonicalGameStatsSlateFromBuild } from '../gameStats/canonicalSlate.ts';`,
    'src/lib/seasonRollover.ts'
  );
  assert.equal(elsewhere.length, 2, 'symbol + import must both flag outside the allowlist');
  assert.ok(elsewhere.some((v) => v.pattern.includes('deriveCanonicalGameStatsSlateFromBuild')));
  assert.ok(elsewhere.some((v) => v.pattern.startsWith('dormant-module import')));

  // The allowlisted FILE gains no other dormant privileges: every other dormant
  // module and every other dormant symbol still flags inside it.
  const laundering = [
    `import { mergeGameStatsPartitionDurable } from './durableMerge.ts';`,
    `const m = await import('./publicProjection.ts');`,
    `export * from './evidenceAuthority.ts';`,
    `const p = projectAnalyticsPartition(input, w, st, rec, rel);`,
    `const s = buildCanonicalGameStatsSlate({ year, scheduleItems, teams, aliasMap, now });`,
  ];
  for (const source of laundering) {
    assert.ok(
      findBoundaryViolations(source, snapshotModule).length >= 1,
      `must stay forbidden inside the snapshot module: ${source}`
    );
  }

  // The allowance is POSITIONAL and FORM-STRICT: even the allowlisted
  // module/symbol cannot be re-exported, renamed, namespace-grabbed,
  // value-exported, dynamically imported, or bundled with non-allowlisted
  // names from the allowlisted file — the crossing must not launder dormant
  // capability onward.
  const positionalLaundering = [
    `export * from './canonicalSlate.ts';`,
    `export { deriveCanonicalGameStatsSlateFromBuild } from './canonicalSlate.ts';`,
    `export { deriveCanonicalGameStatsSlateFromBuild as deriveSlate } from './canonicalSlate.ts';`,
    // Renamed import: the alias would be invisible to the symbol scan afterward.
    `import { deriveCanonicalGameStatsSlateFromBuild as derive } from './canonicalSlate.ts';`,
    // Namespace import: grabs the whole dormant module without naming a symbol.
    `import * as canonicalSlate from './canonicalSlate.ts';`,
    // Bundling a non-allowlisted runtime export into the sanctioned form.
    `import { deriveCanonicalGameStatsSlateFromBuild, EXPECTED_KICKOFF_MIN_AGE_MS } from './canonicalSlate.ts';`,
    // A semicolon hidden in a comment must not disguise a re-export as an import.
    `export /* ; import */ { deriveCanonicalGameStatsSlateFromBuild } from './canonicalSlate.ts';`,
    `const m = await import('./canonicalSlate.ts');`,
    'const m = await import(`./canonicalSlate.ts`);',
    `const m = require('./canonicalSlate.ts');`,
    `const alias = deriveCanonicalGameStatsSlateFromBuild;`,
    `export const derive = deriveCanonicalGameStatsSlateFromBuild;`,
  ];
  for (const source of positionalLaundering) {
    assert.ok(
      findBoundaryViolations(source, snapshotModule).length >= 1,
      `positional laundering must flag inside the snapshot module: ${source}`
    );
  }

  // …while the sanctioned forms are clean, exactly as the real module uses
  // them — including with a semicolon-bearing comment BEFORE the import
  // (statement boundaries come from the comment/string mask).
  const sanctioned = [
    `/* provenance rationale; more rationale */`,
    `import {`,
    `  deriveCanonicalGameStatsSlateFromBuild,`,
    `  type CanonicalGame,`,
    `  type CanonicalSlate,`,
    `} from './canonicalSlate.ts';`,
    `const slate = deriveCanonicalGameStatsSlateFromBuild(input);`,
  ].join('\n');
  assert.deepEqual(findBoundaryViolations(sanctioned, snapshotModule), []);

  // A pure type import carries no runtime capability and stays clean.
  assert.deepEqual(
    findBoundaryViolations(
      `import type { CanonicalGame } from './canonicalSlate.ts';`,
      snapshotModule
    ),
    []
  );
});

test('scanner: template-literal specifiers resolve like quoted ones', () => {
  const importer = 'src/lib/insights/context.ts';
  const flagged = [
    'const m = await import(`../gameStats/durableMerge`);',
    'const m = require(`@/lib/gameStats/publicProjection`);',
  ];
  for (const source of flagged) {
    const violations = findBoundaryViolations(source, importer);
    assert.ok(
      violations.some((v) => v.pattern.startsWith('dormant-module import')),
      source
    );
  }
  // An INTERPOLATED template is not statically resolvable — its partial prefix
  // must never accidentally match a dormant module.
  assert.deepEqual(
    // eslint-disable-next-line no-template-curly-in-string
    findBoundaryViolations('const m = await import(`./modules/${name}`);', importer),
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
  for (const excluded of [
    'src/lib/gameStats/contract.ts',
    'src/lib/gameStats/types.ts',
    'src/lib/gameStats/durableMerge.ts',
    // PLATFORM-086H3C1 read-model modules.
    'src/lib/gameStats/canonicalSlate.ts',
    'src/lib/gameStats/evidenceAuthority.ts',
    'src/lib/gameStats/partitionCoverage.ts',
    'src/lib/gameStats/publicProjection.ts',
    // PLATFORM-086H3C2 ingestion coordinator.
    'src/lib/gameStats/ingestionCoordinator.ts',
    // PLATFORM-086H3D writer-control transition authority.
    'src/lib/gameStats/writerControlTransition.ts',
  ]) {
    assert.ok(!set.has(excluded), `${excluded} must be excluded`);
  }
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
    // The E1 archive-snapshot seam holds an EXACT allowlisted crossing — it must
    // stay SCANNED so every non-allowlisted dormant reference inside it flags.
    'src/lib/gameStats/slateSnapshot.ts',
    // The LIVE writer fence must stay scanned — only the transition authority
    // (writerControlTransition.ts) is a dormant home, never the fence itself.
    'src/lib/gameStats/writerFence.ts',
    // The shared RFC 3339 fence parser is a benign primitive, NOT a dormant home,
    // so it MUST stay scanned (it never references a dormant capability itself).
    'src/lib/gameStats/observationFence.ts',
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
  await seedLegacyWriterControl();
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
