import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  FetchLike,
  RecordedIntentLookup,
  RecordedScheduleIntent,
  RunDeps,
  ScheduleReadback,
} from '../../../../scripts/lib/qstashSchedule';
import type { PlannerScheduleIntent } from '../pollingPlannerRecord';
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

// ---------------------------------------------------------------------------
// Remediation round 1 — both reviews, 2026-09-06
// ---------------------------------------------------------------------------

/**
 * The type-level pin. `RecordedScheduleIntent` is re-declared in the CLI rather
 * than imported — the module carries no application dependency — and nothing tied
 * the two shapes together, so they could drift silently and the CLI would keep
 * compiling against a store field it no longer receives. These assignments fail
 * the type-check the moment either side changes.
 */
const _cliAcceptsStoreShape: RecordedScheduleIntent = {} as PlannerScheduleIntent;
const _storeAcceptsCliShape: PlannerScheduleIntent = {} as RecordedScheduleIntent;
void _cliAcceptsStoreShape;
void _storeAcceptsCliShape;

test('the four refusal causes are told apart, because they send an operator elsewhere', async () => {
  // /code-review #4. One message claimed "is present but could not be read" for a
  // store OUTAGE, where nothing is known about presence, and for a record that
  // read fine but belonged to another schedule. The durable side keeps those
  // states apart; the CLI now does too.
  const cases: Array<{ reader: RunDeps['readRecordedIntent']; expect: RegExp; not?: RegExp }> = [
    { reader: reader({ kind: 'unreadable' }), expect: /is present but could not be read/ },
    {
      reader: reader({ kind: 'unavailable' }),
      expect: /record store was unavailable/,
      not: /is present/,
    },
    { reader: throwingReader(), expect: /record store was unavailable/, not: /is present/ },
    {
      reader: reader({
        kind: 'intent',
        intent: recordedIntent({ scheduleId: 'turfwar-something-else' }),
      }),
      expect: /recorded for a DIFFERENT schedule id/,
    },
  ];

  for (const { reader: readRecordedIntent, expect, not } of cases) {
    const { deps, err, calls } = harness(readbackFor(SUBJECT), readRecordedIntent);
    assert.equal(await SUBJECT.run(deps), 3, err.join(' | '));
    assert.equal(calls.length, 0, 'no management request is sent on any refusal');
    const joined = err.join('\n');
    assert.match(joined, expect);
    if (not) assert.doesNotMatch(joined, not, 'no presence claim the CLI cannot support');
  }
});

test('an intent this CLI would not PRINT is refused before it reaches an output sink', async () => {
  // Codex P2 at the second boundary. The store validates on read, but the reader
  // is injected and this module deliberately does not import the store — so the
  // "only ever the known-safe expected value" invariant has to be re-established
  // here, where the value is actually printed.
  const forged = 'https://turfwar.games/a\nREFUSED: schedule diverges from the fixed contract:';
  const unprintable: Array<Partial<{ destination: string; cron: string; method: string }>> = [
    { destination: forged },
    { destination: `https://turfwar.games/a${String.fromCharCode(27)}[31m` },
    { destination: 'http://turfwar.games/api/cron/game-stats' },
    { destination: 'https://user:pass@turfwar.games/api/cron/game-stats' },
    { cron: 'rm -rf / # */15 * * * *' },
    { method: 'get' },
  ];

  for (const override of unprintable) {
    const { deps, out, err, calls } = harness(readbackFor(SUBJECT), (async () => ({
      kind: 'intent' as const,
      intent: { ...recordedIntent(), ...override },
    })) as RunDeps['readRecordedIntent']);

    assert.equal(await SUBJECT.run(deps), 3, `accepted ${JSON.stringify(override)}`);
    assert.equal(calls.length, 0);
    assert.match(err.join('\n'), /shape this CLI will not print/);
    assert.equal(
      [...out, ...err].join('\n').includes('REFUSED: schedule diverges'),
      false,
      'the forged line never reaches the operator'
    );
  }

  // Positive control: the same intent, unmodified, is accepted and printed.
  const clean = harness(
    readbackFor(SUBJECT, { cron: PLANNER_CRON }),
    reader({
      kind: 'intent',
      intent: recordedIntent(),
    })
  );
  assert.equal(await SUBJECT.run(clean.deps), 0, clean.err.join(' | '));
});
