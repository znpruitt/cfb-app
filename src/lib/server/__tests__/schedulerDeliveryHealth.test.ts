import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CRON as LIVE_SCORES_CRON } from '../../../../scripts/manage-live-scores-schedule';
import { CRON as GAME_STATS_CRON } from '../../../../scripts/manage-game-stats-schedule';
import { CRON as ODDS_CRON } from '../../../../scripts/manage-odds-schedule';
import { CRON as RANKINGS_CRON } from '../../../../scripts/manage-rankings-schedule';
import { CRON as SCHEDULE_REFRESH_CRON } from '../../../../scripts/manage-schedule-refresh-schedule';
import {
  buildSchedulerExecutionReceipt,
  EXTERNAL_SCHEDULER_JOBS,
  rankingsYearsTarget,
  scheduleYearsTarget,
  seasonRolloverYearsTarget,
  seasonTransitionYearsTarget,
  schedulerSourceForJob,
  type ExternalSchedulerJob,
  type SchedulerExecutionReceipt,
  type SchedulerExecutionReceiptInput,
  type SchedulerExecutionResult,
  type SchedulerExecutionTarget,
} from '@/lib/server/schedulerExecutionStatus';
import {
  previousScheduleSlotMs,
  readSchedulerDeliveryHealth,
  schedulerDeliveryPolicies,
  type SchedulerDeliveryState,
} from '@/lib/server/schedulerDeliveryHealth';

// PLATFORM-086F2E2B — the cache-only reader + schedule-slot delivery classifier.
// All boundary tests use FIXED UTC instants (never the machine clock).

const MIN = 60_000;
const HOUR = 60 * MIN;

const ms = (iso: string): number => Date.parse(iso);

/** A minimal valid target for each job. */
function targetFor(job: ExternalSchedulerJob): SchedulerExecutionTarget {
  switch (job) {
    case 'live-scores':
      return { kind: 'live-scores', year: 2026, mode: null, targetGames: 0, targetPartitions: 0 };
    case 'game-stats':
      return { kind: 'game-stats', year: 2026, week: null, seasonType: null };
    case 'odds':
      return { kind: 'odds', year: 2026, cadence: null, eligibleGames: 0 };
    case 'schedule-refresh':
      return scheduleYearsTarget([{ year: 2026, operation: null }]);
    case 'rankings':
      return rankingsYearsTarget([{ year: 2026, publicationWindow: null }]);
    case 'season-transition':
      return seasonTransitionYearsTarget([
        { year: 2026, targetLeagues: 1, probed: true, transitionedLeagues: 0 },
      ]);
    case 'season-rollover':
      return seasonRolloverYearsTarget([{ year: 2026, targetLeagues: 1, rolledOverLeagues: 0 }]);
  }
}

const REASON_FOR: Record<ExternalSchedulerJob, SchedulerExecutionReceiptInput['reason']> = {
  'live-scores': 'no-polling-target',
  'game-stats': 'no-polling-target',
  odds: 'automation-paused-or-disabled',
  'schedule-refresh': 'no-maintenance-target',
  rankings: 'no-ranking-target',
  'season-transition': 'no-preseason-leagues',
  'season-rollover': 'no-season-leagues',
};

/** Build a valid STORED receipt for `job` started at `startedAtMs`. */
function validReceipt(
  job: ExternalSchedulerJob,
  startedAtMs: number,
  overrides: { result?: SchedulerExecutionResult; providerCallAttempted?: boolean } = {}
): SchedulerExecutionReceipt {
  const receipt = buildSchedulerExecutionReceipt({
    job,
    invocationId: `id-${job}-${startedAtMs}`,
    startedAtMs,
    completedAtMs: startedAtMs + 1000,
    result: overrides.result ?? 'skipped',
    reason: REASON_FOR[job],
    providerCallAttempted: overrides.providerCallAttempted ?? false,
    target: targetFor(job),
  });
  assert.ok(receipt, `valid receipt builds for ${job}`);
  return receipt;
}

/** A loader returning the given job→stored-value entries. */
function loaderOf(entries: Array<{ key: string; value: unknown }>): () => Promise<typeof entries> {
  return () => Promise.resolve(entries);
}

/** Classify one job given a single stored value + a fixed clock. */
async function stateOf(
  job: ExternalSchedulerJob,
  value: unknown,
  nowMs: number
): Promise<SchedulerDeliveryState> {
  const snap = await readSchedulerDeliveryHealth({
    nowMs,
    loadEntries: loaderOf([{ key: job, value }]),
  });
  return snap.jobs.find((r) => r.job === job)!.deliveryState;
}

// ── 1. Canonical order + derived source ──────────────────────────────────────
test('the snapshot has all seven jobs in canonical order with derived source', async () => {
  const snap = await readSchedulerDeliveryHealth({
    nowMs: ms('2026-03-15T12:00:00Z'),
    loadEntries: loaderOf([]),
  });
  assert.deepEqual(
    snap.jobs.map((r) => r.job),
    [...EXTERNAL_SCHEDULER_JOBS]
  );
  for (const row of snap.jobs) {
    assert.equal(row.source, schedulerSourceForJob(row.job));
  }
  assert.equal(snap.jobs.find((r) => r.job === 'live-scores')!.source, 'qstash');
  assert.equal(snap.jobs.find((r) => r.job === 'season-transition')!.source, 'vercel-cron');
  assert.equal(snap.jobs.find((r) => r.job === 'season-rollover')!.source, 'vercel-cron');
});

// ── 2. Exact policy cron + grace ─────────────────────────────────────────────
test('policies carry the exact fixed cron strings and grace periods', () => {
  const byJob = new Map(schedulerDeliveryPolicies().map((p) => [p.job, p]));
  assert.equal(byJob.get('live-scores')!.cron, '*/3 * * * *');
  assert.equal(byJob.get('live-scores')!.graceMs, 6 * MIN);
  assert.equal(byJob.get('game-stats')!.cron, '*/15 * * * *');
  assert.equal(byJob.get('game-stats')!.graceMs, 30 * MIN);
  assert.equal(byJob.get('odds')!.cron, '0 * * * *');
  assert.equal(byJob.get('odds')!.graceMs, 2 * HOUR);
  assert.equal(byJob.get('schedule-refresh')!.cron, '0 12 * * 2');
  assert.equal(byJob.get('schedule-refresh')!.graceMs, 24 * HOUR);
  assert.equal(byJob.get('rankings')!.cron, '0 4,22 * * *');
  assert.equal(byJob.get('rankings')!.graceMs, 2 * HOUR);
  assert.equal(byJob.get('season-transition')!.cron, '0 0 * * *');
  assert.equal(byJob.get('season-transition')!.graceMs, 65 * MIN);
  assert.equal(byJob.get('season-rollover')!.cron, '0 0 * * *');
  assert.equal(byJob.get('season-rollover')!.graceMs, 65 * MIN);
});

// ── 3. Policy parity vs management scripts + vercel.json ─────────────────────
test('policy crons match the management-script CRON exports and vercel.json', () => {
  const byJob = new Map(schedulerDeliveryPolicies().map((p) => [p.job, p]));
  assert.equal(byJob.get('live-scores')!.cron, LIVE_SCORES_CRON);
  assert.equal(byJob.get('game-stats')!.cron, GAME_STATS_CRON);
  assert.equal(byJob.get('odds')!.cron, ODDS_CRON);
  assert.equal(byJob.get('rankings')!.cron, RANKINGS_CRON);
  assert.equal(byJob.get('schedule-refresh')!.cron, SCHEDULE_REFRESH_CRON);

  const vercelPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../../../vercel.json'
  );
  const vercel = JSON.parse(readFileSync(vercelPath, 'utf8')) as {
    crons: Array<{ path: string; schedule: string }>;
  };
  const scheduleByPath = new Map(vercel.crons.map((c) => [c.path, c.schedule]));
  assert.equal(
    byJob.get('season-transition')!.cron,
    scheduleByPath.get('/api/cron/season-transition')
  );
  assert.equal(byJob.get('season-rollover')!.cron, scheduleByPath.get('/api/cron/season-rollover'));
});

// ── Pure slot calculator across all patterns ─────────────────────────────────
test('previousScheduleSlotMs finds the correct most-recent UTC slot per pattern', () => {
  // */3
  assert.equal(
    previousScheduleSlotMs('*/3 * * * *', ms('2026-03-15T12:07:30Z')),
    ms('2026-03-15T12:06:00Z')
  );
  assert.equal(
    previousScheduleSlotMs('*/3 * * * *', ms('2026-03-15T12:06:00Z')),
    ms('2026-03-15T12:06:00Z')
  );
  // */15
  assert.equal(
    previousScheduleSlotMs('*/15 * * * *', ms('2026-03-15T12:40:10Z')),
    ms('2026-03-15T12:30:00Z')
  );
  // top of hour
  assert.equal(
    previousScheduleSlotMs('0 * * * *', ms('2026-03-15T12:30:00Z')),
    ms('2026-03-15T12:00:00Z')
  );
  // rankings both slots + unequal gaps
  assert.equal(
    previousScheduleSlotMs('0 4,22 * * *', ms('2026-03-15T10:00:00Z')),
    ms('2026-03-15T04:00:00Z')
  );
  assert.equal(
    previousScheduleSlotMs('0 4,22 * * *', ms('2026-03-15T23:00:00Z')),
    ms('2026-03-15T22:00:00Z')
  );
  assert.equal(
    previousScheduleSlotMs('0 4,22 * * *', ms('2026-03-15T03:00:00Z')),
    ms('2026-03-14T22:00:00Z')
  ); // 6h back
  assert.equal(
    previousScheduleSlotMs('0 4,22 * * *', ms('2026-03-15T21:59:00Z')),
    ms('2026-03-15T04:00:00Z')
  ); // 18h back
  // weekly Tuesday 12:00 (2026-03-15 is a Sunday → previous Tuesday is 2026-03-10)
  assert.equal(new Date('2026-03-15T00:00:00Z').getUTCDay(), 0, 'fixture is a Sunday');
  assert.equal(
    previousScheduleSlotMs('0 12 * * 2', ms('2026-03-15T12:00:00Z')),
    ms('2026-03-10T12:00:00Z')
  );
  // daily midnight
  assert.equal(
    previousScheduleSlotMs('0 0 * * *', ms('2026-03-15T05:00:00Z')),
    ms('2026-03-15T00:00:00Z')
  );
  assert.equal(
    previousScheduleSlotMs('0 0 * * *', ms('2026-03-15T00:00:00Z')),
    ms('2026-03-15T00:00:00Z')
  );
});

// ── 4. Live Scores 6-minute grace boundary ───────────────────────────────────
test('live-scores on-time/late flips exactly at the required slot (6-minute grace)', async () => {
  const now = ms('2026-03-15T12:10:00Z'); // cutoff 12:04 → required slot 12:03
  const req = ms('2026-03-15T12:03:00Z');
  const snap = await readSchedulerDeliveryHealth({ nowMs: now, loadEntries: loaderOf([]) });
  assert.equal(
    snap.jobs.find((r) => r.job === 'live-scores')!.requiredStartedAt,
    new Date(req).toISOString()
  );
  assert.equal(await stateOf('live-scores', validReceipt('live-scores', req), now), 'on-time'); // at
  assert.equal(await stateOf('live-scores', validReceipt('live-scores', req - 1000), now), 'late'); // before
  assert.equal(
    await stateOf('live-scores', validReceipt('live-scores', ms('2026-03-15T12:09:00Z')), now),
    'on-time'
  ); // after
});

// ── 5. Game Stats 15-minute / 30-minute grace ────────────────────────────────
test('game-stats classifies against its 15-minute slot with a 30-minute grace', async () => {
  const now = ms('2026-03-15T12:40:00Z'); // cutoff 12:10 → required slot 12:00
  const req = ms('2026-03-15T12:00:00Z');
  assert.equal(await stateOf('game-stats', validReceipt('game-stats', req), now), 'on-time');
  assert.equal(await stateOf('game-stats', validReceipt('game-stats', req - 1), now), 'late');
});

// ── 6. Odds top-of-hour / 2-hour grace ───────────────────────────────────────
test('odds classifies against the top-of-hour slot with a 2-hour grace', async () => {
  const now = ms('2026-03-15T12:30:00Z'); // cutoff 10:30 → required slot 10:00
  const req = ms('2026-03-15T10:00:00Z');
  assert.equal(await stateOf('odds', validReceipt('odds', req), now), 'on-time');
  assert.equal(await stateOf('odds', validReceipt('odds', req - 1), now), 'late');
});

// ── 7. Weekly Tuesday 12:00 UTC / 24-hour grace ──────────────────────────────
test('schedule-refresh classifies against Tuesday 12:00 UTC with a 24-hour grace', async () => {
  // Wednesday 2026-03-18 13:00; cutoff Tue 13:00 → required this Tue 12:00.
  const now = ms('2026-03-18T13:00:00Z');
  assert.equal(new Date('2026-03-17T00:00:00Z').getUTCDay(), 2, 'fixture Tuesday');
  const req = ms('2026-03-17T12:00:00Z');
  assert.equal(
    await stateOf('schedule-refresh', validReceipt('schedule-refresh', req), now),
    'on-time'
  );
  assert.equal(
    await stateOf('schedule-refresh', validReceipt('schedule-refresh', req - 1), now),
    'late'
  );
  // Just inside the grace (Wed 11:00 → cutoff Tue 11:00 → required PREVIOUS Tue 03-10 12:00),
  // so last week's receipt is still on-time.
  const nowInGrace = ms('2026-03-18T11:00:00Z');
  assert.equal(
    await stateOf(
      'schedule-refresh',
      validReceipt('schedule-refresh', ms('2026-03-10T12:00:00Z')),
      nowInGrace
    ),
    'on-time'
  );
});

// ── 8. Rankings both slots incl. unequal gaps ────────────────────────────────
test('rankings classifies against both 04:00/22:00 slots across the unequal gaps', async () => {
  // 06:30 → cutoff 04:30 → required 04:00.
  assert.equal(
    await stateOf(
      'rankings',
      validReceipt('rankings', ms('2026-03-15T04:00:00Z')),
      ms('2026-03-15T06:30:00Z')
    ),
    'on-time'
  );
  assert.equal(
    await stateOf(
      'rankings',
      validReceipt('rankings', ms('2026-03-15T03:59:00Z')),
      ms('2026-03-15T06:30:00Z')
    ),
    'late'
  );
  // 03:00 → cutoff 01:00 → required previous day 22:00 (6h gap side).
  assert.equal(
    await stateOf(
      'rankings',
      validReceipt('rankings', ms('2026-03-14T22:00:00Z')),
      ms('2026-03-15T03:00:00Z')
    ),
    'on-time'
  );
  assert.equal(
    await stateOf(
      'rankings',
      validReceipt('rankings', ms('2026-03-14T21:00:00Z')),
      ms('2026-03-15T03:00:00Z')
    ),
    'late'
  );
});

// ── 9. Lifecycle jobs around UTC midnight / 65-minute Vercel window ───────────
test('lifecycle jobs classify against 00:00 UTC with the 65-minute grace', async () => {
  for (const job of ['season-transition', 'season-rollover'] as const) {
    // 01:00 → cutoff 23:55 prev day → required prev day 00:00; today's 00:00 receipt is on-time.
    const now = ms('2026-03-15T01:00:00Z');
    assert.equal(await stateOf(job, validReceipt(job, ms('2026-03-15T00:00:00Z')), now), 'on-time');
    // A receipt from the previous midnight, when now is well past the 65-min window into a new day.
    const nowLate = ms('2026-03-16T02:00:00Z'); // cutoff 00:55 → required 03-16 00:00
    assert.equal(
      await stateOf(job, validReceipt(job, ms('2026-03-15T00:00:00Z')), nowLate),
      'late'
    );
  }
});

// ── 10. Month, year, and DST boundaries ──────────────────────────────────────
test('slot calculation crosses month and year boundaries and ignores local DST', () => {
  // Month boundary: 2026-04-01 00:30 daily → 2026-04-01 00:00 (weekly walks into March).
  assert.equal(
    previousScheduleSlotMs('0 12 * * 2', ms('2026-04-01T00:00:00Z')),
    ms('2026-03-31T12:00:00Z')
  );
  assert.equal(new Date('2026-03-31T00:00:00Z').getUTCDay(), 2, 'fixture Tuesday (March 31)');
  // Year boundary: Jan 1 2027 weekly → previous Tuesday Dec 29 2026 12:00.
  assert.equal(new Date('2026-12-29T00:00:00Z').getUTCDay(), 2, 'fixture Tuesday (Dec 29)');
  assert.equal(
    previousScheduleSlotMs('0 12 * * 2', ms('2027-01-01T09:00:00Z')),
    ms('2026-12-29T12:00:00Z')
  );
  // DST: US spring-forward is 2026-03-08 07:00 UTC; the UTC-midnight slot is unaffected.
  assert.equal(
    previousScheduleSlotMs('0 0 * * *', ms('2026-03-08T12:00:00Z')),
    ms('2026-03-08T00:00:00Z')
  );
});

// ── 11. Timely receipt is on-time for EVERY execution result ─────────────────
test('a timely receipt is on-time for every execution result value', async () => {
  const now = ms('2026-03-15T12:10:00Z');
  const req = ms('2026-03-15T12:06:00Z');
  const results: SchedulerExecutionResult[] = [
    'skipped',
    'success',
    'partial',
    'no-op',
    'failure',
    'in-progress',
  ];
  for (const result of results) {
    assert.equal(
      await stateOf('live-scores', validReceipt('live-scores', req, { result }), now),
      'on-time',
      `result ${result} → on-time`
    );
  }
});

// ── 12. A successful but overdue receipt is late ─────────────────────────────
test('a successful but overdue receipt is late', async () => {
  const now = ms('2026-03-15T12:20:00Z'); // cutoff 12:14 → required 12:12
  const stale = ms('2026-03-15T12:00:00Z');
  assert.equal(
    await stateOf('live-scores', validReceipt('live-scores', stale, { result: 'success' }), now),
    'late'
  );
});

// ── 13. providerCallAttempted never changes classification ───────────────────
test('providerCallAttempted does not affect delivery classification', async () => {
  const now = ms('2026-03-15T12:10:00Z');
  const req = ms('2026-03-15T12:06:00Z');
  assert.equal(
    await stateOf(
      'live-scores',
      validReceipt('live-scores', req, { providerCallAttempted: true }),
      now
    ),
    'on-time'
  );
  assert.equal(
    await stateOf(
      'live-scores',
      validReceipt('live-scores', req, { providerCallAttempted: false }),
      now
    ),
    'on-time'
  );
});

// ── 14. Absent key → missing ─────────────────────────────────────────────────
test('an absent durable key is a missing row with a null receipt', async () => {
  const snap = await readSchedulerDeliveryHealth({
    nowMs: ms('2026-03-15T12:00:00Z'),
    loadEntries: loaderOf([]),
  });
  for (const row of snap.jobs) {
    assert.equal(row.deliveryState, 'missing');
    assert.equal(row.receipt, null);
    assert.ok(row.requiredStartedAt, 'a missing row still carries requiredStartedAt');
  }
});

// ── 15. Corrupt fields → invalid ─────────────────────────────────────────────
test('records with invalid version/job/source/target/timestamps/result/reason/future-start are invalid', async () => {
  const now = ms('2026-03-15T12:10:00Z');
  const good = validReceipt('live-scores', ms('2026-03-15T12:06:00Z'));
  const corruptions: unknown[] = [
    { ...good, version: 2 },
    { ...good, job: 'game-stats' }, // wrong job for the key
    { ...good, source: 'vercel-cron' }, // wrong derived source
    { ...good, target: { kind: 'odds', year: 2026, cadence: null, eligibleGames: 0 } }, // wrong kind
    {
      ...good,
      target: {
        kind: 'live-scores',
        year: 2026,
        mode: 'bogus',
        targetGames: 0,
        targetPartitions: 0,
      },
    },
    { ...good, startedAt: 'not-a-date' },
    { ...good, result: 'bogus' },
    { ...good, reason: '' },
    { ...good, startedAt: new Date(now + 10 * 60 * 1000).toISOString() }, // materially future
    'a string',
    null,
  ];
  for (const value of corruptions) {
    assert.equal(await stateOf('live-scores', value, now), 'invalid', JSON.stringify(value));
  }
});

// ── 16. Canary fields never escape the parser ────────────────────────────────
test('extra top-level, target, and nested target-entry fields never appear in output', async () => {
  const now = ms('2026-03-15T12:10:00Z');
  const good = validReceipt('schedule-refresh', ms('2026-03-15T12:06:00Z'));
  const withCanaries = {
    ...good,
    LEAK_TOP: 'top-MARKER',
    target: {
      ...good.target,
      LEAK_TARGET: 'target-MARKER',
      years: [{ year: 2026, operation: null, LEAK_NESTED: 'nested-MARKER' }],
    },
  };
  const snap = await readSchedulerDeliveryHealth({
    nowMs: now,
    loadEntries: loaderOf([{ key: 'schedule-refresh', value: withCanaries }]),
  });
  const row = snap.jobs.find((r) => r.job === 'schedule-refresh')!;
  assert.equal(row.deliveryState, 'on-time');
  const serialized = JSON.stringify(row.receipt);
  assert.ok(!serialized.includes('MARKER'), 'no canary escaped the parser');
  assert.deepEqual(Object.keys(row.receipt!).sort(), [
    'completedAt',
    'durationMs',
    'invocationId',
    'job',
    'providerCallAttempted',
    'reason',
    'result',
    'source',
    'startedAt',
    'target',
    'version',
  ]);
  const target = row.receipt!.target as { years: Array<Record<string, unknown>> };
  assert.deepEqual(Object.keys(target.years[0]!).sort(), ['operation', 'year']);
});

// ── 17. An invalid row does not contaminate valid siblings ───────────────────
test('an invalid row does not affect a valid sibling', async () => {
  const now = ms('2026-03-15T12:10:00Z');
  const snap = await readSchedulerDeliveryHealth({
    nowMs: now,
    loadEntries: loaderOf([
      { key: 'live-scores', value: { garbage: true } },
      { key: 'game-stats', value: validReceipt('game-stats', ms('2026-03-15T12:00:00Z')) },
    ]),
  });
  assert.equal(snap.jobs.find((r) => r.job === 'live-scores')!.deliveryState, 'invalid');
  assert.equal(snap.jobs.find((r) => r.job === 'game-stats')!.deliveryState, 'on-time');
});

// ── 18. Unknown scope keys are ignored ───────────────────────────────────────
test('unknown durable keys are ignored', async () => {
  const now = ms('2026-03-15T12:10:00Z');
  const snap = await readSchedulerDeliveryHealth({
    nowMs: now,
    loadEntries: loaderOf([
      { key: 'not-a-job', value: { anything: 1 } },
      { key: 'live-scores', value: validReceipt('live-scores', ms('2026-03-15T12:06:00Z')) },
    ]),
  });
  assert.equal(snap.jobs.length, 7);
  assert.ok(!snap.jobs.some((r) => (r.job as string) === 'not-a-job'));
  assert.equal(snap.jobs.find((r) => r.job === 'live-scores')!.deliveryState, 'on-time');
});

// ── 19. Scope-read failure → seven unavailable rows, no leak ──────────────────
test('a scope-read failure yields seven unavailable rows without error-detail leakage', async () => {
  const now = ms('2026-03-15T12:10:00Z');
  const snap = await readSchedulerDeliveryHealth({
    nowMs: now,
    loadEntries: () => Promise.reject(new Error('durable scope boom-MARKER')),
  });
  assert.equal(snap.jobs.length, 7);
  for (const row of snap.jobs) {
    assert.equal(row.deliveryState, 'unavailable');
    assert.equal(row.receipt, null);
    assert.ok(row.requiredStartedAt, 'unavailable rows still carry requiredStartedAt');
  }
  assert.ok(!JSON.stringify(snap).includes('MARKER'), 'the thrown storage error never leaks');
});

// ── 20. Stable order + one shared caller-supplied clock ──────────────────────
test('the snapshot uses one shared clock and canonical order', async () => {
  const now = ms('2026-03-15T12:34:56Z');
  const snap = await readSchedulerDeliveryHealth({ nowMs: now, loadEntries: loaderOf([]) });
  assert.equal(snap.generatedAt, new Date(now).toISOString());
  assert.deepEqual(
    snap.jobs.map((r) => r.job),
    [...EXTERNAL_SCHEDULER_JOBS]
  );
});

// ── 21. One scope read, zero writes ──────────────────────────────────────────
test('the reader performs exactly one scope read and no writes', async () => {
  let reads = 0;
  await readSchedulerDeliveryHealth({
    nowMs: ms('2026-03-15T12:00:00Z'),
    loadEntries: () => {
      reads += 1;
      return Promise.resolve([]);
    },
  });
  assert.equal(reads, 1, 'exactly one durable scope read');
});
