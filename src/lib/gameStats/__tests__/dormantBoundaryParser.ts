import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

/**
 * PLATFORM-086H3B-DORMANT-BOUNDARY-GUARD-REMEDIATION — parser-backed capability
 * analysis for the ONE sanctioned production connection to the dormant revision
 * authority: the admin revision route and its narrow inspection facade.
 *
 * The regex module/symbol scan in `dormant-boundary.test.ts` guards every OTHER
 * production file. This module resolves the route's and facade's imports/exports
 * with the TypeScript compiler API — following aliases, re-exports, and multi-hop
 * barrels — so a forbidden lifecycle capability can never reach the route by being
 * renamed, wildcarded, or hidden behind a mixed barrel. Fail-closed: an
 * unresolved local import, a namespace/default/require/dynamic form, or a terminal
 * that is not on the explicit allowlist is a violation.
 *
 * PLATFORM-086H3B-DORMANT-BOUNDARY-LAUNDERING-REMEDIATION: it additionally REJECTS
 * local side-effect imports (`import './x'`) and import-equals
 * (`import x = require('./y')`), and TRACES the guarded facade graph's exported
 * function IMPLEMENTATIONS — local aliases (direct/chained/destructured), wrappers
 * (declarations/arrows/expressions), one-or-more local helper hops, and namespace
 * member access — to the runtime capabilities they use. An approved export NAME can
 * no longer conceal a forbidden terminal (e.g. `repairRevisionState`,
 * `withAppStateKeyTransaction`, `setAppState`) behind a wrapper.
 *
 * Analysis is over source TEXT + a virtual file map, so fixtures can build
 * arbitrary module graphs without writing files; real modules fall back to disk.
 */

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);

export const ADMIN_ROUTE_PATH = 'src/app/api/admin/game-stats-revision/route.ts';
export const INSPECTION_FACADE_PATH = 'src/lib/gameStats/revisionRepairInspection.ts';

// The ONLY local modules the admin route may import from (resolved repo paths),
// each with its approved RUNTIME named imports. Type-only imports are allowed from
// any module (they carry no runtime capability). External packages are unrestricted.
const ROUTE_APPROVED_MODULES = new Map<string, Set<string>>([
  ['src/lib/server/adminAuth.ts', new Set(['requireAdminAuth'])],
  [
    'src/lib/gameStats/revisionRepairInspection.ts',
    new Set([
      'inspectRevisionState',
      'readRevisionAuditTrail',
      'planRevisionRepair',
      'isCfbdSeasonType',
    ]),
  ],
  // Type-only home for `PartitionIdentity` — NO runtime symbols permitted.
  ['src/lib/gameStats/revisionAuthority.ts', new Set<string>()],
]);

// The terminal (real, de-aliased) binding names the ROUTE may reach at runtime.
const ROUTE_APPROVED_TERMINALS = new Set([
  'requireAdminAuth',
  'inspectRevisionState',
  'readRevisionAuditTrail',
  'isCfbdSeasonType',
  'planRevisionRepair',
]);

// The terminal binding names the inspection FACADE may EXPORT at runtime.
const FACADE_APPROVED_EXPORT_TERMINALS = new Set([
  'inspectRevisionState',
  'readRevisionAuditTrail',
  'isCfbdSeasonType',
  'planRevisionRepair',
]);

export const INSPECTION_PLANNER_PATH = 'src/lib/gameStats/revisionRepairPlanning.ts';

// The GUARDED FACADE GRAPH: local modules whose exported-function IMPLEMENTATIONS
// the parser traces (bounded — not whole-program) for concealed forbidden
// capabilities. The facade + its mutation-free planner.
const GUARDED_FACADE_MODULES = new Set([INSPECTION_FACADE_PATH, INSPECTION_PLANNER_PATH]);

// Runtime capabilities the admin surface must NEVER reach — the app-state MUTATION
// owners. Read-only helpers (e.g. `getAppState`) are intentionally NOT here; the
// mutation-free planner legitimately READS. An approved export NAME never overrides
// membership here — a forbidden terminal stays forbidden however it is reached.
const FORBIDDEN_CAPABILITY_NAMES = new Set([
  'repairRevisionState', // applied repair service
  'withAppStateKeyTransaction', // app-state transaction (can mutate)
  'setAppState', // app-state write
  'mergeGameStatsPartitionRevisioned', // revisioned evidence write
  'allocateGameStatsCommitStamp', // revision allocation
  'setActivationState', // activation transition
  'markRevisionedEvidenceCommitted', // evidence witness write
  'setCachedGameStats', // legacy evidence write
  'writeLegacyGameStatsPartition', // legacy evidence write
  'beginGameStatsRefreshAttempt', // status chronology mutation
  'recordGameStatsRefreshSuccess',
  'recordGameStatsRefreshNoop',
  'recordGameStatsRefreshFailure',
]);

export type CapabilityViolation = { file: string; reason: string; detail: string };

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Resolve a module specifier from `fromRepoPath` to a repo-relative `.ts(x)` path, or null if external. */
function resolveSpecifier(
  fromRepoPath: string,
  specifier: string,
  virtual: Map<string, string>
): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith('.')) {
    base = path.posix.normalize(
      path.posix.join(path.posix.dirname(toPosix(fromRepoPath)), specifier)
    );
  } else return null; // external package — outside lifecycle-capability analysis
  base = base.replace(/\.(js|mjs|cjs|ts|mts|cts|tsx)$/, '');
  const candidates = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`];
  for (const cand of candidates) {
    if (virtual.has(cand) || existsSync(path.join(REPO_ROOT, cand))) return cand;
  }
  return `${base}.ts`; // best-effort; caller fails closed if it cannot be read
}

function readModule(repoPath: string, virtual: Map<string, string>): string | null {
  if (virtual.has(repoPath)) return virtual.get(repoPath)!;
  const abs = path.join(REPO_ROOT, repoPath);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

function parse(repoPath: string, text: string): ts.SourceFile {
  return ts.createSourceFile(repoPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** A resolved binding: where it is finally DEFINED (or the broad/external/unresolved kind). */
export type Terminal =
  | { kind: 'value'; module: string; name: string }
  | { kind: 'type'; module: string; name: string }
  | { kind: 'external'; specifier: string; name: string }
  | { kind: 'namespace'; module: string }
  | { kind: 'default'; module: string; name: string }
  | { kind: 'unresolved'; detail: string };

/**
 * Resolve an EXPORTED name of a module to its terminal definition, following
 * `export { x } from`, `export { x as y } from`, `export *`, and local
 * `import`→`export` chains across hops. `seen` guards re-export cycles.
 */
export function resolveExport(
  module: string,
  exportName: string,
  virtual: Map<string, string>,
  seen: Set<string> = new Set()
): Terminal {
  const key = `${module}#${exportName}`;
  if (seen.has(key)) return { kind: 'unresolved', detail: `re-export cycle at ${key}` };
  seen.add(key);
  const text = readModule(module, virtual);
  if (text === null) return { kind: 'unresolved', detail: `cannot read module ${module}` };
  const sf = parse(module, text);
  const stars: string[] = [];

  for (const stmt of sf.statements) {
    // export { a, b as c } [from './x'] / export * [from './x']
    if (ts.isExportDeclaration(stmt)) {
      const from =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? resolveSpecifier(module, stmt.moduleSpecifier.text, virtual)
          : null;
      const externalSpec =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) && from === null
          ? stmt.moduleSpecifier.text
          : null;
      if (!stmt.exportClause) {
        // export * from './x'
        if (from) stars.push(from);
        else if (externalSpec) {
          /* export * from external — cannot resolve names; ignore for star fallback */
        }
        continue;
      }
      if (ts.isNamespaceExport(stmt.exportClause)) {
        // export * as ns from './x' — a broad namespace re-export.
        if (stmt.exportClause.name.text === exportName) {
          return from
            ? { kind: 'namespace', module: from }
            : { kind: 'external', specifier: externalSpec ?? '?', name: '*' };
        }
        continue;
      }
      for (const el of stmt.exportClause.elements) {
        if (el.name.text !== exportName) continue;
        const original = el.propertyName?.text ?? el.name.text;
        const isType = stmt.isTypeOnly || el.isTypeOnly;
        if (externalSpec) return { kind: 'external', specifier: externalSpec, name: original };
        if (from) return follow(resolveExport(from, original, virtual, seen), isType);
        // export { local } / export { local as exported } — no module: a local binding.
        return follow(resolveLocalBinding(module, original, virtual, seen), isType);
      }
      continue;
    }
    // export function/class/const/type/interface/enum NAME
    if (!hasExportModifier(stmt)) continue;
    if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      stmt.name?.text === exportName
    ) {
      return { kind: 'value', module, name: exportName };
    }
    if (
      (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) &&
      stmt.name.text === exportName
    ) {
      return { kind: 'type', module, name: exportName };
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === exportName) {
          return { kind: 'value', module, name: exportName };
        }
      }
    }
  }
  // Not found directly — expand `export *` targets (multi-hop barrels).
  for (const star of stars) {
    const r = resolveExport(star, exportName, virtual, seen);
    if (r.kind !== 'unresolved') return r;
  }
  return { kind: 'unresolved', detail: `export "${exportName}" not found in ${module}` };
}

/** A `type`-only step downgrades a value terminal to a type terminal (no runtime path). */
function follow(t: Terminal, isType: boolean): Terminal {
  if (isType && t.kind === 'value') return { kind: 'type', module: t.module, name: t.name };
  return t;
}

/** Resolve a LOCAL binding name (a local decl, or an import) to its terminal. */
function resolveLocalBinding(
  module: string,
  localName: string,
  virtual: Map<string, string>,
  seen: Set<string>
): Terminal {
  const text = readModule(module, virtual);
  if (text === null) return { kind: 'unresolved', detail: `cannot read module ${module}` };
  const sf = parse(module, text);
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && stmt.importClause) {
      const specNode = stmt.moduleSpecifier;
      const spec = ts.isStringLiteral(specNode) ? specNode.text : '';
      const resolved = resolveSpecifier(module, spec, virtual);
      const clause = stmt.importClause;
      if (clause.name && clause.name.text === localName) {
        return resolved
          ? { kind: 'default', module: resolved, name: localName }
          : { kind: 'external', specifier: spec, name: 'default' };
      }
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb) && nb.name.text === localName) {
        return resolved
          ? { kind: 'namespace', module: resolved }
          : { kind: 'external', specifier: spec, name: '*' };
      }
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) {
          if (el.name.text !== localName) continue;
          const original = el.propertyName?.text ?? el.name.text;
          const isType = clause.isTypeOnly || el.isTypeOnly;
          if (!resolved) return { kind: 'external', specifier: spec, name: original };
          return follow(resolveExport(resolved, original, virtual, seen), isType);
        }
      }
    }
    // Local declarations.
    if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      stmt.name?.text === localName
    ) {
      return { kind: 'value', module, name: localName };
    }
    if (
      (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) &&
      stmt.name.text === localName
    ) {
      return { kind: 'type', module, name: localName };
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === localName) {
          return { kind: 'value', module, name: localName };
        }
      }
    }
  }
  return { kind: 'unresolved', detail: `local binding "${localName}" not found in ${module}` };
}

/** Every exported NAME of a module (locals + named re-exports + expanded stars). */
function collectExportedNames(
  module: string,
  virtual: Map<string, string>,
  seen: Set<string> = new Set()
): Array<{ name: string; isType: boolean }> {
  if (seen.has(module)) return [];
  seen.add(module);
  const text = readModule(module, virtual);
  if (text === null) return [];
  const sf = parse(module, text);
  const out: Array<{ name: string; isType: boolean }> = [];
  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt)) {
      const from =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? resolveSpecifier(module, stmt.moduleSpecifier.text, virtual)
          : null;
      if (!stmt.exportClause) {
        if (from) out.push(...collectExportedNames(from, virtual, seen));
        continue;
      }
      if (ts.isNamespaceExport(stmt.exportClause)) {
        out.push({ name: stmt.exportClause.name.text, isType: false });
        continue;
      }
      for (const el of stmt.exportClause.elements) {
        out.push({ name: el.name.text, isType: stmt.isTypeOnly || el.isTypeOnly });
      }
      continue;
    }
    if (!hasExportModifier(stmt)) continue;
    if (
      ts.isFunctionDeclaration(stmt) ||
      ts.isClassDeclaration(stmt) ||
      ts.isEnumDeclaration(stmt)
    ) {
      if (stmt.name) out.push({ name: stmt.name.text, isType: false });
    } else if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
      out.push({ name: stmt.name.text, isType: true });
    } else if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) out.push({ name: decl.name.text, isType: false });
      }
    }
  }
  return out;
}

/** Detect `require('...')` / dynamic `import('...')` targeting a LOCAL module. */
function findDynamicLocalSpecifiers(
  sf: ts.SourceFile,
  module: string,
  virtual: Map<string, string>
): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      const isDynImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      if ((isRequire || isDynImport) && node.arguments.length > 0) {
        const arg = node.arguments[0]!;
        if (ts.isStringLiteral(arg) && resolveSpecifier(module, arg.text, virtual) !== null) {
          found.push(arg.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function describeTerminal(t: Terminal): string {
  if (t.kind === 'value' || t.kind === 'type' || t.kind === 'default')
    return `${t.name}@${t.module} (${t.kind})`;
  if (t.kind === 'namespace') return `namespace of ${t.module}`;
  if (t.kind === 'external') return `${t.name}@${t.specifier} (external)`;
  return t.detail;
}

// ---------------------------------------------------------------------------
// Side-effect + import-equals import detection (local modules only)
// ---------------------------------------------------------------------------

/**
 * Local side-effect imports (`import './x'`) and TypeScript import-equals
 * (`import x = require('./y')`) are runtime capability paths that bypass named
 * analysis — reject them for any LOCAL specifier. External package side-effect
 * imports are outside lifecycle analysis (the route/facade import no locals this way).
 */
function detectSideEffectAndEqualsImports(
  sf: ts.SourceFile,
  module: string,
  virtual: Map<string, string>
): CapabilityViolation[] {
  const v: CapabilityViolation[] = [];
  for (const stmt of sf.statements) {
    // `import './x';` — an ImportDeclaration with NO import clause.
    if (
      ts.isImportDeclaration(stmt) &&
      !stmt.importClause &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      resolveSpecifier(module, stmt.moduleSpecifier.text, virtual) !== null
    ) {
      v.push({
        file: module,
        reason: 'local side-effect import',
        detail: stmt.moduleSpecifier.text,
      });
    }
    // `import x = require('./y');` — an ImportEqualsDeclaration with a require ref.
    if (ts.isImportEqualsDeclaration(stmt)) {
      const ref = stmt.moduleReference;
      if (ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression)) {
        if (resolveSpecifier(module, ref.expression.text, virtual) !== null) {
          v.push({
            file: module,
            reason: 'import-equals of a local module',
            detail: `${stmt.name.text} = require(${ref.expression.text})`,
          });
        }
      } else {
        // `import x = A.B` (entity-name) — a local capability alias; fail closed.
        v.push({ file: module, reason: 'import-equals alias', detail: stmt.name.text });
      }
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// Capability tracing: resolve local aliases + wrappers to runtime capabilities
// ---------------------------------------------------------------------------

/** A local runtime binding of `name` in `module`: an import, a local decl, or none. */
type LocalImport = { specifier: string; original: string; isNamespace: boolean; typeOnly: boolean };
function findImportBinding(sf: ts.SourceFile, localName: string): LocalImport | null {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    const clause = stmt.importClause;
    if (clause.name && clause.name.text === localName) {
      return {
        specifier: spec,
        original: 'default',
        isNamespace: false,
        typeOnly: clause.isTypeOnly,
      };
    }
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb) && nb.name.text === localName) {
      return { specifier: spec, original: '*', isNamespace: true, typeOnly: clause.isTypeOnly };
    }
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        if (el.name.text === localName) {
          return {
            specifier: spec,
            original: el.propertyName?.text ?? el.name.text,
            isNamespace: false,
            typeOnly: clause.isTypeOnly || el.isTypeOnly,
          };
        }
      }
    }
  }
  return null;
}

/** Whether a terminal is a forbidden runtime capability (by its de-aliased name). */
function terminalForbidden(t: Terminal): boolean {
  return (t.kind === 'value' || t.kind === 'default') && FORBIDDEN_CAPABILITY_NAMES.has(t.name);
}

/**
 * Trace the runtime capabilities a NAME in a guarded module reaches — following
 * local aliases (direct/chained/destructured), and wrapper functions (declarations,
 * arrows, function expressions) through their bodies (direct/returned calls,
 * namespace member access, one or more local helper hops). Resolves imported
 * bindings to their terminal (a forbidden terminal is a violation); recurses into
 * local functions/aliases within the guarded graph; fails closed on an unresolved
 * local binding. Bounded: only guarded-module bodies are traced; non-guarded
 * terminals are checked by name only.
 */
function collectForbiddenCapabilities(
  module: string,
  name: string,
  virtual: Map<string, string>,
  seen: Set<string> = new Set()
): CapabilityViolation[] {
  const key = `${module}#${name}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const text = readModule(module, virtual);
  if (text === null) {
    return [
      { file: module, reason: 'unresolved binding (fail closed)', detail: `${name} in ${module}` },
    ];
  }
  const sf = parse(module, text);

  // 1. Imported binding → resolve to terminal.
  const imp = findImportBinding(sf, name);
  if (imp) {
    if (imp.typeOnly) return []; // type-only carries no runtime capability
    if (imp.isNamespace) return []; // namespace: capability decided at member-access sites
    const resolved = resolveSpecifier(module, imp.specifier, virtual);
    if (resolved === null) return []; // external package — outside analysis
    const terminal = resolveExport(resolved, imp.original, virtual);
    return checkResolvedTerminal(module, name, terminal, virtual, seen);
  }

  // 2. Local declaration.
  for (const stmt of sf.statements) {
    if (
      (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) &&
      stmt.name?.text === name
    ) {
      return analyzeImplementation(module, stmt, virtual, seen);
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name && decl.initializer) {
          return analyzeInitializer(module, decl.initializer, virtual, seen);
        }
        // Top-level namespace destructuring: `const { orig: name } = ns`. A binding
        // laundered out of a namespace import (or a namespace alias) resolves to the
        // underlying member — an approved export name on the LHS cannot hide it.
        if (
          ts.isObjectBindingPattern(decl.name) &&
          decl.initializer &&
          ts.isIdentifier(decl.initializer)
        ) {
          for (const el of decl.name.elements) {
            if (!ts.isIdentifier(el.name) || el.name.text !== name) continue;
            const prop =
              el.propertyName && ts.isIdentifier(el.propertyName)
                ? el.propertyName.text
                : el.name.text;
            const origin = moduleNamespaceOrigin(module, decl.initializer.text, virtual);
            if (origin) {
              return checkNamespaceMember(
                module,
                decl.initializer.text,
                origin,
                prop,
                virtual,
                seen
              );
            }
          }
        }
      }
    }
  }
  return []; // not a module-level binding (a parameter / local variable) — no capability
}

/** A statically-known property name from a computed-access argument, else null. */
function staticPropertyName(arg: ts.Expression): string | null {
  if (ts.isStringLiteral(arg)) return arg.text;
  if (ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text;
  return null;
}

/**
 * The origin of a namespace value: a LOCAL guarded-graph module (member access +
 * computed access are analyzable / must fail closed), or an EXTERNAL package
 * (outside analysis). `null` means the value is not a namespace import at all.
 */
type NamespaceOrigin = { kind: 'local'; module: string } | { kind: 'external' };

/**
 * Resolve a MODULE-LEVEL identifier to a namespace origin, following module-level
 * `const alias = ns` alias chains. Returns null when the identifier is not a
 * namespace import (a named/default import, a local value, or absent).
 */
function moduleNamespaceOrigin(
  module: string,
  name: string,
  virtual: Map<string, string>,
  seen2: Set<string> = new Set()
): NamespaceOrigin | null {
  const cyc = `${module}#ns#${name}`;
  if (seen2.has(cyc)) return null;
  seen2.add(cyc);
  const text = readModule(module, virtual);
  if (text === null) return null;
  const sf = parse(module, text);
  const imp = findImportBinding(sf, name);
  if (imp) {
    if (!imp.isNamespace || imp.typeOnly) return null; // named/default/type-only ≠ namespace value
    const resolved = resolveSpecifier(module, imp.specifier, virtual);
    return resolved === null ? { kind: 'external' } : { kind: 'local', module: resolved };
  }
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === name &&
        decl.initializer &&
        ts.isIdentifier(decl.initializer)
      ) {
        return moduleNamespaceOrigin(module, decl.initializer.text, virtual, seen2);
      }
    }
  }
  return null;
}

/**
 * Resolve a member of a namespace origin and check it. A member of a LOCAL guarded
 * namespace resolves to its terminal (a forbidden export → violation). A non-static
 * (`prop === null`) computed access on a LOCAL namespace FAILS CLOSED — an unknown
 * property could be any export, so it cannot be assumed safe. External namespaces are
 * outside analysis; a `null` origin is ordinary (non-namespace) access — safe.
 */
function checkNamespaceMember(
  module: string,
  nsLabel: string,
  origin: NamespaceOrigin | null,
  prop: string | null,
  virtual: Map<string, string>,
  seen: Set<string>
): CapabilityViolation[] {
  if (origin === null) return []; // not a namespace — ordinary property/element access
  if (origin.kind === 'external') return []; // external package — outside analysis
  if (prop === null) {
    return [
      {
        file: module,
        reason: 'unresolved computed access to a local capability namespace (fail closed)',
        detail: `${nsLabel}[…]`,
      },
    ];
  }
  const terminal = resolveExport(origin.module, prop, virtual);
  return checkResolvedTerminal(module, `${nsLabel}.${prop}`, terminal, virtual, seen);
}

/** A resolved terminal: forbidden → violation; guarded local → recurse; else name check. */
function checkResolvedTerminal(
  module: string,
  name: string,
  terminal: Terminal,
  virtual: Map<string, string>,
  seen: Set<string>
): CapabilityViolation[] {
  if (terminal.kind === 'type') return [];
  if (terminal.kind === 'unresolved') {
    return [
      {
        file: module,
        reason: 'unresolved capability (fail closed)',
        detail: `${name}: ${terminal.detail}`,
      },
    ];
  }
  if (terminalForbidden(terminal)) {
    return [
      {
        file: module,
        reason: 'reaches a forbidden runtime capability',
        detail: `${name} → ${describeTerminal(terminal)}`,
      },
    ];
  }
  if (terminal.kind === 'namespace') {
    // A namespace of a local module — member access decides; conservatively OK here
    // (a forbidden member would be flagged where accessed inside a guarded body).
    return [];
  }
  // A safe value terminal inside the guarded graph → recurse into its implementation.
  if (terminal.kind === 'value' && GUARDED_FACADE_MODULES.has(terminal.module)) {
    return collectForbiddenCapabilities(terminal.module, terminal.name, virtual, seen);
  }
  return []; // a non-guarded, non-forbidden terminal (e.g. a read helper / pure fn)
}

/** Analyze a const initializer (alias / wrapper / member / computed) for capabilities. */
function analyzeInitializer(
  module: string,
  init: ts.Expression,
  virtual: Map<string, string>,
  seen: Set<string>
): CapabilityViolation[] {
  // `const x = someIdentifier` — a direct/chained alias.
  if (ts.isIdentifier(init)) {
    return collectForbiddenCapabilities(module, init.text, virtual, seen);
  }
  // `const x = ns.member` — a namespace (or namespace-alias) member.
  if (ts.isPropertyAccessExpression(init) && ts.isIdentifier(init.expression)) {
    const origin = moduleNamespaceOrigin(module, init.expression.text, virtual);
    if (origin) {
      return checkNamespaceMember(
        module,
        init.expression.text,
        origin,
        init.name.text,
        virtual,
        seen
      );
    }
  }
  // `const x = ns['member']` — literal computed member access on a namespace; a
  // non-static index on a local namespace fails closed (checkNamespaceMember).
  if (ts.isElementAccessExpression(init) && ts.isIdentifier(init.expression)) {
    const origin = moduleNamespaceOrigin(module, init.expression.text, virtual);
    if (origin) {
      return checkNamespaceMember(
        module,
        init.expression.text,
        origin,
        staticPropertyName(init.argumentExpression),
        virtual,
        seen
      );
    }
  }
  // `const x = req => ...` / `const x = function(){...}` — a wrapper.
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
    return analyzeImplementation(module, init, virtual, seen);
  }
  // Any other initializer (a call, object, ordinary member/computed access, etc.):
  // trace referenced identifiers so a `const x = helper(forbidden)` is caught.
  return analyzeImplementation(module, init, virtual, seen);
}

/** A namespace value laundered into a local binding within a single function scope. */
type LocalBinding =
  | { kind: 'alias'; target: string } // `const x = y`
  | { kind: 'member'; nsName: string; prop: string | null }; // `const {p:x}=ns` / `ns.p` / `ns['p']`

/**
 * Trace a function/expression body for forbidden capabilities, resolving namespace
 * member access (`ns.member`, `ns['member']`), namespace aliases (`const s = ns`),
 * and namespace destructuring (`const { member: x } = ns`) — INCLUDING bindings
 * laundered inside this function scope. Literal computed access resolves to the
 * underlying export; unresolved computed access to a LOCAL namespace fails closed.
 * Bounded: only this body's local bindings + the module-level graph are considered
 * (no whole-program call graph); a namespace-derived name shadowed across nested
 * scopes conservatively resolves to the capability (fail-safe).
 */
function analyzeImplementation(
  module: string,
  node: ts.Node,
  virtual: Map<string, string>,
  seen: Set<string>
): CapabilityViolation[] {
  const out: CapabilityViolation[] = [];
  const body =
    ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
      ? (node.body ?? node)
      : node;

  // 1. Collect local bindings that launder a namespace member / alias out of this
  //    body, so a later reference resolves to the underlying capability even when the
  //    binding was created inside the function scope (not at module level).
  const locals = new Map<string, LocalBinding>();
  const collect = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const init = n.initializer;
      if (ts.isIdentifier(n.name)) {
        if (ts.isIdentifier(init)) {
          locals.set(n.name.text, { kind: 'alias', target: init.text });
        } else if (ts.isPropertyAccessExpression(init) && ts.isIdentifier(init.expression)) {
          locals.set(n.name.text, {
            kind: 'member',
            nsName: init.expression.text,
            prop: init.name.text,
          });
        } else if (ts.isElementAccessExpression(init) && ts.isIdentifier(init.expression)) {
          locals.set(n.name.text, {
            kind: 'member',
            nsName: init.expression.text,
            prop: staticPropertyName(init.argumentExpression),
          });
        }
      } else if (ts.isObjectBindingPattern(n.name) && ts.isIdentifier(init)) {
        for (const el of n.name.elements) {
          if (!ts.isIdentifier(el.name)) continue;
          const prop =
            el.propertyName && ts.isIdentifier(el.propertyName)
              ? el.propertyName.text
              : el.name.text;
          locals.set(el.name.text, { kind: 'member', nsName: init.text, prop });
        }
      }
    }
    ts.forEachChild(n, collect);
  };
  collect(body);

  // 2. Resolve an identifier used as a NAMESPACE value, through local aliases then
  //    module level. A member binding is a value (not a namespace) → null.
  const localNsOrigin = (name: string, seen2: Set<string> = new Set()): NamespaceOrigin | null => {
    if (seen2.has(name)) return null;
    seen2.add(name);
    const b = locals.get(name);
    if (b?.kind === 'alias') return localNsOrigin(b.target, seen2);
    if (b?.kind === 'member') return null;
    return moduleNamespaceOrigin(module, name, virtual);
  };

  // 3. Resolve an identifier used as a VALUE: a laundered namespace member (check it),
  //    a bare namespace alias (safe — member access decides), else module-level.
  const checkValueRef = (name: string, seen2: Set<string> = new Set()): CapabilityViolation[] => {
    if (seen2.has(name)) return [];
    seen2.add(name);
    const b = locals.get(name);
    if (b?.kind === 'member') {
      return checkNamespaceMember(module, b.nsName, localNsOrigin(b.nsName), b.prop, virtual, seen);
    }
    if (b?.kind === 'alias') {
      if (localNsOrigin(b.target)) return []; // bare namespace alias — no capability by itself
      return checkValueRef(b.target, seen2);
    }
    return collectForbiddenCapabilities(module, name, virtual, seen);
  };

  const visit = (n: ts.Node): void => {
    // Binding names are not value references — trace only the initializer.
    if (ts.isVariableDeclaration(n)) {
      if (n.initializer) visit(n.initializer);
      return;
    }
    // `obj.member` / `obj['member']` / `obj[expr]` — resolve when `obj` is a namespace.
    if (
      (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) &&
      ts.isIdentifier(n.expression)
    ) {
      const origin = localNsOrigin(n.expression.text);
      if (origin) {
        const prop = ts.isPropertyAccessExpression(n)
          ? n.name.text
          : staticPropertyName(n.argumentExpression);
        out.push(...checkNamespaceMember(module, n.expression.text, origin, prop, virtual, seen));
        // trace the computed argument (e.g. `ns[getName()]`), not the namespace object.
        if (ts.isElementAccessExpression(n)) ts.forEachChild(n.argumentExpression, visit);
        return;
      }
      // ordinary object/array access → visit all children (incl. the object identifier).
      ts.forEachChild(n, visit);
      return;
    }
    if (ts.isIdentifier(n)) {
      out.push(...checkValueRef(n.text));
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  return out;
}

/**
 * Analyze the admin route's imports against the capability allowlist. Fail-closed:
 * only approved local modules + approved runtime named imports resolving to
 * approved terminals pass. Namespace/default/require/dynamic local imports fail.
 */
export function analyzeAdminRouteCapabilities(
  source: string,
  routePath: string = ADMIN_ROUTE_PATH,
  virtual: Map<string, string> = new Map()
): CapabilityViolation[] {
  const v: CapabilityViolation[] = [];
  const files = new Map(virtual);
  files.set(routePath, source);
  const sf = parse(routePath, source);

  for (const spec of findDynamicLocalSpecifiers(sf, routePath, files)) {
    v.push({ file: routePath, reason: 'dynamic/require local import', detail: spec });
  }
  v.push(...detectSideEffectAndEqualsImports(sf, routePath, files));

  for (const stmt of sf.statements) {
    // Re-exports from the route (an API route should not re-export lifecycle code).
    if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      const resolved = resolveSpecifier(routePath, stmt.moduleSpecifier.text, files);
      if (resolved)
        v.push({
          file: routePath,
          reason: 'route re-exports a local module',
          detail: stmt.moduleSpecifier.text,
        });
      continue;
    }
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const specNode = stmt.moduleSpecifier;
    if (!ts.isStringLiteral(specNode)) continue;
    const specifier = specNode.text;
    const resolved = resolveSpecifier(routePath, specifier, files);
    if (resolved === null) continue; // external package — allowed
    const clause = stmt.importClause;

    if (clause.name) {
      v.push({
        file: routePath,
        reason: 'default import of a local module',
        detail: `${clause.name.text} from ${specifier}`,
      });
    }
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) {
      v.push({
        file: routePath,
        reason: 'namespace import of a local module',
        detail: `* as ${nb.name.text} from ${specifier}`,
      });
      continue;
    }
    if (!nb || !ts.isNamedImports(nb)) continue;

    const approvedForModule = ROUTE_APPROVED_MODULES.get(resolved);
    for (const el of nb.elements) {
      const typeOnly = clause.isTypeOnly || el.isTypeOnly;
      if (typeOnly) continue; // type-only import: no runtime capability path
      const local = el.name.text;
      const original = el.propertyName?.text ?? local;
      if (!approvedForModule) {
        v.push({
          file: routePath,
          reason: 'runtime import from a non-allowlisted module',
          detail: `${original} from ${specifier} (${resolved})`,
        });
        continue;
      }
      if (!approvedForModule.has(original)) {
        v.push({
          file: routePath,
          reason: 'runtime import not on the module allowlist',
          detail: `${original} from ${resolved}`,
        });
        continue;
      }
      // Deep check: resolve the exact binding through re-export/barrel chains.
      const terminal = resolveExport(resolved, original, files);
      if (terminal.kind === 'unresolved') {
        v.push({
          file: routePath,
          reason: 'unresolved route import (fail closed)',
          detail: `${original} from ${resolved}: ${terminal.detail}`,
        });
      } else if (terminal.kind === 'type') {
        continue; // resolved to a type — no runtime capability
      } else if (terminal.kind !== 'value' || !ROUTE_APPROVED_TERMINALS.has(terminal.name)) {
        v.push({
          file: routePath,
          reason: 'route reaches a non-approved capability',
          detail: `${original} → ${describeTerminal(terminal)}`,
        });
      } else if (GUARDED_FACADE_MODULES.has(terminal.module)) {
        // Defense in depth: trace the approved terminal's implementation so a
        // facade alias/wrapper concealing a forbidden capability behind an approved
        // name is caught from the route too.
        v.push(...collectForbiddenCapabilities(terminal.module, terminal.name, files));
      }
    }
  }
  return v;
}

/**
 * Verify the inspection facade's EXPORT surface: every runtime export must resolve
 * to an approved terminal, and no export may resolve to a forbidden mutation
 * capability (directly, via alias, or through a barrel/`export *`).
 */
export function analyzeInspectionFacadeSurface(
  source: string,
  facadePath: string = INSPECTION_FACADE_PATH,
  virtual: Map<string, string> = new Map()
): CapabilityViolation[] {
  const v: CapabilityViolation[] = [];
  const files = new Map(virtual);
  files.set(facadePath, source);
  const sf = parse(facadePath, source);
  // Local side-effect / import-equals imports are rejected in the facade too.
  v.push(...detectSideEffectAndEqualsImports(sf, facadePath, files));

  for (const { name, isType } of collectExportedNames(facadePath, files)) {
    if (isType) continue; // type exports carry no runtime capability
    const terminal = resolveExport(facadePath, name, files);
    if (terminal.kind === 'type') continue;
    if (terminal.kind === 'unresolved') {
      v.push({
        file: facadePath,
        reason: 'unresolved facade export (fail closed)',
        detail: `${name}: ${terminal.detail}`,
      });
    } else if (terminal.kind !== 'value' || !FACADE_APPROVED_EXPORT_TERMINALS.has(terminal.name)) {
      v.push({
        file: facadePath,
        reason: 'facade export reaches a non-approved capability',
        detail: `${name} → ${describeTerminal(terminal)}`,
      });
    }
    // Deep-trace the export's ACTUAL IMPLEMENTATION (aliases / wrappers / local
    // helpers, in whichever guarded module defines it) for any concealed forbidden
    // runtime capability — an approved export NAME never makes a forbidden terminal
    // safe. The facade-local name is traced first (catches a facade-local wrapper);
    // if the export resolves to a guarded terminal elsewhere, that body is traced too.
    v.push(...collectForbiddenCapabilities(facadePath, name, files));
    if (terminal.kind === 'value' && GUARDED_FACADE_MODULES.has(terminal.module)) {
      v.push(...collectForbiddenCapabilities(terminal.module, terminal.name, files));
    }
  }
  return v;
}
