import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  buildEvidence,
  checkCapturePathOutsideRepo,
  describeApplyOutcome,
  parseCaptureFile,
  parseRecoveryArgs,
  recordRecoveryAttemptOutcome,
  renderEvidence,
} from '../../../../scripts/recover-game-stats.ts';
import { getCachedGameStats } from '../cache.ts';
import { ingestGameStatsPartitionResponse } from '../ingestionCoordinator.ts';
import { interpretGameStatsRefreshOutcome } from '../refreshOutcome.ts';
import type { GameStats } from '../types.ts';
import {
  __deleteAppStateFileForTests,
  __resetAppStateForTests,
  __setAppStateKeyLockFailureForTests,
  __setAppStateWriteFailureForTests,
} from '../../server/appStateStore.ts';
import { weekPartitionScope } from '../../providerRefreshScope.ts';
import {
  beginProviderRefreshAttempt,
  getProviderRefreshStatus,
} from '../../server/providerRefreshStatus.ts';
import { seedActiveWriterControl, seedWriterControlState } from './writerControlSeed.ts';
import { wireGame } from './fixtures.ts';

test.beforeEach(async () => {
  await __deleteAppStateFileForTests();
  __resetAppStateForTests();
  await seedActiveWriterControl();
});

const BASE = { year: 2026, week: 1, seasonType: 'regular' as const };
const T1 = '2026-09-08T04:45:06.949Z';
const T2 = '2026-09-09T04:45:06.949Z';
const T0 = '2026-08-30T06:00:14.291Z';

/** A wire game with per-side stat overrides, built from the observed fixture. */
function game(
  id: number,
  overrides: { home?: Record<string, string>; away?: Record<string, string> } = {}
) {
  return wireGame({
    id,
    home: { statOverrides: overrides.home ?? {} },
    away: { statOverrides: overrides.away ?? {} },
  });
}

function ingest(
  payload: unknown,
  fetchStartedAt: string,
  restrictToProviderGameIds?: ReadonlySet<number>
) {
  return restrictToProviderGameIds === undefined
    ? ingestGameStatsPartitionResponse({ ...BASE, fetchStartedAt, payload })
    : ingestGameStatsPartitionResponse({
        ...BASE,
        fetchStartedAt,
        payload,
        restrictToProviderGameIds,
      });
}

async function readPartition() {
  return getCachedGameStats(BASE.year, BASE.week, BASE.seasonType);
}

function rowById(partition: { games: GameStats[] } | null, id: number): GameStats {
  const row = partition?.games.find((g) => g.providerGameId === id);
  assert.ok(row, `expected a stored row for ${id}`);
  return row;
}

// === Bounding: the path cannot run unbounded ===

test('capture mode REFUSES an absent --game-ids: there is no "recover whatever needs it"', () => {
  const parsed = parseRecoveryArgs([
    'capture',
    '--year',
    '2026',
    '--week',
    '1',
    '--season-type',
    'regular',
    '--out',
    '/tmp/x.json',
  ]);
  assert.deepEqual(parsed, { error: '--game-ids is required' });
});

test('capture mode REFUSES an empty or malformed --game-ids rather than widening', () => {
  const base = ['capture', '--year', '2026', '--week', '1', '--season-type', 'regular'];
  const out = ['--out', '/tmp/x.json'];
  for (const ids of ['', ',', '401868170,', 'all', '0', '-1', '1.5']) {
    const parsed = parseRecoveryArgs([...base, '--game-ids', ids, ...out]);
    assert.ok('error' in parsed, `expected a refusal for --game-ids ${JSON.stringify(ids)}`);
  }
});

test('capture mode parses an explicit set, sorted and deduplicated', () => {
  const parsed = parseRecoveryArgs([
    'capture',
    '--year',
    '2026',
    '--week',
    '1',
    '--season-type',
    'regular',
    '--game-ids',
    '401868170,401856661,401868170',
    '--out',
    '/tmp/x.json',
  ]);
  assert.ok(!('error' in parsed) && parsed.mode === 'capture');
  assert.deepEqual(parsed.gameIds, [401856661, 401868170]);
});

test('--apply is refused in capture mode: a capture never writes', () => {
  const parsed = parseRecoveryArgs([
    'capture',
    '--year',
    '2026',
    '--week',
    '1',
    '--season-type',
    'regular',
    '--game-ids',
    '401868170',
    '--out',
    '/tmp/x.json',
    '--apply',
  ]);
  assert.ok('error' in parsed);
});

test('apply mode requires an explicit capture and rejects stray arguments', () => {
  assert.deepEqual(parseRecoveryArgs(['apply']), {
    error: '--capture is required in apply mode',
  });
  assert.ok('error' in parseRecoveryArgs(['apply', '--capture', '/tmp/c.json', '--year', '2026']));
  const ok = parseRecoveryArgs(['apply', '--capture', '/tmp/c.json', '--apply']);
  assert.deepEqual(ok, { mode: 'apply', capture: '/tmp/c.json', apply: true });
});

test('a capture path inside the repository is refused; outside is allowed', () => {
  const repoRoot = path.resolve('/repo');
  const identity = (p: string) => p;
  for (const inside of [
    '/repo',
    '/repo/capture.json',
    '/repo/src/nested/capture.json',
    '/repo/../repo/x.json',
    // A case-insensitive filesystem (default macOS) reaches the same directory.
    '/REPO/capture.json',
  ]) {
    const result = checkCapturePathOutsideRepo(inside, repoRoot, identity);
    assert.ok(result !== null, `expected ${inside} to be refused`);
    assert.match(result.error, /inside the repository/);
  }
  assert.equal(checkCapturePathOutsideRepo('/elsewhere/capture.json', repoRoot, identity), null);
  assert.equal(checkCapturePathOutsideRepo('/repo-sibling/capture.json', repoRoot, identity), null);
});

test('a symlink pointing back into the repository is refused, not just a lexical match', () => {
  const repoRoot = path.resolve('/repo');
  // `/outside/link` is a symlink whose real target is inside the tree — the
  // lexical check passes and `writeFileSync` still lands the payload in git.
  const realpath = (p: string) => (p === '/outside/link' ? '/repo/sneaky' : p);
  const result = checkCapturePathOutsideRepo('/outside/link/capture.json', repoRoot, realpath);
  assert.ok(result !== null, 'a symlinked path into the repo must be refused');
  assert.match(result.error, /inside the repository/);
});

// === The bound is honored against the real durable authority ===

test('a bounded recovery rewrites ONLY the named games; every other stored row is byte-identical', async () => {
  const seed = await ingest([game(401868170), game(401858212), game(401868967)], T1);
  assert.equal(seed.kind, 'merge-result');
  const before = await readPartition();
  assert.equal(before!.games.length, 3);
  const untouchedBefore = [rowById(before, 401858212), rowById(before, 401868967)];

  // The whole partition is re-observed with NEW values for all three games —
  // exactly what a partition-granular provider endpoint returns — but the
  // recovery is bounded to one.
  const result = await ingest(
    [
      game(401868170, { home: { totalYards: '513' }, away: { totalYards: '117' } }),
      game(401858212, { home: { totalYards: '324' } }),
      game(401868967, { home: { totalYards: '398' } }),
    ],
    T2,
    new Set([401868170])
  );
  assert.equal(result.kind, 'merge-result');
  assert.ok(result.kind === 'merge-result');
  assert.equal(result.merge.outcome, 'written');
  assert.deepEqual(result.merge.updated, [401868170]);
  assert.deepEqual(result.merge.retainedExisting, [401858212, 401868967]);
  assert.deepEqual(result.diagnostics.restriction?.requestedProviderGameIds, [401868170]);
  assert.deepEqual(result.diagnostics.restriction?.matchedProviderGameIds, [401868170]);
  assert.equal(result.diagnostics.restriction?.responseRowCount, 3);
  assert.equal(result.diagnostics.restriction?.excludedParsedRowCount, 2);

  const after = await readPartition();
  assert.equal(rowById(after, 401868170).home.totalYards, 513);
  assert.equal(rowById(after, 401868170).fetchStartedAt, T2);
  // The two excluded games are unchanged DOWN TO THE FENCE — a widened write
  // would have advanced them even where content matched.
  assert.deepEqual(rowById(after, 401858212), untouchedBefore[0]);
  assert.deepEqual(rowById(after, 401868967), untouchedBefore[1]);
  assert.equal(rowById(after, 401858212).fetchStartedAt, T1);
});

test('an empty restriction is REFUSED, never read as "no restriction"', async () => {
  await ingest([game(401868170)], T1);
  const before = await readPartition();

  __setAppStateWriteFailureForTests(new Error('no write expected'), 'game-stats');
  const result = await ingest([game(401868170, { home: { totalYards: '999' } })], T2, new Set());
  __setAppStateWriteFailureForTests(null);

  assert.deepEqual(result, { kind: 'rejected', reason: 'empty-restriction' });
  assert.deepEqual(await readPartition(), before);
});

test('a restriction naming an invalid provider game id says SO, not "empty"', async () => {
  const result = await ingest([game(401868170)], T1, new Set([0, 401868170]));
  // The operator typed a nonempty set; reporting `empty-restriction` would
  // contradict the command they just ran.
  assert.deepEqual(result, { kind: 'rejected', reason: 'invalid-restriction-id' });
  assert.equal(interpretGameStatsRefreshOutcome(result).kind, 'failure');
  assert.equal(await readPartition(), null);
});

test('an EMPTY response under a restriction is a failure, never a successful no-op', async () => {
  await ingest([game(401868170)], T1);
  const before = await readPartition();

  const result = await ingest([], T2, new Set([401868170]));
  assert.deepEqual(result, { kind: 'rejected', reason: 'restriction-matched-nothing' });
  const interpretation = interpretGameStatsRefreshOutcome(result);
  assert.equal(interpretation.kind, 'failure');
  assert.notEqual(interpretation.reason, 'empty-response');
  assert.deepEqual(await readPartition(), before);

  // The unrestricted empty response is still the valid no-op it always was.
  const unrestricted = await ingest([], T2);
  assert.deepEqual(unrestricted, { kind: 'no-op', reason: 'empty-response' });
});

test('a PARTIALLY matched restriction commits what it found but never reports clean', async () => {
  await ingest([game(401868170), game(401858212)], T1);

  const result = await ingest(
    [game(401868170, { home: { totalYards: '513' } })],
    T2,
    new Set([401868170, 401858212])
  );
  assert.ok(result.kind === 'merge-result');
  assert.equal(result.merge.outcome, 'written');
  assert.deepEqual(result.merge.updated, [401868170]);
  assert.deepEqual(result.diagnostics.restriction?.unmatchedProviderGameIds, [401858212]);
  // A named game was NOT re-observed, so the batch cannot be `clean` — the
  // caller must record partialFailure rather than a whole success.
  assert.equal(result.diagnostics.rowAcceptance, 'mixed');
  const interpretation = interpretGameStatsRefreshOutcome(result);
  assert.equal(interpretation.kind, 'partial');
  assert.equal(interpretation.reason, 'written-mixed');
  assert.equal(interpretation.partialFailure, true);
  // …and the repair that DID land is still durable.
  assert.equal(rowById(await readPartition(), 401868170).home.totalYards, 513);
});

test('a restriction that matches nothing reports FAILED, not a no-op', async () => {
  await ingest([game(401868170)], T1);
  const before = await readPartition();

  const result = await ingest([game(401868170)], T2, new Set([401999999]));
  assert.deepEqual(result, { kind: 'rejected', reason: 'restriction-matched-nothing' });
  // Truthful outcome reporting: the caller asked for a named game and got none.
  const interpretation = interpretGameStatsRefreshOutcome(result);
  assert.equal(interpretation.kind, 'failure');
  assert.equal(interpretation.reason, 'restriction-matched-nothing');
  assert.equal(interpretation.advanceLastSuccess, false);
  assert.equal(interpretation.knownUnchanged, true);
  assert.deepEqual(await readPartition(), before);
});

test('an unrelated malformed row cannot drag a bounded batch to `mixed`', async () => {
  await ingest([game(401868170)], T1);
  const result = await ingest(
    [game(401868170, { home: { totalYards: '513' } }), { id: 'not-a-game-id' }, {}],
    T2,
    new Set([401868170])
  );
  assert.ok(result.kind === 'merge-result');
  // The batch that reached H2 was clean, so the refresh is a clean success —
  // NOT a partial that would stamp `partialFailure` on the provider record.
  assert.equal(result.diagnostics.rowAcceptance, 'clean');
  assert.deepEqual(result.diagnostics.parseFailureCounts, {});
  assert.equal(interpretGameStatsRefreshOutcome(result).reason, 'written-clean');
  // …while the whole response's failures are still reported, not hidden.
  assert.equal(result.diagnostics.restriction?.responseRowCount, 3);
  assert.ok(
    Object.values(result.diagnostics.restriction?.responseParseFailureCounts ?? {}).reduce(
      (sum, n) => sum + n,
      0
    ) === 2
  );
});

test('an unrestricted ingestion is unchanged by PLATFORM-110A', async () => {
  const result = await ingest([game(401868170), { id: 'bad' }], T1);
  assert.ok(result.kind === 'merge-result');
  assert.equal(result.diagnostics.rawRowCount, 2, 'rawRowCount still counts the raw response');
  assert.equal(result.diagnostics.rowAcceptance, 'mixed');
  assert.equal(result.diagnostics.restriction, undefined);
});

// === Prior-good retention on a failed observation ===

test('prior-good survives a bounded observation whose evidence is too thin to persist', async () => {
  await ingest([game(401868170)], T1);
  const before = await readPartition();

  // A provider row for the named game carrying no persistable evidence.
  const thin = {
    id: 401868170,
    teams: [
      { teamId: 290, team: 'Alpha', conference: 'C', homeAway: 'home', points: 31, stats: [] },
      { teamId: 2127, team: 'Beta', conference: 'C', homeAway: 'away', points: 0, stats: [] },
    ],
  };
  __setAppStateWriteFailureForTests(new Error('no write expected'), 'game-stats');
  const result = await ingest([thin], T2, new Set([401868170]));
  __setAppStateWriteFailureForTests(null);

  assert.deepEqual(result, { kind: 'rejected', reason: 'no-persistable-observations' });
  assert.equal(interpretGameStatsRefreshOutcome(result).kind, 'failure');
  assert.deepEqual(await readPartition(), before);
});

test('a bounded observation older than the stored fence is stale, never a rollback', async () => {
  await ingest([game(401868170, { home: { totalYards: '513' } })], T2);
  const before = await readPartition();

  const result = await ingest(
    [game(401868170, { home: { totalYards: '424' } })],
    T0,
    new Set([401868170])
  );
  assert.ok(result.kind === 'merge-result');
  assert.equal(result.merge.outcome, 'stale');
  assert.deepEqual(result.merge.stale, [401868170]);
  assert.deepEqual(await readPartition(), before);
});

// === Writer fencing: the recovery path did not get its own door ===

test('MUTATION — remove the partition lock and the bounded recovery cannot write', async () => {
  await ingest([game(401868170)], T1);
  const before = await readPartition();

  __setAppStateKeyLockFailureForTests(new Error('lock down'), 'game-stats');
  const result = await ingest(
    [game(401868170, { home: { totalYards: '513' } })],
    T2,
    new Set([401868170])
  );
  __setAppStateKeyLockFailureForTests(null);

  assert.ok(result.kind === 'merge-result');
  assert.equal(result.merge.outcome, 'unavailable');
  assert.equal(result.merge.unavailableReason, 'lock-unavailable');
  assert.deepEqual(await readPartition(), before);

  // Positive control: with the lock restored the SAME call commits, so the
  // refusal above is the lock and not an unrelated rejection.
  const restored = await ingest(
    [game(401868170, { home: { totalYards: '513' } })],
    T2,
    new Set([401868170])
  );
  assert.ok(restored.kind === 'merge-result');
  assert.equal(restored.merge.outcome, 'written');
  assert.equal(rowById(await readPartition(), 401868170).home.totalYards, 513);
});

test('MUTATION — writer control off `active` refuses the bounded recovery', async () => {
  await ingest([game(401868170)], T1);
  const before = await readPartition();

  await seedWriterControlState('read-only-safe');
  const result = await ingest(
    [game(401868170, { home: { totalYards: '513' } })],
    T2,
    new Set([401868170])
  );
  assert.ok(result.kind === 'merge-result');
  assert.equal(result.merge.outcome, 'unavailable');
  assert.equal(result.merge.unavailableReason, 'control-not-active');
  assert.deepEqual(await readPartition(), before);

  await seedWriterControlState('active');
  const restored = await ingest(
    [game(401868170, { home: { totalYards: '513' } })],
    T2,
    new Set([401868170])
  );
  assert.ok(restored.kind === 'merge-result');
  assert.equal(restored.merge.outcome, 'written');
});

test('a concurrent ordinary writer and a bounded recovery both survive', async () => {
  await ingest([game(401868170), game(401858212)], T1);

  const [recovery, ordinary] = await Promise.all([
    ingest([game(401868170, { home: { totalYards: '513' } })], T2, new Set([401868170])),
    ingest([game(401858212, { home: { totalYards: '324' } })], T2),
  ]);
  assert.ok(recovery.kind === 'merge-result' && ordinary.kind === 'merge-result');
  assert.equal(recovery.merge.outcome, 'written');
  assert.equal(ordinary.merge.outcome, 'written');

  const after = await readPartition();
  assert.equal(rowById(after, 401868170).home.totalYards, 513);
  assert.equal(rowById(after, 401858212).home.totalYards, 324);
});

// === Capture file + evidence ===

test('an untrusted capture file is validated, never assumed', () => {
  assert.ok('error' in parseCaptureFile(null));
  assert.ok('error' in parseCaptureFile([]));
  assert.ok('error' in parseCaptureFile({ kind: 'something-else', version: 1 }));
  assert.ok(
    'error' in
      parseCaptureFile({
        kind: 'game-stats-recovery-capture',
        version: 1,
        year: 2026,
        week: 1,
        seasonType: 'regular',
        fetchStartedAt: T1,
        gameIds: [],
        payload: [],
      }),
    'an empty gameIds list in a capture must be refused too'
  );
  const ok = parseCaptureFile({
    kind: 'game-stats-recovery-capture',
    version: 1,
    year: 2026,
    week: 1,
    seasonType: 'regular',
    fetchStartedAt: T1,
    gameIds: [401868170],
    payload: [],
  });
  assert.ok(!('error' in ok));
  assert.equal(ok.fetchStartedAt, T1);
});

test('evidence compares RAW categories, so a merge-preserving omission is never a fake delta', () => {
  const storedGames = [
    {
      providerGameId: 401868170,
      fetchStartedAt: T1,
      home: { school: 'Georgia Southern', raw: { totalYards: '424', possessionTime: '23:59' } },
      away: { school: 'Charleston Southern', raw: { totalYards: '35' } },
    },
  ];
  // The observation revises totalYards and OMITS possessionTime entirely. H2
  // preserves an omitted category, so reporting `23:59 → 0` would describe a
  // mutation that will never happen — the defect a normalized comparison has.
  const payload = [
    {
      id: 401868170,
      teams: [
        {
          teamId: 290,
          team: 'Georgia Southern',
          conference: 'Sun Belt',
          homeAway: 'home',
          points: 31,
          stats: [{ category: 'totalYards', stat: '513' }],
        },
        {
          teamId: 2127,
          team: 'Charleston Southern',
          conference: 'OVC',
          homeAway: 'away',
          points: 0,
          stats: [{ category: 'totalYards', stat: '117' }],
        },
      ],
    },
  ];
  const evidence = buildEvidence({ storedGames, payload, requestedIds: [401868170] });
  assert.equal(evidence[0]!.status, 'differs');
  const home = evidence[0]!.sides.find((side) => side.side === 'home')!;
  assert.deepEqual(
    home.deltas.map((d) => [d.category, d.stored, d.observed]),
    [
      ['possessionTime', '23:59', null],
      ['totalYards', '424', '513'],
    ]
  );
  const rendered = renderEvidence(evidence);
  assert.match(rendered, /possessionTime 23:59 → \(not re-observed — stored value preserved\)/);
  // The zero-fallback artifact a normalized comparison would print.
  assert.doesNotMatch(rendered, /possessionTime 23:59 → 0/);
});

test('evidence covers EVERY changed category, not a curated shortlist', () => {
  const storedGames = [
    {
      providerGameId: 1,
      fetchStartedAt: T1,
      home: { school: 'A', raw: { totalYards: '400', tackles: '0', qbHurries: '0' } },
      away: { school: 'B', raw: { totalYards: '300' } },
    },
  ];
  const payload = [
    {
      id: 1,
      teams: [
        {
          teamId: 10,
          team: 'A',
          conference: 'C',
          homeAway: 'home',
          points: 7,
          stats: [
            { category: 'totalYards', stat: '400' },
            { category: 'tackles', stat: '33' },
            { category: 'qbHurries', stat: '4' },
          ],
        },
        {
          teamId: 20,
          team: 'B',
          conference: 'C',
          homeAway: 'away',
          points: 3,
          stats: [{ category: 'totalYards', stat: '300' }],
        },
      ],
    },
  ];
  const evidence = buildEvidence({ storedGames, payload, requestedIds: [1] });
  const home = evidence[0]!.sides.find((side) => side.side === 'home')!;
  // `tackles` and `qbHurries` are raw-only categories H2 rewrites and no
  // normalized field exposes. A shortlist would report this game as identical.
  assert.deepEqual(
    home.deltas.map((d) => d.category),
    ['qbHurries', 'tackles']
  );
  assert.equal(evidence[0]!.status, 'differs');
});

test('a game the partition lacks is reported as an INSERT, not as unreachable', () => {
  const payload = [
    {
      id: 999,
      teams: [
        {
          teamId: 1,
          team: 'A',
          conference: 'C',
          homeAway: 'home',
          points: 7,
          stats: [{ category: 'totalYards', stat: '400' }],
        },
        {
          teamId: 2,
          team: 'B',
          conference: 'C',
          homeAway: 'away',
          points: 3,
          stats: [{ category: 'totalYards', stat: '300' }],
        },
      ],
    },
  ];
  const evidence = buildEvidence({ storedGames: [], payload, requestedIds: [999, 1000] });
  assert.deepEqual(
    evidence.map((e) => [e.providerGameId, e.status]),
    [
      [999, 'will-insert'],
      [1000, 'unknown'],
    ]
  );
  assert.match(renderEvidence(evidence), /the merge will INSERT this game/);
});

test('a malformed stored row is survived, not dereferenced blind', () => {
  const storedGames = [null, 'nonsense', { providerGameId: 1 }, { providerGameId: 2, home: null }];
  const evidence = buildEvidence({ storedGames, payload: [], requestedIds: [1, 2, 3] });
  assert.deepEqual(
    evidence.map((e) => e.status),
    ['unknown', 'unknown', 'unknown']
  );
});

// === Truthful outcome reporting ===

test('a merge that repaired NOTHING exits nonzero, whatever H2 calls it', () => {
  // `stale-clean` is the documented consequence of another writer landing
  // between capture and apply. H2 calls it a no-op; for a repair it is a
  // refusal, and `--apply && …` must not treat it as done.
  for (const reason of ['stale-clean', 'unchanged-clean'] as const) {
    const described = describeApplyOutcome({
      kind: 'no-op',
      reason,
      httpStatus: 200,
      advanceLastSuccess: false,
      partialFailure: false,
      knownUnchanged: true,
      durabilityUnknown: false,
    });
    assert.match(described.line, /NOT REPAIRED/);
    assert.notEqual(described.code, 0, `${reason} must not exit 0`);
  }
  assert.match(
    describeApplyOutcome({
      kind: 'no-op',
      reason: 'stale-clean',
      httpStatus: 200,
      advanceLastSuccess: false,
      partialFailure: false,
      knownUnchanged: true,
      durabilityUnknown: false,
    }).line,
    /OLDER than the stored observation/
  );
});

test('a partial repair exits nonzero: some named game was not repaired', () => {
  const described = describeApplyOutcome({
    kind: 'partial',
    reason: 'written-mixed',
    httpStatus: 200,
    advanceLastSuccess: true,
    partialFailure: true,
    knownUnchanged: false,
    durabilityUnknown: false,
  });
  assert.match(described.line, /PARTIAL/);
  assert.notEqual(described.code, 0);
});

test('only a clean commit exits 0', () => {
  const described = describeApplyOutcome({
    kind: 'success',
    reason: 'written-clean',
    httpStatus: 200,
    advanceLastSuccess: true,
    partialFailure: false,
    knownUnchanged: false,
    durabilityUnknown: false,
  });
  assert.match(described.line, /COMMITTED/);
  assert.equal(described.code, 0);
});

test('--quota-override is explicit, never defaulted, and rejected where it means nothing', () => {
  const base = [
    'capture',
    '--year',
    '2026',
    '--week',
    '1',
    '--season-type',
    'regular',
    '--game-ids',
    '401868170',
    '--out',
    '/tmp/x.json',
  ];
  const plain = parseRecoveryArgs(base);
  assert.ok(!('error' in plain) && plain.mode === 'capture');
  assert.equal(plain.quotaOverride, false);
  const overridden = parseRecoveryArgs([...base, '--quota-override']);
  assert.ok(!('error' in overridden) && overridden.mode === 'capture');
  assert.equal(overridden.quotaOverride, true);
  assert.ok(
    'error' in parseRecoveryArgs(['apply', '--capture', '/tmp/c.json', '--quota-override'])
  );
});

test('describeApplyOutcome never reports a failure as a no-op', () => {
  const failure = describeApplyOutcome({
    kind: 'failure',
    reason: 'conflict',
    httpStatus: 409,
    advanceLastSuccess: false,
    partialFailure: false,
    knownUnchanged: true,
    durabilityUnknown: false,
  });
  assert.match(failure.line, /FAILED \(conflict\)/);
  assert.notEqual(failure.code, 0);

  const indeterminate = describeApplyOutcome({
    kind: 'failure',
    reason: 'indeterminate',
    httpStatus: 503,
    advanceLastSuccess: false,
    partialFailure: false,
    knownUnchanged: false,
    durabilityUnknown: true,
  });
  assert.match(indeterminate.line, /INDETERMINATE/);
  assert.equal(indeterminate.code, 4);
});

// === The recovery is a refresh entry point, so it records scoped status ===

const SCOPE = weekPartitionScope(BASE.year, BASE.week, BASE.seasonType);

async function recordThenRead(payload: unknown, fence: string, ids: readonly number[]) {
  const attempt = await beginProviderRefreshAttempt('game-stats', SCOPE, {
    startedAt: new Date().toISOString(),
  });
  const result = await ingest(payload, fence, new Set(ids));
  const interpretation = interpretGameStatsRefreshOutcome(result);
  await recordRecoveryAttemptOutcome(SCOPE, attempt, interpretation, result);
  return { status: await getProviderRefreshStatus('game-stats', SCOPE), interpretation };
}

test('a committed recovery records a scoped success — not a stale cron outcome', async () => {
  await ingest([game(401868170)], T1);
  const { status } = await recordThenRead([game(401868170, { home: { totalYards: '513' } })], T2, [
    401868170,
  ]);
  assert.equal(status?.latestAttemptOutcome, 'succeeded');
  assert.equal(status?.rowsCommitted, 1);
  assert.equal(status?.partialFailure, false);
  assert.equal(status?.lastError, null);
  assert.ok(status?.lastSuccessAt);
});

test('a PARTIAL recovery records partialFailure, never a whole success', async () => {
  await ingest([game(401868170), game(401858212)], T1);
  const { status } = await recordThenRead(
    [game(401868170, { home: { totalYards: '513' } })],
    T2,
    [401868170, 401858212]
  );
  assert.equal(status?.latestAttemptOutcome, 'partial');
  assert.equal(status?.partialFailure, true);
});

test('a REFUSED recovery records a failure and never advances last-success', async () => {
  await ingest([game(401868170)], T1);
  const seeded = await getProviderRefreshStatus('game-stats', SCOPE);
  const priorSuccessAt = seeded?.lastSuccessAt ?? null;

  const { status } = await recordThenRead([], T2, [401868170]);
  assert.equal(status?.latestAttemptOutcome, 'failed');
  assert.equal(status?.lastSuccessAt ?? null, priorSuccessAt);
  assert.match(String(status?.lastError?.code), /restriction-matched-nothing/);
});
