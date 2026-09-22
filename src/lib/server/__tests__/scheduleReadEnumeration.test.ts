import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

/**
 * PLATFORM-813 — every durable `schedule` read in `src/`, ENUMERATED, not listed.
 *
 * **WHAT THIS REPLACED, AND WHY.** The previous check held a hand-written list of 13
 * "consumers" and asserted each file contained the substring `loadCachedScheduleItems`.
 * That proves the listed files mention the reader; it says nothing about files NOT on
 * the list, which is the only question "none reads around it" asks. Its list was a count
 * of the reads in hand, and this prompt family published that mistake twice ("13
 * consumers, validating once covers all", then "14 of 14"). Codex flagged the substring
 * form in v2 round 2; it stayed unresolved until this round.
 *
 * **POPULATION**: every reference, in every non-test `.ts`/`.tsx` file under `src/`, to
 * a store function that can read a scope — `getAppState`, `getAppStateEntries`,
 * `withAppStateKeyTransaction`, `listAppStateKeys` — resolved through imports by the
 * type checker, not matched by name. A CALL whose scope argument type-resolves to the
 * literal `'schedule'` is a schedule read. A reference that is NOT a direct call (passed
 * as a value, e.g. `params.readState ?? getAppState`) is reported separately, because
 * the scope it is eventually called with is invisible here — a direct-call scan missed
 * `scheduleDisappearanceBaseline` for exactly that reason when this was first written.
 *
 * **WHAT IT CANNOT SEE, stated because a sweep's blind spot is part of its result.** A
 * scope built at runtime (`draftScope(slug)`, a loop variable) has type `string`, not a
 * literal, so it cannot be proven not to be `'schedule'`. Traced by hand on 2026-09-21:
 * every such argument is an alias, owners, draft, suppression, odds, archive or
 * provider-refresh scope. That trace is dated and will decay; the literal half is
 * enforced.
 */

const READERS = new Set([
  'getAppState',
  'getAppStateEntries',
  'withAppStateKeyTransaction',
  'listAppStateKeys',
]);
const STORE = 'src/lib/server/appStateStore.ts';

/**
 * Every place allowed to read durable `schedule` rows WITHOUT the canonical boundary,
 * with how many sites and why. A new read anywhere — or one more in a listed file —
 * fails the test until it is either routed through `canonicalScheduleCache.ts` or
 * added here with a reason. The reason is the point: an entry with no defensible reason
 * is a bypass.
 */
const ALLOWED_SCHEDULE_READS: Record<string, { sites: number; reason: string }> = {
  'src/lib/server/canonicalScheduleCache.ts': {
    sites: 3,
    reason: 'the canonical reader itself: aggregate, then the two legacy partitions',
  },
  'src/lib/schedule/fullSeasonScheduleRefresh.ts': {
    sites: 2,
    reason: 'the only WRITER; reads the prior value to order observations',
  },
  'src/app/api/admin/cache-historical-schedule/route.ts': {
    sites: 1,
    reason: 'record presence only (already-cached short-circuit)',
  },
  'src/lib/server/providerCacheState.ts': { sites: 1, reason: 'row count only' },
  'src/components/admin/LeagueStatusPanel.tsx': {
    sites: 2,
    reason: 'presence and age only; its own key precedence is #833',
  },
  'src/lib/server/providerDataDiagnostics.ts': {
    sites: 2,
    reason:
      'a diagnostic that exists to SEE corruption; whether it should read through a sanitizing boundary is #843',
  },
  'src/lib/server/scoreApplicability.ts': {
    sites: 1,
    reason: 'seasonType by equality only; a non-object row throws, loudly, exactly as on main',
  },
  'src/lib/rankings/automaticContext.ts': {
    sites: 1,
    reason: 'validates itself: a non-object element is `malformed`; startDate is typeof-guarded',
  },
  'src/lib/schedule/schedulePresentationRefresh.ts': {
    sites: 1,
    reason: 'id via a typeof guard; a non-object row throws, loudly, exactly as on main',
  },
  'src/app/api/cron/schedule-refresh/route.ts': {
    sites: 2,
    reason:
      'weeklyRefreshOperation: seasonType by equality, startDate typeof-guarded; a non-object row throws, as on main',
  },
  'src/lib/seasonRollover.ts': {
    sites: 2,
    reason:
      'findNationalChampionshipGameDate: typeof-guarded, the whole read in a try/catch returning null; its precedence is #833',
  },
};

/** Store readers referenced other than by a direct call — the scope is invisible here. */
const ALLOWED_INDIRECT_READERS: Record<string, string> = {
  'src/lib/schedule/scheduleDisappearanceBaseline.ts':
    'deliberate raw read of the partition pair for the disappearance baseline (:28-45)',
};

type Scan = {
  filesScanned: number;
  scheduleReads: Map<string, number>;
  indirect: Set<string>;
  /** The SOURCE TEXT of each scope argument that is not a string literal type. */
  unresolvedScopes: Array<{ file: string; scope: string }>;
};

function scan(root: string): Scan {
  const parsed = ts.getParsedCommandLineOfConfigFile(path.join(root, 'tsconfig.json'), undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  });
  assert.ok(parsed, 'tsconfig.json parses');
  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();

  const result: Scan = {
    filesScanned: 0,
    scheduleReads: new Map(),
    indirect: new Set(),
    unresolvedScopes: [],
  };

  const resolvesToStore = (node: ts.Identifier): boolean => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    const decl = symbol?.declarations?.[0];
    return Boolean(decl && path.relative(root, decl.getSourceFile().fileName) === STORE);
  };

  for (const sourceFile of program.getSourceFiles()) {
    const rel = path.relative(root, sourceFile.fileName);
    if (!isScannedSource(rel)) continue;
    result.filesScanned += 1;

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && READERS.has(node.text) && resolvesToStore(node)) {
        const parent = node.parent;
        const isDirectCall = ts.isCallExpression(parent) && parent.expression === node;
        const isTypeOnly = ts.isTypeQueryNode(parent);
        if (isDirectCall) {
          const scopeArg = parent.arguments[0];
          const type = scopeArg ? checker.getTypeAtLocation(scopeArg) : undefined;
          if (type?.isStringLiteral()) {
            if (type.value === 'schedule') {
              result.scheduleReads.set(rel, (result.scheduleReads.get(rel) ?? 0) + 1);
            }
          } else {
            result.unresolvedScopes.push({
              file: rel,
              scope: scopeArg?.getText(sourceFile) ?? '<none>',
            });
          }
        } else if (!isTypeOnly && !ts.isImportSpecifier(parent)) {
          result.indirect.add(rel);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return result;
}

function isScannedSource(rel: string): boolean {
  return (
    rel.startsWith(`src${path.sep}`) &&
    /\.tsx?$/.test(rel) &&
    !rel.endsWith('.d.ts') &&
    !rel.split(path.sep).includes('__tests__') &&
    !/\.test\.tsx?$/.test(rel) &&
    rel !== STORE
  );
}

/** The same population, counted from the filesystem, so the scan cannot skip files silently. */
function countSourceFiles(root: string): number {
  let count = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (isScannedSource(path.relative(root, full))) count += 1;
    }
  };
  walk(path.join(root, 'src'));
  return count;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

test('every durable schedule read in src/ is the canonical reader or an allowed, reasoned bypass', () => {
  assert.equal(path.basename(path.join(ROOT, 'src')), 'src');
  const result = scan(ROOT);

  // COVERAGE FIRST. A scan that silently read fewer files returns the same "nothing
  // unexpected" as a clean repo. `tsconfig`'s program must hold every source file the
  // filesystem does, or the result below is about a smaller population than it claims.
  assert.equal(
    result.filesScanned,
    countSourceFiles(ROOT),
    'the type-checked program must cover every non-test source file under src/'
  );

  assert.deepEqual(
    Object.fromEntries([...result.scheduleReads].sort(([a], [b]) => a.localeCompare(b))),
    Object.fromEntries(
      Object.entries(ALLOWED_SCHEDULE_READS)
        .map(([file, { sites }]) => [file, sites] as const)
        .sort(([a], [b]) => a.localeCompare(b))
    ),
    'a durable `schedule` read appeared, moved or disappeared — route it through canonicalScheduleCache.ts, or allow it here WITH A REASON'
  );

  assert.deepEqual(
    [...result.indirect].sort(),
    Object.keys(ALLOWED_INDIRECT_READERS).sort(),
    'a store reader is passed as a value somewhere new; its eventual scope is invisible to this scan'
  );

  // The draft surfaces moved onto the canonical reader in #813 v2/v3. Named, because
  // they are the member-facing bypasses this check exists to keep closed.
  for (const moved of [
    'src/app/league/[slug]/draft/board/boardData.ts',
    'src/app/league/[slug]/draft/page.tsx',
  ]) {
    assert.equal(result.scheduleReads.has(moved), false, `${moved} reads around the boundary`);
  }

  // No unresolved scope EXPRESSION spells `schedule`. Weak by design — see the header —
  // but it catches the obvious regression of a template-built schedule scope. It tests
  // the argument's text, not the file path: the first version matched on the path and
  // flagged `schedulePresentationLease.ts`, whose scopes are `schedule-media` and the
  // venue catalog.
  assert.ok(result.unresolvedScopes.length > 0, 'the unresolved-scope population is non-empty');
  assert.deepEqual(
    result.unresolvedScopes.filter(({ scope }) => /schedule/i.test(scope)),
    [],
    'a runtime-built scope mentions schedule; this scan cannot resolve it'
  );
});
