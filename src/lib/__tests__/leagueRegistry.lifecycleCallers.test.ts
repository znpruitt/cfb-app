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

/** Files whose source contains `needle`, as `src`-relative POSIX-ish paths. */
function filesContaining(needle: string): string[] {
  return SOURCE_FILES.filter((file) => readFileSync(file, 'utf8').includes(needle))
    .map(relativeToSrc)
    .sort();
}

function readSource(relativePath: string): string {
  return readFileSync(join(SRC, relativePath), 'utf8');
}

test('the unguarded updateLeagueStatus has no production caller beyond the test-league controls', () => {
  const callers = filesContaining('updateLeagueStatus(').filter(
    (file) => file !== REGISTRY_MODULE && file !== TEST_LEAGUE_CONTROLS
  );

  assert.deepEqual(
    callers,
    [],
    `updateLeagueStatus must not be called outside the registry and the test-league controls:\n${callers.join('\n')}`
  );
});

test('the test-league controls call updateLeagueStatus only for the test league', () => {
  const text = readSource(TEST_LEAGUE_CONTROLS);
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
    const text = readSource(route);
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
  const text = readSource(join('app', 'api', 'cron', 'season-transition', 'route.ts'));

  assert.ok(text.includes('completeSeasonTransition('), 'guarded transition consumed');
  assert.ok(!text.includes('updateLeagueStatus'), 'no unrestricted lifecycle write remains');
});

test('the commissioner lifecycle actions use their guarded authorities', () => {
  const text = readSource(TEST_LEAGUE_CONTROLS);

  assert.ok(text.includes('beginPreseasonTransition('), 'offseason→preseason is guarded');
  assert.ok(text.includes('completePreseasonSetup('), 'setup completion is guarded');
});

test('no module outside the registry constructs a league record with a lifecycle field', () => {
  // The synchronized `status` + `year` projection lives in exactly one place;
  // any spread that reassigns either field elsewhere would be a second authority.
  const pattern = /\{\s*\.\.\.[A-Za-z_$][\w$]*\s*,[^}]*\b(status|year)\s*:/;
  const offenders = SOURCE_FILES.filter((file) => {
    if (relativeToSrc(file) === REGISTRY_MODULE) return false;
    const text = readFileSync(file, 'utf8');
    if (!text.includes('League')) return false;
    return pattern.test(text);
  }).map(relativeToSrc);

  assert.deepEqual(
    offenders,
    [],
    `lifecycle field synchronization must stay in the registry:\n${offenders.join('\n')}`
  );
});

test('the recovery route exposes only the missing-status initializer', () => {
  const route = join('app', 'api', 'admin', 'lifecycle-recovery', 'route.ts');
  const text = readSource(route);

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
  const callers = SOURCE_FILES.filter((file) => {
    const rel = relativeToSrc(file);
    if (rel === join('app', 'api', 'admin', 'lifecycle-recovery', 'route.ts')) return false;
    return readFileSync(file, 'utf8').includes('/api/admin/lifecycle-recovery');
  }).map(relativeToSrc);

  assert.deepEqual(
    callers,
    [],
    `the recovery API stays dormant until F2H3:\n${callers.join('\n')}`
  );
});

test('the registry module is the only place holding the registry key transaction for leagues', () => {
  const offenders = SOURCE_FILES.filter((file) => {
    if (relativeToSrc(file) === REGISTRY_MODULE) return false;
    const text = readFileSync(file, 'utf8');
    return /withAppStateKeyTransaction\(\s*'leagues'/.test(text);
  }).map(relativeToSrc);

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
