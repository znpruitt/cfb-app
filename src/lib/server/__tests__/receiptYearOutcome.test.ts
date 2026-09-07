import assert from 'node:assert/strict';
import test from 'node:test';

import type { UpstreamFaultClass } from '../../api/upstreamFaultClass.ts';
import { UPSTREAM_FAULT_KINDS } from '../../api/upstreamFaultClass.ts';
import { summarizeReceiptTarget } from '../../../components/admin/systemHealth/systemHealthPresentation.ts';
import { deriveSystemHealthIssues } from '../systemHealthIssues.ts';
import {
  buildSchedulerExecutionReceipt,
  MAX_RECEIPT_PARTITIONS,
  MAX_SCHEDULER_TARGET_YEARS,
  parseSchedulerExecutionReceipt,
  rankingsYearsTarget,
  scheduleYearsTarget,
  type SchedulerExecutionReceipt,
  type SchedulerFailedPartition,
} from '../schedulerExecutionStatus.ts';
import { formatYearFailureEvidence } from '../schedulerYearEvidence.ts';
import {
  baseInputs,
  deliveryRow,
  deliverySnapshot,
  healthyDelivery,
  receiptFor,
} from './systemHealthFixtures.ts';
import { cleanScheduleYearOutcome } from '../../../test/schedulerYearOutcomeFixtures.ts';

// PLATFORM-126B — the widened receipt contract itself: the durable round trip
// over the TYPE's space, the System Health surfaces that read it, and the proof
// that the four single-unit jobs were not touched.

const NOW = Date.parse('2026-09-07T17:00:00.000Z');

function scheduleEntry(
  year: number,
  over: Partial<ReturnType<typeof cleanScheduleYearOutcome>> = {}
) {
  return {
    year,
    operation: 'ordinary-maintenance' as const,
    scoreRepairs: 0,
    scoreDifferenceCount: 0,
    scoreSweepFailedPartitions: [] as ReadonlyArray<unknown>,
    scoreSweepCannotTellCount: 0,
    kickoffsChanged: 0,
    ...cleanScheduleYearOutcome(over),
  };
}

/** Build → record-shape → parse, the exact path a durable row takes. */
function roundTrip(
  job: 'schedule-refresh' | 'rankings',
  target: SchedulerExecutionReceipt['target']
): SchedulerExecutionReceipt {
  const receipt = buildSchedulerExecutionReceipt({
    job,
    invocationId: '11111111-1111-4111-8111-111111111111',
    startedAtMs: NOW - 60_000,
    completedAtMs: NOW - 59_000,
    result: 'failure',
    reason: 'year-results',
    providerCallAttempted: true,
    target,
  });
  assert.ok(receipt);
  const parsed = parseSchedulerExecutionReceipt(JSON.parse(JSON.stringify(receipt)), job, NOW);
  assert.ok(parsed, 'the widened receipt survives its own parser');
  return parsed;
}

// ── Generated over the TYPE's contract ───────────────────────────────────────

test('GENERATED: year count × which year fails × class × absent optionals all round-trip', () => {
  // The space is what the BUILDER accepts and the PARSER admits — not what
  // today's two routes happen to emit. `AGENTS.md` → Verification: a generator
  // seeded from the callers' habits tests the callers, not the function.
  const faults: Array<UpstreamFaultClass | null> = [
    null,
    ...UPSTREAM_FAULT_KINDS.map((kind) => ({
      kind,
      status: kind === 'http' ? 503 : null,
    })),
  ];
  const seasonTypes = ['regular', 'postseason'] as const;
  let checked = 0;

  for (let yearCount = 1; yearCount <= MAX_SCHEDULER_TARGET_YEARS + 2; yearCount += 1) {
    for (let failingIndex = 0; failingIndex < yearCount; failingIndex += 1) {
      for (const fault of faults) {
        for (const seasonType of seasonTypes) {
          const failed: SchedulerFailedPartition[] = [{ seasonType, upstream: fault }];
          const entries = Array.from({ length: yearCount }, (_, index) =>
            index === failingIndex
              ? scheduleEntry(2020 + index, {
                  result: 'failure',
                  reason: 'partition-fetch-failed',
                  failedPartitions: failed,
                  attemptedSeasonTypes: ['regular', 'postseason'],
                  rowsCommitted: 0,
                })
              : scheduleEntry(2020 + index)
          );
          const parsed = roundTrip('schedule-refresh', scheduleYearsTarget(entries, 0));
          const target = parsed.target as Extract<
            SchedulerExecutionReceipt['target'],
            { kind: 'schedule-years' }
          >;

          assert.equal(target.totalYears, yearCount);
          assert.equal(target.truncated, yearCount > MAX_SCHEDULER_TARGET_YEARS);
          assert.equal(target.years.length, Math.min(yearCount, MAX_SCHEDULER_TARGET_YEARS));

          // The failing year is identifiable BY YEAR whenever it survived the
          // bound — which is the whole claim this item makes.
          if (failingIndex < MAX_SCHEDULER_TARGET_YEARS) {
            const failures = target.years.filter((entry) => entry.result === 'failure');
            assert.equal(failures.length, 1, 'exactly one year reads as failed');
            assert.equal(failures[0]!.year, 2020 + failingIndex);
            assert.equal(failures[0]!.reason, 'partition-fetch-failed');
            assert.deepEqual(failures[0]!.failedPartitions, [{ seasonType, upstream: fault }]);
          } else {
            // Truncation drops the failing year — `truncated` is the ONLY honest
            // signal left, and it is set. Bounding by dropping years is the
            // pre-existing `MAX_SCHEDULER_TARGET_YEARS` policy, not a narrowing
            // introduced here.
            assert.equal(target.truncated, true);
          }
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked >= 500, `the sweep is wide enough to be evidence (${checked} shapes)`);
});

test('GENERATED: a legacy entry missing ANY subset of the optional fields still parses', () => {
  const optional = [
    'result',
    'reason',
    'providerCallAttempted',
    'rowsReceived',
    'rowsCommitted',
    'dataChanged',
    'attemptedSeasonTypes',
    'failedPartitions',
  ] as const;

  // Every subset — 256 shapes — because a rollout can produce a row written by
  // any build, and the reader must not reject one.
  for (let mask = 0; mask < 1 << optional.length; mask += 1) {
    const entry: Record<string, unknown> = { year: 2026, operation: 'ordinary-maintenance' };
    for (const [index, field] of optional.entries()) {
      if (mask & (1 << index)) {
        entry[field] =
          field === 'attemptedSeasonTypes' || field === 'failedPartitions'
            ? []
            : field === 'result'
              ? 'failure'
              : field === 'reason'
                ? 'partition-fetch-failed'
                : field === 'providerCallAttempted' || field === 'dataChanged'
                  ? true
                  : 1;
      }
    }
    const parsed = parseSchedulerExecutionReceipt(
      {
        version: 1,
        job: 'schedule-refresh',
        source: 'qstash',
        invocationId: 'legacy',
        startedAt: '2026-09-01T12:00:01.664Z',
        completedAt: '2026-09-01T12:00:38.788Z',
        durationMs: 37124,
        result: 'failure',
        reason: 'year-results',
        providerCallAttempted: true,
        target: {
          kind: 'schedule-years',
          totalYears: 1,
          truncated: false,
          invalidLifecycleTargets: 0,
          years: [entry],
        },
      },
      'schedule-refresh',
      NOW
    );
    assert.ok(parsed, `subset mask ${mask} parses`);
    const year = (
      parsed.target as Extract<SchedulerExecutionReceipt['target'], { kind: 'schedule-years' }>
    ).years[0]!;
    // Absent always reads as null/[] — never as a fabricated 0 or false.
    for (const field of optional) {
      if (!(mask & (1 << optional.indexOf(field)))) {
        const expected =
          field === 'attemptedSeasonTypes' || field === 'failedPartitions' ? [] : null;
        assert.deepEqual(year[field], expected, `${field} absent → ${JSON.stringify(expected)}`);
      }
    }
  }
});

// ── The parser rejects what it must ──────────────────────────────────────────

test('a present-but-invalid per-year field rejects the record, as every other stored field does', () => {
  const badEntries: Array<[string, Record<string, unknown>]> = [
    ['unknown result', { result: 'exploded' }],
    ['reason with a space', { reason: 'partition fetch failed' }],
    ['reason carrying a URL', { reason: 'https://api.collegefootballdata.com/games' }],
    ['reason too long', { reason: `a${'b'.repeat(64)}` }],
    ['non-boolean provider flag', { providerCallAttempted: 'yes' }],
    ['negative row count', { rowsReceived: -1 }],
    ['non-integer row count', { rowsCommitted: 1.5 }],
    ['unknown season type', { attemptedSeasonTypes: ['preseason'] }],
    ['too many partitions', { failedPartitions: [1, 2, 3].map(() => ({ seasonType: 'regular' })) }],
    ['partition with no season type', { failedPartitions: [{ upstream: null }] }],
    [
      'unknown fault kind',
      { failedPartitions: [{ seasonType: 'regular', upstream: { kind: 'dns' } }] },
    ],
    [
      'fault with an unusable status',
      { failedPartitions: [{ seasonType: 'regular', upstream: { kind: 'http', status: 700 } }] },
    ],
  ];

  for (const [label, override] of badEntries) {
    const parsed = parseSchedulerExecutionReceipt(
      {
        version: 1,
        job: 'schedule-refresh',
        source: 'qstash',
        invocationId: 'corrupt',
        startedAt: '2026-09-01T12:00:01.664Z',
        completedAt: '2026-09-01T12:00:38.788Z',
        durationMs: 1,
        result: 'failure',
        reason: 'year-results',
        providerCallAttempted: true,
        target: {
          kind: 'schedule-years',
          totalYears: 1,
          truncated: false,
          invalidLifecycleTargets: 0,
          years: [{ year: 2026, operation: 'ordinary-maintenance', ...override }],
        },
      },
      'schedule-refresh',
      NOW
    );
    assert.equal(parsed, null, `${label} makes the record replaceable`);
  }
});

test('the partition list is bounded, so a corrupt row cannot inflate the receipt', () => {
  assert.equal(MAX_RECEIPT_PARTITIONS, 2, 'both multi-year jobs cover exactly two partitions');
  const target = scheduleYearsTarget(
    [
      scheduleEntry(2026, {
        result: 'failure',
        reason: 'partition-fetch-failed',
        attemptedSeasonTypes: ['regular', 'postseason', 'regular'] as never,
        failedPartitions: [
          { seasonType: 'regular', upstream: null },
          { seasonType: 'postseason', upstream: null },
          { seasonType: 'regular', upstream: null },
        ],
      }),
    ],
    0
  );
  assert.equal(target.years[0]!.failedPartitions.length, MAX_RECEIPT_PARTITIONS);
  assert.equal(target.years[0]!.attemptedSeasonTypes.length, MAX_RECEIPT_PARTITIONS);
});

// ── The two System Health surfaces ───────────────────────────────────────────

test('the shared formatter renders failure evidence and stays silent on every other result', () => {
  assert.equal(
    formatYearFailureEvidence({
      result: 'failure',
      reason: 'partition-fetch-failed',
      failedPartitions: [{ seasonType: 'postseason', upstream: { kind: 'http', status: 503 } }],
    }),
    'failure / partition-fetch-failed · postseason http 503'
  );
  assert.equal(
    formatYearFailureEvidence({
      result: 'partial',
      reason: 'publication-completion-unconfirmed',
      failedPartitions: [],
    }),
    'partial / publication-completion-unconfirmed',
    'a failure with no partition evidence still names its reason'
  );
  assert.equal(
    formatYearFailureEvidence({
      result: 'failure',
      reason: 'partition-schema-drift',
      failedPartitions: [{ seasonType: 'regular', upstream: null }],
    }),
    'failure / partition-schema-drift · regular',
    'a partition with no transport fault renders bare, not as "unclassified"'
  );
  // Silent on everything that is not a fault — a clean run renders as before.
  for (const result of ['success', 'no-op', 'skipped', 'in-progress', null]) {
    assert.equal(
      formatYearFailureEvidence({ result, reason: 'written-clean', failedPartitions: [] }),
      '',
      `${String(result)} adds nothing`
    );
  }
});

test('the System Health execution-failed issue carries the evidence, and its severity is unchanged', () => {
  const failing = receiptFor('schedule-refresh', 'failure');
  const withEvidence: SchedulerExecutionReceipt = {
    ...failing,
    target: scheduleYearsTarget(
      [
        scheduleEntry(2025),
        scheduleEntry(2026, {
          result: 'failure',
          reason: 'partition-fetch-failed',
          failedPartitions: [
            { seasonType: 'postseason', upstream: { kind: 'timeout', status: null } },
          ],
        }),
      ],
      0
    ),
  };
  const rows = healthyDelivery().jobs.map((row) =>
    row.job === 'schedule-refresh' ? deliveryRow('schedule-refresh', 'on-time', withEvidence) : row
  );
  const issues = deriveSystemHealthIssues(
    baseInputs({ schedulerDelivery: deliverySnapshot(rows) })
  );
  const issue = issues.find((i) => i.code === 'scheduler-execution-failed');
  assert.ok(issue);
  // Unchanged: still a warning, still derived from `receipt.result` alone.
  assert.equal(issue.severity, 'warning');
  assert.equal(issue.title, 'schedule-refresh execution failed');
  assert.match(issue.explanation, /^The most recent schedule-refresh invocation reported a failed/);
  assert.match(issue.explanation, /2026: failure \/ partition-fetch-failed · postseason timeout/);
  assert.match(issue.explanation, /it does not describe what the cache now holds/);
  assert.ok(
    !issue.explanation.includes('2025'),
    'the healthy sibling year is not narrated as evidence'
  );
});

test('a single-unit job’s execution-failed explanation is byte-identical to before this slice', () => {
  // The four single-unit jobs get NOTHING from this tier (owner decision
  // 2026-09-04), including on this surface.
  const rows = healthyDelivery().jobs.map((row) =>
    row.job === 'live-scores'
      ? deliveryRow('live-scores', 'on-time', receiptFor('live-scores', 'failure'))
      : row
  );
  const issues = deriveSystemHealthIssues(
    baseInputs({ schedulerDelivery: deliverySnapshot(rows) })
  );
  const issue = issues.find((i) => i.code === 'scheduler-execution-failed');
  assert.ok(issue);
  assert.equal(
    issue.explanation,
    'The most recent live-scores invocation reported a failed execution result.',
    'no evidence clause is appended to a single-unit job'
  );
});

// ── The four single-unit jobs are untouched ──────────────────────────────────

test('MUTATION PIN: the four single-unit target shapes are byte-identical through the store', () => {
  // `live-scores`, `game-stats`, `odds` and `team-records` process one unit per
  // run, so their run-level result/reason already identifies what failed.
  // Widening them for symmetry would grow the receipt contract for every job to
  // solve a problem two jobs have — owner decision 2026-09-04, not to be
  // re-argued. This pin fails if any field is added to, removed from, or
  // reshaped in any of the four.
  const targets: Array<
    ['live-scores' | 'game-stats' | 'odds' | 'team-records', SchedulerExecutionReceipt['target']]
  > = [
    [
      'live-scores',
      { kind: 'live-scores', year: 2026, mode: 'scoreboard', targetGames: 3, targetPartitions: 2 },
    ],
    ['game-stats', { kind: 'game-stats', year: 2026, week: 3, seasonType: 'regular' }],
    ['odds', { kind: 'odds', year: 2026, cadence: 'pregame', eligibleGames: 5 }],
    ['team-records', { kind: 'team-records', year: 2026 }],
  ];

  for (const [job, target] of targets) {
    const receipt = buildSchedulerExecutionReceipt({
      job,
      invocationId: '22222222-2222-4222-8222-222222222222',
      startedAtMs: NOW - 60_000,
      completedAtMs: NOW - 59_000,
      result: 'failure',
      reason: 'unexpected-error',
      providerCallAttempted: true,
      target,
    });
    assert.ok(receipt);
    const parsed = parseSchedulerExecutionReceipt(JSON.parse(JSON.stringify(receipt)), job, NOW);
    assert.ok(parsed);
    assert.deepEqual(parsed.target, target, `${job} target is unchanged, field for field`);
  }

  // And their rendered summaries are unchanged.
  assert.equal(
    summarizeReceiptTarget(targets[0]![1]),
    '2026 · 3 game(s), 2 partition(s) · scoreboard'
  );
  assert.equal(summarizeReceiptTarget(targets[1]![1]), '2026 · week 3 · regular');
  assert.equal(summarizeReceiptTarget(targets[2]![1]), '2026 · 5 eligible game(s) · pregame');
  assert.equal(summarizeReceiptTarget(targets[3]![1]), '2026');
});

test('the rankings target carries the same widened shape as the schedule target', () => {
  // One vocabulary across both multi-year jobs — a drift between them is the
  // thing the shared `SchedulerYearOutcome` exists to prevent.
  const target = rankingsYearsTarget(
    [
      {
        year: 2026,
        publicationWindow: 'weekly-ap-coaches',
        result: 'failure',
        reason: 'provider-fetch-failed',
        providerCallAttempted: true,
        rowsReceived: 1,
        rowsCommitted: 0,
        dataChanged: false,
        attemptedSeasonTypes: ['regular', 'postseason'],
        failedPartitions: [{ seasonType: 'regular', upstream: { kind: 'parse', status: null } }],
      },
    ],
    0
  );
  const parsed = roundTrip('rankings', target);
  assert.deepEqual(parsed.target, target);
  assert.equal(
    summarizeReceiptTarget(parsed.target),
    '1 year(s): 2026 (weekly-ap-coaches) — failure / provider-fetch-failed · regular parse'
  );
});
