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
import * as refreshOrchestrationModule from '../refreshOrchestration.ts';
import * as refreshPublicationModule from '../refreshPublication.ts';
import * as readAvailabilityModule from '../readAvailability.ts';
import * as publicProjectionModule from '../publicProjection.ts';

// PLATFORM-086H3 — activation guards.
//
// The primary boundary is MODULE OWNERSHIP over RESOLVED IMPORTS: sensitive
// capabilities (durable mutation, the transaction lock, refresh-status
// publication, recovery-disposition mutation, coverage evaluation, raw
// durable-row reads) are importable only by their designated owners, so a
// production file simply cannot obtain the capability outside its ownership
// domain. A secondary AST pass catches in-file bypass shapes (aliases,
// namespace members, const-derived scope strings, same-file wrappers) for the
// capabilities that ARE legitimately imported elsewhere.
//
// WHAT THIS STRUCTURALLY GUARANTEES (and what it does not):
//   ✔ no production file outside the allowlists can IMPORT the guarded
//     capabilities (resolved specifiers, all import forms);
//   ✔ guarded capabilities cannot be RE-EXPORTED or laundered onward by any
//     file (owners included): `export *`, barrels, named/aliased/namespace
//     re-exports, local `export { x }` of a guarded binding, exported
//     `const alias = guarded`, and exported forwarding WRAPPERS that pass
//     their own parameters (or a rest spread) through to the guarded call —
//     detected through `await`, parentheses, `as`, alias chains, a
//     namespace-member callee, default/rest params, and any argument
//     position;
//   ✔ within any single file, ordinary aliasing/wrapping of an imported
//     mutation/read primitive cannot reach the game-stats evidence scope
//     undetected (fixed-point alias/wrapper propagation, scope strings
//     through const chains, wrapper scope arguments at any position);
//   ✔ the activated lifecycle is CONNECTED (each stage's file really calls
//     its downstream stage).
//   ✖ these are STATIC guarantees over ordinary TypeScript imports, aliases,
//     wrappers, and exports. The analyzer does NOT claim to prove behavior of
//     RUNTIME-generated/dynamic dispatch (computed member access on a
//     namespace, `eval`, `Function`, reflection, dynamic `import()` of a
//     computed specifier), nor arbitrary cross-file control flow or
//     reachability — those cannot arise in production ownership precisely
//     BECAUSE the import boundary keeps unauthorized files from obtaining the
//     capability in the first place, and every allowlisted file is owned,
//     reviewed lifecycle code. A genuine domain API that constructs its OWN
//     scope/key and forwards none of its parameters is intentionally allowed.

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

// --- module-specifier resolution ---

function resolveSpecifier(specifier: string, importerRepoRelativePath: string): string {
  const normalized = specifier.replace(/\\/g, '/').replace(/\.(js|mjs|cjs|ts|mts|cts|tsx)$/, '');
  if (normalized.startsWith('@/')) return `src/${normalized.slice(2)}`;
  if (!normalized.startsWith('.')) return normalized; // bare package
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(toPosix(importerRepoRelativePath)), normalized)
  );
}

// --- ownership boundaries (resolved module → named export → allowed importers) ---

const GAME_STATS_ROUTES = [
  'src/app/api/cron/game-stats/route.ts',
  'src/app/api/game-stats/route.ts',
];

function isGameStatsRouteFile(file: string): boolean {
  return (
    file.startsWith('src/app/api/cron/game-stats/') || file.startsWith('src/app/api/game-stats/')
  );
}
function isGameStatsLifecycleFile(file: string): boolean {
  return isGameStatsRouteFile(file) || file.startsWith('src/lib/gameStats/');
}

type OwnershipRule = {
  /** Resolved module path (repo-relative, extensionless). */
  module: string;
  /** Named exports this rule guards. */
  names: readonly string[];
  /** Exact production files allowed to import those names. */
  allowed: ReadonlySet<string>;
  /** Restrict enforcement to a subset of files (default: all production). */
  appliesTo?: (file: string) => boolean;
  rule: string;
};

const OWNERSHIP_RULES: OwnershipRule[] = [
  {
    // The transaction-lock primitive: the durable authorities — the evidence
    // merge, the recovery-metadata owner, and the refresh-status ledger's
    // atomic compare-and-write (PLATFORM-086H3 status ordering).
    module: 'src/lib/server/appStateStore',
    names: ['withAppStateKeyTransaction'],
    allowed: new Set([
      'src/lib/gameStats/durableMerge.ts',
      'src/lib/gameStats/recoveryDisposition.ts',
      'src/lib/server/providerRefreshStatus.ts',
    ]),
    rule: 'transaction-lock-ownership',
  },
  {
    // Durable mutation primitives: forbidden across the ENTIRE game-stats
    // lifecycle except the recovery-metadata owner (whose scope usage the AST
    // pass further restricts). Other datasets' files are out of scope here —
    // the AST scope check still covers them for the game-stats scope.
    module: 'src/lib/server/appStateStore',
    names: ['setAppState', 'deleteAppState'],
    allowed: new Set(['src/lib/gameStats/recoveryDisposition.ts']),
    appliesTo: isGameStatsLifecycleFile,
    rule: 'evidence-mutation-ownership',
  },
  {
    // Refresh-status SUCCESS/NOOP publication: only the committed-coverage
    // finalization boundary (within the game-stats lifecycle).
    module: 'src/lib/server/providerRefreshStatus',
    names: ['recordProviderRefreshSuccess', 'recordProviderRefreshNoop'],
    allowed: new Set(['src/lib/gameStats/refreshPublication.ts']),
    appliesTo: isGameStatsLifecycleFile,
    rule: 'status-publication-ownership',
  },
  {
    // Failure recording + attempt begin: finalization boundary plus the
    // orchestration (pre-ingestion provider/config failures). Routes: never.
    module: 'src/lib/server/providerRefreshStatus',
    names: ['recordProviderRefreshFailure', 'beginProviderRefreshAttempt'],
    allowed: new Set([
      'src/lib/gameStats/refreshPublication.ts',
      'src/lib/gameStats/refreshOrchestration.ts',
    ]),
    appliesTo: isGameStatsLifecycleFile,
    rule: 'status-publication-ownership',
  },
  {
    // Recovery metadata MUTATION: only the orchestration boundary.
    module: 'src/lib/gameStats/recoveryDisposition',
    names: [
      'claimGameStatsRecoveryPartition',
      'finalizeGameStatsRecoveryClaim',
      'retireGameStatsRecoveryDisposition',
    ],
    allowed: new Set(['src/lib/gameStats/refreshOrchestration.ts']),
    rule: 'recovery-mutation-ownership',
  },
  {
    // Coverage evaluation: the shared consumers — never the writer routes.
    module: 'src/lib/gameStats/partitionCoverage',
    names: ['evaluateGameStatsPartitionCoverage'],
    allowed: new Set([
      'src/lib/gameStats/recovery.ts',
      'src/lib/gameStats/refreshPublication.ts',
      'src/lib/gameStats/refreshOrchestration.ts',
      'src/lib/gameStats/readAvailability.ts',
      'src/lib/server/providerDataDiagnostics.ts',
    ]),
    rule: 'coverage-ownership',
  },
  {
    // Raw durable-row readers: lifecycle internals + documented compatibility
    // readers (insights, debug diagnostics). Writer routes: never — they
    // serve committed state through the finalize/read boundaries.
    module: 'src/lib/gameStats/cache',
    names: ['getCachedGameStats', 'listCachedGameStats', 'listCachedGameStatsWeeks'],
    allowed: new Set([
      'src/lib/gameStats/durableMerge.ts',
      'src/lib/gameStats/refreshPublication.ts',
      'src/lib/gameStats/refreshOrchestration.ts',
      'src/lib/gameStats/readAvailability.ts',
      'src/lib/insights/context.ts',
      'src/lib/server/providerDataDiagnostics.ts',
      'src/app/api/debug/archive-integrity/route.ts',
      'src/app/api/debug/game-stats-diagnostic/route.ts',
    ]),
    rule: 'raw-row-ownership',
  },
  {
    // The refresh orchestration entry points: the writer routes only.
    module: 'src/lib/gameStats/refreshOrchestration',
    names: ['runScheduledGameStatsRefresh', 'runManualGameStatsRefresh'],
    allowed: new Set(GAME_STATS_ROUTES),
    rule: 'orchestration-ownership',
  },
  {
    // The evidence merge authority: callable only from validated ingestion.
    module: 'src/lib/gameStats/durableMerge',
    names: ['mergeGameStatsPartitionDurable', 'computeWeeklyGameStatsMerge'],
    allowed: new Set(['src/lib/gameStats/ingestion.ts']),
    rule: 'merge-ownership',
  },
  {
    // Validated ingestion: callable only from the orchestration boundary.
    module: 'src/lib/gameStats/ingestion',
    names: ['ingestGameStatsObservations'],
    allowed: new Set(['src/lib/gameStats/refreshOrchestration.ts']),
    rule: 'ingestion-ownership',
  },
  {
    // Committed-state finalization: callable only from the orchestration.
    module: 'src/lib/gameStats/refreshPublication',
    names: ['finalizeGameStatsRefresh'],
    allowed: new Set(['src/lib/gameStats/refreshOrchestration.ts']),
    rule: 'finalization-ownership',
  },
];

/** Files allowed to read RAW game-stats rows via the generic store getter. */
const RAW_GENERIC_READ_ALLOWED = new Set([
  'src/lib/gameStats/cache.ts',
  // Documented raw-inspection debug surface.
  'src/app/api/debug/game-stats-diagnostic/route.ts',
]);

// --- guard analysis ---

export type GuardViolation = { file: string; rule: string; detail: string; line: number };

function lineAt(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

const MUTATION_NAMES = new Set(['setAppState', 'deleteAppState']);
const LOCK_NAME = 'withAppStateKeyTransaction';
const RETIRED_SETTER = 'setCachedGameStats';
const GAME_STATS_SCOPE = 'game-stats';
const NORMALIZERS_SELF = 'src/lib/gameStats/normalizers.ts';

/**
 * Analyze one production source. Two passes: (1) resolve imports — ownership
 * violations, and local binding names for guarded capabilities (including
 * renames and namespace imports); (2) AST bypass scan — retired setter,
 * lock use via ANY binding, mutation calls whose scope argument (const-chain
 * resolved, any wrapper argument position) is the game-stats evidence scope.
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

  // Pass 1: imports.
  const mutationBindings = new Set<string>();
  const lockBindings = new Set<string>();
  const readBindings = new Set<string>();
  const storeNamespaces = new Set<string>();
  /** Local bindings holding a guarded capability (for re-export laundering). */
  const guardedBindings = new Map<string, string>();

  const visitImports = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (spec && ts.isStringLiteral(spec)) {
        const resolved = resolveSpecifier(spec.text, repoRelativePath);
        if (repoRelativePath !== NORMALIZERS_SELF && resolved === 'src/lib/gameStats/normalizers') {
          violations.push({
            file: repoRelativePath,
            rule: 'legacy-normalizer-import',
            detail: `production import of the legacy normalizer ("${spec.text}")`,
            line: lineAt(sourceFile, node),
          });
        }

        // Ownership rules over the resolved module.
        for (const rule of OWNERSHIP_RULES) {
          if (resolved !== rule.module) continue;
          const isOwner = rule.allowed.has(repoRelativePath);
          const inScope = !rule.appliesTo || rule.appliesTo(repoRelativePath);

          if (ts.isExportDeclaration(node)) {
            // RE-EXPORTS of guarded capabilities are forbidden for EVERYONE —
            // including allowlisted owners: an owner re-exporting the raw
            // capability would launder it past the import boundary
            // (`export *`, barrels, aliased named re-exports all count).
            if (!node.exportClause) {
              violations.push({
                file: repoRelativePath,
                rule: 'guarded-reexport',
                detail: `\`export *\` from guarded module "${spec.text}"`,
                line: lineAt(sourceFile, node),
              });
            } else if (ts.isNamedExports(node.exportClause)) {
              for (const element of node.exportClause.elements) {
                const exported = (element.propertyName ?? element.name).text;
                if (rule.names.includes(exported)) {
                  violations.push({
                    file: repoRelativePath,
                    rule: 'guarded-reexport',
                    detail: `re-export of guarded "${exported}" from "${spec.text}"`,
                    line: lineAt(sourceFile, element),
                  });
                } else if (!isOwner && inScope) {
                  violations.push({
                    file: repoRelativePath,
                    rule: rule.rule,
                    detail: `re-export from guarded module "${spec.text}"`,
                    line: lineAt(sourceFile, element),
                  });
                }
              }
            } else {
              // `export * as ns from` — namespace re-export grants everything.
              violations.push({
                file: repoRelativePath,
                rule: 'guarded-reexport',
                detail: `namespace re-export of guarded module "${spec.text}"`,
                line: lineAt(sourceFile, node),
              });
            }
            continue;
          }

          // Import declarations: binding tracking for laundering detection
          // applies to every file (owners included)…
          const bindings = node.importClause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              const imported = (element.propertyName ?? element.name).text;
              if (rule.names.includes(imported)) {
                guardedBindings.set(element.name.text, imported);
              }
            }
          }
          // …while the ownership restriction applies to non-owners in scope.
          if (isOwner || !inScope) continue;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              const imported = (element.propertyName ?? element.name).text;
              if (rule.names.includes(imported)) {
                violations.push({
                  file: repoRelativePath,
                  rule: rule.rule,
                  detail: `"${imported}" imported outside its ownership boundary`,
                  line: lineAt(sourceFile, element),
                });
              }
            }
          }
          if (bindings && ts.isNamespaceImport(bindings)) {
            // A namespace import of a guarded module grants every export —
            // treat it as importing all guarded names.
            violations.push({
              file: repoRelativePath,
              rule: rule.rule,
              detail: `namespace import of guarded module "${spec.text}"`,
              line: lineAt(sourceFile, node),
            });
          }
        }

        // Binding collection for the AST pass (any file, incl. allowed ones).
        if (resolved === 'src/lib/server/appStateStore' && ts.isImportDeclaration(node)) {
          const bindings = node.importClause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) {
            for (const element of bindings.elements) {
              const imported = (element.propertyName ?? element.name).text;
              const local = element.name.text;
              if (MUTATION_NAMES.has(imported)) mutationBindings.add(local);
              if (imported === LOCK_NAME) lockBindings.add(local);
              if (imported === 'getAppState') readBindings.add(local);
            }
          }
          if (bindings && ts.isNamespaceImport(bindings)) storeNamespaces.add(bindings.name.text);
        }
      }
    }
    ts.forEachChild(node, visitImports);
  };
  visitImports(sourceFile);

  // Pass 1b: same-file alias/wrapper/const-string propagation (fixed point).
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
  const isTrackedLockExpr = (expr: ts.Expression): boolean => {
    if (ts.isIdentifier(expr)) return lockBindings.has(expr.text);
    if (ts.isPropertyAccessExpression(expr)) {
      return (
        ts.isIdentifier(expr.expression) &&
        storeNamespaces.has(expr.expression.text) &&
        expr.name.text === LOCK_NAME
      );
    }
    return false;
  };

  const constStrings = new Map<string, string>();
  const wrapperNames = new Set<string>();
  const readWrapperNames = new Set<string>();
  const isTrackedReadExpr = (expr: ts.Expression): boolean => {
    if (ts.isIdentifier(expr)) return readBindings.has(expr.text);
    if (ts.isPropertyAccessExpression(expr)) {
      return (
        ts.isIdentifier(expr.expression) &&
        storeNamespaces.has(expr.expression.text) &&
        expr.name.text === 'getAppState'
      );
    }
    return false;
  };
  const touchesRead = (node: ts.Node): boolean => {
    let found = false;
    const walk = (n: ts.Node): void => {
      if (found) return;
      if (ts.isIdentifier(n) && (readBindings.has(n.text) || readWrapperNames.has(n.text))) {
        found = true;
        return;
      }
      if (
        ts.isPropertyAccessExpression(n) &&
        ts.isIdentifier(n.expression) &&
        storeNamespaces.has(n.expression.text) &&
        n.name.text === 'getAppState'
      ) {
        found = true;
        return;
      }
      ts.forEachChild(n, walk);
    };
    walk(node);
    return found;
  };
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
  let grew = true;
  while (grew) {
    grew = false;
    const collect = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const name = node.name.text;
        if (ts.isStringLiteralLike(node.initializer) && !constStrings.has(name)) {
          constStrings.set(name, node.initializer.text);
          grew = true;
        }
        // Chained const-string aliases: const a = 'game-stats'; const b = a;
        if (
          ts.isIdentifier(node.initializer) &&
          constStrings.has(node.initializer.text) &&
          !constStrings.has(name)
        ) {
          constStrings.set(name, constStrings.get(node.initializer.text)!);
          grew = true;
        }
        if (isTrackedMutationExpr(node.initializer) && !mutationBindings.has(name)) {
          mutationBindings.add(name);
          grew = true;
        }
        if (isTrackedReadExpr(node.initializer) && !readBindings.has(name)) {
          readBindings.add(name);
          grew = true;
        }
        if (isTrackedLockExpr(node.initializer) && !lockBindings.has(name)) {
          lockBindings.add(name);
          grew = true;
        }
        // Alias chains of ANY guarded capability (`const g2 = g1`) propagate so
        // an exported alias/forwarder through a renamed local is still caught.
        if (
          ts.isIdentifier(node.initializer) &&
          guardedBindings.has(node.initializer.text) &&
          !guardedBindings.has(name)
        ) {
          guardedBindings.set(name, guardedBindings.get(node.initializer.text)!);
          grew = true;
        }
        if (
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
          touchesMutation(node.initializer) &&
          !wrapperNames.has(name)
        ) {
          wrapperNames.add(name);
          grew = true;
        }
        if (
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) &&
          touchesRead(node.initializer) &&
          !readWrapperNames.has(name)
        ) {
          readWrapperNames.add(name);
          grew = true;
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name && node.body && touchesMutation(node.body)) {
        if (!wrapperNames.has(node.name.text)) {
          wrapperNames.add(node.name.text);
          grew = true;
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name && node.body && touchesRead(node.body)) {
        if (!readWrapperNames.has(node.name.text)) {
          readWrapperNames.add(node.name.text);
          grew = true;
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(sourceFile);
  }

  const isGameStatsScopeExpr = (arg: ts.Expression): boolean => {
    if (ts.isStringLiteralLike(arg)) return arg.text === GAME_STATS_SCOPE;
    if (ts.isIdentifier(arg)) return constStrings.get(arg.text) === GAME_STATS_SCOPE;
    return false;
  };

  /** Strip `await`, parentheses, and `as`/`satisfies` off an expression. */
  const unwrapExpr = (expr: ts.Expression): ts.Expression => {
    let current = expr;
    for (;;) {
      if (ts.isAwaitExpression(current)) current = current.expression;
      else if (ts.isParenthesizedExpression(current)) current = current.expression;
      else if (ts.isAsExpression(current) || ts.isSatisfiesExpression(current))
        current = current.expression;
      else if (ts.isNonNullExpression(current)) current = current.expression;
      else return current;
    }
  };

  /** The function's own parameter identifier names (including a rest name). */
  const parameterNames = (
    fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression
  ): Set<string> => {
    const names = new Set<string>();
    for (const param of fn.parameters) {
      if (ts.isIdentifier(param.name)) names.add(param.name.text);
    }
    return names;
  };

  /** The callee resolves to a guarded capability (bare alias, alias chain, or
   * store-namespace member). */
  const isGuardedCallee = (calleeRaw: ts.Expression): boolean => {
    const callee = unwrapExpr(calleeRaw);
    if (ts.isIdentifier(callee)) return guardedBindings.has(callee.text);
    if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
      return storeNamespaces.has(callee.expression.text);
    }
    return false;
  };

  /**
   * A FORWARDING wrapper EXPOSES the raw capability: it calls a guarded
   * capability passing one or more of its OWN PARAMETERS (or a rest-param
   * spread) straight through, so a caller gains the same arbitrary-target
   * power the import boundary is meant to withhold. This holds regardless of
   * preceding validation/harmless statements, `return await`, parentheses, an
   * aliased/namespace callee, default/rest parameters, or the forwarded
   * argument's position. A genuine domain API that constructs its OWN scope/key
   * (module constants, internally-derived locals) and passes THOSE is NOT a
   * forwarder — the caller cannot retarget it — and is not flagged.
   */
  const forwardsGuardedCapability = (
    fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression
  ): boolean => {
    if (!fn.body) return false;
    const params = parameterNames(fn);
    const argForwardsParam = (arg: ts.Expression): boolean => {
      const inner = unwrapExpr(ts.isSpreadElement(arg) ? arg.expression : arg);
      return ts.isIdentifier(inner) && params.has(inner.text);
    };
    const isForwardingCall = (expr: ts.Expression): boolean => {
      const call = unwrapExpr(expr);
      return (
        ts.isCallExpression(call) &&
        isGuardedCallee(call.expression) &&
        call.arguments.some(argForwardsParam)
      );
    };
    if (ts.isBlock(fn.body)) {
      // Any RETURN that forwards a guarded call (preceding statements ignored).
      return fn.body.statements.some(
        (stmt) =>
          ts.isReturnStatement(stmt) &&
          stmt.expression !== undefined &&
          isForwardingCall(stmt.expression)
      );
    }
    // Expression-bodied arrow.
    return isForwardingCall(fn.body);
  };

  // Pass 2: bypass violations.
  const lockAllowed =
    repoRelativePath === 'src/lib/server/appStateStore.ts' ||
    repoRelativePath === 'src/lib/gameStats/durableMerge.ts' ||
    repoRelativePath === 'src/lib/gameStats/recoveryDisposition.ts' ||
    repoRelativePath === 'src/lib/server/providerRefreshStatus.ts';

  const visit = (node: ts.Node): void => {
    // Guarded-capability LAUNDERING: exporting a local binding that holds a
    // guarded import (`export { withAppStateKeyTransaction }` without a
    // specifier, or `export const tx = withAppStateKeyTransaction`) is a
    // re-export in disguise — forbidden for every file, owners included.
    if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause) {
      if (ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          const local = (element.propertyName ?? element.name).text;
          const guardedName = guardedBindings.get(local);
          if (guardedName) {
            violations.push({
              file: repoRelativePath,
              rule: 'guarded-reexport',
              detail: `local re-export of guarded "${guardedName}"`,
              line: lineAt(sourceFile, element),
            });
          }
        }
      }
    }
    if (
      ts.isVariableStatement(node) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
        if (
          ts.isIdentifier(declaration.initializer) &&
          guardedBindings.has(declaration.initializer.text)
        ) {
          violations.push({
            file: repoRelativePath,
            rule: 'guarded-reexport',
            detail: `exported alias of guarded "${guardedBindings.get(declaration.initializer.text)}"`,
            line: lineAt(sourceFile, declaration),
          });
        }
        // Exported arrow/function-expression FORWARDER of a guarded capability.
        if (
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer)) &&
          forwardsGuardedCapability(declaration.initializer)
        ) {
          violations.push({
            file: repoRelativePath,
            rule: 'guarded-reexport',
            detail: 'exported forwarding wrapper around a guarded capability',
            line: lineAt(sourceFile, declaration),
          });
        }
      }
    }
    // Exported function DECLARATION that merely forwards a guarded capability.
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.body &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
      forwardsGuardedCapability(node)
    ) {
      violations.push({
        file: repoRelativePath,
        rule: 'guarded-reexport',
        detail: `exported forwarding wrapper "${node.name.text}" around a guarded capability`,
        line: lineAt(sourceFile, node),
      });
    }
    if (ts.isIdentifier(node) && node.text === RETIRED_SETTER) {
      violations.push({
        file: repoRelativePath,
        rule: 'retired-blind-overwrite',
        detail: `reference to retired setter "${RETIRED_SETTER}"`,
        line: lineAt(sourceFile, node),
      });
    }
    if (ts.isCallExpression(node)) {
      // Unwrap await/parens/as off the callee so `(load)(...)` and friends are
      // recognized identically to a bare callee.
      const callee = unwrapExpr(node.expression);
      // Lock use via ANY binding (aliased import, alias chain, namespace).
      if (!lockAllowed && isTrackedLockExpr(callee)) {
        violations.push({
          file: repoRelativePath,
          rule: 'independent-transaction-lock',
          detail: 'per-key transaction primitive invoked outside the durable authorities',
          line: lineAt(sourceFile, node),
        });
      }
      const calleeIsDirectMutation =
        (ts.isIdentifier(callee) && mutationBindings.has(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          storeNamespaces.has(callee.expression.text) &&
          MUTATION_NAMES.has(callee.name.text));
      // Generic RAW game-stats reads: getAppState (any alias/wrapper/namespace
      // form) with the evidence scope is restricted to the approved raw-row
      // owners — routes, analytics, and diagnostics must go through the
      // typed cache/read boundaries.
      const calleeIsDirectRead =
        (ts.isIdentifier(callee) && readBindings.has(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          storeNamespaces.has(callee.expression.text) &&
          callee.name.text === 'getAppState');
      const calleeIsReadWrapper = ts.isIdentifier(callee) && readWrapperNames.has(callee.text);
      if (
        (calleeIsDirectRead || calleeIsReadWrapper) &&
        !RAW_GENERIC_READ_ALLOWED.has(repoRelativePath)
      ) {
        const args = calleeIsReadWrapper ? node.arguments : node.arguments.slice(0, 1);
        if (args.some(isGameStatsScopeExpr)) {
          violations.push({
            file: repoRelativePath,
            rule: 'raw-game-stats-read',
            detail: 'generic raw game-stats read outside the approved raw-row owners',
            line: lineAt(sourceFile, node),
          });
        }
      }
      const calleeIsWrapper = ts.isIdentifier(callee) && wrapperNames.has(callee.text);
      if (calleeIsDirectMutation || calleeIsWrapper) {
        // Direct mutation: scope is the first argument. Wrappers: the scope
        // may sit at ANY argument position.
        const args = calleeIsWrapper ? node.arguments : node.arguments.slice(0, 1);
        // The recovery-metadata owner may write its own scope; the evidence
        // scope is forbidden for EVERYONE via mutation primitives.
        if (args.some(isGameStatsScopeExpr)) {
          violations.push({
            file: repoRelativePath,
            rule: 'direct-game-stats-write',
            detail: 'durable mutation reached with the game-stats evidence scope',
            line: lineAt(sourceFile, node),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

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
    calls: ['runScheduledGameStatsRefresh'],
  },
  {
    file: 'src/app/api/game-stats/route.ts',
    calls: ['readPublicGameStats', 'runManualGameStatsRefresh', 'buildPublicWeeklyGameStats'],
  },
  {
    file: 'src/lib/gameStats/refreshOrchestration.ts',
    calls: [
      'planGameStatsRecovery',
      'claimGameStatsRecoveryPartition',
      'ingestGameStatsObservations',
      'finalizeGameStatsRefresh',
      'finalizeGameStatsRecoveryClaim',
    ],
  },
  { file: 'src/lib/gameStats/ingestion.ts', calls: ['mergeGameStatsPartitionDurable'] },
  {
    file: 'src/lib/gameStats/refreshPublication.ts',
    calls: ['getCachedGameStats', 'evaluateGameStatsPartitionCoverage'],
  },
  {
    file: 'src/lib/gameStats/readAvailability.ts',
    calls: ['evaluateGameStatsPartitionCoverage', 'buildPublicWeeklyGameStats'],
  },
  { file: 'src/lib/gameStats/recovery.ts', calls: ['evaluateGameStatsPartitionCoverage'] },
  { file: 'src/lib/gameStats/ownerStats.ts', calls: ['selectAnalyticsRows'] },
  { file: 'src/lib/gameStats/scoreEvidence.ts', calls: ['selectAnalyticsRows'] },
  {
    file: 'src/lib/server/providerDataDiagnostics.ts',
    calls: ['evaluateGameStatsPartitionCoverage'],
  },
  {
    file: 'src/lib/server/providerCacheState.ts',
    calls: ['evaluateYearGameStatsAvailability'],
  },
  {
    file: 'src/app/api/debug/archive-integrity/route.ts',
    calls: ['buildScoreEvidenceByProviderId'],
  },
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

// === 1. Ownership + bypass guard over the real production tree ===

test('no production source violates the game-stats architecture boundaries', () => {
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
  assert.equal(typeof ingestionModule.computeScheduleExpectationFingerprint, 'function');
  assert.equal(typeof ingestionModule.ingestGameStatsObservations, 'function');
  assert.equal(typeof durableMergeModule.mergeGameStatsPartitionDurable, 'function');
  assert.equal(typeof partitionCoverageModule.evaluateGameStatsPartitionCoverage, 'function');
  assert.equal(typeof partitionCoverageModule.computeCoverageFingerprint, 'function');
  assert.equal(typeof recoveryModule.planGameStatsRecovery, 'function');
  assert.equal(typeof recoveryDispositionModule.claimGameStatsRecoveryPartition, 'function');
  assert.equal(typeof recoveryDispositionModule.finalizeGameStatsRecoveryClaim, 'function');
  assert.equal(typeof recoveryDispositionModule.isRecoveryEligible, 'function');
  assert.equal(typeof refreshOrchestrationModule.runScheduledGameStatsRefresh, 'function');
  assert.equal(typeof refreshOrchestrationModule.runManualGameStatsRefresh, 'function');
  assert.equal(typeof refreshPublicationModule.finalizeGameStatsRefresh, 'function');
  assert.equal(typeof readAvailabilityModule.readPublicGameStats, 'function');
  assert.equal(typeof readAvailabilityModule.validateWeeklyGameStatsEnvelope, 'function');
  assert.equal(typeof readAvailabilityModule.evaluateYearGameStatsAvailability, 'function');
  assert.equal(typeof publicProjectionModule.buildPublicWeeklyGameStats, 'function');
  assert.equal(typeof contractModule.selectAnalyticsRows, 'function');
});

// === Analyzer self-tests ===

const STORE_IMPORT = `import { setAppState, deleteAppState } from './server/appStateStore';`;

function rulesOf(source: string, file: string): string[] {
  return analyzeProductionSource(source, file).map((v) => v.rule);
}

test('analyzer: direct literal-scope writes are flagged', () => {
  assert.ok(
    rulesOf(
      `${STORE_IMPORT}\nawait setAppState('game-stats', key, value);`,
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

test('analyzer: CHAINED scope constants are flagged', () => {
  const source = `${STORE_IMPORT}
const base = 'game-stats';
const scope = base;
const alias = scope;
await setAppState(alias, key, value);`;
  assert.ok(rulesOf(source, 'src/lib/example.ts').includes('direct-game-stats-write'));
});

test('analyzer: renamed import bindings and namespace members are flagged', () => {
  assert.ok(
    rulesOf(
      `import { setAppState as persist } from './server/appStateStore';\nawait persist('game-stats', key, value);`,
      'src/lib/example.ts'
    ).includes('direct-game-stats-write')
  );
  assert.ok(
    rulesOf(
      `import * as store from './server/appStateStore';\nawait store.setAppState('game-stats', key, value);`,
      'src/lib/example.ts'
    ).includes('direct-game-stats-write')
  );
});

test('analyzer: wrapper functions are flagged, including scope at a NON-FIRST argument', () => {
  const inlineScope = `${STORE_IMPORT}
function save(value) { return setAppState('game-stats', 'k', value); }`;
  assert.ok(rulesOf(inlineScope, 'src/lib/example.ts').includes('direct-game-stats-write'));

  const secondArg = `${STORE_IMPORT}
function save(value, scope) { return setAppState(scope, 'k', value); }
await save(payload, 'game-stats');`;
  assert.ok(rulesOf(secondArg, 'src/lib/example.ts').includes('direct-game-stats-write'));

  const arrowWrapper = `${STORE_IMPORT}
const save = (value, scope) => setAppState(scope, 'k', value);
await save(payload, 'game-stats');`;
  assert.ok(rulesOf(arrowWrapper, 'src/lib/example.ts').includes('direct-game-stats-write'));
});

test('analyzer: the retired setter name is flagged wherever it reappears', () => {
  assert.ok(
    rulesOf(`await setCachedGameStats(record);`, 'src/lib/example.ts').includes(
      'retired-blind-overwrite'
    )
  );
});

test('analyzer: lock use is flagged through plain, ALIASED, and NAMESPACE forms', () => {
  const plain = `import { withAppStateKeyTransaction } from './server/appStateStore';
await withAppStateKeyTransaction('game-stats', key, fn);`;
  const aliased = `import { withAppStateKeyTransaction as tx } from './server/appStateStore';
await tx('game-stats', key, fn);`;
  const chained = `import { withAppStateKeyTransaction } from './server/appStateStore';
const lock = withAppStateKeyTransaction;
await lock('game-stats', key, fn);`;
  const namespaced = `import * as store from './server/appStateStore';
await store.withAppStateKeyTransaction('game-stats', key, fn);`;
  for (const source of [plain, aliased, chained, namespaced]) {
    const rules = rulesOf(source, 'src/lib/example.ts');
    assert.ok(
      rules.includes('independent-transaction-lock') ||
        rules.includes('transaction-lock-ownership'),
      source
    );
  }
  // The durable authorities stay clean for direct use.
  assert.ok(
    !rulesOf(plain, 'src/lib/gameStats/durableMerge.ts').includes('independent-transaction-lock')
  );
  assert.ok(
    !rulesOf(plain, 'src/lib/gameStats/recoveryDisposition.ts').includes(
      'independent-transaction-lock'
    )
  );
});

test('ownership: forbidden cross-module imports are flagged by module boundary', () => {
  // A game-stats lifecycle file importing a mutation primitive at all
  // (specifier relative to the importing lifecycle file).
  assert.ok(
    rulesOf(
      `import { setAppState } from '../server/appStateStore';`,
      'src/lib/gameStats/coverage.ts'
    ).includes('evidence-mutation-ownership')
  );
  // A writer route importing the status publisher directly.
  assert.ok(
    rulesOf(
      `import { recordProviderRefreshSuccess } from '@/lib/server/providerRefreshStatus';`,
      'src/app/api/game-stats/route.ts'
    ).includes('status-publication-ownership')
  );
  // ALIASED publication import is still an ownership violation.
  assert.ok(
    rulesOf(
      `import { recordProviderRefreshSuccess as publish } from '@/lib/server/providerRefreshStatus';`,
      'src/app/api/game-stats/route.ts'
    ).includes('status-publication-ownership')
  );
  // A route importing the recovery claim/finalize setters directly.
  assert.ok(
    rulesOf(
      `import { claimGameStatsRecoveryPartition } from '@/lib/gameStats/recoveryDisposition';`,
      'src/app/api/cron/game-stats/route.ts'
    ).includes('recovery-mutation-ownership')
  );
  // A route importing the coverage reducer directly.
  assert.ok(
    rulesOf(
      `import { evaluateGameStatsPartitionCoverage } from '@/lib/gameStats/partitionCoverage';`,
      'src/app/api/game-stats/route.ts'
    ).includes('coverage-ownership')
  );
  // A route reading raw durable rows (bypassing the public projection path).
  assert.ok(
    rulesOf(
      `import { getCachedGameStats } from '@/lib/gameStats/cache';`,
      'src/app/api/game-stats/route.ts'
    ).includes('raw-row-ownership')
  );
  // Analytics/diagnostics importing raw persistence helpers.
  assert.ok(
    rulesOf(
      `import { getCachedGameStats } from '../gameStats/cache';`,
      'src/lib/gameStats/ownerStats.ts'
    ).includes('raw-row-ownership')
  );
  // Namespace import of a guarded module.
  assert.ok(
    rulesOf(
      `import * as disposition from '@/lib/gameStats/recoveryDisposition';`,
      'src/app/api/cron/game-stats/route.ts'
    ).includes('recovery-mutation-ownership')
  );
  // An unrelated consumer importing the orchestration entry points.
  assert.ok(
    rulesOf(
      `import { runManualGameStatsRefresh } from '@/lib/gameStats/refreshOrchestration';`,
      'src/lib/insights/context.ts'
    ).includes('orchestration-ownership')
  );
  // The owners themselves stay clean.
  assert.ok(
    !rulesOf(
      `import { recordProviderRefreshSuccess } from '../server/providerRefreshStatus.ts';`,
      'src/lib/gameStats/refreshPublication.ts'
    ).includes('status-publication-ownership')
  );
  assert.ok(
    !rulesOf(
      `import { claimGameStatsRecoveryPartition } from './recoveryDisposition.ts';`,
      'src/lib/gameStats/refreshOrchestration.ts'
    ).includes('recovery-mutation-ownership')
  );
  // Other datasets' routes may keep importing status recording for themselves.
  assert.ok(
    !rulesOf(
      `import { recordProviderRefreshSuccess } from '@/lib/server/providerRefreshStatus';`,
      'src/app/api/scores/route.ts'
    ).includes('status-publication-ownership')
  );
});

test('re-export boundary: guarded capabilities cannot be re-exported — by ANYONE', () => {
  // The exact required fixture.
  assert.ok(
    rulesOf(
      `export { withAppStateKeyTransaction } from '../server/appStateStore';`,
      'src/lib/gameStats/example.ts'
    ).includes('guarded-reexport')
  );
  // Aliased re-export.
  assert.ok(
    rulesOf(
      `export { withAppStateKeyTransaction as tx } from '../server/appStateStore';`,
      'src/lib/gameStats/example.ts'
    ).includes('guarded-reexport')
  );
  // `export *` (barrel) from a guarded module.
  assert.ok(
    rulesOf(`export * from './recoveryDisposition';`, 'src/lib/gameStats/index.ts').includes(
      'guarded-reexport'
    )
  );
  assert.ok(
    rulesOf(`export * from '../server/appStateStore';`, 'src/lib/gameStats/index.ts').includes(
      'guarded-reexport'
    )
  );
  // Namespace re-export.
  assert.ok(
    rulesOf(
      `export * as store from '../server/appStateStore';`,
      'src/lib/gameStats/example.ts'
    ).includes('guarded-reexport')
  );
  // OWNER modules are barred too: the laundering fixtures below use the
  // sanctioned owners' own paths.
  assert.ok(
    rulesOf(
      `export { withAppStateKeyTransaction } from '../server/appStateStore.ts';`,
      'src/lib/gameStats/recoveryDisposition.ts'
    ).includes('guarded-reexport')
  );
  // Status-publisher laundering.
  assert.ok(
    rulesOf(
      `export { recordProviderRefreshSuccess } from '../server/providerRefreshStatus.ts';`,
      'src/lib/gameStats/refreshPublication.ts'
    ).includes('guarded-reexport')
  );
  // Recovery-mutator laundering.
  assert.ok(
    rulesOf(
      `export { claimGameStatsRecoveryPartition } from './recoveryDisposition.ts';`,
      'src/lib/gameStats/refreshOrchestration.ts'
    ).includes('guarded-reexport')
  );
  // Raw-row reader laundering.
  assert.ok(
    rulesOf(
      `export { getCachedGameStats } from './cache.ts';`,
      'src/lib/gameStats/readAvailability.ts'
    ).includes('guarded-reexport')
  );
  // Local re-export without a specifier.
  assert.ok(
    rulesOf(
      `import { withAppStateKeyTransaction } from '../server/appStateStore';\nexport { withAppStateKeyTransaction };`,
      'src/lib/gameStats/recoveryDisposition.ts'
    ).includes('guarded-reexport')
  );
  // Exported alias of a guarded binding.
  assert.ok(
    rulesOf(
      `import { withAppStateKeyTransaction } from '../server/appStateStore';\nexport const tx = withAppStateKeyTransaction;`,
      'src/lib/gameStats/durableMerge.ts'
    ).includes('guarded-reexport')
  );
  // Non-guarded exports from guarded modules stay clean for owners.
  assert.ok(
    !rulesOf(
      `export { getGameStatsKey } from './cache.ts';`,
      'src/lib/gameStats/readAvailability.ts'
    ).includes('guarded-reexport')
  );
});

test('analyzer: resurrected legacy-normalizer imports are flagged', () => {
  assert.ok(
    rulesOf(
      `import { normalizeGameTeamStats } from './normalizers.ts';`,
      'src/lib/gameStats/coverage.ts'
    ).includes('legacy-normalizer-import')
  );
  assert.deepEqual(rulesOf(`export function normalizeGameTeamStats() {}`, NORMALIZERS_SELF), []);
  // An unrelated module that shares the basename stays clean.
  assert.deepEqual(rulesOf(`import { x } from './normalizers';`, 'src/lib/scores/cache.ts'), []);
});

test('analyzer: clean sources produce no violations', () => {
  const clean = [
    [
      // Raw evidence reads are legal for the approved raw-row owner.
      `import { getAppState } from '../server/appStateStore';\nawait getAppState('game-stats', k);`,
      'src/lib/gameStats/cache.ts',
    ],
    [
      // Other scopes stay unrestricted for generic readers.
      `import { getAppState } from './server/appStateStore';\nawait getAppState('schedule', k);`,
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

test('raw-read guard: generic game-stats reads are blocked in every alias/wrapper form', () => {
  const READ_IMPORT = `import { getAppState } from './server/appStateStore';`;
  const direct = `${READ_IMPORT}\nawait getAppState('game-stats', key);`;
  assert.ok(rulesOf(direct, 'src/lib/example.ts').includes('raw-game-stats-read'));
  // Aliased read.
  const aliased = `import { getAppState as load } from './server/appStateStore';\nawait load('game-stats', key);`;
  assert.ok(rulesOf(aliased, 'src/lib/example.ts').includes('raw-game-stats-read'));
  // Chained alias.
  const chained = `${READ_IMPORT}\nconst a = getAppState;\nconst b = a;\nawait b('game-stats', key);`;
  assert.ok(rulesOf(chained, 'src/lib/example.ts').includes('raw-game-stats-read'));
  // Wrapper with the scope at a non-first argument.
  const wrapper = `${READ_IMPORT}\nfunction load(key, scope) { return getAppState(scope, key); }\nawait load('k', 'game-stats');`;
  assert.ok(rulesOf(wrapper, 'src/lib/example.ts').includes('raw-game-stats-read'));
  // Namespace member.
  const namespaced = `import * as store from './server/appStateStore';\nawait store.getAppState('game-stats', key);`;
  assert.ok(rulesOf(namespaced, 'src/lib/example.ts').includes('raw-game-stats-read'));
  // Awaited + parenthesized wrapper call.
  const wrappedAwait = `${READ_IMPORT}\nfunction load(scope, key) { return getAppState(scope, key); }\nconst r = await (load)('game-stats', key);`;
  assert.ok(rulesOf(wrappedAwait, 'src/lib/example.ts').includes('raw-game-stats-read'));
  // The documented debug raw-inspection surface stays legal.
  assert.ok(
    !rulesOf(
      `import { getAppState } from '@/lib/server/appStateStore';\nawait getAppState('game-stats', key);`,
      'src/app/api/debug/game-stats-diagnostic/route.ts'
    ).includes('raw-game-stats-read')
  );
});

test('module resolution: laundering is caught at the file that re-exports/forwards, per resolved specifier', () => {
  // A realistic multi-file laundering chain, analyzed file by file exactly as
  // the production scan does. Each file is scanned against its RESOLVED import
  // specifiers; the guarantee is that whichever file performs the re-export or
  // forward is the one flagged — the downstream importer of a non-guarded
  // barrel path is clean because the barrel already failed the guard.
  const files = new Map<string, string>([
    // (1) An OWNER re-exporting an alias of the lock → flagged in the owner.
    [
      'src/lib/gameStats/recoveryDisposition.ts',
      `import { withAppStateKeyTransaction } from '../server/appStateStore';\nexport { withAppStateKeyTransaction as tx };`,
    ],
    // (2) A BARREL re-exporting a guarded module wholesale → flagged in barrel.
    ['src/lib/gameStats/index.ts', `export * from '../server/appStateStore';`],
    // (3) A route importing the BARREL alias (resolves to the barrel, NOT the
    //     guarded module) → clean here; the barrel already failed the guard.
    [
      'src/app/api/game-stats/route.ts',
      `import { tx } from '@/lib/gameStats/index';\nexport const GET = () => tx('game-stats', 'k', run);`,
    ],
    // (4) An exported forwarding wrapper with an extra statement → flagged.
    [
      'src/lib/gameStats/refreshOrchestration.ts',
      `import { claimGameStatsRecoveryPartition } from './recoveryDisposition.ts';\nexport async function claim(a, b, c) {\n  log('claim');\n  return await claimGameStatsRecoveryPartition(a, b, c);\n}`,
    ],
  ]);
  const rulesFor = (file: string): string[] =>
    analyzeProductionSource(files.get(file)!, file).map((v) => v.rule);

  assert.ok(rulesFor('src/lib/gameStats/recoveryDisposition.ts').includes('guarded-reexport'));
  assert.ok(rulesFor('src/lib/gameStats/index.ts').includes('guarded-reexport'));
  assert.ok(
    !rulesFor('src/app/api/game-stats/route.ts').includes('guarded-reexport'),
    'the barrel importer resolves to a non-guarded path and is clean (barrel caught it)'
  );
  assert.ok(rulesFor('src/lib/gameStats/refreshOrchestration.ts').includes('guarded-reexport'));
});

test('ownership: merge, ingestion, and finalizer imports are owner-only', () => {
  assert.ok(
    rulesOf(
      `import { mergeGameStatsPartitionDurable } from '@/lib/gameStats/durableMerge';`,
      'src/app/api/game-stats/route.ts'
    ).includes('merge-ownership')
  );
  assert.ok(
    rulesOf(
      `import { ingestGameStatsObservations } from '@/lib/gameStats/ingestion';`,
      'src/app/api/cron/game-stats/route.ts'
    ).includes('ingestion-ownership')
  );
  assert.ok(
    rulesOf(
      `import { finalizeGameStatsRefresh } from '@/lib/gameStats/refreshPublication';`,
      'src/app/api/game-stats/route.ts'
    ).includes('finalization-ownership')
  );
  // Raw-row reader through a barrel: the barrel re-export itself is flagged.
  assert.ok(
    rulesOf(`export * from './cache.ts';`, 'src/lib/gameStats/index.ts').includes(
      'guarded-reexport'
    )
  );
  // The owners stay clean.
  assert.ok(
    !rulesOf(
      `import { mergeGameStatsPartitionDurable } from './durableMerge.ts';`,
      'src/lib/gameStats/ingestion.ts'
    ).includes('merge-ownership')
  );
});

test('guarded forwarding wrappers cannot be exported — even by owners (realistic shapes)', () => {
  const OWNER = 'src/lib/gameStats/recoveryDisposition.ts';
  const LOCK_IMPORT = `import { withAppStateKeyTransaction } from '../server/appStateStore';`;
  const flagged = [
    // Rest-param spread forward.
    `${LOCK_IMPORT}\nexport function tx(...args) { return withAppStateKeyTransaction(...args); }`,
    // Arrow rest-spread forward.
    `import { claimGameStatsRecoveryPartition } from './recoveryDisposition.ts';\nexport const claim = (...args) => claimGameStatsRecoveryPartition(...args);`,
    // `return await` a forward.
    `${LOCK_IMPORT}\nexport async function tx(scope, key, fn) { return await withAppStateKeyTransaction(scope, key, fn); }`,
    // Preceding harmless + validation statements, then forward.
    `${LOCK_IMPORT}\nexport async function tx(scope, key, fn) {\n  const t = Date.now();\n  if (!scope) throw new Error('x');\n  return withAppStateKeyTransaction(scope, key, fn);\n}`,
    // Parenthesized callee + parenthesized return.
    `${LOCK_IMPORT}\nexport function tx(scope, key, fn) { return (withAppStateKeyTransaction)(scope, key, fn); }`,
    // Aliased callee (local alias chain).
    `${LOCK_IMPORT}\nconst lock = withAppStateKeyTransaction;\nconst lock2 = lock;\nexport function tx(scope, key, fn) { return lock2(scope, key, fn); }`,
    // Default params, scope in a NON-first position.
    `${LOCK_IMPORT}\nexport function tx(key, scope, fn = noop) { return withAppStateKeyTransaction(scope, key, fn); }`,
  ];
  for (const source of flagged) {
    assert.ok(
      rulesOf(source, OWNER).includes('guarded-reexport'),
      `should flag forwarder:\n${source}`
    );
  }

  // A genuine domain API that constructs its OWN scope/key (a module constant
  // and an internally-derived local) and forwards NONE of its parameters to
  // the guarded call is NOT a forwarder — the caller cannot retarget it. This
  // mirrors the real recovery/merge/status owners.
  const domainApi = `${LOCK_IMPORT}
const RECOVERY_SCOPE = 'game-stats-recovery';
export async function claimPartition(year, week, seasonType) {
  const key = recoveryKey(year, week, seasonType);
  return withAppStateKeyTransaction(RECOVERY_SCOPE, key, async (txn) => run(txn));
}`;
  assert.ok(
    !rulesOf(domainApi, OWNER).includes('guarded-reexport'),
    'internal-argument domain API must not be flagged'
  );
});

// === Wiring self-tests: disconnected lifecycle paths MUST be detected ===

function wiringFixture(overrides: Map<string, string>): string[] {
  const read = (file: string): string =>
    overrides.get(file) ?? readFileSync(path.join(REPO_ROOT, file), 'utf8');
  return findWiringGaps(read);
}

test('wiring: a disconnected (dead) merge call site fails', () => {
  const gaps = wiringFixture(
    new Map([
      [
        'src/lib/gameStats/ingestion.ts',
        `import { mergeGameStatsPartitionDurable } from './durableMerge.ts';\nexport const dead = mergeGameStatsPartitionDurable;`,
      ],
    ])
  );
  assert.ok(
    gaps.includes('src/lib/gameStats/ingestion.ts must call mergeGameStatsPartitionDurable')
  );
});

test('wiring: a route bypassing the orchestration or projection fails', () => {
  const gaps = wiringFixture(
    new Map([
      [
        'src/app/api/game-stats/route.ts',
        `import { readPublicGameStats } from '@/lib/gameStats/readAvailability';
export async function GET() {
  const read = await readPublicGameStats({});
  return Response.json(read); // no manual-refresh orchestration, no projection call
}`,
      ],
    ])
  );
  assert.ok(gaps.includes('src/app/api/game-stats/route.ts must call runManualGameStatsRefresh'));
  assert.ok(gaps.includes('src/app/api/game-stats/route.ts must call buildPublicWeeklyGameStats'));
});

test('wiring: a raw analytics consumer and a separate diagnostics coverage helper fail', () => {
  const gaps = wiringFixture(
    new Map([
      [
        'src/lib/gameStats/ownerStats.ts',
        `export function aggregateOwnerGameStats(games) { return games.map((g) => g.home.totalYards); }`,
      ],
      [
        'src/lib/server/providerDataDiagnostics.ts',
        `function myOwnCoverage(record) { return record.games.length > 0; }\nexport const x = myOwnCoverage;`,
      ],
    ])
  );
  assert.ok(gaps.includes('src/lib/gameStats/ownerStats.ts must call selectAnalyticsRows'));
  assert.ok(
    gaps.includes(
      'src/lib/server/providerDataDiagnostics.ts must call evaluateGameStatsPartitionCoverage'
    )
  );
});

test('wiring: an orchestration missing the fenced claim or conditional finalization fails', () => {
  const gaps = wiringFixture(
    new Map([
      [
        'src/lib/gameStats/refreshOrchestration.ts',
        `import { planGameStatsRecovery } from './recovery.ts';
import { ingestGameStatsObservations } from './ingestion.ts';
import { finalizeGameStatsRefresh } from './refreshPublication.ts';
export async function run() {
  planGameStatsRecovery({});
  await ingestGameStatsObservations({});
  await finalizeGameStatsRefresh({}); // fetches WITHOUT a durable claim
}`,
      ],
    ])
  );
  assert.ok(
    gaps.includes(
      'src/lib/gameStats/refreshOrchestration.ts must call claimGameStatsRecoveryPartition'
    )
  );
  assert.ok(
    gaps.includes(
      'src/lib/gameStats/refreshOrchestration.ts must call finalizeGameStatsRecoveryClaim'
    )
  );
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
    'src/lib/gameStats/refreshOrchestration.ts',
    'src/lib/gameStats/refreshPublication.ts',
    'src/lib/gameStats/readAvailability.ts',
    'src/lib/gameStats/publicProjection.ts',
    'src/lib/gameStats/scoreEvidence.ts',
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
