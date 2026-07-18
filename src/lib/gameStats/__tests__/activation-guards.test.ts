import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import * as cacheModule from '../cache.ts';
import * as contractModule from '../contract.ts';
import * as ingestionModule from '../ingestion.ts';
import * as durableMergeModule from '../durableMerge.ts';
import * as partitionCoverageModule from '../partitionCoverage.ts';
import * as recoveryModule from '../recovery.ts';
import * as recoveryDispositionModule from '../recoveryDisposition.ts';
import * as refreshPublicationModule from '../refreshPublication.ts';
import * as publicProjectionModule from '../publicProjection.ts';

// PLATFORM-086H3 — activation guards (AST-based).
//
// The guards enforce the ACTIVATED game-stats architecture boundary with the
// TypeScript compiler API rather than fixed-symbol regexes, so ordinary
// aliases and wrappers cannot slip past them. What the analysis STRUCTURALLY
// GUARANTEES (documented per requirement — this is a boundary enforcement,
// not a proof of arbitrary program semantics):
//
//   1. WRITER BYPASS: in every production source file, no call reaches a
//      durable mutation primitive (`setAppState` / `deleteAppState`) with the
//      `game-stats` evidence scope — including calls through renamed imports,
//      namespace-member access, same-file `const` aliases, and same-file
//      wrapper functions whose bodies touch a mutation primitive, and
//      including scope names carried through same-file `const` string
//      bindings. Cross-FILE wrapper laundering is additionally cut off by
//      rule 3 (the writer routes may not import mutation primitives at all)
//      and by the module boundary (only the merge authority owns the
//      transaction primitive).
//   2. LOCK OWNERSHIP: `withAppStateKeyTransaction` is referenced ONLY by its
//      defining module and the durable merge authority — no independent
//      serialization domain can exist.
//   3. ROUTE BOUNDARY: the game-stats writer routes import NO durable
//      mutation primitive, and no game-stats lifecycle file other than the
//      committed-state finalize path references success/no-op publication —
//      success cannot be published without the committed reread + coverage
//      evaluation that path performs.
//   4. RETIRED PATHS: the blind-overwrite setter name and any production
//      import of the legacy normalizer module fail the scan.
//   5. LIFECYCLE WIRING: the activated pipeline is CONNECTED — the routes
//      call recovery planning / expectation derivation, ingestion, and the
//      finalize path; ingestion actually calls the merge authority;
//      finalization actually rereads durable state and evaluates coverage;
//      analytics, diagnostics, and cache-state reporting actually call the
//      shared projection/coverage. A dead (disconnected) merge or coverage
//      call site fails.
//
// Self-tests at the bottom prove the analyzer flags representative bypasses
// (aliases, wrappers, namespace members, const-derived scopes, disconnected
// wiring) and stays quiet on clean sources.

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

// --- module-specifier resolution helpers ---

function resolveRelative(specifier: string, importerRepoRelativePath: string): string {
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(toPosix(importerRepoRelativePath)), specifier)
  );
}

function specifierTargets(
  specifier: string,
  importerRepoRelativePath: string,
  moduleSuffix: string // e.g. 'server/appStateStore' | 'gameStats/normalizers'
): boolean {
  const normalized = specifier.replace(/\\/g, '/');
  const stripped = normalized.replace(/\.(js|mjs|cjs|ts|mts|cts|tsx)$/, '');
  if (stripped.includes(moduleSuffix)) return true;
  if (!stripped.startsWith('.')) return false;
  const resolved = resolveRelative(stripped, importerRepoRelativePath);
  return resolved === `src/lib/${moduleSuffix}` || resolved.endsWith(`/${moduleSuffix}`);
}

// --- the analyzer ---

const MUTATION_NAMES = new Set(['setAppState', 'deleteAppState']);
const LOCK_NAME = 'withAppStateKeyTransaction';
const RETIRED_SETTER = 'setCachedGameStats';
const GAME_STATS_SCOPE = 'game-stats';

const LOCK_ALLOWED = new Set([
  'src/lib/server/appStateStore.ts',
  'src/lib/gameStats/durableMerge.ts',
]);
const NORMALIZERS_SELF = 'src/lib/gameStats/normalizers.ts';

/** Game-stats writer routes: no durable mutation primitive may be imported. */
function isGameStatsRouteFile(file: string): boolean {
  return (
    file.startsWith('src/app/api/cron/game-stats/') || file.startsWith('src/app/api/game-stats/')
  );
}

/** Game-stats lifecycle files where success/no-op publication is forbidden. */
const PUBLICATION_NAMES = new Set(['recordProviderRefreshSuccess', 'recordProviderRefreshNoop']);
const PUBLICATION_ALLOWED = new Set([
  'src/lib/server/providerRefreshStatus.ts',
  'src/lib/gameStats/refreshPublication.ts',
]);
function isGameStatsLifecycleFile(file: string): boolean {
  return isGameStatsRouteFile(file) || file.startsWith('src/lib/gameStats/');
}

export type GuardViolation = { file: string; rule: string; detail: string; line: number };

function lineAt(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

/**
 * Pure AST analysis of one production source. Two passes: collect import
 * bindings, namespace names, local aliases/wrappers, and const string
 * bindings; then flag violating references/calls.
 */
export function analyzeProductionSource(
  source: string,
  repoRelativePath: string
): GuardViolation[] {
  const violations: GuardViolation[] = [];
  const sourceFile = ts.createSourceFile(
    repoRelativePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    repoRelativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  // Pass 1a: import bindings from appStateStore.
  const mutationBindings = new Set<string>(); // local names bound to setAppState/deleteAppState
  const lockBindings = new Set<string>(); // local names bound to withAppStateKeyTransaction
  const storeNamespaces = new Set<string>(); // `import * as ns` of appStateStore
  let importsNormalizers = false;
  const visitImports = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec)) {
        if (
          repoRelativePath !== NORMALIZERS_SELF &&
          specifierTargets(spec.text, repoRelativePath, 'gameStats/normalizers')
        ) {
          importsNormalizers = true;
          violations.push({
            file: repoRelativePath,
            rule: 'legacy-normalizer-import',
            detail: `production import of the legacy normalizer ("${spec.text}")`,
            line: lineAt(sourceFile, node),
          });
        }
        if (
          ts.isImportDeclaration(node) &&
          specifierTargets(spec.text, repoRelativePath, 'server/appStateStore')
        ) {
          const clause = node.importClause;
          const bindings = clause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              const imported = (element.propertyName ?? element.name).text;
              const local = element.name.text;
              if (MUTATION_NAMES.has(imported)) mutationBindings.add(local);
              if (imported === LOCK_NAME) lockBindings.add(local);
            }
          }
          if (bindings && ts.isNamespaceImport(bindings)) {
            storeNamespaces.add(bindings.name.text);
          }
        }
      }
    }
    ts.forEachChild(node, visitImports);
  };
  visitImports(sourceFile);
  void importsNormalizers;

  // Pass 1b: same-file const aliases, wrapper functions, and scope strings.
  const isTrackedMutationExpr = (expr: ts.Expression): boolean => {
    if (ts.isIdentifier(expr)) return mutationBindings.has(expr.text);
    if (ts.isPropertyAccessExpression(expr)) {
      return (
        ts.isIdentifier(expr.expression) &&
        storeNamespaces.has(expr.expression.text) &&
        MUTATION_NAMES.has(expr.name.text)
      );
    }
    return false;
  };

  const constStrings = new Map<string, string>();
  const wrapperNames = new Set<string>();
  let grew = true;
  const touchesMutation = (node: ts.Node): boolean => {
    let found = false;
    const walk = (n: ts.Node): void => {
      if (found) return;
      if (ts.isIdentifier(n) && (mutationBindings.has(n.text) || wrapperNames.has(n.text))) {
        found = true;
        return;
      }
      if (
        ts.isPropertyAccessExpression(n) &&
        ts.isIdentifier(n.expression) &&
        storeNamespaces.has(n.expression.text) &&
        MUTATION_NAMES.has(n.name.text)
      ) {
        found = true;
        return;
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
  };
  // Iterate to a fixed point so alias-of-alias and wrapper-of-wrapper resolve.
  while (grew) {
    grew = false;
    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const name = node.name.text;
        if (ts.isStringLiteralLike(node.initializer) && !constStrings.has(name)) {
          constStrings.set(name, node.initializer.text);
        }
        if (isTrackedMutationExpr(node.initializer) && !mutationBindings.has(name)) {
          mutationBindings.add(name);
          grew = true;
        }
        if (ts.isIdentifier(node.initializer) && lockBindings.has(node.initializer.text)) {
          if (!lockBindings.has(name)) {
            lockBindings.add(name);
            grew = true;
          }
        }
        if (
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
          touchesMutation(node.initializer) &&
          !wrapperNames.has(name)
        ) {
          wrapperNames.add(name);
          grew = true;
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name && node.body && touchesMutation(node.body)) {
        if (!wrapperNames.has(node.name.text)) {
          wrapperNames.add(node.name.text);
          grew = true;
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);
  }

  const isGameStatsScopeArg = (arg: ts.Expression | undefined): boolean => {
    if (!arg) return false;
    if (ts.isStringLiteralLike(arg)) return arg.text === GAME_STATS_SCOPE;
    if (ts.isIdentifier(arg)) return constStrings.get(arg.text) === GAME_STATS_SCOPE;
    return false;
  };

  // Pass 2: violations.
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === RETIRED_SETTER) {
      violations.push({
        file: repoRelativePath,
        rule: 'retired-blind-overwrite',
        detail: `reference to retired setter "${RETIRED_SETTER}"`,
        line: lineAt(sourceFile, node),
      });
    }
    if (ts.isIdentifier(node) && node.text === LOCK_NAME && !LOCK_ALLOWED.has(repoRelativePath)) {
      violations.push({
        file: repoRelativePath,
        rule: 'independent-transaction-lock',
        detail: 'per-key transaction primitive referenced outside the merge authority',
        line: lineAt(sourceFile, node),
      });
    }
    if (
      ts.isIdentifier(node) &&
      PUBLICATION_NAMES.has(node.text) &&
      isGameStatsLifecycleFile(repoRelativePath) &&
      !PUBLICATION_ALLOWED.has(repoRelativePath)
    ) {
      violations.push({
        file: repoRelativePath,
        rule: 'publication-outside-finalize',
        detail: `"${node.text}" outside the committed-state finalize path`,
        line: lineAt(sourceFile, node),
      });
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const calleeIsMutation =
        (ts.isIdentifier(callee) &&
          (mutationBindings.has(callee.text) || wrapperNames.has(callee.text))) ||
        (ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          storeNamespaces.has(callee.expression.text) &&
          MUTATION_NAMES.has(callee.name.text));
      if (calleeIsMutation && isGameStatsScopeArg(node.arguments[0])) {
        violations.push({
          file: repoRelativePath,
          rule: 'direct-game-stats-write',
          detail: 'durable mutation reached with the game-stats evidence scope',
          line: lineAt(sourceFile, node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Route boundary: the writer routes import NO mutation primitive at all.
  if (
    isGameStatsRouteFile(repoRelativePath) &&
    (mutationBindings.size > 0 || lockBindings.size > 0 || storeNamespaces.size > 0)
  ) {
    violations.push({
      file: repoRelativePath,
      rule: 'writer-route-mutation-import',
      detail: 'game-stats writer route imports a durable mutation primitive',
      line: 1,
    });
  }

  return violations;
}

// --- lifecycle wiring (connectedness) ---

function containsCall(source: string, filePath: string, calleeName: string): boolean {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === calleeName) {
        found = true;
        return;
      }
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === calleeName) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

type WiringRequirement = { file: string; calls: string[] };

const LIFECYCLE_WIRING: WiringRequirement[] = [
  {
    file: 'src/app/api/cron/game-stats/route.ts',
    calls: ['planGameStatsRecovery', 'ingestGameStatsObservations', 'finalizeGameStatsRefresh'],
  },
  {
    file: 'src/app/api/game-stats/route.ts',
    calls: [
      'deriveSlateExpectation',
      'ingestGameStatsObservations',
      'finalizeGameStatsRefresh',
      'toPublicWeeklyGameStats',
      'evaluateGameStatsPartitionCoverage',
    ],
  },
  { file: 'src/lib/gameStats/ingestion.ts', calls: ['mergeGameStatsPartitionDurable'] },
  {
    file: 'src/lib/gameStats/refreshPublication.ts',
    calls: ['getCachedGameStats', 'evaluateGameStatsPartitionCoverage'],
  },
  { file: 'src/lib/gameStats/recovery.ts', calls: ['evaluateGameStatsPartitionCoverage'] },
  { file: 'src/lib/gameStats/ownerStats.ts', calls: ['selectAnalyticsRows'] },
  {
    file: 'src/lib/server/providerDataDiagnostics.ts',
    calls: ['evaluateGameStatsPartitionCoverage'],
  },
  { file: 'src/lib/server/providerCacheState.ts', calls: ['selectAnalyticsRows'] },
];

function findWiringGaps(read: (file: string) => string): string[] {
  const gaps: string[] = [];
  for (const requirement of LIFECYCLE_WIRING) {
    const source = read(requirement.file);
    for (const call of requirement.calls) {
      if (!containsCall(source, requirement.file, call)) {
        gaps.push(`${requirement.file} must call ${call}`);
      }
    }
  }
  return gaps;
}

// === 1. Writer-bypass guard over the real production tree ===

test('no production source bypasses the durable game-stats merge authority', () => {
  const files = listProductionSources();
  assert.ok(files.length > 100, `expected a full production scan, saw ${files.length} files`);

  const violations = files.flatMap((file) =>
    analyzeProductionSource(readFileSync(path.join(REPO_ROOT, file), 'utf8'), file)
  );
  assert.deepEqual(
    violations,
    [],
    `game-stats architecture boundary violated:\n${violations
      .map((v) => `  ${v.file}:${v.line} — [${v.rule}] ${v.detail}`)
      .join('\n')}`
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

// === 2. Activation-completeness guard (connected lifecycle wiring) ===

test('the lifecycle wiring is complete and connected end to end', () => {
  const gaps = findWiringGaps((file) => readFileSync(path.join(REPO_ROOT, file), 'utf8'));
  assert.deepEqual(gaps, [], `lifecycle wiring gaps:\n  ${gaps.join('\n  ')}`);
});

test('the activated modules expose the lifecycle surface end to end', () => {
  assert.equal(typeof ingestionModule.validateGameStatsPayload, 'function');
  assert.equal(typeof ingestionModule.deriveSlateExpectation, 'function');
  assert.equal(typeof ingestionModule.classifyObservationAttachment, 'function');
  assert.equal(typeof ingestionModule.ingestGameStatsObservations, 'function');
  assert.equal(typeof durableMergeModule.mergeGameStatsPartitionDurable, 'function');
  assert.equal(typeof durableMergeModule.computeWeeklyGameStatsMerge, 'function');
  assert.equal(typeof partitionCoverageModule.evaluateGameStatsPartitionCoverage, 'function');
  assert.equal(typeof partitionCoverageModule.isPartitionRecoverySatisfied, 'function');
  assert.equal(typeof recoveryModule.planGameStatsRecovery, 'function');
  assert.equal(typeof recoveryDispositionModule.recordGameStatsRecoveryAttempt, 'function');
  assert.equal(typeof recoveryDispositionModule.isRecoveryEligible, 'function');
  assert.equal(typeof refreshPublicationModule.finalizeGameStatsRefresh, 'function');
  assert.equal(typeof publicProjectionModule.toPublicWeeklyGameStats, 'function');
  assert.equal(typeof contractModule.selectAnalyticsRows, 'function');
  assert.equal(typeof contractModule.toAnalyticsGameStats, 'function');
});

// === Analyzer self-tests: representative bypasses MUST be flagged ===

const STORE_IMPORT = `import { setAppState, deleteAppState } from '../../lib/server/appStateStore';`;

function rulesOf(source: string, file = 'src/app/api/example/route.ts'): string[] {
  return analyzeProductionSource(source, file).map((v) => v.rule);
}

test('analyzer: direct literal-scope writes are flagged', () => {
  assert.ok(
    rulesOf(
      `${STORE_IMPORT}\nawait setAppState('game-stats', key, value);`,
      'src/lib/example.ts'
    ).includes('direct-game-stats-write')
  );
  assert.ok(
    rulesOf(
      `${STORE_IMPORT}\nawait deleteAppState(\`game-stats\`, key);`,
      'src/lib/example.ts'
    ).includes('direct-game-stats-write')
  );
});

test('analyzer: aliased setter + const-derived scope is flagged (required fixture)', () => {
  const source = `${STORE_IMPORT}
const put = setAppState;
const scope = 'game-stats';
put(scope, value);`;
  assert.ok(rulesOf(source, 'src/lib/example.ts').includes('direct-game-stats-write'));
});

test('analyzer: renamed import bindings are flagged', () => {
  const source = `import { setAppState as persist } from '../server/appStateStore';
await persist('game-stats', key, value);`;
  assert.ok(rulesOf(source, 'src/lib/example.ts').includes('direct-game-stats-write'));
});

test('analyzer: namespace-member mutation is flagged', () => {
  const source = `import * as store from '../server/appStateStore';
await store.setAppState('game-stats', key, value);`;
  assert.ok(rulesOf(source, 'src/lib/example.ts').includes('direct-game-stats-write'));
});

test('analyzer: wrapper functions around storage writes are flagged', () => {
  const inlineScope = `${STORE_IMPORT}
function save(value) { return setAppState('game-stats', 'k', value); }`;
  assert.ok(rulesOf(inlineScope, 'src/lib/example.ts').includes('direct-game-stats-write'));

  const parameterScope = `${STORE_IMPORT}
function save(scope, value) { return setAppState(scope, 'k', value); }
await save('game-stats', value);`;
  assert.ok(rulesOf(parameterScope, 'src/lib/example.ts').includes('direct-game-stats-write'));

  const arrowWrapper = `${STORE_IMPORT}
const save = (scope, value) => setAppState(scope, 'k', value);
await save('game-stats', value);`;
  assert.ok(rulesOf(arrowWrapper, 'src/lib/example.ts').includes('direct-game-stats-write'));
});

test('analyzer: the retired setter name is flagged wherever it reappears', () => {
  assert.ok(
    rulesOf(`await setCachedGameStats(record);`, 'src/lib/example.ts').includes(
      'retired-blind-overwrite'
    )
  );
});

test('analyzer: independent transaction-lock use is flagged; sanctioned homes are not', () => {
  const source = `import { withAppStateKeyTransaction } from '../server/appStateStore';
await withAppStateKeyTransaction('game-stats', key, fn);`;
  assert.ok(rulesOf(source, 'src/lib/example.ts').includes('independent-transaction-lock'));
  for (const allowed of LOCK_ALLOWED) {
    assert.ok(!rulesOf(source, allowed).includes('independent-transaction-lock'), allowed);
  }
});

test('analyzer: writer routes may not import mutation primitives at all', () => {
  const source = `${STORE_IMPORT}\nexport const dynamic = 'force-dynamic';`;
  assert.ok(
    rulesOf(source, 'src/app/api/game-stats/route.ts').includes('writer-route-mutation-import')
  );
  assert.ok(
    rulesOf(source, 'src/app/api/cron/game-stats/route.ts').includes('writer-route-mutation-import')
  );
  // A non-game-stats route importing the store for its own dataset is fine.
  assert.ok(
    !rulesOf(source, 'src/app/api/scores/route.ts').includes('writer-route-mutation-import')
  );
});

test('analyzer: success/no-op publication outside the finalize path is flagged', () => {
  const source = `import { recordProviderRefreshSuccess } from '@/lib/server/providerRefreshStatus';
await recordProviderRefreshSuccess('game-stats', scope, {});`;
  assert.ok(
    rulesOf(source, 'src/app/api/game-stats/route.ts').includes('publication-outside-finalize')
  );
  assert.ok(
    !rulesOf(source, 'src/lib/gameStats/refreshPublication.ts').includes(
      'publication-outside-finalize'
    )
  );
  // Other datasets' routes are outside this boundary.
  assert.ok(
    !rulesOf(source, 'src/app/api/scores/route.ts').includes('publication-outside-finalize')
  );
});

test('analyzer: resurrected legacy-normalizer imports are flagged', () => {
  const source = `import { normalizeGameTeamStats } from './normalizers.ts';`;
  assert.ok(rulesOf(source, 'src/lib/gameStats/coverage.ts').includes('legacy-normalizer-import'));
  assert.deepEqual(rulesOf(`export function normalizeGameTeamStats() {}`, NORMALIZERS_SELF), []);
  // An unrelated module that shares the basename stays clean.
  assert.deepEqual(rulesOf(`import { x } from './normalizers';`, 'src/lib/scores/cache.ts'), []);
});

test('analyzer: clean sources produce no violations', () => {
  const clean = [
    [
      `import { getAppState } from '../server/appStateStore';\nawait getAppState('game-stats', k);`,
      'src/lib/example.ts',
    ],
    [`${STORE_IMPORT}\nawait setAppState('schedule', key, value);`, 'src/lib/example.ts'],
    [`const scope = 'game-stats';\nconsole.log(scope);`, 'src/lib/example.ts'],
    [`const contractor = signContract();`, 'src/lib/example.ts'],
  ] as const;
  for (const [source, file] of clean) {
    assert.deepEqual(analyzeProductionSource(source, file), [], source);
  }
});

// === Wiring self-tests: disconnected lifecycle paths MUST be detected ===

test('wiring: a disconnected (dead) merge call site fails', () => {
  const fixture = new Map<string, string>();
  for (const requirement of LIFECYCLE_WIRING) {
    fixture.set(requirement.file, readFileSync(path.join(REPO_ROOT, requirement.file), 'utf8'));
  }
  // Ingestion that imports the merge authority but never CALLS it.
  fixture.set(
    'src/lib/gameStats/ingestion.ts',
    `import { mergeGameStatsPartitionDurable } from './durableMerge.ts';\nexport const dead = mergeGameStatsPartitionDurable;`
  );
  const gaps = findWiringGaps((file) => fixture.get(file)!);
  assert.ok(
    gaps.includes('src/lib/gameStats/ingestion.ts must call mergeGameStatsPartitionDurable')
  );
});

test('wiring: a route that returns early without committed-coverage finalization fails', () => {
  const fixture = new Map<string, string>();
  for (const requirement of LIFECYCLE_WIRING) {
    fixture.set(requirement.file, readFileSync(path.join(REPO_ROOT, requirement.file), 'utf8'));
  }
  fixture.set(
    'src/app/api/game-stats/route.ts',
    `import { ingestGameStatsObservations, deriveSlateExpectation } from '@/lib/gameStats/ingestion';
import { evaluateGameStatsPartitionCoverage } from '@/lib/gameStats/partitionCoverage';
import { toPublicWeeklyGameStats } from '@/lib/gameStats/publicProjection';
export async function GET() {
  deriveSlateExpectation({});
  evaluateGameStatsPartitionCoverage({}, null, {});
  const r = await ingestGameStatsObservations({});
  return Response.json(toPublicWeeklyGameStats(r)); // publishes WITHOUT finalize
}`
  );
  const gaps = findWiringGaps((file) => fixture.get(file)!);
  assert.ok(gaps.includes('src/app/api/game-stats/route.ts must call finalizeGameStatsRefresh'));
});

test('wiring: a raw analytics consumer and a separate diagnostics coverage helper fail', () => {
  const fixture = new Map<string, string>();
  for (const requirement of LIFECYCLE_WIRING) {
    fixture.set(requirement.file, readFileSync(path.join(REPO_ROOT, requirement.file), 'utf8'));
  }
  fixture.set(
    'src/lib/gameStats/ownerStats.ts',
    `export function aggregateOwnerGameStats(games) { return games.map((g) => g.home.totalYards); }`
  );
  fixture.set(
    'src/lib/server/providerDataDiagnostics.ts',
    `function myOwnCoverage(record) { return record.games.length > 0; }\nexport const x = myOwnCoverage;`
  );
  const gaps = findWiringGaps((file) => fixture.get(file)!);
  assert.ok(gaps.includes('src/lib/gameStats/ownerStats.ts must call selectAnalyticsRows'));
  assert.ok(
    gaps.includes(
      'src/lib/server/providerDataDiagnostics.ts must call evaluateGameStatsPartitionCoverage'
    )
  );
});

test('wiring: a public route responding with raw durable rows (no projection) fails', () => {
  const fixture = new Map<string, string>();
  for (const requirement of LIFECYCLE_WIRING) {
    fixture.set(requirement.file, readFileSync(path.join(REPO_ROOT, requirement.file), 'utf8'));
  }
  fixture.set(
    'src/app/api/game-stats/route.ts',
    `import { deriveSlateExpectation, ingestGameStatsObservations } from '@/lib/gameStats/ingestion';
import { finalizeGameStatsRefresh } from '@/lib/gameStats/refreshPublication';
import { evaluateGameStatsPartitionCoverage } from '@/lib/gameStats/partitionCoverage';
import { getCachedGameStats } from '@/lib/gameStats/cache';
export async function GET() {
  deriveSlateExpectation({});
  evaluateGameStatsPartitionCoverage({}, null, {});
  await ingestGameStatsObservations({});
  await finalizeGameStatsRefresh({});
  return Response.json(await getCachedGameStats(2026, 1, 'regular')); // raw durable rows
}`
  );
  const gaps = findWiringGaps((file) => fixture.get(file)!);
  assert.ok(gaps.includes('src/app/api/game-stats/route.ts must call toPublicWeeklyGameStats'));
});

// === Scan hygiene ===

test('production seams are all scanned; tests and fixtures are not', () => {
  const files = listProductionSources();
  const set = new Set(files);
  for (const seam of [
    'src/app/api/cron/game-stats/route.ts',
    'src/app/api/game-stats/route.ts',
    'src/lib/gameStats/ingestion.ts',
    'src/lib/gameStats/identityContext.ts',
    'src/lib/gameStats/durableMerge.ts',
    'src/lib/gameStats/partitionCoverage.ts',
    'src/lib/gameStats/recovery.ts',
    'src/lib/gameStats/recoveryDisposition.ts',
    'src/lib/gameStats/refreshPublication.ts',
    'src/lib/gameStats/publicProjection.ts',
    'src/lib/gameStats/ownerStats.ts',
    'src/lib/gameStats/cache.ts',
    'src/lib/gameStats/normalizers.ts',
    'src/lib/insights/context.ts',
    'src/lib/server/providerDataDiagnostics.ts',
    'src/lib/server/providerCacheState.ts',
    'src/lib/server/appStateStore.ts',
  ]) {
    assert.ok(set.has(seam), `${seam} must be scanned`);
  }
  assert.ok(files.every((f) => !f.includes('__tests__/') && !TEST_FILE_PATTERN.test(f)));
});
