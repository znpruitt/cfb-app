import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1 — deterministic lifecycle-authority guard.
//
// Proves by SOURCE ANALYSIS that lifecycle writes stay centralized in
// `src/lib/leagueRegistry.ts` and that every production transition goes through
// a guarded operation. This is defense-in-depth: the binding restriction on the
// unguarded `updateLeagueStatus` is enforced at RUNTIME inside that function.
//
// The scan is AST-based (TypeScript compiler API), not regex over text. An
// earlier regex form was wrong in both directions (F2H review): it was defeated
// by `import { updateLeagueStatus as alias }`, and its comment-stripping
// truncated every line at the first `//` — including `//` inside string literals
// such as `https://` URLs — creating a silent false-negative channel in the very
// guard meant to detect a reintroduced lifecycle write. A real parser has
// neither failure mode: comments and string contents are structurally distinct
// from code.
//
// Test files are excluded — the lifecycle suites legitimately name every
// authority they assert against.
// ---------------------------------------------------------------------------

const SRC = join(process.cwd(), 'src');
const REGISTRY_MODULE = join('lib', 'leagueRegistry.ts');
/** The test league's independent lifecycle controls. */
const TEST_LEAGUE_CONTROLS = join('app', 'admin', '[slug]', 'actions.ts');

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === '__tests__') continue; // production code only
      collectSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

function relativeToSrc(file: string): string {
  return relative(SRC, file);
}

function parseSource(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
}

/** Every production source parsed ONCE into a real AST. */
const SOURCES: ReadonlyArray<{ file: string; ast: ts.SourceFile }> = collectSourceFiles(SRC).map(
  (full) => ({ file: relativeToSrc(full), ast: parseSource(full, readFileSync(full, 'utf8')) })
);

const BY_FILE = new Map(SOURCES.map((s) => [s.file, s.ast]));

function astOf(relativePath: string): ts.SourceFile {
  const ast = BY_FILE.get(relativePath);
  assert.ok(ast, `${relativePath.split(sep).join('/')} was scanned`);
  return ast;
}

/** Depth-first walk over every node. */
function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function some(ast: ts.Node, predicate: (n: ts.Node) => boolean): boolean {
  let found = false;
  walk(ast, (n) => {
    if (!found && predicate(n)) found = true;
  });
  return found;
}

function moduleSpecifierOf(node: ts.ImportDeclaration): string {
  return ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : '';
}

const REGISTRY_SPECIFIER = /(?:^|\/)leagueRegistry(?:\.ts)?$/;
const LEAGUE_MODULE_SPECIFIER = /(?:^|\/)league(?:\.ts)?$/;

/** Whether `ast` imports `name` from the registry under ANY binding. */
function importsRegistrySymbol(ast: ts.SourceFile, name: string): boolean {
  return some(ast, (n) => {
    if (!ts.isImportDeclaration(n)) return false;
    if (!REGISTRY_SPECIFIER.test(moduleSpecifierOf(n))) return false;
    const bindings = n.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return false;
    // `propertyName` is the ORIGINAL export when aliased; `name` otherwise.
    return bindings.elements.some((el) => (el.propertyName ?? el.name).text === name);
  });
}

/**
 * Files importing `name` from the registry, under ANY binding — `{ name }`,
 * `{ name as alias }`, or across a multi-line list. Import binding is what a
 * scan must key on: matching call syntax alone is defeated by a single alias.
 */
function filesImportingFromRegistry(name: string): string[] {
  return SOURCES.filter(({ ast }) => importsRegistrySymbol(ast, name))
    .map(({ file }) => file)
    .sort();
}

/** Every direct call `name(...)` in one file, as AST nodes. */
function callsTo(ast: ts.SourceFile, name: string): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  walk(ast, (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) {
      calls.push(n);
    }
  });
  return calls;
}

/** Files containing a direct call `name(...)`. */
function filesCalling(name: string): string[] {
  return SOURCES.filter(({ ast }) => callsTo(ast, name).length > 0)
    .map(({ file }) => file)
    .sort();
}

/** Whether the AST contains the EXACT string literal `value` (never a comment). */
function hasStringLiteral(ast: ts.Node, value: string): boolean {
  return some(
    ast,
    (n) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && n.text === value
  );
}

/**
 * Whether the AST spreads an existing RECORD and then OVERRIDES a lifecycle
 * field on it — i.e. `{ ...record, status, year: … }`, the projection shape.
 *
 * Two structural conditions keep this from firing on unrelated object literals
 * (F2H review — the looser form flagged the rollover route's response body,
 * `{ success, year, …, ...(cond ? { message } : {}) }`):
 *   1. the spread expression must be a record reference (an identifier or a
 *      property access), never a conditional/call that merely contributes
 *      optional keys;
 *   2. the lifecycle property must come AFTER that spread, since only then does
 *      it override the spread record's own value.
 */
function hasLifecycleProjection(ast: ts.Node): boolean {
  return some(ast, (n) => {
    if (!ts.isObjectLiteralExpression(n)) return false;
    const firstRecordSpread = n.properties.findIndex(
      (prop) =>
        ts.isSpreadAssignment(prop) &&
        (ts.isIdentifier(prop.expression) || ts.isPropertyAccessExpression(prop.expression))
    );
    if (firstRecordSpread === -1) return false;
    return n.properties
      .slice(firstRecordSpread + 1)
      .some(
        (prop) =>
          (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) &&
          ts.isIdentifier(prop.name) &&
          (prop.name.text === 'status' || prop.name.text === 'year')
      );
  });
}

// ---------------------------------------------------------------------------

test('the unguarded updateLeagueStatus has no production caller beyond the test-league controls', () => {
  const allowed = new Set([REGISTRY_MODULE, TEST_LEAGUE_CONTROLS]);

  const callers = filesCalling('updateLeagueStatus').filter((f) => !allowed.has(f));
  assert.deepEqual(
    callers,
    [],
    `updateLeagueStatus must not be called outside the registry and the test-league controls:\n${callers.join('\n')}`
  );

  // An alias cannot evade an import-binding scan.
  const importers = filesImportingFromRegistry('updateLeagueStatus').filter((f) => !allowed.has(f));
  assert.deepEqual(
    importers,
    [],
    `updateLeagueStatus must not be imported (aliased or otherwise) outside the allowlist:\n${importers.join('\n')}`
  );
});

test('the test-league controls call updateLeagueStatus only for the literal test slug', () => {
  const ast = astOf(TEST_LEAGUE_CONTROLS);
  const calls = callsTo(ast, 'updateLeagueStatus');

  assert.ok(calls.length > 0, 'the test-league controls still set the test league lifecycle');
  for (const call of calls) {
    const first = call.arguments[0];
    assert.ok(
      first && ts.isStringLiteral(first) && first.text === 'test',
      'every unguarded lifecycle write names the test league literally'
    );
  }
});

test('both rollover callers still use the exact-year guarded completeSeasonRollover', () => {
  for (const route of [
    join('app', 'api', 'admin', 'rollover', 'route.ts'),
    join('app', 'api', 'cron', 'season-rollover', 'route.ts'),
  ]) {
    const ast = astOf(route);
    assert.ok(
      callsTo(ast, 'completeSeasonRollover').length > 0,
      `${route}: rollover still goes through the guarded transition`
    );
    assert.equal(
      callsTo(ast, 'updateLeagueStatus').length,
      0,
      `${route}: rollover was not rerouted through an unrestricted mutation`
    );
    assert.ok(
      !importsRegistrySymbol(ast, 'updateLeagueStatus'),
      `${route}: the unguarded authority is not even imported`
    );
    assert.ok(
      callsTo(ast, 'groupRolloverTargets').length > 0,
      `${route}: rollover still uses the shared target-selection policy`
    );
    assert.ok(
      callsTo(ast, 'resolveNationalChampionshipRollover').length > 0,
      `${route}: rollover still executes behind the strict eligibility authority`
    );
  }
});

test('the season-transition cron uses the guarded preseason→season authority', () => {
  const ast = astOf(join('app', 'api', 'cron', 'season-transition', 'route.ts'));

  assert.ok(callsTo(ast, 'completeSeasonTransition').length > 0, 'guarded transition consumed');
  assert.equal(callsTo(ast, 'updateLeagueStatus').length, 0, 'no unrestricted lifecycle write');
  assert.ok(
    !importsRegistrySymbol(ast, 'updateLeagueStatus'),
    'the unguarded authority is not even imported'
  );
});

test('the commissioner lifecycle actions use their guarded authorities', () => {
  const ast = astOf(TEST_LEAGUE_CONTROLS);

  assert.ok(callsTo(ast, 'beginPreseasonTransition').length > 0, 'offseason→preseason is guarded');
  assert.ok(callsTo(ast, 'completePreseasonSetup').length > 0, 'setup completion is guarded');
});

test('no module outside the registry spreads a record while rewriting a lifecycle field', () => {
  // The synchronized `status` + `year` projection lives in exactly one place.
  // Scoped to files that import the league record or the registry — a spread
  // setting `year:` in an unrelated module (schedule probe state, health view
  // models, React action state) is not a lifecycle write.
  const offenders = SOURCES.filter(({ file, ast }) => {
    if (file === REGISTRY_MODULE) return false;
    const importsLeagueShape = some(
      ast,
      (n) =>
        ts.isImportDeclaration(n) &&
        (REGISTRY_SPECIFIER.test(moduleSpecifierOf(n)) ||
          LEAGUE_MODULE_SPECIFIER.test(moduleSpecifierOf(n)))
    );
    return importsLeagueShape && hasLifecycleProjection(ast);
  }).map(({ file }) => file);

  assert.deepEqual(
    offenders,
    [],
    `lifecycle field synchronization must stay in the registry:\n${offenders.join('\n')}`
  );
});

test('the recovery route exposes only the missing-status initializer', () => {
  const route = join('app', 'api', 'admin', 'lifecycle-recovery', 'route.ts');
  const ast = astOf(route);

  assert.ok(callsTo(ast, 'initializeMissingLifecycleStatus').length > 0, 'the one authority');
  for (const forbidden of [
    'updateLeagueStatus',
    'completeSeasonRollover',
    'completeSeasonTransition',
    'beginPreseasonTransition',
    'completePreseasonSetup',
  ]) {
    assert.equal(callsTo(ast, forbidden).length, 0, `${route}: must not call ${forbidden}`);
    assert.ok(!importsRegistrySymbol(ast, forbidden), `${route}: must not import ${forbidden}`);
  }
  assert.ok(
    !some(ast, (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'GET'),
    `${route}: there is deliberately no GET route`
  );
});

test('no UI or server action invokes the dormant recovery API in F2H1', () => {
  const routeFile = join('app', 'api', 'admin', 'lifecycle-recovery', 'route.ts');
  const callers = SOURCES.filter(
    ({ file, ast }) => file !== routeFile && hasStringLiteral(ast, '/api/admin/lifecycle-recovery')
  ).map(({ file }) => file);

  assert.deepEqual(
    callers,
    [],
    `the recovery API stays dormant until F2H3:\n${callers.join('\n')}`
  );
});

test('the registry module is the only place holding the registry key transaction', () => {
  const offenders = SOURCES.filter(({ file, ast }) => {
    if (file === REGISTRY_MODULE) return false;
    return some(ast, (n) => {
      if (!ts.isCallExpression(n)) return false;
      if (!ts.isIdentifier(n.expression) || n.expression.text !== 'withAppStateKeyTransaction') {
        return false;
      }
      const first = n.arguments[0];
      return Boolean(first && ts.isStringLiteral(first) && first.text === 'leagues');
    });
  }).map(({ file }) => file);

  assert.deepEqual(offenders, [], `registry writes stay centralized:\n${offenders.join('\n')}`);
});

// ---------------------------------------------------------------------------
// Guards on the guard — a scan that silently matches nothing is worse than none.

test('the AST scan actually inspected the lifecycle sources it claims to guard', () => {
  for (const expected of [
    REGISTRY_MODULE,
    TEST_LEAGUE_CONTROLS,
    join('app', 'api', 'cron', 'season-transition', 'route.ts'),
    join('app', 'api', 'cron', 'season-rollover', 'route.ts'),
    join('app', 'api', 'admin', 'rollover', 'route.ts'),
    join('app', 'api', 'admin', 'lifecycle-recovery', 'route.ts'),
  ]) {
    assert.ok(BY_FILE.has(expected), `${expected.split(sep).join('/')} was scanned`);
  }
});

test('the scanner reads code structurally — comments and string contents are not code', () => {
  const probe = (source: string): ts.SourceFile => parseSource('probe.ts', source);

  // Aliased and multi-line imports are caught; other modules are not.
  assert.ok(
    importsRegistrySymbol(
      probe(`import { updateLeagueStatus as setStatus } from '@/lib/leagueRegistry';`),
      'updateLeagueStatus'
    ),
    'an aliased import is detected'
  );
  assert.ok(
    importsRegistrySymbol(
      probe(`import {\n  getLeague,\n  updateLeagueStatus,\n} from '../leagueRegistry.ts';`),
      'updateLeagueStatus'
    ),
    'a multi-line import list is detected'
  );
  assert.ok(
    !importsRegistrySymbol(
      probe(`import { updateLeagueStatus } from './someOtherModule';`),
      'updateLeagueStatus'
    ),
    'only registry imports count'
  );

  // A comment naming an authority is not a call.
  assert.equal(
    callsTo(
      probe(`// updateLeagueStatus(slug, s) is the unguarded authority\nexport const a = 1;`),
      'updateLeagueStatus'
    ).length,
    0,
    'a line comment is not a call'
  );
  assert.equal(
    callsTo(probe(`/* updateLeagueStatus(slug, s) */\nexport const a = 1;`), 'updateLeagueStatus')
      .length,
    0,
    'a block comment is not a call'
  );

  // The regression that motivated dropping regex comment-stripping: a `//`
  // inside a string literal must NOT blind the scanner to code after it.
  assert.equal(
    callsTo(
      probe(`const url = 'https://api.example.com/v1'; updateLeagueStatus('x', s);`),
      'updateLeagueStatus'
    ).length,
    1,
    'code following a URL literal on the same line is still seen'
  );
  assert.equal(
    callsTo(
      probe(
        `const u = \`https://a.example/\${p}\`; withAppStateKeyTransaction('leagues', 'registry', f);`
      ),
      'withAppStateKeyTransaction'
    ).length,
    1,
    'code following a template literal containing // is still seen'
  );

  // A path mentioned in a comment is not a string literal.
  assert.ok(
    hasStringLiteral(
      probe(`fetch('/api/admin/lifecycle-recovery');`),
      '/api/admin/lifecycle-recovery'
    )
  );
  assert.ok(
    !hasStringLiteral(
      probe(`// see /api/admin/lifecycle-recovery\nconst a = 1;`),
      '/api/admin/lifecycle-recovery'
    )
  );
});

test('the lifecycle-projection scan matches a reintroduced projection', () => {
  // Proves the object-literal detector is not inert: the registry's own
  // projection matches (it is excluded by path, not by the predicate failing),
  // and an unrelated spread does not.
  assert.ok(hasLifecycleProjection(astOf(REGISTRY_MODULE)), 'the registry projection matches');
  assert.ok(
    hasLifecycleProjection(
      parseSource('probe.ts', `const next = { ...current, status, year: status.year };`)
    ),
    'a reintroduced projection matches'
  );
  assert.ok(
    !hasLifecycleProjection(
      parseSource('probe.ts', `const next = { ...probeState, baseCachedAt: now };`)
    ),
    'a spread without a lifecycle field does not match'
  );
  assert.ok(
    !hasLifecycleProjection(
      parseSource(
        'probe.ts',
        `const body = { success: true, year, ...(bad ? { message: 'x' } : {}) };`
      )
    ),
    'a response body whose only spread contributes optional keys does not match'
  );
  assert.ok(
    !hasLifecycleProjection(parseSource('probe.ts', `const body = { year, ...extra };`)),
    'a lifecycle field BEFORE the spread is not an override'
  );
});
