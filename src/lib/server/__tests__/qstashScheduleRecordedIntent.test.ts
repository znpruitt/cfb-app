import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  FetchLike,
  RecordedIntentLookup,
  RunDeps,
  ScheduleReadback,
} from '../../../../scripts/lib/qstashSchedule';
import * as gameStats from '../../../../scripts/manage-game-stats-schedule';
import * as liveScores from '../../../../scripts/manage-live-scores-schedule';
import * as odds from '../../../../scripts/manage-odds-schedule';
import * as rankings from '../../../../scripts/manage-rankings-schedule';
import * as scheduleRefresh from '../../../../scripts/manage-schedule-refresh-schedule';
import * as teamRecords from '../../../../scripts/manage-team-records-schedule';
import * as usageSample from '../../../../scripts/manage-usage-sample-schedule';

/**
 * PLATFORM-102 slice 3a — `inspect` against the planner's recorded intent.
 *
 * TWO POPULATIONS, and conflating them is how the prompt for this slice first got
 * the count wrong. `EXTERNAL_SCHEDULER_JOBS` holds NINE jobs and seven of them are
 * not planner-owned — but `inspect` exists only for the SEVEN `scripts/manage-*`
 * CLIs, and two of the not-planner-owned jobs (`season-transition`,
 * `season-rollover`) are Vercel-native crons with no management script at all. So
 * the fallback is asserted here over all seven CLIs that HAVE an inspect, which is
 * the right population precisely because nothing writes a record in production:
 * every one of them must still resolve the fixed contract.
 */

const TOKEN = 'qstash-token-SECRET-VALUE';
const CRON_SECRET_VALUE = 'cron-secret-SECRET-VALUE';
const REDACTED_AUTH = 'REDACTED:9f2c-opaque-digest-value';

type Cli = {
  name: string;
  scheduleId: string;
  destination: string;
  cron: string;
  method: string;
  retries: number;
  run: (deps: RunDeps) => Promise<number>;
};

type CliModule = {
  SCHEDULE_ID: string;
  DESTINATION: string;
  CRON: string;
  METHOD: string;
  RETRIES: number;
  runManageSchedule: (deps: RunDeps) => Promise<number>;
};

function cliFor(name: string, module: CliModule): Cli {
  return {
    name,
    scheduleId: module.SCHEDULE_ID,
    destination: module.DESTINATION,
    cron: module.CRON,
    method: module.METHOD,
    retries: module.RETRIES,
    run: module.runManageSchedule,
  };
}

const CLIS: Cli[] = [
  cliFor('game-stats', gameStats),
  cliFor('live-scores', liveScores),
  cliFor('odds', odds),
  cliFor('rankings', rankings),
  cliFor('schedule-refresh', scheduleRefresh),
  cliFor('team-records', teamRecords),
  cliFor('usage-sample', usageSample),
];

function readbackFor(cli: Cli, overrides: Partial<ScheduleReadback> = {}): ScheduleReadback {
  return {
    scheduleId: cli.scheduleId,
    destination: cli.destination,
    cron: cli.cron,
    method: cli.method,
    retries: cli.retries,
    isPaused: false,
    header: { Authorization: [REDACTED_AUTH] },
    ...overrides,
  };
}

function harness(
  schedule: ScheduleReadback,
  readRecordedIntent?: RunDeps['readRecordedIntent']
): { deps: RunDeps; out: string[]; err: string[]; calls: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    return { status: 200, json: async () => schedule };
  };
  const deps: RunDeps = {
    argv: ['inspect'],
    env: { QSTASH_TOKEN: TOKEN, CRON_SECRET: CRON_SECRET_VALUE },
    fetchImpl,
    log: (line) => out.push(line),
    errorLog: (line) => err.push(line),
    ...(readRecordedIntent ? { readRecordedIntent } : {}),
  };
  return { deps, out, err, calls };
}

/** The `{...}` payload of the `[inspect] <id>: {...}` summary line. */
function summaryFrom(out: string[]): Record<string, unknown> {
  const line = out.find((entry) => entry.includes(': {')) ?? '';
  return JSON.parse(line.slice(line.indexOf(': {') + 2)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The fallback: all seven CLIs, unchanged
// ---------------------------------------------------------------------------

test('all seven manage CLIs still inspect against their FIXED contract', async () => {
  // The mutation target for the fallback. Break `resolveExpectedContract` — have
  // the no-reader branch return `{kind: 'unreadable'}`, or drop the `absent`
  // branch — and every case here goes red with exit 3 instead of 0.
  assert.equal(CLIS.length, 7, 'seven management CLIs exist; assert them, do not assume');

  for (const cli of CLIS) {
    const { deps, out, err } = harness(readbackFor(cli));
    const code = await cli.run(deps);

    assert.equal(code, 0, `${cli.name}: ${err.join(' | ')}`);
    assert.deepEqual(
      summaryFrom(out),
      {
        scheduleId: cli.scheduleId,
        destination: cli.destination,
        cron: cli.cron,
        method: cli.method,
        retries: cli.retries,
        isPaused: false,
        authorization: 'ok',
        forwardedHeaderCount: 1,
        forwardedAuthorizationValueCount: 1,
        callback: 'none',
        failureCallback: 'none',
        delay: 'none',
        flowControlKey: 'none',
        parallelism: 'none',
        rate: 'none',
        period: 'none',
        retryDelayExpression: 'none',
      },
      `${cli.name}: the summary is computed from the fixed contract`
    );
    assert.ok(
      out.some((line) =>
        line.startsWith(
          '[inspect] verified: schedule structure and provider-side redaction match the fixed contract.'
        )
      ),
      `${cli.name}: the verified line still names the fixed contract`
    );
    assert.equal(
      out.some((line) => line.includes('recorded intent')),
      false,
      `${cli.name}: nothing mentions a planner record when none is consulted`
    );
  }
});

test('all seven still REFUSE a divergent schedule against the fixed constants', async () => {
  // Positive control for the test above: exit 0 there must mean the contract was
  // actually compared, not that the comparison was skipped.
  for (const cli of CLIS) {
    const { deps, err } = harness(readbackFor(cli, { cron: '7 7 7 7 7' }));
    const code = await cli.run(deps);

    assert.equal(code, 2, `${cli.name} accepted a foreign cron`);
    assert.ok(
      err.some((line) => line.includes('REFUSED: schedule diverges from the fixed contract:')),
      `${cli.name}: ${err.join(' | ')}`
    );
    assert.ok(err.some((line) => line.includes(`cron diverges from \`${cli.cron}\``)));
  }
});

// ---------------------------------------------------------------------------
// The three states
// ---------------------------------------------------------------------------

const SUBJECT = CLIS.find((cli) => cli.name === 'game-stats') as Cli;
const PLANNER_CRON = '*/15 19,20,21,22,23 * * *';

function reader(result: RecordedIntentLookup): RunDeps['readRecordedIntent'] {
  return async () => result;
}

function throwingReader(): RunDeps['readRecordedIntent'] {
  return async () => {
    throw new Error('replica unreachable');
  };
}

function recordedIntent(overrides: Partial<{ scheduleId: string; cron: string }> = {}) {
  return {
    scheduleId: overrides.scheduleId ?? SUBJECT.scheduleId,
    destination: SUBJECT.destination,
    cron: overrides.cron ?? PLANNER_CRON,
    method: SUBJECT.method,
    retries: SUBJECT.retries,
  };
}

test('ABSENT falls back to the fixed constant, exactly as before this slice', async () => {
  const { deps, out, err } = harness(readbackFor(SUBJECT), reader({ kind: 'absent' }));

  assert.equal(await SUBJECT.run(deps), 0, err.join(' | '));
  assert.equal(summaryFrom(out).cron, SUBJECT.cron);
  assert.equal(
    out.some((line) => line.includes('recorded intent')),
    false,
    'an absent record must be indistinguishable from no reader at all'
  );
});

test('a RECORDED intent is what the live schedule is judged against', async () => {
  // A planner-owned cron the fixed constant would refuse.
  const planned = readbackFor(SUBJECT, { cron: PLANNER_CRON });

  const withRecord = harness(planned, reader({ kind: 'intent', intent: recordedIntent() }));
  assert.equal(await SUBJECT.run(withRecord.deps), 0, withRecord.err.join(' | '));
  assert.equal(summaryFrom(withRecord.out).cron, PLANNER_CRON);
  assert.ok(
    withRecord.out.some((line) =>
      line.startsWith(
        "[inspect] verified: schedule structure and provider-side redaction match the planner's recorded intent."
      )
    ),
    'the verified line names the authority it actually used'
  );

  // Positive control: the SAME readback without a record still refuses, so exit 0
  // above is the recorded intent's doing and not a weakened check.
  const withoutRecord = harness(planned);
  assert.equal(await SUBJECT.run(withoutRecord.deps), 2);
  assert.ok(
    withoutRecord.err.some((line) => line.includes('REFUSED: schedule diverges from the fixed'))
  );
});

test('a schedule that diverges from the RECORDED intent is refused, and says so', async () => {
  const { deps, err } = harness(
    readbackFor(SUBJECT, { cron: '0 0 * * *' }),
    reader({ kind: 'intent', intent: recordedIntent() })
  );

  assert.equal(await SUBJECT.run(deps), 2);
  assert.ok(
    err.some((line) =>
      line.includes("REFUSED: schedule diverges from the planner's recorded intent:")
    ),
    err.join(' | ')
  );
  assert.ok(
    err.some((line) => line.includes(`cron diverges from \`${PLANNER_CRON}\``)),
    'the message names the recorded cron, never the readback value'
  );
});

test('an UNREADABLE record refuses fail-closed, before any credential is sent', async () => {
  // The owner ruling this slice turns on. Falling back here would report a
  // planner-owned cron as permanently `correct` against a constant it no longer
  // follows — a broken record becoming a false all-clear on the one job that most
  // needs a tampering signal.
  const { deps, err, calls } = harness(readbackFor(SUBJECT), reader({ kind: 'unreadable' }));

  assert.equal(await SUBJECT.run(deps), 3);
  assert.equal(calls.length, 0, 'no management request is sent, so QSTASH_TOKEN never leaves');
  assert.ok(
    err.some((line) => line.includes('could not be read')),
    err.join(' | ')
  );
  assert.ok(err.some((line) => line.includes('No change made.')));
});

test('a reader that THROWS is a read failure, not an absence', async () => {
  const { deps, calls } = harness(readbackFor(SUBJECT), throwingReader());

  assert.equal(await SUBJECT.run(deps), 3);
  assert.equal(calls.length, 0);
});

test('an intent for a DIFFERENT schedule id is refused, never applied', async () => {
  // The schedule was fetched BY `contract.scheduleId`; substituting another
  // identity would compare schedule A against intent B and report a divergence
  // that means nothing.
  const { deps, calls } = harness(
    readbackFor(SUBJECT),
    reader({ kind: 'intent', intent: recordedIntent({ scheduleId: 'turfwar-something-else' }) })
  );

  assert.equal(await SUBJECT.run(deps), 3);
  assert.equal(calls.length, 0);
});

test('no output on the recorded path carries a credential', async () => {
  const { deps, out, err } = harness(
    readbackFor(SUBJECT, { cron: PLANNER_CRON }),
    reader({ kind: 'intent', intent: recordedIntent() })
  );
  await SUBJECT.run(deps);

  const everything = [...out, ...err].join('\n');
  assert.equal(everything.includes(TOKEN), false);
  assert.equal(everything.includes(CRON_SECRET_VALUE), false);
  assert.ok(
    everything.includes(SUBJECT.scheduleId),
    'positive control: the harness sees the output'
  );
});
