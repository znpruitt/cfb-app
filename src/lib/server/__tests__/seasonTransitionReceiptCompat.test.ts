import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSchedulerExecutionReceipt,
  parseSchedulerExecutionReceipt,
  seasonTransitionYearsTarget,
} from '../schedulerExecutionStatus.ts';
import { RECEIPT_KEYS } from './schedulerReceiptTestHarness.ts';

// ---------------------------------------------------------------------------
// PLATFORM-086F2H1B — the season-transition receipt gained three disposition
// counters. Production may already hold a valid pre-H1B version-1 receipt
// WITHOUT them, and that row must keep parsing: the reader validates then
// rebuilds field-by-field, so a rejected record degrades its System Health row
// to `invalid` until the next daily cron run rewrites it — a gap of up to a day.
//
// Contract: absent counters normalize to 0; present-but-invalid counters still
// reject the whole record; new writers always emit all three.
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 7, 4, 12);
const STARTED = new Date(NOW - 60_000).toISOString();
const COMPLETED = new Date(NOW - 59_000).toISOString();

/** A stored receipt in the EXACT pre-H1B shape — no disposition counters. */
function legacyStoredReceipt(): Record<string, unknown> {
  return {
    version: 1,
    job: 'season-transition',
    source: 'vercel-cron',
    invocationId: '11111111-1111-4111-8111-111111111111',
    startedAt: STARTED,
    completedAt: COMPLETED,
    durationMs: 1000,
    result: 'success',
    reason: 'season-transitioned',
    providerCallAttempted: true,
    target: {
      kind: 'season-transition-years',
      totalYears: 1,
      truncated: false,
      years: [{ year: 2026, targetLeagues: 2, probed: true, transitionedLeagues: 2 }],
    },
  };
}

function parse(record: Record<string, unknown>) {
  return parseSchedulerExecutionReceipt(record, 'season-transition', NOW);
}

// 29 — the legacy shape still parses, with the new counters normalized to zero.
test('a legacy pre-H1B receipt parses and normalizes the new counters to zero', () => {
  const parsed = parse(legacyStoredReceipt());

  assert.ok(parsed, 'a valid pre-H1B row must NOT degrade to invalid');
  assert.equal(parsed.target.kind, 'season-transition-years');
  if (parsed.target.kind !== 'season-transition-years') return;
  const year = parsed.target.years[0]!;

  // Pre-existing fields survive verbatim.
  assert.equal(year.year, 2026);
  assert.equal(year.targetLeagues, 2);
  assert.equal(year.probed, true);
  assert.equal(year.transitionedLeagues, 2);

  // New fields are present and zeroed, so a reader never sees `undefined`.
  assert.equal(year.alreadyInTargetSeasonLeagues, 0);
  assert.equal(year.removedLeagues, 0);
  assert.equal(year.refusedLeagues, 0);
});

// 30 — a present-but-invalid counter still rejects the record.
test('a malformed new counter rejects the whole record, making the prior replaceable', () => {
  for (const bad of [-1, 1.5, '2', null, Number.NaN, {}]) {
    for (const field of [
      'alreadyInTargetSeasonLeagues',
      'removedLeagues',
      'refusedLeagues',
    ] as const) {
      const record = legacyStoredReceipt();
      const target = record.target as { years: Array<Record<string, unknown>> };
      target.years[0]![field] = bad;

      assert.equal(
        parse(record),
        null,
        `${field}=${JSON.stringify(bad)} must reject, not be silently normalized`
      );
    }
  }
});

test('the pre-existing required fields still reject when absent or invalid', () => {
  for (const field of ['targetLeagues', 'probed', 'transitionedLeagues'] as const) {
    const record = legacyStoredReceipt();
    const target = record.target as { years: Array<Record<string, unknown>> };
    delete target.years[0]![field];
    assert.equal(parse(record), null, `${field} is still required`);
  }
});

// 31 — a new writer always emits all three counters.
test('a new receipt emits every disposition counter explicitly', () => {
  const receipt = buildSchedulerExecutionReceipt({
    job: 'season-transition',
    invocationId: '22222222-2222-4222-8222-222222222222',
    startedAtMs: NOW - 60_000,
    completedAtMs: NOW - 59_000,
    result: 'partial',
    reason: 'lifecycle-transition-refused',
    providerCallAttempted: true,
    target: seasonTransitionYearsTarget([
      {
        year: 2026,
        targetLeagues: 4,
        probed: true,
        transitionedLeagues: 1,
        alreadyInTargetSeasonLeagues: 1,
        removedLeagues: 1,
        refusedLeagues: 1,
      },
    ]),
  });

  assert.ok(receipt);
  assert.equal(receipt.target.kind, 'season-transition-years');
  if (receipt.target.kind !== 'season-transition-years') return;
  assert.deepEqual(receipt.target.years[0], {
    year: 2026,
    targetLeagues: 4,
    probed: true,
    transitionedLeagues: 1,
    alreadyInTargetSeasonLeagues: 1,
    removedLeagues: 1,
    refusedLeagues: 1,
  });
});

test('the builder defaults omitted counters to zero rather than undefined', () => {
  // Pre-H1B call sites and fixtures pass only the original four fields.
  const target = seasonTransitionYearsTarget([
    { year: 2026, targetLeagues: 1, probed: false, transitionedLeagues: 0 },
  ]);

  assert.deepEqual(target.years[0], {
    year: 2026,
    targetLeagues: 1,
    probed: false,
    transitionedLeagues: 0,
    alreadyInTargetSeasonLeagues: 0,
    removedLeagues: 0,
    refusedLeagues: 0,
  });
});

// 32 — exact allowlisted key sets, top level and per year.
test('the receipt key sets stay exactly allowlisted', () => {
  const parsed = parse(legacyStoredReceipt());
  assert.ok(parsed);

  assert.deepEqual(Object.keys(parsed).sort(), RECEIPT_KEYS, 'top-level keys unchanged');
  assert.equal(parsed.target.kind, 'season-transition-years');
  if (parsed.target.kind !== 'season-transition-years') return;
  assert.deepEqual(Object.keys(parsed.target).sort(), ['kind', 'totalYears', 'truncated', 'years']);
  assert.deepEqual(Object.keys(parsed.target.years[0]!).sort(), [
    'alreadyInTargetSeasonLeagues',
    'probed',
    'refusedLeagues',
    'removedLeagues',
    'targetLeagues',
    'transitionedLeagues',
    'year',
  ]);
});

// 33 — nothing sensitive can ride along.
test('an unregistered field is dropped by the rebuild, never persisted onward', () => {
  const record = legacyStoredReceipt();
  const target = record.target as { years: Array<Record<string, unknown>> };
  target.years[0]!.leagueSlug = 'tsc';
  target.years[0]!.passwordHash = 'HASH-CANARY';
  (record as Record<string, unknown>).rawError = 'boom';

  const parsed = parse(record);

  assert.ok(parsed, 'unknown extras do not invalidate a valid row');
  const serialized = JSON.stringify(parsed);
  assert.ok(!serialized.includes('tsc'), 'no league slug survives');
  assert.ok(!serialized.includes('HASH-CANARY'), 'no credential material survives');
  assert.ok(!serialized.includes('boom'), 'no raw error survives');
  assert.ok(!serialized.includes('leagueSlug'));
  assert.ok(!serialized.includes('rawError'));
});

test('the version gate and job/source pairing are unchanged', () => {
  const wrongVersion = { ...legacyStoredReceipt(), version: 2 };
  assert.equal(parse(wrongVersion), null, 'only version 1 parses');

  const wrongSource = { ...legacyStoredReceipt(), source: 'qstash' };
  assert.equal(parse(wrongSource), null, 'season-transition stays vercel-cron');

  const wrongJob = { ...legacyStoredReceipt(), job: 'season-rollover' };
  assert.equal(parse(wrongJob), null, 'the job must match the requested one');
});
