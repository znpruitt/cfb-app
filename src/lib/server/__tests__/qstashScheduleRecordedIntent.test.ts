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
import { UNSAFE_CHARACTER_CODES } from './unsafeCharacterTable';
import * as gameStats from '../../../../scripts/manage-game-stats-schedule';
import * as gameStatsSlow from '../../../../scripts/manage-game-stats-slow-schedule';
import * as liveScores from '../../../../scripts/manage-live-scores-schedule';
import * as liveScoresSlow from '../../../../scripts/manage-live-scores-slow-schedule';
import * as pollingPlanner from '../../../../scripts/manage-polling-planner-schedule';
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
  // PLATFORM-102 slice 4 — the two reconciliation schedules and the planner's own
  // trigger. Their `runManageSchedule` export takes injected deps with NO reader,
  // exactly like the other seven, so the fallback assertions below cover all ten.
  cliFor('game-stats-slow', gameStatsSlow),
  cliFor('live-scores-slow', liveScoresSlow),
  cliFor('polling-planner', pollingPlanner),
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

test('all ten manage CLIs still inspect against their FIXED contract', async () => {
  // The mutation target for the fallback. Break `resolveExpectedContract` — have
  // the no-reader branch return `{kind: 'unreadable'}`, or drop the `absent`
  // branch — and every case here goes red with exit 3 instead of 0.
  assert.equal(CLIS.length, 10, 'ten management CLIs exist; assert them, do not assume');

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

test('all ten still REFUSE a divergent schedule against the fixed constants', async () => {
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

// ---------------------------------------------------------------------------
// Remediation round 2
// ---------------------------------------------------------------------------

test('ONLY the cron is substituted — the planner does not own the other fields', async () => {
  // The round's most severe finding. `SynthesizedCron` carries a cron and nothing
  // else, so `destination`, `method` and `retries` are invariant constants;
  // letting a record override them meant a record naming another host, plus a
  // schedule repointed to match, would read as `verified` where the fixed
  // contract exits 2.
  const evil = 'https://evil.example/api/cron/game-stats';
  const { deps, err, out } = harness(
    readbackFor(SUBJECT, { cron: PLANNER_CRON, destination: evil }),
    (async () => ({
      kind: 'intent' as const,
      intent: { ...recordedIntent(), destination: evil },
    })) as RunDeps['readRecordedIntent']
  );

  // Exit 2, not 3: this is a DEFINITE divergence, and the module's vocabulary
  // reserves 2 for that. A monitor keyed on 2 is what fires on a tampering
  // signal; emitting 3 would have it never fire on the one signal this slice
  // exists to raise, while a wrapper treating 3 as transient retried forever.
  assert.equal(await SUBJECT.run(deps), 2, out.join(' | '));
  assert.match(err.join('\n'), /^REFUSED: /m);
  assert.match(err.join('\n'), /field the planner does not own/);
  assert.equal(
    out.some((line) => line.includes('verified:')),
    false,
    'a repointed destination is never blessed'
  );
});

test('a record contradicting the contract is REFUSED, not quietly ignored', async () => {
  // Ignoring the disagreement would be safe for the comparison but would throw
  // away the signal: the planner cannot produce such a record, so its existence
  // is itself evidence that the record, the schedule, or both were tampered with.
  for (const override of [
    { destination: 'https://turfwar.games/api/cron/other' },
    { method: 'POST' },
    { retries: 3 },
  ]) {
    const { deps, err } = harness(readbackFor(SUBJECT, { cron: PLANNER_CRON }), (async () => ({
      kind: 'intent' as const,
      intent: { ...recordedIntent(), ...override },
    })) as RunDeps['readRecordedIntent']);

    assert.equal(await SUBJECT.run(deps), 2, `accepted ${JSON.stringify(override)}`);
    assert.match(err.join('\n'), /^REFUSED: /m);
    assert.match(err.join('\n'), /disagrees with the fixed contract/);
  }

  // Positive control: the same reader with a contract-consistent record verifies.
  const clean = harness(
    readbackFor(SUBJECT, { cron: PLANNER_CRON }),
    reader({ kind: 'intent', intent: recordedIntent() })
  );
  assert.equal(await SUBJECT.run(clean.deps), 0, clean.err.join(' | '));
});

test('an INDETERMINATE lookup has its own state and its own message', async () => {
  // The store can resolve to exactly this — an upsert left unconfirmed, so
  // neither cron is known to be in force. Without the variant an adapter would
  // have to report it as `unreadable` or `unavailable`, both of which are false.
  const { deps, err, calls } = harness(readbackFor(SUBJECT), reader({ kind: 'indeterminate' }));

  assert.equal(await SUBJECT.run(deps), 3);
  assert.equal(calls.length, 0);
  const joined = err.join('\n');
  assert.match(joined, /upsert that was never confirmed/);
  assert.doesNotMatch(joined, /is present but could not be read/);
  assert.doesNotMatch(joined, /record store was unavailable/);
});

test('a malformed reader RESULT refuses with its message instead of throwing', async () => {
  // `usableIntent` ran after `lookup.intent.scheduleId` was dereferenced, so a
  // reader returning `{kind:'intent'}` with no intent threw a TypeError out of
  // `runInspect` and the wrapper turned it into an opaque failure tag — losing
  // the designed message. Shape is now checked before meaning.
  for (const intent of [undefined, null, 'a string', 42]) {
    const { deps, err } = harness(readbackFor(SUBJECT), (async () => ({
      kind: 'intent' as const,
      intent,
    })) as unknown as RunDeps['readRecordedIntent']);

    assert.equal(await SUBJECT.run(deps), 3, `threw on ${JSON.stringify(intent) ?? 'undefined'}`);
    assert.match(err.join('\n'), /shape this CLI will not print/);
  }
});

test('the CLI and the store agree on the unsafe-character class', async () => {
  // The two scans are re-declared rather than shared, because the CLI carries no
  // application import. This pins them against one table so they cannot drift.
  for (const code of UNSAFE_CHARACTER_CODES) {
    const destination = `https://turfwar.games/a${String.fromCharCode(code)}b`;
    const { deps, err } = harness(readbackFor(SUBJECT, { cron: PLANNER_CRON }), (async () => ({
      kind: 'intent' as const,
      intent: { ...recordedIntent(), destination },
    })) as RunDeps['readRecordedIntent']);

    assert.equal(
      await SUBJECT.run(deps),
      3,
      `the CLI accepted U+${code.toString(16).padStart(4, '0')} where the store refuses it`
    );
    assert.match(err.join('\n'), /shape this CLI will not print/);
  }
});

// ---------------------------------------------------------------------------
// Remediation round 3 (final)
// ---------------------------------------------------------------------------

test('a DEFINITE divergence exits 2; only "cannot determine" exits 3', async () => {
  // The module's own vocabulary: `2 = refused (… an absent/DIVERGENT schedule on
  // inspect) — nothing mutated`, `3 = management unreachable / fail closed`. The
  // severity of getting this wrong is low; the consequence is not — the
  // deliverable is a tampering signal, and a monitor keyed on 2 never fires if
  // the signal exits 3, while a wrapper treating 3 as transient retries a
  // deterministic result forever.
  const cannotDetermine: Array<[string, RunDeps['readRecordedIntent']]> = [
    ['unreadable', reader({ kind: 'unreadable' })],
    ['unavailable', reader({ kind: 'unavailable' })],
    ['indeterminate', reader({ kind: 'indeterminate' })],
    ['store threw', throwingReader()],
    [
      'foreign',
      reader({
        kind: 'intent',
        intent: recordedIntent({ scheduleId: 'turfwar-something-else' }),
      }),
    ],
  ];

  for (const [name, readRecordedIntent] of cannotDetermine) {
    const { deps, err } = harness(readbackFor(SUBJECT), readRecordedIntent);
    assert.equal(await SUBJECT.run(deps), 3, `${name} should stay 3`);
    assert.match(err.join('\n'), /^FAILED: /m, `${name} should read as FAILED`);
  }

  // The one definite negative, for contrast on the same harness.
  const { deps, err } = harness(readbackFor(SUBJECT, { cron: PLANNER_CRON }), (async () => ({
    kind: 'intent' as const,
    intent: { ...recordedIntent(), retries: 3 },
  })) as RunDeps['readRecordedIntent']);
  assert.equal(await SUBJECT.run(deps), 2);
  assert.match(err.join('\n'), /^REFUSED: /m);
});

// ---------------------------------------------------------------------------
// PLATFORM-102 slice 4 — `upsert` answers to the same authority `inspect` does
// ---------------------------------------------------------------------------

/**
 * The upsert harness. Separate from `harness` because upsert MUTATES: the GET is
 * never made, the POST is, and what matters is the request that goes out.
 */
function upsertHarness(readRecordedIntent?: RunDeps['readRecordedIntent']): {
  deps: RunDeps;
  out: string[];
  err: string[];
  calls: Array<{ url: string; method: string; headers: Record<string, string> }>;
} {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    return { status: 200, json: async () => ({ scheduleId: SUBJECT.scheduleId }) };
  };
  return {
    deps: {
      argv: ['upsert', '--apply'],
      env: { QSTASH_TOKEN: TOKEN, CRON_SECRET: CRON_SECRET_VALUE },
      fetchImpl,
      log: (line) => out.push(line),
      errorLog: (line) => err.push(line),
      ...(readRecordedIntent ? { readRecordedIntent } : {}),
    },
    out,
    err,
    calls,
  };
}

test('THE LOOP IS CLOSED: upsert writes the RECORDED cron, so the next inspect verifies it', async () => {
  // Slice 3a wired `inspect` to the record and left `upsert` writing the fixed
  // constant, so one process held two authorities: a planner-owned schedule that
  // went absent was reprovisioned at the fixed cadence, which the next `inspect`
  // then refused. This is that loop, asserted end to end.
  const { deps, calls, out } = upsertHarness(reader({ kind: 'intent', intent: recordedIntent() }));
  assert.equal(await SUBJECT.run(deps), 0);

  const upsert = calls.find((call) => call.method === 'POST')!;
  assert.equal(upsert.headers['Upstash-Cron'], PLANNER_CRON, 'the RECORDED cron is what is sent');
  assert.notEqual(upsert.headers['Upstash-Cron'], SUBJECT.cron);
  assert.ok(out.some((line) => line.includes("writing the planner's last recorded intent")));

  // AND THE LOOP CLOSES: inspect the schedule that upsert just produced, against
  // the same record, and it verifies instead of refusing.
  const after = harness(
    readbackFor(SUBJECT, { cron: upsert.headers['Upstash-Cron']! }),
    reader({
      kind: 'intent',
      intent: recordedIntent(),
    })
  );
  assert.equal(await SUBJECT.run(after.deps), 0, after.err.join(' | '));

  // POSITIVE CONTROL: what the OLD behaviour wrote — the fixed constant — is
  // exactly what that same inspect refuses. Without this the assertion above
  // would pass for a build where nothing changed.
  const oldBehaviour = harness(
    readbackFor(SUBJECT, { cron: SUBJECT.cron }),
    reader({
      kind: 'intent',
      intent: recordedIntent(),
    })
  );
  assert.equal(await SUBJECT.run(oldBehaviour.deps), 2);
});

test('upsert REFUSES on a record it cannot read, rather than clobbering the planner', async () => {
  // The mirror of the `inspect` rule, and the reason it matters more here:
  // `inspect` refusing costs a diagnosis, `upsert` writing the fixed constant
  // costs the planner its cron and makes the next inspect refuse what this run
  // just wrote.
  for (const [name, lookup] of [
    ['unreadable', reader({ kind: 'unreadable' })],
    ['unavailable', reader({ kind: 'unavailable' })],
    ['store threw', throwingReader()],
    ['foreign', reader({ kind: 'intent', intent: recordedIntent({ scheduleId: 'other' }) })],
  ] as Array<[string, RunDeps['readRecordedIntent']]>) {
    const { deps, err, calls } = upsertHarness(lookup);
    assert.equal(await SUBJECT.run(deps), 3, `${name} should refuse`);
    assert.equal(calls.length, 0, `${name}: nothing is sent, so neither secret leaves the process`);
    assert.match(err.join('\n'), /clobber a cron the planner owns/);
  }

  // `contradicts-contract` is a DEFINITE divergence and keeps exit 2.
  const contradicts = upsertHarness((async () => ({
    kind: 'intent' as const,
    intent: { ...recordedIntent(), retries: 3 },
  })) as RunDeps['readRecordedIntent']);
  assert.equal(await SUBJECT.run(contradicts.deps), 2);
  assert.equal(contradicts.calls.length, 0);
});

test('INDETERMINATE diverges by ACTION, and the divergence is explicit', async () => {
  // On `inspect` a refusal is a diagnosis. On `upsert` it means never retrying the
  // one operation whose outcome is unknown, so a single exit 4 wedges
  // reprovisioning until a human intervenes — and making an unknown state definite
  // is exactly what an operator reaches for `upsert` to do. QStash documents the
  // create endpoint as an UPDATE when the schedule id already exists, so
  // re-issuing is not a duplicate.
  const lookup = reader({ kind: 'indeterminate' });

  const inspected = harness(readbackFor(SUBJECT), lookup);
  assert.equal(await SUBJECT.run(inspected.deps), 3, 'inspect still refuses');
  assert.equal(inspected.calls.length, 0);

  const upserted = upsertHarness(lookup);
  assert.equal(await SUBJECT.run(upserted.deps), 0, 'upsert proceeds');
  const sent = upserted.calls.find((call) => call.method === 'POST')!;
  // It falls back to the FIXED contract, which over-approximates; the next planner
  // run overwrites it, so the exposure is at most one cycle.
  assert.equal(sent.headers['Upstash-Cron'], SUBJECT.cron);
});

test('ABSENT is the BOOTSTRAP: upsert writes the fixed contract and sends it', async () => {
  // An operator upserting a planner-owned job before the planner has ever run has
  // nothing else to write, and after cutover a wiped record store gives the same
  // fallback. It over-approximates, the handler guards remain the correctness
  // protection, and the next planner run narrows it.
  const { deps, calls } = upsertHarness(reader({ kind: 'absent' }));
  assert.equal(await SUBJECT.run(deps), 0);
  const sent = calls.find((call) => call.method === 'POST')!;
  assert.equal(sent.headers['Upstash-Cron'], SUBJECT.cron);
  assert.equal(sent.headers['Upstash-Forward-Authorization'], `Bearer ${CRON_SECRET_VALUE}`);
});

test('the resolver runs BEFORE a credential is attached, on the upsert path too', async () => {
  // `resolveQstashBase` establishes this ordering for a poisoned base and the
  // record read must not undo it: a refusal has to land before `QSTASH_TOKEN` or
  // the forwarded `CRON_SECRET` is put on a request.
  const { deps, calls } = upsertHarness(reader({ kind: 'unreadable' }));
  await SUBJECT.run(deps);
  assert.equal(calls.length, 0);

  // And a missing CRON_SECRET still fails closed ahead of the resolver, so a
  // record read is never even attempted without the credential the write needs.
  let readerCalled = false;
  const noSecret = upsertHarness((async () => {
    readerCalled = true;
    return { kind: 'absent' as const };
  }) as RunDeps['readRecordedIntent']);
  noSecret.deps.env = { QSTASH_TOKEN: TOKEN };
  assert.equal(await SUBJECT.run(noSecret.deps), 3);
  assert.equal(readerCalled, false);
  assert.equal(noSecret.calls.length, 0);
});
