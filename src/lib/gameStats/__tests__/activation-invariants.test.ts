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

// PLATFORM-086H3E3 — the ACTIVATION-INVARIANT guard (replaces the dormant-
// boundary guard; scanner machinery retained).
//
// The dormant era is over: the canonical evidence/ingestion/projection
// authorities are live seams. What this guard now proves, within an HONEST
// STATIC SCOPE (textual scanning + explicit positive assertions — it cannot
// judge semantics; behavioral truth lives in the route/cron/consumer suites):
//
//   1. No live legacy writer remains: `setCachedGameStats` /
//      `writeLegacyGameStatsPartition` exist ONLY inside the gameStats module
//      family (the fenced definition — writable only under `legacy` control,
//      kept for test seeding and pre-activation deploys), and the retired
//      legacy classifier names no longer exist anywhere.
//   2. Route and cron reach ingestion ONLY through the shared orchestration:
//      the durable merge entry points never appear outside the gameStats
//      family, and the route/cron sources positively contain the approved
//      coordinator + interpreter + projector seams.
//   3. No production analytics path aggregates raw persisted rows: raw
//      read/aggregation entry points are restricted to an exact allowlist
//      (the projection-consuming loader, the admin PRESENCE probe, and the
//      justified archive-integrity score cross-check), and the aggregation
//      boundary itself is compile-time (`AnalyticsGameStats`-only, pinned by
//      an expect-error compile regression in ownerStats.test.ts).
//   4. No public wire can carry internal persisted/v2/H2 metadata: app-layer
//      sources never reference the internal metadata names, and the
//      game-stats route never spreads a persisted value into a response.
//   5. No active path references superseded lineage/revision/repair/claims/
//      leases/backoff machinery (the frozen-branch names stay banned).
//   6. Writer-control transitions stay CLI-only: nothing in production src may
//      import `writerControlTransition` or reference its entry points.
//   7. The required live seams are CONNECTED (positive assertions), including
//      auth-before-parsing in the route, the 15-minute `vercel.json` cadence,
//      and the truthful descriptor.

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

function readSource(repoRelative: string): string {
  return readFileSync(path.join(REPO_ROOT, repoRelative), 'utf8');
}

// === Scanner machinery (retained from the dormant-boundary guard) ===

/**
 * One-pass textual mask: comment contents become spaces (offsets preserved);
 * string/template contents are kept so specifiers stay readable. Fail-safe
 * bias — a mis-mask can only cause a false FLAG, never a false allow.
 */
function maskComments(source: string): string {
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
      if (ch === '\\' && next !== undefined && next !== '\n') i += 1;
      else if (ch === closer) state = 'code';
    }
  }
  return out.join('');
}

// Module specifiers in every statically-resolvable import form, incl. the
// template-literal spellings; interpolated templates stay out of scope.
const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"`]([^'"`$]+)['"`]/g;

/** Decode JS string escapes so obfuscated spellings resolve like plain ones. */
function decodeSpecifierEscapes(specifier: string): string {
  try {
    return specifier.replace(
      /\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})|\\(\r\n|[\s\S])/g,
      (
        _whole: string,
        codePoint: string | undefined,
        u4: string | undefined,
        x2: string | undefined,
        single: string | undefined
      ) => {
        if (codePoint !== undefined) return String.fromCodePoint(parseInt(codePoint, 16));
        if (u4 !== undefined) return String.fromCharCode(parseInt(u4, 16));
        if (x2 !== undefined) return String.fromCharCode(parseInt(x2, 16));
        if (single === '\n' || single === '\r' || single === '\r\n') return '';
        return single ?? '';
      }
    );
  } catch {
    return specifier;
  }
}

// The ONLY module nothing in production may import: the writer-control
// transition authority (operator CLI only — production transitions are the
// operator runbook's job, never application code's).
const CLI_ONLY_MODULE_BASENAMES = ['writerControlTransition'];
const CLI_ONLY_MODULE_RESOLVED = new RegExp(
  `^src/lib/gameStats/(${CLI_ONLY_MODULE_BASENAMES.join('|')})(\\.(?:js|mjs|cjs|ts|mts|cts|tsx))?$`
);

/** The CLI-only module basename a specifier resolves to, or null. */
function cliOnlyModuleTarget(specifier: string, importerRepoRelativePath: string): string | null {
  const normalized = decodeSpecifierEscapes(specifier).replace(/\\/g, '/');
  for (const base of CLI_ONLY_MODULE_BASENAMES) {
    if (normalized.includes(`gameStats/${base}`)) return base;
  }
  if (!normalized.startsWith('.')) return null;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(toPosix(importerRepoRelativePath)), normalized)
  );
  const match = CLI_ONLY_MODULE_RESOLVED.exec(resolved);
  return match ? match[1]! : null;
}

// === Rule tables ===

/** Names that must not exist anywhere in production src. */
const BANNED_EVERYWHERE = [
  // Retired legacy ingestion policy (deleted with the legacy writer).
  'classifyGameStatsPayload',
  'expectsGameStats',
  'hasUsableGameStats',
  // Superseded 086H3B lineage/revision/repair + claims/leases/backoff design
  // (frozen-branch names — the door stays shut).
  'revisionLedger',
  'mergeWithLineage',
  'restorationHighWater',
  'irreversibleWitness',
  'writerClaimLease',
  'recoveryBackoff',
  'capabilityGraph',
];

/**
 * Symbols allowed only in an EXACT per-file allowlist — including their own
 * defining files. There is deliberately NO blanket gameStats-family
 * exemption: a brand-new family file gains no privileges.
 */
const RESTRICTED_SYMBOLS: ReadonlyArray<[string, ReadonlySet<string>]> = [
  // Writer entry points: the fenced definition only — no caller anywhere.
  ['setCachedGameStats', new Set(['src/lib/gameStats/cache.ts'])],
  ['writeLegacyGameStatsPartition', new Set(['src/lib/gameStats/cache.ts'])],
  // Durable merge entry points: the definition + the ONE coordinator.
  [
    'mergeGameStatsPartitionDurable',
    new Set(['src/lib/gameStats/durableMerge.ts', 'src/lib/gameStats/ingestionCoordinator.ts']),
  ],
  ['computeWeeklyGameStatsMerge', new Set(['src/lib/gameStats/durableMerge.ts'])],
  // Writer-control transitions: CLI-only — the defining module and nothing else.
  ['transitionWriterControl', new Set(['src/lib/gameStats/writerControlTransition.ts'])],
  ['isAllowedWriterControlTransition', new Set(['src/lib/gameStats/writerControlTransition.ts'])],
  // Raw partition READS: the definitions, the projection-consuming loader, the
  // admin PRESENCE probe, and the justified archive-integrity score
  // cross-check (non-analytics).
  [
    'getCachedGameStats',
    new Set([
      'src/lib/gameStats/cache.ts',
      'src/lib/insights/context.ts',
      'src/app/api/debug/archive-integrity/route.ts',
    ]),
  ],
  [
    'listCachedGameStatsWeeks',
    new Set([
      'src/lib/gameStats/cache.ts',
      'src/lib/insights/context.ts',
      'src/app/api/debug/archive-integrity/route.ts',
    ]),
  ],
  [
    'listCachedGameStats',
    new Set([
      'src/lib/gameStats/cache.ts',
      'src/lib/server/providerCacheState.ts',
      'src/app/api/debug/archive-integrity/route.ts',
    ]),
  ],
  [
    'usableGameStatsGameIds',
    new Set(['src/lib/gameStats/coverage.ts', 'src/lib/server/providerCacheState.ts']),
  ],
  // Owner aggregation: the definition + the projection-consuming loader.
  [
    'aggregateOwnerSeasonStats',
    new Set(['src/lib/gameStats/ownerStats.ts', 'src/lib/insights/context.ts']),
  ],
];

/**
 * Internal persisted/v2/H2 metadata names that must never appear in the app
 * layer (route/page sources) — the wire is projector-only. The lib layer
 * legitimately defines and validates them.
 */
const APP_LAYER_BANNED = ['schemaVersion', 'pointsProvided', 'observationFence', 'rowAcceptance'];

/**
 * The route may spread ONLY these expressions into a response body. Every
 * other `...expr` — whatever it is named — is treated as a potential
 * persisted-value wire leak (renames cannot launder it).
 */
const ROUTE_SPREAD_ALLOWLIST = new Set(['projection.wire', 'extra']);
const SPREAD_PATTERN = /\.\.\.\s*([A-Za-z_$][\w$.]*)/g;

const ROUTE_FILE = 'src/app/api/game-stats/route.ts';
const CRON_FILE = 'src/app/api/cron/game-stats/route.ts';

/** Required (positively asserted) seams per file. */
const CONNECTED_SEAMS: ReadonlyArray<[string, string[]]> = [
  [
    ROUTE_FILE,
    [
      'requireAdminRequest',
      'ingestGameStatsPartitionResponse',
      'interpretGameStatsRefreshOutcome',
      'projectPublicPartition',
      'evaluateManualQuota',
      'weekPartitionScope',
      'beginProviderRefreshAttempt',
    ],
  ],
  [
    CRON_FILE,
    [
      'CRON_SECRET',
      'isAutoRefreshAllowed',
      'listKickoffWindowPartitions',
      'selectPollingTarget',
      'evaluateAutomationQuota',
      'ingestGameStatsPartitionResponse',
      'interpretGameStatsRefreshOutcome',
      'weekPartitionScope',
      'projectPublicPartition',
    ],
  ],
  [
    'src/lib/insights/context.ts',
    [
      'projectAnalyticsPartition',
      'assembleLiveAnalyticsProvenance',
      'assembleArchiveAnalyticsProvenance',
      'aggregateOwnerSeasonStats',
    ],
  ],
  ['src/lib/selectors/historySelectors.ts', ["kind: 'archive'"]],
  [
    'src/lib/server/providerDataDiagnostics.ts',
    ['evaluatePartitionCoverage', 'validateGameStatsEnvelope', 'loadCanonicalGameStatsSlate'],
  ],
  ['src/lib/seasonRollover.ts', ['buildGameStatSlateSnapshot', 'assembleSeasonScoredBuild']],
];

type Violation = { file: string; pattern: string; line: number };

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function symbolPattern(names: readonly string[]): RegExp {
  return new RegExp(`\\b(${names.join('|')})\\b`, 'g');
}

/** Pure scan of one production source for activation-invariant violations. */
function findActivationViolations(source: string, repoRelativePath: string): Violation[] {
  const violations: Violation[] = [];

  for (const match of source.matchAll(symbolPattern(BANNED_EVERYWHERE))) {
    violations.push({
      file: repoRelativePath,
      pattern: `banned symbol "${match[1]}"`,
      line: lineOf(source, match.index),
    });
  }

  for (const [symbol, allowed] of RESTRICTED_SYMBOLS) {
    if (allowed.has(repoRelativePath)) continue;
    for (const match of source.matchAll(symbolPattern([symbol]))) {
      // Longest-match protection: `listCachedGameStats` must not claim a
      // `listCachedGameStatsWeeks` occurrence.
      const after = source[match.index + symbol.length];
      if (after !== undefined && /[\w$]/.test(after)) continue;
      violations.push({
        file: repoRelativePath,
        pattern: `restricted symbol "${symbol}" outside its allowlist`,
        line: lineOf(source, match.index),
      });
    }
  }

  if (repoRelativePath.startsWith('src/app/')) {
    for (const match of source.matchAll(symbolPattern(APP_LAYER_BANNED))) {
      violations.push({
        file: repoRelativePath,
        pattern: `internal metadata name "${match[1]}" in the app layer`,
        line: lineOf(source, match.index),
      });
    }
  }

  // CLI-only module imports and route spreads scan a comments-masked copy so
  // comments can neither hide nor satisfy anything; escapes decode before
  // module resolution.
  const specifierScan = maskComments(source);

  if (repoRelativePath === ROUTE_FILE) {
    // A parenthesized spread (`...(anything)`) is a direct textual laundering
    // form — banned outright; the route is written without conditional spreads.
    for (const match of specifierScan.matchAll(/\.\.\.\s*\(/g)) {
      violations.push({
        file: repoRelativePath,
        pattern: 'parenthesized spread "...(…)" in the route',
        line: lineOf(source, match.index),
      });
    }
    for (const match of specifierScan.matchAll(SPREAD_PATTERN)) {
      if (ROUTE_SPREAD_ALLOWLIST.has(match[1]!)) continue;
      violations.push({
        file: repoRelativePath,
        pattern: `non-allowlisted spread "...${match[1]}" in the route wire`,
        line: lineOf(source, match.index),
      });
    }
  }
  for (const match of specifierScan.matchAll(SPECIFIER_PATTERN)) {
    const target = cliOnlyModuleTarget(match[1]!, repoRelativePath);
    if (target === null) continue;
    violations.push({
      file: repoRelativePath,
      pattern: `CLI-only module import "${match[1]}"`,
      line: lineOf(source, match.index),
    });
  }

  return violations;
}

// === The guard itself ===

test('activation invariants hold across every production source', () => {
  const files = listProductionSources();
  assert.ok(files.length > 100, `expected a full production scan, saw ${files.length} files`);

  const violations = files.flatMap((file) => findActivationViolations(readSource(file), file));
  assert.deepEqual(
    violations,
    [],
    `activation invariants violated:\n${violations
      .map((v) => `  ${v.file}:${v.line} — ${v.pattern}`)
      .join('\n')}`
  );
});

/** Auth-order predicate over a comments-MASKED source (comments cannot spoof). */
function authPrecedesParsing(maskedSource: string): boolean {
  const auth = maskedSource.indexOf('requireAdminRequest(');
  const parse = maskedSource.indexOf('searchParams');
  return auth !== -1 && parse !== -1 && auth < parse;
}

test('required live seams are CONNECTED (in code, not comments)', () => {
  for (const [file, seams] of CONNECTED_SEAMS) {
    const masked = maskComments(readSource(file));
    for (const seam of seams) {
      assert.ok(masked.includes(seam), `${file} must contain the "${seam}" seam`);
    }
  }
});

test('the route authenticates BEFORE parsing the query', () => {
  assert.ok(authPrecedesParsing(maskComments(readSource(ROUTE_FILE))));
});

test('vercel.json schedules the game-stats cron every 15 minutes', () => {
  const config = JSON.parse(readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8')) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };
  const cron = (config.crons ?? []).find((c) => c.path === '/api/cron/game-stats');
  assert.ok(cron, 'game-stats cron entry present');
  assert.equal(cron!.schedule, '*/15 * * * *');
});

test('the provider descriptor describes the active cadence truthfully', () => {
  const source = readSource('src/lib/providerDatasets.ts');
  assert.ok(source.includes('Every 15 minutes'), 'descriptor names the 15-minute cadence');
  assert.ok(!source.includes('Mondays 11:00 UTC'), 'stale weekly wording removed');
});

// === Guard self-tests: prove the scanner detects representative violations ===

test('scanner: legacy-writer and raw-consumer laundering flags outside the family', () => {
  const cases: Array<[string, string]> = [
    [`await setCachedGameStats(result);`, 'setCachedGameStats'],
    [`await writeLegacyGameStatsPartition(stats);`, 'writeLegacyGameStatsPartition'],
    [`const m = await mergeGameStatsPartitionDurable(input);`, 'mergeGameStatsPartitionDurable'],
    [`const c = computeWeeklyGameStatsMerge(existing, input);`, 'computeWeeklyGameStatsMerge'],
    [`const t = await transitionWriterControl(request);`, 'transitionWriterControl'],
    [`const rows = await listCachedGameStats(year);`, 'listCachedGameStats'],
    [
      `const agg = aggregateOwnerSeasonStats(weekly, roster, resolver, y);`,
      'aggregateOwnerSeasonStats',
    ],
  ];
  for (const [source, symbol] of cases) {
    const violations = findActivationViolations(source, 'src/lib/example.ts');
    assert.ok(
      violations.some((v) => v.pattern.includes(symbol)),
      source
    );
  }
});

test('scanner: allowlisted files stay clean; the allowlists are EXACT, not family-wide', () => {
  // The presence probe may use its restricted reads…
  assert.deepEqual(
    findActivationViolations(
      `const rows = await listCachedGameStats(year); usableGameStatsGameIds(rows[0]);`,
      'src/lib/server/providerCacheState.ts'
    ),
    []
  );
  // …the loader may read + aggregate…
  assert.deepEqual(
    findActivationViolations(
      `const s = await getCachedGameStats(y, w, t); aggregateOwnerSeasonStats(rows, r, res, y);`,
      'src/lib/insights/context.ts'
    ),
    []
  );
  // …the ONE coordinator may call the durable merge…
  assert.deepEqual(
    findActivationViolations(
      `const m = await mergeGameStatsPartitionDurable(input);`,
      'src/lib/gameStats/ingestionCoordinator.ts'
    ),
    []
  );
  // …but a BRAND-NEW gameStats-family file gains no privileges at all.
  for (const source of [
    `await setCachedGameStats(result);`,
    `const m = await mergeGameStatsPartitionDurable(input);`,
    `const rows = await listCachedGameStats(year);`,
    `const agg = aggregateOwnerSeasonStats(weekly, roster, resolver, y);`,
  ]) {
    assert.ok(
      findActivationViolations(source, 'src/lib/gameStats/rogue.ts').length >= 1,
      `a new family file must not launder: ${source}`
    );
  }
  // Longest-match protection: Weeks-listing in an allowed file never
  // false-flags the shorter name.
  assert.deepEqual(
    findActivationViolations(
      `const keys = await listCachedGameStatsWeeks(year);`,
      'src/lib/insights/context.ts'
    ),
    []
  );
});

test('scanner: retired and superseded names are banned everywhere, even in the family', () => {
  for (const source of [
    `const c = classifyGameStatsPayload(raw, week, seasonType);`,
    `if (expectsGameStats(status)) {}`,
    `if (hasUsableGameStats(record)) {}`,
    `const l = revisionLedger.append(entry);`,
    `const w = irreversibleWitness(state);`,
  ]) {
    assert.ok(
      findActivationViolations(source, 'src/lib/gameStats/ingestionCoordinator.ts').length >= 1,
      source
    );
  }
});

test('scanner: app-layer internal metadata and route spreads flag', () => {
  assert.ok(
    findActivationViolations(`const v = row.schemaVersion;`, 'src/app/league/page.tsx').length >= 1
  );
  assert.ok(
    findActivationViolations(`team.pointsProvided = true;`, 'src/app/api/foo/route.ts').length >= 1
  );
  assert.deepEqual(
    // The lib layer legitimately validates these names.
    findActivationViolations(`const v = row.schemaVersion;`, 'src/lib/gameStats/contract.ts'),
    []
  );
  // The spread rule is allowlist-based — renames cannot launder a wire leak —
  // and parenthesization is banned outright, so `...(cached)` cannot slip by.
  for (const source of [
    `return NextResponse.json({ ...cached, meta });`,
    `return NextResponse.json({ ...read.value });`,
    `return NextResponse.json({ ...anythingRenamed });`,
    `return NextResponse.json({ ...(cached) });`,
    `return NextResponse.json({ ...(read.value) });`,
  ]) {
    assert.ok(
      findActivationViolations(source, ROUTE_FILE).some((v) => v.pattern.includes('spread')),
      source
    );
  }
  assert.deepEqual(
    findActivationViolations(`return NextResponse.json({ ...projection.wire, meta });`, ROUTE_FILE),
    []
  );
});

test('scanner: a comment cannot spoof the auth-before-parsing order', () => {
  const spoofed = [
    `// requireAdminRequest( comes first in this comment`,
    `const url = new URL(req.url); url.searchParams.get('year');`,
    `const failure = await requireAdminRequest(req);`,
  ].join('\n');
  assert.equal(authPrecedesParsing(maskComments(spoofed)), false);
  const genuine = [
    `const failure = await requireAdminRequest(req);`,
    `const url = new URL(req.url); url.searchParams.get('year');`,
  ].join('\n');
  assert.equal(authPrecedesParsing(maskComments(genuine)), true);
});

test('scanner: CLI-only module imports flag in every statically-resolvable form', () => {
  const importer = 'src/lib/example.ts';
  const flagged = [
    `import { transitionWriterControl } from '../gameStats/writerControlTransition';`,
    `const m = await import('@/lib/gameStats/writerControlTransition');`,
    `const m = require('../gameStats/writerControlTransition.ts');`,
    `export * from '../gameStats/writerControlTransition';`,
    'const m = await import(`../gameStats/writerControlTransition`);',
    `import * as w from /* hidden */ '../gameStats/writerControlTransition';`,
    String.raw`import '../gameStats/writerControlTransition';`,
  ];
  for (const source of flagged) {
    assert.ok(
      findActivationViolations(source, importer).some((v) =>
        v.pattern.includes('CLI-only module import')
      ),
      source
    );
  }
  // An unrelated module named similarly elsewhere never matches.
  assert.deepEqual(
    findActivationViolations(
      `import { x } from './writerControlTransition';`,
      'src/lib/billing/index.ts'
    ),
    []
  );
});

// === Behavioral writer assertions (fence still holds pre-activation) ===

test('the fenced legacy writer path cannot produce v2 rows', () => {
  const row = legacyRowFromWire(wireGame());
  assert.equal('schemaVersion' in row, false);
  assert.equal('pointsProvided' in row.home, false);
  assert.equal('pointsProvided' in row.away, false);
});

test('the fenced writer persists legacy rows without v2 metadata', async () => {
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
