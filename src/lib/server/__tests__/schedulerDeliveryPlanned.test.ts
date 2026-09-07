import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  PlannerScheduleAction,
  PlannerScheduleOutcome,
  PlannerScheduleRun,
  PollingPlannerReadResult,
  PollingPlannerRun,
} from '@/lib/server/pollingPlannerRecord';
import {
  isPlannerOwnedJob,
  PLANNER_OWNED_JOBS,
  previousScheduleSlotMs,
  readSchedulerDeliveryHealth,
  requiredStartedAtForJob,
  schedulerDeliveryPolicy,
  type PlannerOwnedJob,
  type PlannerRecordLoader,
  type SchedulerDeliveryHealthRow,
  type SchedulerDeliveryScheduleView,
} from '@/lib/server/schedulerDeliveryHealth';
import {
  buildSchedulerExecutionReceipt,
  EXTERNAL_SCHEDULER_JOBS,
  type ExternalSchedulerJob,
  type SchedulerExecutionReceipt,
} from '@/lib/server/schedulerExecutionStatus';

// PLATFORM-102 slice 3b — delivery health reading the planner record instead of
// extrapolating today's cron backwards. All instants are fixed UTC; nothing here
// reads the machine clock.

const MIN = 60_000;
const HOUR = 60 * MIN;

const ms = (iso: string): number => Date.parse(iso);
const at = (instantMs: number): string => new Date(instantMs).toISOString();

// The shapes the record holds on a real pair of days. Written as literals rather
// than synthesized: this slice's whole point is that the row reads what was
// RECORDED, so a fixture that re-derives them would test the synthesizer.
const DEAD_DAY_SLOW = '0 * * * *';
const GAME_DAY_DENSE = '*/3 19,20,21,22,23 * * *';
const GAME_DAY_SLOW = '1 0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18 * * *';
const MORNING_DENSE = '*/3 6,7,8 * * *';
const MORNING_SLOW = '1 0,1,2,3,4,5,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23 * * *';

function schedule(
  cron: string,
  overrides: {
    previousCron?: string | null;
    action?: PlannerScheduleAction;
    outcome?: PlannerScheduleOutcome;
  } = {}
): PlannerScheduleRun {
  return {
    intent: {
      scheduleId: 'turfwar-live-scores-dense',
      destination: 'https://example.test/api/cron/live-scores',
      cron,
      method: 'POST',
      retries: 1,
    },
    previousCron: overrides.previousCron ?? null,
    action: overrides.action ?? 'applied',
    outcome: overrides.outcome ?? 'confirmed',
  };
}

function run(
  atIso: string,
  dense: PlannerScheduleRun | null,
  slow: PlannerScheduleRun
): PollingPlannerRun {
  return {
    at: atIso,
    invocationId: null,
    dayStartMs: ms(`${atIso.slice(0, 10)}T00:00:00.000Z`),
    // Deliberately EMPTY. The reader takes the recorded expressions, never the
    // stored windows re-synthesized, so a fixture supplying windows would let a
    // re-derivation pass unnoticed.
    windows: [],
    dense,
    slow,
  };
}

function okRecord(...runs: PollingPlannerRun[]): PollingPlannerReadResult {
  return { kind: 'ok', series: { runs, droppedRuns: 0 } };
}

function receiptFor(job: PlannerOwnedJob, startedAtMs: number): SchedulerExecutionReceipt {
  const receipt = buildSchedulerExecutionReceipt({
    job,
    invocationId: `id-${job}-${startedAtMs}`,
    startedAtMs,
    completedAtMs: startedAtMs + 1000,
    result: 'skipped',
    reason: 'no-polling-target',
    providerCallAttempted: false,
    target:
      job === 'live-scores'
        ? { kind: 'live-scores', year: 2026, mode: null, targetGames: 0, targetPartitions: 0 }
        : { kind: 'game-stats', year: 2026, week: null, seasonType: null },
  });
  assert.ok(receipt, 'the fixture receipt builds');
  return receipt;
}

type Snapshot = Map<ExternalSchedulerJob, SchedulerDeliveryHealthRow>;

async function rowsFor(options: {
  nowMs: number;
  records?: Partial<Record<PlannerOwnedJob, PollingPlannerReadResult>>;
  loadPlannerRecord?: PlannerRecordLoader;
  receipts?: Array<{ key: string; value: unknown }>;
}): Promise<Snapshot> {
  const snapshot = await readSchedulerDeliveryHealth({
    nowMs: options.nowMs,
    loadEntries: () => Promise.resolve(options.receipts ?? []),
    loadPlannerRecord:
      options.loadPlannerRecord ??
      ((job) => Promise.resolve(options.records?.[job] ?? { kind: 'absent' })),
  });
  return new Map(snapshot.jobs.map((row) => [row.job, row] as const));
}

/** The slot an entry carries, asserted present — a measured entry always has one. */
const slotOf = (entry: SchedulerDeliveryScheduleView | undefined, why: string): number => {
  assert.ok(entry?.requiredStartedAt, `${why}: the entry is measured`);
  return ms(entry.requiredStartedAt);
};

/** Only the schedules that produced a required slot, by expression. */
const measuredCrons = (row: SchedulerDeliveryHealthRow): Array<string | null> =>
  row.schedules.filter((entry) => entry.requiredStartedAt !== null).map((entry) => entry.cron);

const rowOf = (snapshot: Snapshot, job: ExternalSchedulerJob): SchedulerDeliveryHealthRow => {
  const row = snapshot.get(job);
  assert.ok(row, `${job} has a row`);
  return row;
};

// ── 1. The headline: a game day after a differently-armed day ────────────────
//
// REGRESSION TEST. Verified failing against the pre-fix behaviour by replacing
// the recorded-timeline walk with `previousScheduleSlotMs(currentCron, cutoff)`
// — the extrapolation this slice removes — which turns this row `late`.
test('a game day following a dead day reads on-time, not nineteen hours of false late', async () => {
  const now = ms('2026-10-03T00:06:00.000Z');
  // The dead day genuinely last fired at 23:00 under its hourly slow schedule.
  const lastRealFire = ms('2026-10-02T23:00:00.000Z');
  const record = okRecord(
    run(
      '2026-10-02T00:02:00.000Z',
      null,
      schedule(DEAD_DAY_SLOW, {
        previousCron: DEAD_DAY_SLOW,
        action: 'skipped',
        outcome: 'unchanged',
      })
    ),
    run(
      '2026-10-03T00:02:00.000Z',
      schedule(GAME_DAY_DENSE),
      schedule(GAME_DAY_SLOW, { previousCron: DEAD_DAY_SLOW })
    )
  );

  const rows = await rowsFor({
    nowMs: now,
    records: { 'live-scores': record },
    receipts: [{ key: 'live-scores', value: receiptFor('live-scores', lastRealFire) }],
  });
  const row = rowOf(rows, 'live-scores');

  assert.equal(row.deliveryState, 'on-time');
  assert.equal(row.planUnavailableReason, null);
  // The required slot is a firing of the cron that was ACTUALLY in force, on the
  // day it was in force — not a slot of today's expression projected backwards.
  assert.equal(row.requiredStartedAt, '2026-10-02T22:00:00.000Z');
  assert.deepEqual(measuredCrons(row), [DEAD_DAY_SLOW]);
  // The dense schedule is armed for tonight and simply not due yet: published,
  // named, and contributing no slot.
  const dense = row.schedules.find((entry) => entry.schedule === 'dense');
  assert.equal(dense?.cron, GAME_DAY_DENSE);
  assert.equal(dense?.requiredStartedAt, null);
  assert.equal(dense?.unavailableReason, null, 'not due is not a fault');
  // The row's own facts name the schedule it MEASURED, never one it did not.
  assert.equal(row.cron, DEAD_DAY_SLOW);
  assert.equal(row.graceMs, 2 * HOUR);

  // The magnitude of the defect, measured on this module's own parser: the
  // extrapolation demands a slot at 23:57 that the dead day never fired.
  assert.equal(
    previousScheduleSlotMs(GAME_DAY_DENSE, now - 6 * MIN),
    ms('2026-10-02T23:57:00.000Z')
  );
  assert.ok(ms('2026-10-02T23:57:00.000Z') > lastRealFire, 'which is after the last real firing');
});

// The span, MEASURED rather than asserted from the campaign note. It needs one
// precondition, and the precondition is a slice-4 decision: the planner must
// rewrite AFTER the day's first slow slot has already passed. An armed day with
// no reconciliation tail takes the idle slot at hour 0 (`pollingCron.ts`
// IDLE_SLOW_HOUR), which fires at :01, so a rewrite at 00:02 leaves the day dark
// from the rewrite until the dense window opens — and the receipt frozen at
// yesterday's last firing across the whole of it.
const YESTERDAY_DENSE = '*/3 12,13,14,15,16,17,18,19 * * *';
const YESTERDAY_IDLE_SLOW = '1 20 * * *';
const TODAY_IDLE_SLOW = '1 0 * * *';

test('the extrapolation is false-late across a measured nineteen-hour span', () => {
  // Yesterday's last real firing: its idle slow slot at 20:01. Nothing fires
  // again until today's dense window opens at 19:00.
  const receiptMs = ms('2026-10-02T20:01:00.000Z');
  const dayStart = ms('2026-10-03T00:00:00.000Z');
  const rewrite = ms('2026-10-03T00:02:00.000Z');

  let falseLateMinutes = 0;
  let firstFalseLate: number | null = null;
  let lastFalseLate: number | null = null;
  for (let now = rewrite; now < dayStart + 24 * HOUR; now += MIN) {
    // What the pre-fix classifier computes: today's dense expression walked
    // backwards as if it had always been in force.
    const demanded = previousScheduleSlotMs(GAME_DAY_DENSE, now - 6 * MIN);
    // FALSE, specifically: the demanded slot predates the rewrite, so this
    // expression was not in force when it supposedly fired — and no real firing
    // can ever reach it. Once the dense window genuinely opens at 19:00 the same
    // comparison becomes a TRUE late, which is not what is being counted.
    if (demanded < rewrite && demanded > receiptMs) {
      firstFalseLate ??= now;
      lastFalseLate = now;
      falseLateMinutes += 1;
    }
  }
  assert.equal(firstFalseLate, rewrite);
  assert.equal(lastFalseLate, ms('2026-10-03T19:05:00.000Z'));
  assert.equal(falseLateMinutes, 1144, 'contiguous, and 19h04m long');
  assert.equal(
    lastFalseLate - firstFalseLate + MIN,
    falseLateMinutes * MIN,
    'contiguous: no on-time minute inside the span'
  );
});

test('the record reads on-time across that whole span', async () => {
  const receiptMs = ms('2026-10-02T20:01:00.000Z');
  const record = okRecord(
    run(
      '2026-10-02T00:02:00.000Z',
      schedule(YESTERDAY_DENSE, { previousCron: DEAD_DAY_SLOW }),
      schedule(YESTERDAY_IDLE_SLOW, { previousCron: DEAD_DAY_SLOW })
    ),
    run(
      '2026-10-03T00:02:00.000Z',
      schedule(GAME_DAY_DENSE, { previousCron: YESTERDAY_DENSE }),
      schedule(TODAY_IDLE_SLOW, { previousCron: YESTERDAY_IDLE_SLOW })
    )
  );
  const receipts = [{ key: 'live-scores', value: receiptFor('live-scores', receiptMs) }];
  let checked = 0;
  for (
    let now = ms('2026-10-03T00:02:00.000Z');
    now <= ms('2026-10-03T19:05:00.000Z');
    now += 15 * MIN
  ) {
    const row = rowOf(
      await rowsFor({ nowMs: now, records: { 'live-scores': record }, receipts }),
      'live-scores'
    );
    assert.equal(row.deliveryState, 'on-time', at(now));
    // Both schedules resolve to what was in force YESTERDAY, because neither of
    // today's expressions has come due yet.
    assert.deepEqual(
      row.schedules.map((entry) => entry.cron).sort(),
      [YESTERDAY_DENSE, YESTERDAY_IDLE_SLOW].sort(),
      at(now)
    );
    assert.equal(row.requiredStartedAt, at(receiptMs), at(now));
    checked += 1;
  }
  assert.equal(checked, 77, 'the whole span was sampled, not one instant');
});

// ── 2. One row, two schedules — asserted in BOTH directions ──────────────────
test('a dense-schedule failure inside the window is caught', async () => {
  const now = ms('2026-10-03T20:30:00.000Z');
  const record = okRecord(
    run(
      '2026-10-03T00:02:00.000Z',
      schedule(GAME_DAY_DENSE),
      schedule(GAME_DAY_SLOW, { previousCron: DEAD_DAY_SLOW })
    )
  );
  // The dense schedule stopped delivering at 19:00; the slow one is not due in
  // hour 20 at all, so only the dense expectation can catch this.
  const receiptMs = ms('2026-10-03T19:00:00.000Z');
  const rows = await rowsFor({
    nowMs: now,
    records: { 'live-scores': record },
    receipts: [{ key: 'live-scores', value: receiptFor('live-scores', receiptMs) }],
  });
  const row = rowOf(rows, 'live-scores');

  assert.equal(row.deliveryState, 'late');
  assert.equal(row.requiredStartedAt, '2026-10-03T20:24:00.000Z');
  const byCron = new Map(row.schedules.map((entry) => [entry.cron, entry]));
  assert.ok(
    slotOf(byCron.get(GAME_DAY_DENSE), 'dense') > receiptMs,
    'the dense schedule is the one that catches it'
  );
  assert.ok(
    slotOf(byCron.get(GAME_DAY_SLOW), 'slow') <= receiptMs,
    'and the slow schedule alone would have read this on-time'
  );
});

test('a slow-schedule failure inside the reconciliation tail is caught', async () => {
  // The direction that is invisible today: a morning cluster, and a receipt from
  // the last dense firing standing all afternoon.
  const now = ms('2026-10-03T14:00:00.000Z');
  const record = okRecord(
    run(
      '2026-10-03T00:02:00.000Z',
      schedule(MORNING_DENSE),
      schedule(MORNING_SLOW, { previousCron: DEAD_DAY_SLOW })
    )
  );
  const receiptMs = ms('2026-10-03T08:57:00.000Z');
  const rows = await rowsFor({
    nowMs: now,
    records: { 'live-scores': record },
    receipts: [{ key: 'live-scores', value: receiptFor('live-scores', receiptMs) }],
  });
  const row = rowOf(rows, 'live-scores');

  assert.equal(row.deliveryState, 'late');
  assert.equal(row.requiredStartedAt, '2026-10-03T11:01:00.000Z');
  const byCron = new Map(row.schedules.map((entry) => [entry.cron, entry]));
  assert.equal(byCron.get(MORNING_DENSE)!.requiredStartedAt, '2026-10-03T08:57:00.000Z');
  assert.ok(
    slotOf(byCron.get(MORNING_DENSE), 'dense') <= receiptMs,
    'the dense schedule alone reads this on-time — the fifteen-hour blind spot'
  );

  // The measured blind spot the single-cron row leaves open: the dense-governed
  // expectation still points at 08:57 at one minute to midnight.
  assert.equal(
    previousScheduleSlotMs(MORNING_DENSE, ms('2026-10-03T23:59:00.000Z') - 6 * MIN),
    receiptMs
  );
});

// ── 3. The seven jobs the planner does not own ──────────────────────────────
// It compares two executions of THIS build, so it proves the seven rows are
// UNAFFECTED by a planner record — not that they serialize identically to an
// earlier commit. They do not: the per-schedule model added `schedule` and
// `unavailableReason` to every entry, this one included. The behaviour the
// slice promised is the former; the field-level pins below are what tie these
// rows to the fixed contract.
test('the seven unowned jobs are never asked for a record and are unaffected by one', async () => {
  const now = ms('2026-10-03T14:33:17.000Z');
  const asked: ExternalSchedulerJob[] = [];
  const record = okRecord(
    run('2026-10-03T00:02:00.000Z', schedule(GAME_DAY_DENSE), schedule(GAME_DAY_SLOW))
  );

  const withRecords = await rowsFor({
    nowMs: now,
    loadPlannerRecord: (job) => {
      asked.push(job);
      return Promise.resolve(record);
    },
  });
  const withoutRecords = await rowsFor({ nowMs: now });

  assert.deepEqual([...asked].sort(), [...PLANNER_OWNED_JOBS].sort());
  assert.equal(asked.length, 2, 'one read per planner-owned job, and no more');

  for (const job of EXTERNAL_SCHEDULER_JOBS) {
    if (isPlannerOwnedJob(job)) continue;
    assert.deepEqual(
      rowOf(withRecords, job),
      rowOf(withoutRecords, job),
      `${job} is unaffected by a planner record`
    );
    assert.equal(rowOf(withRecords, job).cron, schedulerDeliveryPolicy(job).cron);
    assert.equal(rowOf(withRecords, job).graceMs, schedulerDeliveryPolicy(job).graceMs);
    assert.equal(rowOf(withRecords, job).cadenceLabel, schedulerDeliveryPolicy(job).cadenceLabel);
  }
  // Positive control: the two that ARE owned did change, so the loop above is
  // asserting stability rather than measuring a snapshot nothing could move.
  for (const job of PLANNER_OWNED_JOBS) {
    assert.notDeepEqual(rowOf(withRecords, job), rowOf(withoutRecords, job), job);
  }
});

// ── 4. Partial wiring is detectable, not merely avoided ─────────────────────
test('every row measures against exactly the schedules it publishes', async () => {
  const now = ms('2026-10-03T20:30:00.000Z');
  const record = okRecord(
    run(
      '2026-10-03T00:02:00.000Z',
      schedule(GAME_DAY_DENSE),
      schedule(GAME_DAY_SLOW, { previousCron: DEAD_DAY_SLOW })
    )
  );
  const rows = await rowsFor({
    nowMs: now,
    records: { 'live-scores': record, 'game-stats': record },
    receipts: [
      { key: 'live-scores', value: receiptFor('live-scores', now - 2 * MIN) },
      { key: 'game-stats', value: receiptFor('game-stats', now - 2 * MIN) },
    ],
  });

  for (const job of EXTERNAL_SCHEDULER_JOBS) {
    const row = rowOf(rows, job);
    assert.ok(row.schedules.length > 0, `${job} publishes the schedules it knows`);
    const measured = row.schedules.filter((entry) => entry.requiredStartedAt !== null);
    assert.ok(measured.length > 0, `${job} measured at least one`);
    assert.equal(
      ms(row.requiredStartedAt!),
      Math.max(...measured.map((entry) => ms(entry.requiredStartedAt!))),
      `${job}: the required slot is the latest one its schedules carry`
    );
    // The row's headline facts come from the entry that produced that slot —
    // never from a schedule absent from the list.
    const governing = measured.find((entry) => entry.requiredStartedAt === row.requiredStartedAt);
    assert.ok(governing, `${job}: the row names a schedule it published`);
    assert.equal(row.cron, governing.cron, `${job}: cron names the measured schedule`);
    assert.equal(row.graceMs, governing.graceMs, `${job}: grace belongs to that schedule`);
    for (const entry of measured) {
      // The published slot is a real firing of the published expression.
      assert.equal(
        previousScheduleSlotMs(entry.cron!, ms(entry.requiredStartedAt!)),
        ms(entry.requiredStartedAt!),
        `${job}: ${entry.cron} fires at its own required slot`
      );
    }
  }

  // Display moved WITH measurement: a planner-owned row shows the recorded
  // expressions and a cadence that is not the fixed constant.
  for (const job of PLANNER_OWNED_JOBS) {
    const row = rowOf(rows, job);
    assert.equal(row.cron, GAME_DAY_DENSE);
    assert.notEqual(row.cadenceLabel, schedulerDeliveryPolicy(job).cadenceLabel);
    assert.deepEqual(
      row.schedules.map((entry) => entry.cron).sort(),
      [GAME_DAY_DENSE, GAME_DAY_SLOW].sort()
    );
  }
});

test('requiredStartedAtForJob is the row production builds on the fixed branch', async () => {
  for (const now of [
    ms('2026-03-15T12:07:30.000Z'),
    ms('2026-10-03T00:00:00.000Z'),
    ms('2026-12-31T23:59:59.000Z'),
  ]) {
    const rows = await rowsFor({ nowMs: now });
    for (const job of EXTERNAL_SCHEDULER_JOBS) {
      assert.equal(
        at(requiredStartedAtForJob(job, now)),
        rowOf(rows, job).requiredStartedAt,
        `${job} at ${at(now)}`
      );
    }
  }
});

// ── 5. The four read states ─────────────────────────────────────────────────
test('a corrupt or unreadable record surfaces instead of falling back', async () => {
  const now = ms('2026-10-03T20:30:00.000Z');
  const cases: Array<[PollingPlannerReadResult, string]> = [
    [{ kind: 'unreadable' }, 'plan-unreadable'],
    [{ kind: 'failed' }, 'plan-store-failed'],
    [{ kind: 'ok', series: { runs: [], droppedRuns: 0 } }, 'plan-incomplete'],
  ];
  for (const [record, reason] of cases) {
    const rows = await rowsFor({
      nowMs: now,
      records: { 'live-scores': record },
      // A perfectly good receipt: the plan is the problem, and the row must not
      // claim anything about the receipt.
      receipts: [{ key: 'live-scores', value: receiptFor('live-scores', now - MIN) }],
    });
    const row = rowOf(rows, 'live-scores');
    assert.equal(row.deliveryState, 'unavailable', reason);
    assert.equal(row.planUnavailableReason, reason);
    assert.equal(row.cron, null, `${reason}: no cadence is claimed`);
    assert.equal(row.graceMs, null);
    assert.equal(row.requiredStartedAt, null, `${reason}: and no slot is claimed`);
    // BOTH schedules are refused, each carrying the reason, so the row says which
    // of a job's schedules lost their basis rather than merely that one did.
    assert.deepEqual(
      row.schedules.map((entry) => [entry.schedule, entry.unavailableReason]),
      [
        ['dense', reason],
        ['slow', reason],
      ]
    );
    assert.notEqual(
      row.cadenceLabel,
      schedulerDeliveryPolicy('live-scores').cadenceLabel,
      `${reason}: the fixed contract is NOT restated`
    );
    // THE RECEIPT IS STILL PUBLISHED. Withholding it made every receiptless-row
    // consumer skip this job, so a planner-record failure silently suppressed
    // execution and lifecycle faults on the two jobs that matter most.
    assert.ok(row.receipt, `${reason}: the receipt survives a plan fault`);
    assert.equal(row.receipt!.startedAt, at(now - MIN), reason);
    // The other planner-owned job is untouched: one row degrades, not the page.
    assert.equal(rowOf(rows, 'game-stats').deliveryState, 'missing');
    assert.equal(rowOf(rows, 'game-stats').planUnavailableReason, null);
  }
});

test('absence is the only read state that licenses the fixed contract', async () => {
  const now = ms('2026-10-03T20:30:00.000Z');
  const absent = await rowsFor({ nowMs: now, records: { 'live-scores': { kind: 'absent' } } });
  const unreadable = await rowsFor({
    nowMs: now,
    records: { 'live-scores': { kind: 'unreadable' } },
  });
  assert.equal(rowOf(absent, 'live-scores').cron, schedulerDeliveryPolicy('live-scores').cron);
  assert.equal(rowOf(absent, 'live-scores').planUnavailableReason, null);
  assert.notEqual(
    rowOf(unreadable, 'live-scores').cron,
    rowOf(absent, 'live-scores').cron,
    'a present-but-corrupt record is not absence'
  );
});

test('a throwing record reader degrades one row and never rejects', async () => {
  const now = ms('2026-10-03T20:30:00.000Z');
  const calls: ExternalSchedulerJob[] = [];
  const rows = await rowsFor({
    nowMs: now,
    loadPlannerRecord: (job) => {
      calls.push(job);
      if (job === 'live-scores') return Promise.reject(new Error('durable read exploded'));
      return Promise.resolve(
        okRecord(run('2026-10-03T00:02:00.000Z', schedule(GAME_DAY_DENSE), schedule(GAME_DAY_SLOW)))
      );
    },
  });
  // Positive control: the throwing branch was actually taken.
  assert.ok(calls.includes('live-scores'), 'the throwing loader ran');
  assert.equal(rowOf(rows, 'live-scores').planUnavailableReason, 'plan-store-failed');
  assert.equal(rowOf(rows, 'game-stats').planUnavailableReason, null);
  assert.equal(rowOf(rows, 'game-stats').cron, GAME_DAY_DENSE);
  assert.equal(rowOf(rows, 'odds').deliveryState, 'missing');
});

// ── 6. Outcome vocabulary ───────────────────────────────────────────────────
test('indeterminate refuses rather than rounding to either side', async () => {
  const now = ms('2026-10-03T20:30:00.000Z');
  const reached = await rowsFor({
    nowMs: now,
    records: {
      'live-scores': okRecord(
        run(
          '2026-10-03T00:02:00.000Z',
          schedule(GAME_DAY_DENSE),
          schedule(GAME_DAY_SLOW, { previousCron: DEAD_DAY_SLOW, outcome: 'indeterminate' })
        )
      ),
    },
  });
  // The SLOW schedule lost its basis; the dense one did not, so the row still
  // reports — and the fault is carried on the schedule it belongs to.
  const reachedRow = rowOf(reached, 'live-scores');
  assert.equal(reachedRow.planUnavailableReason, null, 'one schedule is not the row');
  assert.equal(
    reachedRow.schedules.find((entry) => entry.schedule === 'slow')?.unavailableReason,
    'plan-indeterminate'
  );
  assert.equal(
    reachedRow.schedules.find((entry) => entry.schedule === 'dense')?.unavailableReason,
    null
  );
  assert.equal(reachedRow.cron, GAME_DAY_DENSE, 'measured on the schedule that resolved');

  // An indeterminate run the walk never reaches does not poison a later one.
  const superseded = await rowsFor({
    nowMs: now,
    records: {
      'live-scores': okRecord(
        run(
          '2026-10-01T00:02:00.000Z',
          schedule(GAME_DAY_DENSE, { outcome: 'indeterminate' }),
          schedule(GAME_DAY_SLOW, { outcome: 'indeterminate' })
        ),
        run(
          '2026-10-03T00:02:00.000Z',
          schedule(GAME_DAY_DENSE),
          schedule(GAME_DAY_SLOW, { previousCron: DEAD_DAY_SLOW })
        )
      ),
    },
  });
  assert.equal(rowOf(superseded, 'live-scores').planUnavailableReason, null);
  assert.equal(rowOf(superseded, 'live-scores').cron, GAME_DAY_DENSE);
});

test('a refused or failed run leaves the previous cron in force', async () => {
  const now = ms('2026-10-03T20:30:00.000Z');
  for (const outcome of ['refused', 'failed'] as const) {
    const rows = await rowsFor({
      nowMs: now,
      records: {
        'live-scores': okRecord(
          run(
            '2026-10-03T00:02:00.000Z',
            // The planner DERIVED a narrow evening cron and sent nothing, so the
            // dead day's hourly schedule is what QStash still holds.
            schedule(GAME_DAY_DENSE, { previousCron: DEAD_DAY_SLOW, outcome }),
            schedule(GAME_DAY_SLOW, { previousCron: DEAD_DAY_SLOW, outcome })
          )
        ),
      },
      receipts: [
        { key: 'live-scores', value: receiptFor('live-scores', ms('2026-10-03T20:00:00.000Z')) },
      ],
    });
    const row = rowOf(rows, 'live-scores');
    assert.equal(row.cron, DEAD_DAY_SLOW, `${outcome}: the cron in force, not the intent`);
    assert.equal(row.deliveryState, 'on-time', outcome);
    assert.deepEqual(
      row.schedules.map((entry) => entry.cron),
      [DEAD_DAY_SLOW, DEAD_DAY_SLOW],
      `${outcome}: both schedules resolve to what was left in force`
    );
  }
});

test('a refusal with no recorded previous cron has no basis', async () => {
  const rows = await rowsFor({
    nowMs: ms('2026-10-03T20:30:00.000Z'),
    records: {
      'live-scores': okRecord(
        run(
          '2026-10-03T00:02:00.000Z',
          schedule(GAME_DAY_DENSE, { previousCron: null, outcome: 'failed' }),
          schedule(GAME_DAY_SLOW, { previousCron: null, outcome: 'failed' })
        )
      ),
    },
  });
  assert.equal(rowOf(rows, 'live-scores').planUnavailableReason, 'plan-incomplete');
});

// The contract-space check for Item 102's model item 6: the type admits
// contradictory action/outcome pairs, and this consumer is immune because what
// was left in force is a property of the OUTCOME alone.
test('action is not read: every action/outcome pair resolves on the outcome', async () => {
  const now = ms('2026-10-03T20:30:00.000Z');
  const outcomes: PlannerScheduleOutcome[] = [
    'confirmed',
    'unchanged',
    'refused',
    'failed',
    'indeterminate',
  ];
  let compared = 0;
  for (const outcome of outcomes) {
    const build = (action: PlannerScheduleAction) =>
      rowsFor({
        nowMs: now,
        records: {
          'live-scores': okRecord(
            run(
              '2026-10-03T00:02:00.000Z',
              schedule(GAME_DAY_DENSE, { previousCron: DEAD_DAY_SLOW, action, outcome }),
              schedule(GAME_DAY_SLOW, { previousCron: DEAD_DAY_SLOW, action, outcome })
            )
          ),
        },
      });
    const applied = rowOf(await build('applied'), 'live-scores');
    const skipped = rowOf(await build('skipped'), 'live-scores');
    assert.deepEqual(applied, skipped, `${outcome} resolves identically for both actions`);
    compared += 1;
  }
  assert.equal(compared, outcomes.length, 'every outcome was compared across both actions');
});

// ── 7. dense: null — the day with no dense phase ────────────────────────────
test('a dense-less day is carried by the slow schedule alone', async () => {
  const now = ms('2026-06-15T14:00:00.000Z');
  const record = okRecord(
    run('2026-06-15T00:02:00.000Z', null, schedule(DEAD_DAY_SLOW, { previousCron: DEAD_DAY_SLOW }))
  );
  const onTime = await rowsFor({
    nowMs: now,
    records: { 'live-scores': record },
    receipts: [
      { key: 'live-scores', value: receiptFor('live-scores', ms('2026-06-15T13:00:00.000Z')) },
    ],
  });
  const row = rowOf(onTime, 'live-scores');
  assert.equal(row.deliveryState, 'on-time');
  assert.equal(row.cron, DEAD_DAY_SLOW, 'the slow schedule governs when there is no dense phase');
  assert.deepEqual(measuredCrons(row), [DEAD_DAY_SLOW]);
  // `dense: null` is published as a schedule with no expression and no fault —
  // not as an omission, and not as an error.
  const denseEntry = row.schedules.find((entry) => entry.schedule === 'dense');
  assert.equal(denseEntry?.cron, null);
  assert.equal(denseEntry?.unavailableReason, null);

  // Detection continues: the slow schedule still catches an outage.
  const late = await rowsFor({
    nowMs: now,
    records: { 'live-scores': record },
    receipts: [
      { key: 'live-scores', value: receiptFor('live-scores', ms('2026-06-15T09:00:00.000Z')) },
    ],
  });
  assert.equal(rowOf(late, 'live-scores').deliveryState, 'late');
});

// ── 8. The reader takes the recorded expression, not the stored windows ─────
test('the recorded cron is read even when the stored windows disagree with it', async () => {
  const now = ms('2026-10-03T20:30:00.000Z');
  const withWindows: PollingPlannerRun = {
    ...run('2026-10-03T00:02:00.000Z', schedule(GAME_DAY_DENSE), schedule(GAME_DAY_SLOW)),
    // Windows that would synthesize a completely different pair of crons.
    windows: [
      {
        startMs: ms('2026-10-03T02:00:00.000Z'),
        denseEndMs: ms('2026-10-03T04:00:00.000Z'),
        slowEndMs: ms('2026-10-03T06:00:00.000Z'),
        kickoffCount: 1,
      },
    ],
  };
  const rows = await rowsFor({
    nowMs: now,
    records: { 'live-scores': okRecord(withWindows) },
  });
  assert.equal(rowOf(rows, 'live-scores').cron, GAME_DAY_DENSE);
});

// ── 9. Swept across the record type's axes, not slice 2's output ───────────
//
// NOT the whole contract — a finite sweep, and named for what it is. The axes
// are the ones `PollingPlannerRun` and `PlannerScheduleRun` admit: dense present
// or null, every outcome, a recorded previous cron or none, a consecutive
// `previousCron` that AGREES or CONTRADICTS, one run or two, two runs sharing an
// `at`, and a nonzero `droppedRuns` — crossed with expressions this module's
// parser accepts, including shapes the synthesizer never emits, two that match
// no instant at all, and one whose calendar is impossible. A generator seeded
// from `synthesizePollingCrons` output would test slice 2.
test("the record type's axes, swept, always yield a coherent row", async () => {
  const denseCrons: Array<string | null> = [
    null,
    GAME_DAY_DENSE,
    '*/7 * * * *',
    '0,30 6,7 * * *',
    'nonsense',
    '99 * * * *',
    // Every field parses; the calendar is impossible.
    '0 0 31 2 *',
  ];
  const slowCrons = ['1 * * * *', '1 0,1,2 * * *', '5 3 * * *', '* * * * 1', '30 * * * *'];
  const outcomes: PlannerScheduleOutcome[] = [
    'confirmed',
    'unchanged',
    'refused',
    'failed',
    'indeterminate',
  ];
  const previousCrons: Array<string | null> = [null, DEAD_DAY_SLOW];
  const clocks = [
    ms('2026-10-03T00:00:00.000Z'),
    ms('2026-10-03T00:02:00.000Z'),
    ms('2026-10-03T13:37:41.000Z'),
    ms('2026-10-03T23:59:59.999Z'),
  ];

  const fixedRows = new Map<ExternalSchedulerJob, Map<number, SchedulerDeliveryHealthRow>>();
  for (const job of EXTERNAL_SCHEDULER_JOBS) fixedRows.set(job, new Map());
  for (const now of clocks) {
    const snapshot = await rowsFor({ nowMs: now });
    for (const job of EXTERNAL_SCHEDULER_JOBS) fixedRows.get(job)!.set(now, rowOf(snapshot, job));
  }

  const reasonsSeen = new Set<string>();
  let resolved = 0;
  let unresolved = 0;
  let notDue = 0;
  let contradictions = 0;
  let shapes = 0;

  for (const denseCron of denseCrons) {
    for (const slowCron of slowCrons) {
      for (const outcome of outcomes) {
        for (const previousCron of previousCrons) {
          for (const priorShape of ['none', 'agreeing', 'contradicting', 'tied'] as const) {
            const runs: PollingPlannerRun[] = [];
            // The preceding run's own expression. `previousCron` on the newer
            // run either matches it, contradicts it, or is absent — the three
            // transition shapes the record admits.
            //
            // An earlier version set this to `DEAD_DAY_SLOW` for BOTH the
            // agreeing and contradicting branches, so the axis never once
            // constructed a disagreement and differed only by `droppedRuns`. A
            // contradiction needs a non-null `previousCron` that DIFFERS: absence
            // of evidence is not disagreement.
            const priorCron =
              priorShape === 'contradicting' ? '7 * * * *' : (previousCron ?? DEAD_DAY_SLOW);
            if (priorShape === 'contradicting' && previousCron !== null) contradictions += 1;
            if (priorShape !== 'none') {
              runs.push(
                run(
                  // `tied` puts two runs at the SAME instant, which the store
                  // permits and refuses to deduplicate.
                  priorShape === 'tied' ? '2026-10-03T00:02:00.000Z' : '2026-10-02T00:02:00.000Z',
                  schedule(priorCron, { previousCron: DEAD_DAY_SLOW }),
                  schedule(priorCron, { previousCron: DEAD_DAY_SLOW })
                )
              );
            }
            runs.push(
              run(
                '2026-10-03T00:02:00.000Z',
                denseCron === null ? null : schedule(denseCron, { previousCron, outcome }),
                schedule(slowCron, { previousCron, outcome })
              )
            );
            // A nonzero drop count is a readable series with holes; the reader
            // must not treat it as absence, and must not blank on it either.
            const record: PollingPlannerReadResult = {
              kind: 'ok',
              series: { runs, droppedRuns: priorShape === 'contradicting' ? 3 : 0 },
            };
            for (const now of clocks) {
              shapes += 1;
              const snapshot = await rowsFor({
                nowMs: now,
                records: { 'live-scores': record, 'game-stats': record },
              });

              for (const job of EXTERNAL_SCHEDULER_JOBS) {
                const row = rowOf(snapshot, job);
                const label = `${job} dense=${denseCron} slow=${slowCron} ${outcome} prev=${previousCron} prior=${priorShape} @${at(now)}`;

                if (!isPlannerOwnedJob(job)) {
                  // No record is ever read for these, whatever is stored.
                  assert.deepEqual(row, fixedRows.get(job)!.get(now), label);
                  continue;
                }

                // Reasons are collected PER SCHEDULE, because that is where they
                // now live: one schedule losing its basis leaves the row
                // reporting on the other, so a row-level sweep would stop
                // reaching `plan-unreadable` entirely.
                for (const entry of row.schedules) {
                  if (entry.unavailableReason !== null) reasonsSeen.add(entry.unavailableReason);
                }

                if (row.planUnavailableReason !== null) {
                  unresolved += 1;
                  assert.equal(row.deliveryState, 'unavailable', label);
                  assert.equal(row.cron, null, label);
                  assert.equal(row.graceMs, null, label);
                  // A ROW-level reason means NO schedule is known — a silent
                  // dense phase carries no expression and no fault, so it is not
                  // required to carry the reason, only to have no expression.
                  assert.ok(row.schedules.length > 0, label);
                  assert.ok(
                    row.schedules.every((entry) => entry.cron === null),
                    label
                  );
                  assert.ok(
                    row.schedules.some((entry) => entry.unavailableReason !== null),
                    label
                  );
                  assert.equal(row.requiredStartedAt, null, label);
                  assert.equal(row.receipt, null, label);
                  // NEVER the fixed contract: that is inherited item 3.
                  assert.notEqual(
                    row.cadenceLabel,
                    schedulerDeliveryPolicy(job).cadenceLabel,
                    label
                  );
                  continue;
                }

                resolved += 1;
                assert.ok(row.schedules.length > 0, label);
                assert.ok(row.cron !== null && row.graceMs !== null, label);
                // With no receipts loaded, a resolved row is `missing` — never
                // an on-time/late verdict invented out of the plan alone.
                assert.equal(row.deliveryState, 'missing', label);
                const measured = row.schedules.filter((e) => e.requiredStartedAt !== null);
                if (measured.length === 0) {
                  // Known but nothing due yet — a real state, and NOT a refusal.
                  assert.equal(row.requiredStartedAt, null, label);
                  notDue += 1;
                } else {
                  assert.equal(
                    ms(row.requiredStartedAt!),
                    Math.max(...measured.map((entry) => ms(entry.requiredStartedAt!))),
                    label
                  );
                }
                for (const entry of measured) {
                  assert.equal(
                    previousScheduleSlotMs(entry.cron!, ms(entry.requiredStartedAt!)),
                    ms(entry.requiredStartedAt!),
                    `${label}: ${entry.cron} fires at its own slot`
                  );
                  assert.ok(
                    ms(entry.requiredStartedAt!) <= Math.floor((now - entry.graceMs!) / MIN) * MIN,
                    `${label}: the slot is at or before now minus its own grace`
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  assert.equal(shapes, 7 * 5 * 5 * 2 * 4 * 4, 'the whole product was swept');
  // The sweep proves nothing about a branch it never entered.
  assert.ok(resolved > 0 && unresolved > 0, 'both outcomes were reached');
  assert.ok(notDue > 0, 'and the known-but-not-yet-due state, which is neither');
  assert.ok(contradictions > 0, 'the contradiction axis actually constructed disagreements');
  assert.deepEqual(
    [...reasonsSeen].sort(),
    ['plan-incomplete', 'plan-indeterminate', 'plan-unreadable'],
    'every reason the record path can produce was reached'
  );
});

// ── 10. Review remediation — every fix carries its own regression test ──────

// REGRESSION TEST for the first run, where `previousCron` is null by definition
// (`pollingPlannerRecord.ts` documents it as "a first run"). The pre-fix walk
// propagated that unknown span to the whole row, so on the first day slice 4
// ever ran, both rows read `unavailable` for every hour before the dense window.
test('an unknown older span drops ONE schedule, not the row', async () => {
  const now = ms('2026-10-03T10:00:00.000Z');
  const rows = await rowsFor({
    nowMs: now,
    records: {
      'live-scores': okRecord(
        run(
          '2026-10-03T00:02:00.000Z',
          schedule(GAME_DAY_DENSE, { previousCron: null }),
          schedule(GAME_DAY_SLOW, { previousCron: null })
        )
      ),
    },
  });
  const row = rowOf(rows, 'live-scores');
  assert.equal(row.planUnavailableReason, null, 'the row still reports what it can');
  // The dense schedule is not yet due today and its history is unknown, so it
  // contributes nothing; the slow schedule carries detection on its own, and the
  // row's own facts name THAT schedule.
  assert.equal(row.cron, GAME_DAY_SLOW);
  assert.deepEqual(measuredCrons(row), [GAME_DAY_SLOW]);
  assert.equal(
    row.schedules.find((entry) => entry.schedule === 'dense')?.cron,
    GAME_DAY_DENSE,
    'the dense expression is still known and published'
  );
  assert.equal(row.requiredStartedAt, '2026-10-03T07:01:00.000Z');
});

// REGRESSION TEST for the transition evidence. `previousCron` on the FOLLOWING
// run is a direct observation of what was live; the pre-fix timeline ignored it
// and asserted the preceding run's intent across the span regardless.
test('a contradicted span stops contributing, and an agreeing one does not', async () => {
  const now = ms('2026-10-03T00:06:00.000Z');
  const yesterdayDense = '*/3 12,13 * * *';
  const build = (slowPreviousCron: string, droppedRuns: number) =>
    rowsFor({
      nowMs: now,
      records: {
        'live-scores': {
          kind: 'ok',
          series: {
            runs: [
              run(
                '2026-10-02T00:02:00.000Z',
                schedule(yesterdayDense, { previousCron: DEAD_DAY_SLOW }),
                schedule(DEAD_DAY_SLOW, { previousCron: DEAD_DAY_SLOW })
              ),
              run(
                '2026-10-03T00:02:00.000Z',
                schedule(GAME_DAY_DENSE, { previousCron: yesterdayDense }),
                schedule(GAME_DAY_SLOW, { previousCron: slowPreviousCron })
              ),
            ],
            droppedRuns,
          },
        },
      },
    });

  // Agreement: the span is known and both schedules contribute.
  const agreeing = rowOf(await build(DEAD_DAY_SLOW, 0), 'live-scores');
  assert.deepEqual(measuredCrons(agreeing).sort(), [yesterdayDense, DEAD_DAY_SLOW].sort());
  assert.equal(agreeing.requiredStartedAt, '2026-10-02T22:00:00.000Z');

  // Disagreement — a row dropped between the two, or a cron changed outside the
  // planner. The slow schedule's span is no longer known, so it stops
  // contributing; the dense one, whose transition still agrees, does not.
  const contradicted = rowOf(await build('5 * * * *', 1), 'live-scores');
  assert.equal(contradicted.planUnavailableReason, null);
  assert.deepEqual(measuredCrons(contradicted), [yesterdayDense]);
  assert.equal(contradicted.requiredStartedAt, '2026-10-02T13:57:00.000Z');
});

// REGRESSION TEST for grace crossing expressions. Pre-fix, one grace was taken
// from the CURRENT expression and applied to a slot belonging to an older one.
test("a slot is judged with its OWN expression's grace, not the current one's", async () => {
  const now = ms('2026-10-03T00:03:00.000Z');
  const receiptMs = ms('2026-10-02T22:30:00.000Z');
  const rows = await rowsFor({
    nowMs: now,
    records: {
      'live-scores': okRecord(
        run(
          '2026-10-02T00:02:00.000Z',
          schedule(DEAD_DAY_SLOW, { previousCron: DEAD_DAY_SLOW }),
          schedule(DEAD_DAY_SLOW, { previousCron: DEAD_DAY_SLOW })
        ),
        run(
          '2026-10-03T00:02:00.000Z',
          // Hourly yesterday, three-minute today: two hours of tolerance
          // yesterday, six minutes today.
          schedule('*/3 * * * *', { previousCron: DEAD_DAY_SLOW }),
          schedule('*/3 * * * *', { previousCron: DEAD_DAY_SLOW })
        )
      ),
    },
    receipts: [{ key: 'live-scores', value: receiptFor('live-scores', receiptMs) }],
  });
  const row = rowOf(rows, 'live-scores');

  const entry = row.schedules[0];
  assert.ok(entry);
  assert.equal(entry.cron, DEAD_DAY_SLOW, 'the slot belongs to the older expression');
  assert.equal(entry.graceMs, 2 * HOUR, "and carries that expression's own grace");
  assert.equal(entry.requiredStartedAt, '2026-10-02T22:00:00.000Z');
  assert.equal(row.deliveryState, 'on-time');

  // Pre-fix, the current six-minute grace was applied to the hourly span, which
  // demanded the 23:00 slot and read this receipt `late` an hour early.
  assert.equal(
    previousScheduleSlotMs(DEAD_DAY_SLOW, now - 6 * MIN),
    ms('2026-10-02T23:00:00.000Z')
  );
  assert.ok(ms('2026-10-02T23:00:00.000Z') > receiptMs);
});

// REGRESSION TEST for the future-skew window. The store admits a run up to five
// minutes ahead; the pre-fix code took the newest segment unconditionally, so a
// not-yet-started plan supplied the display, the grace, and an `indeterminate`
// refusal.
test('a run that has not started yet governs nothing', async () => {
  const now = ms('2026-10-03T00:04:00.000Z');
  const rows = await rowsFor({
    nowMs: now,
    records: {
      'live-scores': okRecord(
        run(
          '2026-10-03T00:02:00.000Z',
          schedule('*/3 * * * *', { previousCron: DEAD_DAY_SLOW }),
          schedule('*/3 * * * *', { previousCron: DEAD_DAY_SLOW })
        ),
        run(
          // Three minutes ahead of `now`, inside POLLING_PLANNER_FUTURE_SKEW_MS.
          '2026-10-03T00:07:00.000Z',
          schedule(GAME_DAY_DENSE, { previousCron: '*/3 * * * *', outcome: 'indeterminate' }),
          schedule(GAME_DAY_SLOW, { previousCron: '*/3 * * * *', outcome: 'indeterminate' })
        )
      ),
    },
  });
  const row = rowOf(rows, 'live-scores');
  assert.equal(row.planUnavailableReason, null, 'a future run cannot refuse the present');
  // The cadence describes the span that HAS started; the not-yet-started run's
  // `indeterminate` neither refuses the row nor supplies its display.
  assert.match(row.cadenceLabel, /every 3 min/);
  assert.doesNotMatch(row.cadenceLabel, /unknown/);
});

// REGRESSION TEST: readable fields are not proof an expression can fire.
test('a recorded expression that matches no instant is a corrupt record', async () => {
  const rows = await rowsFor({
    nowMs: ms('2026-10-03T00:06:00.000Z'),
    records: {
      'live-scores': okRecord(
        run(
          '2026-10-03T00:02:00.000Z',
          // Every field parses; February has no thirty-first.
          schedule('0 0 31 2 *', { previousCron: DEAD_DAY_SLOW }),
          schedule(DEAD_DAY_SLOW, { previousCron: DEAD_DAY_SLOW })
        )
      ),
    },
  });
  const row = rowOf(rows, 'live-scores');
  // It is NOT silently dropped while the sibling reports healthy — the fault is
  // named on the schedule that has it.
  assert.equal(
    row.schedules.find((entry) => entry.schedule === 'dense')?.unavailableReason,
    'plan-unreadable'
  );
  // And the slow schedule, which is fine, still reports.
  assert.equal(row.planUnavailableReason, null);
  assert.deepEqual(measuredCrons(row), [DEAD_DAY_SLOW]);
});

// REGRESSION TEST for the cadence label, which took the dispatch minute from
// this build's `SLOW_OFFSET_MINUTE` instead of from the record.
test('the cadence label prints the RECORDED dispatch minute', async () => {
  const rows = await rowsFor({
    nowMs: ms('2026-10-03T12:00:00.000Z'),
    records: {
      'live-scores': okRecord(
        run(
          '2026-10-03T00:02:00.000Z',
          null,
          schedule('30 * * * *', { previousCron: '30 * * * *' })
        )
      ),
    },
  });
  const row = rowOf(rows, 'live-scores');
  assert.equal(row.cron, '30 * * * *');
  assert.match(row.cadenceLabel, /:30/);
  assert.doesNotMatch(
    row.cadenceLabel,
    /:01/,
    'not the constant this build would have synthesized'
  );
});

// The per-row `unavailable` state is reachable ONLY from a plan fault: a receipt
// scope failure has no per-job resolution and takes every row with it, which
// `systemHealthIssues` answers with one global issue instead. This pins that, so
// the null-reason branch there stays honestly labelled as defensive.
test('a receipt-scope failure takes every row, so a per-row unavailable is always plan-caused', async () => {
  const snapshot = await readSchedulerDeliveryHealth({
    nowMs: ms('2026-10-03T20:30:00.000Z'),
    loadEntries: () => Promise.reject(new Error('scope read exploded')),
    loadPlannerRecord: () => Promise.resolve({ kind: 'absent' }),
  });
  assert.equal(snapshot.jobs.length, EXTERNAL_SCHEDULER_JOBS.length);
  for (const row of snapshot.jobs) {
    assert.equal(row.deliveryState, 'unavailable', row.job);
    assert.equal(row.planUnavailableReason, null, row.job);
  }
});

// ── 11. The model re-derivation — per-schedule state ────────────────────────

// REGRESSION TEST. Pre-fix, `resolveDeliverySchedules` returned the moment DENSE
// was unresolved, before `slow` was consulted: one exit-4 on one of two upserts
// switched off `missing` and `late` for the whole job until the next planner run.
test('one schedule losing its basis costs the row that schedule, not its sibling', async () => {
  const now = ms('2026-10-03T20:30:00.000Z');
  const rows = await rowsFor({
    nowMs: now,
    records: {
      'live-scores': okRecord(
        run(
          '2026-10-03T00:02:00.000Z',
          schedule(GAME_DAY_DENSE, { previousCron: DEAD_DAY_SLOW, outcome: 'indeterminate' }),
          schedule('1 * * * *', { previousCron: DEAD_DAY_SLOW })
        )
      ),
    },
    receipts: [
      { key: 'live-scores', value: receiptFor('live-scores', ms('2026-10-03T10:00:00.000Z')) },
    ],
  });
  const row = rowOf(rows, 'live-scores');

  // The slow schedule is fully determinate, so the row still judges delivery —
  // and correctly finds this receipt ten hours stale.
  assert.equal(row.planUnavailableReason, null);
  assert.equal(row.deliveryState, 'late');
  assert.equal(row.cron, '1 * * * *');
  assert.deepEqual(measuredCrons(row), ['1 * * * *']);
  // And the dense schedule's fault is carried where it belongs, not discarded.
  assert.equal(
    row.schedules.find((entry) => entry.schedule === 'dense')?.unavailableReason,
    'plan-indeterminate'
  );
});

// REGRESSION TEST for the planner's FIRST run — the day slice 4's cutover
// begins. `previousCron` is null by definition there, so the pre-run span is
// unknown and the slow grace has not cleared the first in-span slot. Pre-fix
// that produced 176 measured minutes of `unavailable`; an unknown PAST cannot
// create an obligation, so the honest answer is that nothing is due yet.
test('the planner first run is never unavailable — an unknown past creates no obligation', async () => {
  const record = okRecord(
    run('2026-09-04T00:05:00.000Z', null, schedule('1 * * * *', { previousCron: null }))
  );
  let blanked = 0;
  let sampled = 0;
  for (
    let now = ms('2026-09-04T00:05:00.000Z');
    now <= ms('2026-09-04T06:00:00.000Z');
    now += 5 * MIN
  ) {
    const row = rowOf(
      await rowsFor({ nowMs: now, records: { 'live-scores': record } }),
      'live-scores'
    );
    if (row.planUnavailableReason !== null) blanked += 1;
    sampled += 1;
  }
  assert.equal(blanked, 0, 'not one minute of the cutover morning is blanked');
  assert.ok(sampled > 60, 'and the whole morning was sampled');

  // Before its first slot comes due the row has no required slot at all — which
  // is NOT the same as having no basis, and cannot be late.
  const early = rowOf(
    await rowsFor({
      nowMs: ms('2026-09-04T01:00:00.000Z'),
      records: { 'live-scores': record },
      receipts: [
        { key: 'live-scores', value: receiptFor('live-scores', ms('2026-09-04T00:30:00.000Z')) },
      ],
    }),
    'live-scores'
  );
  assert.equal(early.requiredStartedAt, null);
  assert.equal(early.deliveryState, 'on-time', 'a row with no obligation cannot be late');
  assert.equal(early.cron, '1 * * * *', 'and it still names what the job is scheduled to run');
});

// REGRESSION TEST. An eight-day probe cannot separate "fires never" from "fires
// rarely", and reported a perfectly valid monthly expression as a corrupt
// record. The calendar answers it exactly.
test('a sparse expression is not corrupt, and an impossible calendar still is', async () => {
  const at15th = ms('2026-10-15T12:00:00.000Z');
  const sparse = rowOf(
    await rowsFor({
      nowMs: at15th,
      records: {
        'live-scores': okRecord(
          run(
            '2026-09-20T00:02:00.000Z',
            null,
            schedule('0 0 1 * *', { previousCron: '0 0 1 * *' })
          )
        ),
      },
    }),
    'live-scores'
  );
  assert.equal(sparse.planUnavailableReason, null, 'monthly is sparse, not corrupt');
  assert.equal(sparse.cron, '0 0 1 * *');

  const impossible = rowOf(
    await rowsFor({
      nowMs: at15th,
      records: {
        'live-scores': okRecord(
          // February has no thirty-first, in any year.
          run(
            '2026-09-20T00:02:00.000Z',
            null,
            schedule('0 0 31 2 *', { previousCron: '0 0 31 2 *' })
          )
        ),
      },
    }),
    'live-scores'
  );
  assert.equal(impossible.planUnavailableReason, 'plan-unreadable');

  // A restricted day-of-week keeps an expression satisfiable whatever its
  // day-of-month says — cron matches on EITHER when both are restricted.
  const dowRescued = rowOf(
    await rowsFor({
      nowMs: at15th,
      records: {
        'live-scores': okRecord(
          run(
            '2026-09-20T00:02:00.000Z',
            null,
            schedule('0 0 31 2 1', { previousCron: '0 0 31 2 1' })
          )
        ),
      },
    }),
    'live-scores'
  );
  assert.equal(dowRescued.planUnavailableReason, null);
});

// REGRESSION TEST for the parser. It defaulted missing fields to `*` and ignored
// extra ones, so a six-field seconds-first expression read as minute 0 of every
// third hour — plausible, wrong, and silent, on durable operator-writable input.
test('an expression with the wrong field count is unreadable, not reinterpreted', async () => {
  for (const malformed of ['0 */3 * * * *', '*/3', '']) {
    const row = rowOf(
      await rowsFor({
        nowMs: ms('2026-10-03T10:00:00.000Z'),
        records: {
          'live-scores': okRecord(
            run('2026-10-03T00:02:00.000Z', null, schedule(malformed, { previousCron: malformed }))
          ),
        },
      }),
      'live-scores'
    );
    assert.equal(row.planUnavailableReason, 'plan-unreadable', JSON.stringify(malformed));
  }
  // And the shared slot walk fails CLOSED on the same shapes rather than
  // inventing a slot from a reinterpreted expression.
  const hour = ms('2026-10-03T10:00:00.000Z');
  assert.ok(previousScheduleSlotMs('0 */3 * * * *', hour) < hour - 300 * 24 * HOUR);
  assert.ok(previousScheduleSlotMs('*/3', hour) < hour - 300 * 24 * HOUR);
});

// REGRESSION TEST. A `refused` run leaves ONE expression governing both
// schedules, and describing it twice told the operator the job runs two
// identical schedules.
test('the cadence label does not repeat one expression for two schedules', async () => {
  const row = rowOf(
    await rowsFor({
      nowMs: ms('2026-10-03T20:30:00.000Z'),
      records: {
        'live-scores': okRecord(
          run(
            '2026-10-03T00:02:00.000Z',
            schedule(GAME_DAY_DENSE, { previousCron: DEAD_DAY_SLOW, outcome: 'failed' }),
            schedule(GAME_DAY_SLOW, { previousCron: DEAD_DAY_SLOW, outcome: 'failed' })
          )
        ),
      },
    }),
    'live-scores'
  );
  assert.deepEqual(measuredCrons(row), [DEAD_DAY_SLOW, DEAD_DAY_SLOW]);
  assert.equal(row.cadenceLabel.split(', ').length, 1, row.cadenceLabel);
});

// ── 12. Two P1s the confirming pass found in the re-derivation ──────────────

// REGRESSION TEST. "Not due" must mean the SCHEDULE has no obligation, never
// that the LOOKBACK could not reach one. An eight-day walk could not see a
// monthly cron's obligation, so a receipt fifteen days stale read `on-time` —
// a real outage masked by the bound rather than by the schedule.
test('a sparse schedule that IS overdue reads late, not "nothing due"', async () => {
  const record = okRecord(
    run('2026-09-20T00:02:00.000Z', null, schedule('0 0 1 * *', { previousCron: '0 0 1 * *' }))
  );
  const stale = rowOf(
    await rowsFor({
      nowMs: ms('2026-10-15T12:00:00.000Z'),
      records: { 'live-scores': record },
      receipts: [
        { key: 'live-scores', value: receiptFor('live-scores', ms('2026-09-30T00:00:00.000Z')) },
      ],
    }),
    'live-scores'
  );
  assert.equal(stale.deliveryState, 'late');
  assert.equal(stale.requiredStartedAt, '2026-10-01T00:00:00.000Z');

  // Positive control: the same schedule with a receipt that DID answer the
  // October slot is on-time, so the assertion above detects the outage rather
  // than the cadence.
  const answered = rowOf(
    await rowsFor({
      nowMs: ms('2026-10-15T12:00:00.000Z'),
      records: { 'live-scores': record },
      receipts: [
        { key: 'live-scores', value: receiptFor('live-scores', ms('2026-10-01T00:00:00.000Z')) },
      ],
    }),
    'live-scores'
  );
  assert.equal(answered.deliveryState, 'on-time');
});

// REGRESSION TEST. The following run's `previousCron` is a DIRECT OBSERVATION of
// what was live, and an `indeterminate` run is exactly where the inference is
// weakest. Discarding it dropped a known obligation and read a fourteen-hour
// stale receipt as `on-time`.
test('an observation on the following run resolves an indeterminate span', async () => {
  const receiptMs = ms('2026-10-02T10:00:00.000Z');
  const build = (earlier: 'indeterminate' | 'confirmed') =>
    rowsFor({
      nowMs: ms('2026-10-03T00:06:00.000Z'),
      records: {
        'live-scores': okRecord(
          run(
            '2026-10-01T00:02:00.000Z',
            null,
            schedule(DEAD_DAY_SLOW, { previousCron: DEAD_DAY_SLOW, outcome: earlier })
          ),
          run(
            '2026-10-03T00:02:00.000Z',
            null,
            schedule(DEAD_DAY_SLOW, { previousCron: DEAD_DAY_SLOW })
          )
        ),
      },
      receipts: [{ key: 'live-scores', value: receiptFor('live-scores', receiptMs) }],
    });

  const resolved = rowOf(await build('indeterminate'), 'live-scores');
  const control = rowOf(await build('confirmed'), 'live-scores');
  assert.equal(resolved.deliveryState, 'late');
  assert.equal(resolved.requiredStartedAt, '2026-10-02T22:00:00.000Z');
  // The observation makes the indeterminate run answer EXACTLY as a confirmed
  // one does, because the record says what ended up live either way.
  assert.deepEqual(resolved, control);
});

// The observation resolves; it does not override. A run that CONTRADICTS the
// span before it still costs that schedule its slot.
test('an observation that contradicts a recorded intent still unresolves the span', async () => {
  const row = rowOf(
    await rowsFor({
      nowMs: ms('2026-10-03T00:06:00.000Z'),
      records: {
        'live-scores': okRecord(
          run(
            '2026-10-01T00:02:00.000Z',
            null,
            schedule('7 * * * *', { previousCron: '7 * * * *' })
          ),
          run(
            '2026-10-03T00:02:00.000Z',
            null,
            schedule(GAME_DAY_SLOW, { previousCron: DEAD_DAY_SLOW })
          )
        ),
      },
    }),
    'live-scores'
  );
  assert.deepEqual(measuredCrons(row), [], 'the contradicted span yields no slot');
  assert.equal(row.requiredStartedAt, null);
});

// ── 13. The confirming pass on the re-derivation ────────────────────────────

// REGRESSION TEST. An unrecognized part inside a comma list used to be DROPPED
// while its siblings were kept, so `8,12-23` parsed to hour 8 alone — and the
// record's own stored pattern admits `-`. Measured on the shipped classifier
// before the fix: a receipt 14h33m stale classified `on-time` against a schedule
// silently narrowed from twelve hours to one, beside a `cron` field still
// naming the full expression.
test('a range inside a comma list is unreadable, never silently dropped', async () => {
  const narrowed = '*/3 8,12-23 * * *';
  const row = rowOf(
    await rowsFor({
      nowMs: ms('2026-10-03T23:30:00.000Z'),
      records: {
        'live-scores': okRecord(
          run(
            '2026-10-03T00:02:00.000Z',
            schedule(narrowed, { previousCron: DEAD_DAY_SLOW }),
            schedule('1 0 * * *', { previousCron: DEAD_DAY_SLOW })
          )
        ),
      },
      receipts: [
        { key: 'live-scores', value: receiptFor('live-scores', ms('2026-10-03T08:57:00.000Z')) },
      ],
    }),
    'live-scores'
  );
  // The corrupt expression SURFACES instead of narrowing the schedule.
  assert.equal(
    row.schedules.find((entry) => entry.schedule === 'dense')?.unavailableReason,
    'plan-unreadable'
  );
  assert.ok(
    !measuredCrons(row).includes(narrowed),
    'and it is never measured against as if it had parsed'
  );

  // The parser fails closed on every unreadable part, rather than keeping the
  // parts it happens to recognise.
  const hour = ms('2026-10-03T12:00:00.000Z');
  for (const unreadable of ['*/3 8,12-23 * * *', '0 1-5 * * *', '0 x * * *', '*/0 * * * *']) {
    assert.ok(
      previousScheduleSlotMs(unreadable, hour) < hour - 300 * 24 * HOUR,
      `${unreadable} answers from the backstop, not from a partial parse`
    );
  }
  // Positive control: the shapes it DOES read still resolve normally.
  assert.equal(previousScheduleSlotMs('0 8,12 * * *', hour), ms('2026-10-03T12:00:00.000Z'));
});

// REGRESSION TEST. An hourly STEP across a single hour fires once a day, and it
// is the planner's own idle-slot shape — the label an operator reads most often
// on a quiet day promised twenty-four firings where there is one.
test('a once-daily schedule is not labelled hourly', async () => {
  const row = rowOf(
    await rowsFor({
      nowMs: ms('2026-10-03T12:00:00.000Z'),
      records: {
        'live-scores': okRecord(
          run(
            '2026-10-03T00:02:00.000Z',
            null,
            schedule('1 0 * * *', { previousCron: '1 0 * * *' })
          )
        ),
      },
    }),
    'live-scores'
  );
  assert.equal(row.cadenceLabel, 'once daily (00:01 UTC)');

  // Positive control: a genuinely hourly expression keeps the hourly wording.
  const hourly = rowOf(
    await rowsFor({
      nowMs: ms('2026-10-03T12:00:00.000Z'),
      records: {
        'live-scores': okRecord(
          run(
            '2026-10-03T00:02:00.000Z',
            null,
            schedule('1 * * * *', { previousCron: '1 * * * *' })
          )
        ),
      },
    }),
    'live-scores'
  );
  assert.equal(hourly.cadenceLabel, 'hourly (:01 UTC)');
});

// ── 14. Both reviewers on e812b3c0 ─────────────────────────────────────────

// REGRESSION TEST. `Number('')` is 0, so an EMPTY comma part — a trailing or
// doubled comma, which the record's stored pattern admits — was accepted as slot
// zero in any field where 0 is in range. Same failure as the dropped range, one
// character over, and it survived that fix because the fix guarded the VALUE and
// not the SHAPE.
test('an empty comma part is unreadable, and does not invent slot zero', () => {
  const hour = ms('2026-10-03T12:00:00.000Z');
  const farPast = hour - 300 * 24 * HOUR;
  for (const malformed of [
    '*/3 19,20,21,22,23, * * *',
    '0,, * * * *',
    ' 0 * * * *,',
    '*/3 8,12-23 * * *',
    '0 1-5 * * *',
  ]) {
    assert.ok(
      previousScheduleSlotMs(malformed, hour) < farPast,
      `${JSON.stringify(malformed)} must not resolve to a slot`
    );
  }
  // Positive control: the shapes the parser DOES accept still resolve to real
  // slots, so the loop above is rejecting malformed input rather than everything.
  assert.equal(
    previousScheduleSlotMs('*/3 19,20,21,22,23 * * *', hour),
    ms('2026-10-02T23:57:00.000Z')
  );
  assert.equal(previousScheduleSlotMs('0 8,12 * * *', hour), hour);
});

// REGRESSION TEST. The bound was derived from the CURRENT expression while the
// walk crosses OLDER spans, so a monthly schedule replaced by a not-yet-due
// daily one had its real obligation skipped by the daily cron's narrower floor.
test('a bound is never narrower than the span the walk actually reaches', async () => {
  const row = rowOf(
    await rowsFor({
      nowMs: ms('2026-10-15T12:00:00.000Z'),
      records: {
        'live-scores': okRecord(
          run(
            '2026-08-01T00:02:00.000Z',
            null,
            schedule('0 0 1 * *', { previousCron: '0 0 1 * *' })
          ),
          run(
            '2026-10-15T00:02:00.000Z',
            null,
            schedule('1 0 * * *', { previousCron: '0 0 1 * *' })
          )
        ),
      },
      receipts: [
        { key: 'live-scores', value: receiptFor('live-scores', ms('2026-09-30T00:00:00.000Z')) },
      ],
    }),
    'live-scores'
  );
  assert.equal(row.deliveryState, 'late');
  assert.equal(row.requiredStartedAt, '2026-10-01T00:00:00.000Z');
});

// REGRESSION TEST. A satisfiable expression's obligation can be YEARS back, and
// no fixed window sized in days can be the answer — the walk steps the calendar
// instead, so there is no cadence left to outrun it.
test('an obligation years back is still found', async () => {
  const row = rowOf(
    await rowsFor({
      nowMs: ms('2026-10-15T12:00:00.000Z'),
      records: {
        'live-scores': okRecord(
          run(
            '2024-01-01T00:02:00.000Z',
            null,
            schedule('0 0 29 2 *', { previousCron: '0 0 29 2 *' })
          )
        ),
      },
      receipts: [
        { key: 'live-scores', value: receiptFor('live-scores', ms('2024-02-28T00:00:00.000Z')) },
      ],
    }),
    'live-scores'
  );
  assert.equal(row.deliveryState, 'late');
  assert.equal(row.requiredStartedAt, '2024-02-29T00:00:00.000Z');
});

// The walk must be cheap enough to run on every System Health load. Stepping
// every MINUTE across a sparse expression was measured at 132 ms of blocking CPU
// per job — on the admin page of a project whose entire point is an Active CPU
// budget.
test('a sparse expression costs a calendar walk, not half a million Date allocations', () => {
  const now = ms('2026-10-15T12:00:00.000Z');
  for (const cron of ['0 0 29 2 *', '0 0 1 1 *', '0 0 1 * *']) {
    const started = process.hrtime.bigint();
    for (let i = 0; i < 20; i += 1) previousScheduleSlotMs(cron, now);
    const perCallMs = Number(process.hrtime.bigint() - started) / 20 / 1e6;
    assert.ok(perCallMs < 10, `${cron} took ${perCallMs.toFixed(2)} ms/call`);
  }
});

// REGRESSION TEST. "Once daily" is a claim about the CALENDAR, not the clock: a
// weekly expression fires once, on one weekday, and was labelled once daily.
test('a weekly expression is not labelled once daily', async () => {
  const label = async (cron: string) =>
    rowOf(
      await rowsFor({
        nowMs: ms('2026-10-03T18:00:00.000Z'),
        records: {
          'live-scores': okRecord(
            run('2026-10-01T00:02:00.000Z', null, schedule(cron, { previousCron: cron }))
          ),
        },
      }),
      'live-scores'
    ).cadenceLabel;

  assert.doesNotMatch(await label('0 12 * * 2'), /once daily/);
  assert.match(await label('0 12 * * 2'), /on selected days/);
  // Positive control: a genuinely once-a-day expression keeps the wording.
  assert.equal(await label('1 0 * * *'), 'once daily (00:01 UTC)');
});
