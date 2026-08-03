import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1 — deterministic lifecycle-authority guard.
//
// Proves by source scan that lifecycle writes stay centralized in
// `src/lib/leagueRegistry.ts` and that every PRODUCTION transition goes through
// a GUARDED operation:
//
//   - the unguarded `updateLeagueStatus` has exactly one non-registry caller —
//     the test league's own lifecycle controls, which deliberately set an
//     arbitrary state and are excluded from global lifecycle policy;
//   - season rollover was NOT rerouted through an unrestricted mutation by this
//     slice: both rollover callers still use the exact-year guarded
//     `completeSeasonRollover`;
//   - the season-transition cron and the two commissioner lifecycle actions use
//     their guarded authorities;
//   - no module outside the registry writes `status`/`year` onto a league
//     record itself (the synchronization projection lives in exactly one place).
//
// Test files are excluded — the lifecycle suites legitimately name every
// authority they assert against.
// ---------------------------------------------------------------------------

const SRC = join(process.cwd(), 'src');
const REGISTRY_MODULE = join('lib', 'leagueRegistry.ts');
/** The test league's independent lifecycle controls (see `AGENTS.md` → rollover targeting). */
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

const SOURCE_FILES = collectSourceFiles(SRC);

function relativeToSrc(file: string): string {
  return relative(SRC, file);
}

/**
 * Strip block and line comments so a doc comment that merely NAMES an authority
 * cannot trip (or satisfy) a scan — the exact false positive this module would
 * otherwise produce, since the codebase documents these authorities heavily
 * (F2H review). Crude but sufficient: the sources are ordinary TS/TSX and no
 * string literal in them contains a comment opener.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/**
 * Every production source read and comment-stripped ONCE (F2H review — the
 * scans below previously re-read and re-stripped the whole tree five times).
 * `code` is what every scan keys on; only the recovery-route inspection uses
 * raw text, and it does so deliberately.
 */
const SOURCE_CODE: ReadonlyMap<string, string> = new Map(
  SOURCE_FILES.map((file) => [relativeToSrc(file), stripComments(readFileSync(file, 'utf8'))])
);

/** Files whose CODE (comments stripped) contains `needle`. */
function filesContaining(needle: string): string[] {
  return [...SOURCE_CODE.entries()]
    .filter(([, code]) => code.includes(needle))
    .map(([file]) => file)
    .sort();
}

function codeOf(relativePath: string): string {
  const code = SOURCE_CODE.get(relativePath);
  assert.ok(code !== undefined, `${relativePath} was scanned`);
  return code;
}

/**
 * Files that IMPORT `name` from the league registry, however it is bound —
 * `{ name }`, `{ name as alias }`, or across a multi-line import list. Import
 * binding is what a scan must key on: matching only `name(` call syntax is
 * defeated by a single `import { updateLeagueStatus as setStatus }` (raised at
 * F2H1 review), which is exactly how the invariant would be reintroduced.
 */
function filesImportingFromRegistry(name: string): string[] {
  const importRe = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
  return [...SOURCE_CODE.entries()]
    .filter(([, text]) => {
      for (const match of text.matchAll(importRe)) {
        const [, bindings = '', source = ''] = match;
        if (!/leagueRegistry/.test(source)) continue;
        const imported = bindings
          .split(',')
          .map((binding) =>
            binding
              .trim()
              .split(/\s+as\s+/)[0]
              ?.trim()
          )
          .filter(Boolean);
        if (imported.includes(name)) return true;
      }
      return false;
    })
    .map(([file]) => file)
    .sort();
}

test('the unguarded updateLeagueStatus has no production caller beyond the test-league controls', () => {
  // Call-syntax scan (catches a same-module call) …
  const callers = filesContaining('updateLeagueStatus(').filter(
    (file) => file !== REGISTRY_MODULE && file !== TEST_LEAGUE_CONTROLS
  );
  assert.deepEqual(
    callers,
    [],
    `updateLeagueStatus must not be called outside the registry and the test-league controls:\n${callers.join('\n')}`
  );

  // … and an IMPORT-BINDING scan, which an alias cannot evade.
  const importers = filesImportingFromRegistry('updateLeagueStatus').filter(
    (file) => file !== REGISTRY_MODULE && file !== TEST_LEAGUE_CONTROLS
  );
  assert.deepEqual(
    importers,
    [],
    `updateLeagueStatus must not be imported (aliased or otherwise) outside the allowlist:\n${importers.join('\n')}`
  );
});

test('the import-binding scan actually detects an aliased import', () => {
  // Guards the guard: proves the binding parser sees `as`-aliased and
  // multi-line import lists, so the assertion above is not vacuous.
  const parsed = (source: string): string[] => {
    const importRe = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
    const found: string[] = [];
    for (const match of stripComments(source).matchAll(importRe)) {
      const [, bindings = '', from = ''] = match;
      if (!/leagueRegistry/.test(from)) continue;
      for (const binding of bindings.split(',')) {
        const name = binding
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (name) found.push(name);
      }
    }
    return found;
  };

  assert.ok(
    parsed(`import { updateLeagueStatus as setStatus } from '@/lib/leagueRegistry';`).includes(
      'updateLeagueStatus'
    ),
    'an aliased import is detected'
  );
  assert.ok(
    parsed(
      `import {\n  getLeague,\n  updateLeagueStatus,\n} from '@/lib/leagueRegistry';`
    ).includes('updateLeagueStatus'),
    'a multi-line import list is detected'
  );
  assert.ok(
    !parsed(`// updateLeagueStatus(slug, status) is the unguarded authority\n`).includes(
      'updateLeagueStatus'
    ),
    'a comment mentioning the symbol is not a violation'
  );
  assert.ok(
    !parsed(`import { updateLeagueStatus } from './someOtherModule';`).includes(
      'updateLeagueStatus'
    ),
    'only registry imports are considered'
  );
});

test('the test-league controls call updateLeagueStatus only for the test league', () => {
  const text = codeOf(TEST_LEAGUE_CONTROLS);
  const calls = text.match(/updateLeagueStatus\(\s*[^,)]+/g) ?? [];

  assert.ok(calls.length > 0, 'the test-league controls still set the test league lifecycle');
  for (const call of calls) {
    assert.match(
      call,
      /updateLeagueStatus\(\s*'test'/,
      `every unguarded lifecycle write names the test league literally: ${call}`
    );
  }
});

test('both rollover callers still use the exact-year guarded completeSeasonRollover', () => {
  for (const route of [
    join('app', 'api', 'admin', 'rollover', 'route.ts'),
    join('app', 'api', 'cron', 'season-rollover', 'route.ts'),
  ]) {
    // Comment-stripped: this codebase documents these authorities heavily, and a
    // doc comment naming one is not a call (F2H review).
    const text = codeOf(route);
    assert.ok(
      text.includes('completeSeasonRollover('),
      `${route}: rollover still goes through the guarded transition`
    );
    assert.ok(
      !text.includes('updateLeagueStatus'),
      `${route}: rollover was not rerouted through an unrestricted mutation`
    );
    assert.ok(
      text.includes('groupRolloverTargets'),
      `${route}: rollover still uses the shared target-selection policy`
    );
    assert.ok(
      text.includes('resolveNationalChampionshipRollover'),
      `${route}: rollover still executes behind the strict eligibility authority`
    );
  }
});

test('the season-transition cron uses the guarded preseason→season authority', () => {
  const text = codeOf(join('app', 'api', 'cron', 'season-transition', 'route.ts'));

  assert.ok(text.includes('completeSeasonTransition('), 'guarded transition consumed');
  assert.ok(!text.includes('updateLeagueStatus'), 'no unrestricted lifecycle write remains');
});

test('the commissioner lifecycle actions use their guarded authorities', () => {
  const text = codeOf(TEST_LEAGUE_CONTROLS);

  assert.ok(text.includes('beginPreseasonTransition('), 'offseason→preseason is guarded');
  assert.ok(text.includes('completePreseasonSetup('), 'setup completion is guarded');
});

test('no module outside the registry spreads a LEAGUE record and rewrites a lifecycle field', () => {
  // The synchronized `status` + `year` projection lives in exactly one place.
  //
  // Scope note (F2H review): the earlier form keyed on any file whose text
  // merely contained "League" plus any spread setting `year:`/`status:`, which
  // false-positives on unrelated records that legitimately carry a `year`
  // (schedule probe state, health view models, React action state). Guessing at
  // identifier NAMES fares no better — `{ ...prev, [key]: { status } }` in an
  // admin component is not a lifecycle write. So the scan is scoped
  // SEMANTICALLY: only files that actually import the league record type or the
  // registry can be constructing a league. It stays a tripwire for the obvious
  // reintroduction, not a proof — `const n = {...league}; n.year = y;` is out of
  // a regex's reach, which is why the import-binding scan above is the primary
  // enforcement.
  const pattern = /\{\s*\.\.\.[A-Za-z_$][\w$]*\s*,[^}]*\b(status|year)\s*:/;
  const offenders = [...SOURCE_CODE.entries()]
    .filter(([file, code]) => {
      if (file === REGISTRY_MODULE) return false;
      if (!/from\s*['"][^'"]*(?:lib\/league|\.\/league|leagueRegistry)(?:\.ts)?['"]/.test(code)) {
        return false;
      }
      return pattern.test(code);
    })
    .map(([file]) => file);

  assert.deepEqual(
    offenders,
    [],
    `lifecycle field synchronization must stay in the registry:\n${offenders.join('\n')}`
  );
});

test('the lifecycle-field scan detects the pattern it claims to guard', () => {
  // Guards the guard on BOTH axes: the pattern still matches a reintroduced
  // projection (the registry itself is excluded by path, not because the scan is
  // inert), and the import scope excludes a file that never touches leagues.
  const pattern = /\{\s*\.\.\.[A-Za-z_$][\w$]*\s*,[^}]*\b(status|year)\s*:/;
  const importScope = /from\s*['"][^'"]*(?:lib\/league|\.\/league|leagueRegistry)(?:\.ts)?['"]/;

  assert.ok(pattern.test(codeOf(REGISTRY_MODULE)), 'the registry projection still matches');
  assert.ok(importScope.test(codeOf(REGISTRY_MODULE)), 'the registry is in the import scope');
  assert.ok(
    pattern.test('const next: League = { ...current, status, year: status.year };'),
    'a reintroduced projection matches'
  );
  assert.ok(
    !importScope.test(`import { useState } from 'react';`),
    'a module that never imports a league record is out of scope'
  );
});

test('the recovery route exposes only the missing-status initializer', () => {
  const route = join('app', 'api', 'admin', 'lifecycle-recovery', 'route.ts');
  const text = codeOf(route);

  assert.ok(text.includes('initializeMissingLifecycleStatus('), 'the one recovery authority');
  for (const forbidden of [
    'updateLeagueStatus',
    'completeSeasonRollover',
    'completeSeasonTransition',
    'beginPreseasonTransition',
    'completePreseasonSetup',
  ]) {
    assert.ok(!text.includes(forbidden), `${route}: must not expose ${forbidden}`);
  }
  assert.ok(
    !/export\s+async\s+function\s+GET/.test(text),
    `${route}: there is deliberately no GET route`
  );
});

test('no UI or server action invokes the dormant recovery API in F2H1', () => {
  const routeFile = join('app', 'api', 'admin', 'lifecycle-recovery', 'route.ts');
  const callers = [...SOURCE_CODE.entries()]
    .filter(([file, code]) => file !== routeFile && code.includes('/api/admin/lifecycle-recovery'))
    .map(([file]) => file);

  assert.deepEqual(
    callers,
    [],
    `the recovery API stays dormant until F2H3:\n${callers.join('\n')}`
  );
});

test('the registry module is the only place holding the registry key transaction for leagues', () => {
  const offenders = [...SOURCE_CODE.entries()]
    .filter(
      ([file, code]) =>
        file !== REGISTRY_MODULE && /withAppStateKeyTransaction\(\s*'leagues'/.test(code)
    )
    .map(([file]) => file);

  assert.deepEqual(offenders, [], `registry writes stay centralized:\n${offenders.join('\n')}`);
});

test('the scan actually inspected the lifecycle sources it claims to guard', () => {
  // Guards the guard: a path typo or a moved module would otherwise make every
  // assertion above vacuously pass.
  for (const expected of [
    REGISTRY_MODULE,
    TEST_LEAGUE_CONTROLS,
    join('app', 'api', 'cron', 'season-transition', 'route.ts'),
    join('app', 'api', 'cron', 'season-rollover', 'route.ts'),
    join('app', 'api', 'admin', 'rollover', 'route.ts'),
    join('app', 'api', 'admin', 'lifecycle-recovery', 'route.ts'),
  ]) {
    assert.ok(
      SOURCE_FILES.some((file) => relativeToSrc(file) === expected),
      `${expected.split(sep).join('/')} was scanned`
    );
  }
});
