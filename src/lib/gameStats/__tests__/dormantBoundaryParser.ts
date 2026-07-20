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
  }
  return v;
}
