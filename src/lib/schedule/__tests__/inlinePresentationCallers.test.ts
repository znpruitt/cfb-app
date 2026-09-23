import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

/**
 * PLATFORM-757a ACCEPTANCE 4 — **the inline presentation calls are unchanged.**
 *
 * ## What this is for
 *
 * 757a is ADDITIVE by design. The standalone job ships first and the three
 * inline calls stay exactly where they are, so the branch is safe to promote at
 * any moment: removing them before the job is live in production would silently
 * stop broadcast refreshes for everyone. 757b deletes them, once a standalone
 * receipt has actually been observed.
 *
 * That makes "the inline calls still exist" a property of THIS slice, and a
 * property nothing else would notice the loss of — every other suite in the
 * repo passes just as well with them gone.
 *
 * ## Why the type checker and not a grep
 *
 * A substring search for `refreshSchedulePresentation` is satisfied by a
 * comment, an import that nothing calls, or a mention in a docblock — all three
 * of which exist in this repo. It also misses an aliased import
 * (`refreshSchedulePresentation as refresh`), which is a real call the pin must
 * count. So callees are resolved to the DECLARATION through the checker,
 * matched on where the symbol is declared rather than on how the call site
 * spells it. The positive control at the end proves the scan can see a call at
 * all, through this exact function rather than a copy of its predicate.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const AUTHORITY = 'src/lib/schedule/schedulePresentationRefresh.ts';
const FUNCTION_NAME = 'refreshSchedulePresentation';

/**
 * Every production call site, with WHY it is there. A call appearing anywhere
 * else — or one of these disappearing — fails until this map is updated, which
 * is the point: 757b's deletion must be a deliberate edit to this list, not a
 * silent diff nothing observes.
 */
const EXPECTED_CALLERS: Record<string, { calls: number; reason: string }> = {
  'src/app/api/schedule/route.ts': {
    calls: 1,
    reason:
      'E1C1 manual seeding: the authorized full-year bypassCache refresh. 757b decides this one separately — it is an interactive admin path, not a cron',
  },
  'src/app/api/cron/schedule-refresh/route.ts': {
    calls: 1,
    reason: 'E1C2 inline weekly call, AFTER the canonical commit. 757b removes this',
  },
  'src/app/api/cron/season-transition/route.ts': {
    calls: 1,
    reason: 'E1C2 inline lifecycle call, after the probe/status work. 757b removes this',
  },
  'src/app/api/cron/schedule-presentation/route.ts': {
    calls: 1,
    reason: 'PLATFORM-757a — the standalone job this slice adds',
  },
};

function isScannedSource(rel: string): boolean {
  if (!rel.startsWith(`src${path.sep}`)) return false;
  if (!rel.endsWith('.ts') && !rel.endsWith('.tsx')) return false;
  if (rel.endsWith('.d.ts')) return false;
  return !rel.split(path.sep).includes('__tests__');
}

/** Call sites per file, resolved through the checker. */
function scan(virtualFiles: Record<string, string> = {}): Map<string, number> {
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(ROOT, 'tsconfig.json'), undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  });
  assert.ok(parsed, 'tsconfig.json parses');
  const virtual = new Map(
    Object.entries(virtualFiles).map(([rel, text]) => [path.join(ROOT, rel), text] as const)
  );
  const host = ts.createCompilerHost(parsed.options);
  const baseGetSourceFile = host.getSourceFile.bind(host);
  const baseFileExists = host.fileExists.bind(host);
  const baseReadFile = host.readFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, ...rest) => {
    const text = virtual.get(path.resolve(fileName));
    return text !== undefined
      ? ts.createSourceFile(fileName, text, languageVersion, true)
      : baseGetSourceFile(fileName, languageVersion, ...rest);
  };
  host.fileExists = (fileName) => virtual.has(path.resolve(fileName)) || baseFileExists(fileName);
  host.readFile = (fileName) => virtual.get(path.resolve(fileName)) ?? baseReadFile(fileName);
  const program = ts.createProgram([...parsed.fileNames, ...virtual.keys()], parsed.options, host);
  const checker = program.getTypeChecker();

  const calls = new Map<string, number>();

  /** True when this identifier resolves to the authority's exported function. */
  const isAuthorityCallee = (node: ts.Identifier): boolean => {
    let symbol = checker.getSymbolAtLocation(node);
    if (!symbol) return false;
    if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    if (symbol.name !== FUNCTION_NAME) return false;
    const decl = symbol.declarations?.[0];
    if (!decl) return false;
    return path.relative(ROOT, decl.getSourceFile().fileName) === AUTHORITY;
  };

  for (const sourceFile of program.getSourceFiles()) {
    const rel = path.relative(ROOT, sourceFile.fileName);
    if (!isScannedSource(rel) && !virtual.has(path.resolve(sourceFile.fileName))) continue;
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        isAuthorityCallee(node.expression)
      ) {
        calls.set(rel, (calls.get(rel) ?? 0) + 1);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }
  return calls;
}

test('ACCEPTANCE 4: every inline presentation caller is still exactly where 757a found it', () => {
  const calls = scan();
  const actual = Object.fromEntries([...calls.entries()].sort());
  const expected = Object.fromEntries(
    Object.entries(EXPECTED_CALLERS)
      .map(([file, { calls: n }]) => [file, n] as const)
      .sort()
  );
  assert.deepEqual(
    actual,
    expected,
    'the three inline callers plus the new standalone job — no more, no fewer'
  );
});

test('the standalone job is an ADDITION: the two crons still call the authority themselves', () => {
  const calls = scan();
  // Named individually as well as in the map above, because this is the claim
  // that makes the branch safe to promote at any time, and a reader of a
  // failure should see which caller vanished rather than a diffed object.
  assert.equal(calls.get('src/app/api/cron/schedule-refresh/route.ts'), 1, 'weekly cron');
  assert.equal(calls.get('src/app/api/cron/season-transition/route.ts'), 1, 'lifecycle cron');
  assert.equal(calls.get('src/app/api/schedule/route.ts'), 1, 'manual admin refresh');
  assert.equal(calls.get('src/app/api/cron/schedule-presentation/route.ts'), 1, 'the new job');
});

test('POSITIVE CONTROL: the scan detects a call, including through an alias', () => {
  // Without this the deepEqual above passes just as well against a scan that
  // resolves nothing — every count would be absent and the expected map would
  // simply have to be empty. It runs the SAME `scan`, not a copy of its
  // predicate, and uses an ALIASED import because that is the case a
  // spelling-based check silently misses.
  const virtualCaller = `
    import { refreshSchedulePresentation as refresh } from '@/lib/schedule/schedulePresentationRefresh';
    export async function probe(): Promise<void> {
      await refresh({ year: 2026, trigger: 'manual' });
    }
  `;
  const calls = scan({ 'src/lib/schedule/__probeCaller.ts': virtualCaller });
  assert.equal(
    calls.get(path.join('src', 'lib', 'schedule', '__probeCaller.ts')),
    1,
    'an aliased call is counted, so the pin cannot be satisfied by spelling alone'
  );
});
