import assert from 'node:assert/strict';
import test from 'node:test';

import { buildUpsertRequest, type ScheduleContract } from '../../../../scripts/lib/qstashSchedule';
import type { PollingWindow } from '../../schedule/pollingWindows';
import {
  appendPollingPlannerRun,
  projectPollingPlannerRun,
  buildPollingPlannerRun,
  latestRecordedIntentForSchedule,
  parsePollingPlannerRuns,
  POLLING_PLANNER_FUTURE_SKEW_MS,
  POLLING_PLANNER_MAX_RUNS,
  projectPlannerScheduleIntent,
  readPollingPlannerRunsForWrite,
  type PlannerScheduleAction,
  type PlannerScheduleIntent,
  type PlannerScheduleOutcome,
  type PlannerScheduleRun,
  type PollingPlannerRun,
  type PollingPlannerRunSeries,
} from '../pollingPlannerRecord';

/**
 * PLATFORM-102 slice 3a — the durable planner record.
 *
 * These are STORAGE tests: projection, parsing, ordering, the bound, and the
 * fail-closed write-path read. Interpretation — which cron was in force on a
 * given day — is slice 3b's and is deliberately absent here.
 */

// ---------------------------------------------------------------------------
// The generated space
//
// Every candidate list below is derived from what the RECORD's own parser
// admits, not from what `derivePollingWindows` happens to emit. That distinction
// is the rule slice 2 earned: a 400,000-shape sweep drawn from a caller's
// defaults tests the caller, not the type. So the window list deliberately
// includes the tail-less and degenerate shapes the default derivation never
// produces but the stored contract accepts.
// ---------------------------------------------------------------------------

const SCHEDULE_IDS = [
  'turfwar-live-scores-3m',
  'turfwar-game-stats-slow',
  'a',
  'x'.repeat(120),
] as const;

const DESTINATIONS = [
  'https://turfwar.games/api/cron/live-scores',
  'https://turfwar.games/api/cron/game-stats',
  'https://example.test:8443/nested/path?query=1',
  'https://a.b',
] as const;

const CRONS = [
  '*/3 19,20,21,22,23 * * *',
  '1 * * * *',
  '0 12 * * 2',
  '*/15 0,1,2,3,4,5,6,7,8,9,10,11 * * *',
  '59 23 31 12 5',
  // The longest expression the parser admits, built from the admitted charset.
  `1 ${Array.from({ length: 24 }, (_, hour) => hour).join(',')} * * *`.padEnd(120, ',1'),
] as const;

const METHODS = ['GET', 'POST', 'DELETE'] as const;
const RETRIES = [0, 1, 3, 10] as const;

const INTENT_SPACE: PlannerScheduleIntent[] = [];
for (const scheduleId of SCHEDULE_IDS) {
  for (const destination of DESTINATIONS) {
    for (const cron of CRONS) {
      for (const method of METHODS) {
        for (const retries of RETRIES) {
          INTENT_SPACE.push({ scheduleId, destination, cron, method, retries });
        }
      }
    }
  }
}

const WINDOW_SETS: PollingWindow[][] = [
  // An offseason day: a real plan with no windows, not a missing one.
  [],
  [
    {
      startMs: 1_764_000_000_000,
      denseEndMs: 1_764_030_000_000,
      slowEndMs: 1_764_086_400_000,
      kickoffCount: 12,
    },
  ],
  // TAIL-LESS (`slowEndMs === denseEndMs`) — admitted by the synthesizer's
  // validated contract and reachable through a caller-supplied guarantee, but
  // never produced by `derivePollingWindows`' defaults. Item 102's own slice-2
  // follow-up names this shape.
  [{ startMs: 0, denseEndMs: 21_600_000, slowEndMs: 21_600_000, kickoffCount: 1 }],
  // Degenerate: a zero-length window. `startMs <= denseEndMs <= slowEndMs` holds.
  [{ startMs: 5, denseEndMs: 5, slowEndMs: 5, kickoffCount: 0 }],
  [
    { startMs: -86_400_000, denseEndMs: -3_600_000, slowEndMs: 0, kickoffCount: 0 },
    { startMs: 0.5, denseEndMs: 1.5, slowEndMs: 2.5, kickoffCount: 3 },
    { startMs: 10, denseEndMs: 20, slowEndMs: 30, kickoffCount: 9007 },
  ],
  [
    {
      startMs: Number.MAX_SAFE_INTEGER - 2,
      denseEndMs: Number.MAX_SAFE_INTEGER - 1,
      slowEndMs: Number.MAX_SAFE_INTEGER,
      kickoffCount: Number.MAX_SAFE_INTEGER,
    },
  ],
];

// EXACT UTC MIDNIGHTS ONLY — the generator ranges over what the parser admits,
// and the parser now enforces `validDayStart`'s contract. An offset day was in
// this list until review pointed out that admitting it here meant admitting it
// in the store, where it rotates the entire cron hour field downstream.
const DAY_STARTS = [1_764_028_800_000, 0, -86_400_000, 1_735_689_600_000] as const;
const INVOCATION_IDS = [null, '6f1b3c02-9c1a-4f4e-8f2b-1f2a3b4c5d6e', 'i'.repeat(200)] as const;
const PREVIOUS_CRONS = [null, '*/3 * * * *', CRONS[5]] as const;
const ACTIONS: readonly PlannerScheduleAction[] = ['applied', 'skipped'];
const OUTCOMES: readonly PlannerScheduleOutcome[] = [
  'confirmed',
  'unchanged',
  'refused',
  'failed',
  'indeterminate',
];

function scheduleRun(
  intent: PlannerScheduleIntent,
  previousCron: string | null,
  action: PlannerScheduleAction,
  outcome: PlannerScheduleOutcome
): PlannerScheduleRun {
  return { intent, previousCron, action, outcome };
}

/**
 * The record space. Intents are drawn from `INTENT_SPACE` at two different
 * strides so the dense and slow slots see different members and the sweep covers
 * far more than the record count suggests.
 */
function generateRecords(): PollingPlannerRun[] {
  const records: PollingPlannerRun[] = [];
  let index = 0;
  for (const windows of WINDOW_SETS) {
    for (const denseAbsent of [false, true]) {
      for (const dayStartMs of DAY_STARTS) {
        for (const invocationId of INVOCATION_IDS) {
          for (const previousCron of PREVIOUS_CRONS) {
            for (const action of ACTIONS) {
              for (const outcome of OUTCOMES) {
                const slowIntent = INTENT_SPACE[
                  index % INTENT_SPACE.length
                ] as PlannerScheduleIntent;
                const denseIntent = INTENT_SPACE[
                  (index * 7 + 3) % INTENT_SPACE.length
                ] as PlannerScheduleIntent;
                index += 1;
                records.push({
                  at: new Date(1_764_000_000_000 + index * 1_000).toISOString(),
                  invocationId,
                  dayStartMs,
                  windows: windows.map((window) => ({ ...window })),
                  dense: denseAbsent
                    ? null
                    : scheduleRun(denseIntent, previousCron, action, outcome),
                  slow: scheduleRun(slowIntent, previousCron, action, outcome),
                });
              }
            }
          }
        }
      }
    }
  }
  return records;
}

const RECORD_SPACE = generateRecords();

/** JSON is what durable storage actually holds; parse what a round trip yields. */
function roundTrip(run: PollingPlannerRun): PollingPlannerRun | undefined {
  const stored: unknown = JSON.parse(JSON.stringify({ runs: [run] }));
  return parsePollingPlannerRuns(stored).runs[0];
}

test('the generated space is the record type contract, not one caller output', () => {
  // Guards the sweeps below from silently shrinking to nothing — and pins that
  // the window list still carries the shapes `derivePollingWindows` never emits.
  assert.equal(INTENT_SPACE.length, 1152);
  assert.ok(RECORD_SPACE.length >= 4000, `record space collapsed to ${RECORD_SPACE.length}`);
  const tailless = WINDOW_SETS.some((set) =>
    set.some(
      (window) => window.slowEndMs === window.denseEndMs && window.startMs < window.denseEndMs
    )
  );
  assert.ok(tailless, 'the tail-less window shape must stay in the space');
});

test('every intent the type admits survives a durable round trip', () => {
  for (const intent of INTENT_SPACE) {
    const run: PollingPlannerRun = {
      at: '2026-09-06T00:00:00.000Z',
      invocationId: null,
      dayStartMs: 0,
      windows: [],
      dense: null,
      slow: scheduleRun(intent, null, 'applied', 'confirmed'),
    };
    assert.deepEqual(roundTrip(run), run, `intent lost: ${JSON.stringify(intent)}`);
  }
});

test('every record shape the type admits survives a durable round trip', () => {
  // The invariant: parsing is lossless over the whole space, so nothing the
  // planner can legitimately record is silently coerced or dropped on the way
  // back out. A hand-picked fixture proves the fixture.
  for (const run of RECORD_SPACE) {
    assert.deepEqual(roundTrip(run), run, `record lost: ${JSON.stringify(run)}`);
  }
});

test('every record shape the type admits is accepted by the write-path read', () => {
  for (const run of RECORD_SPACE) {
    const stored: unknown = JSON.parse(JSON.stringify({ runs: [run] }));
    const read = readPollingPlannerRunsForWrite(stored);
    assert.equal(read.ok, true, `refused a valid record: ${JSON.stringify(run)}`);
    assert.equal(read.ok && read.series.runs.length, 1);
  }
});

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

const CONTRACT: ScheduleContract = {
  scheduleId: 'turfwar-live-scores-3m',
  destination: 'https://turfwar.games/api/cron/live-scores',
  cron: '*/3 * * * *',
  method: 'GET',
  retries: 0,
  usage: 'usage text',
  debugEnvVar: 'MANAGE_LIVE_SCORES_SCHEDULE_DEBUG',
  failureTag: 'manage-live-scores-schedule-failed',
  authProofRef: '§8f step 5',
};

const QSTASH_TOKEN = 'qstash-token-SECRET-VALUE';
const CRON_SECRET = 'cron-secret-SECRET-VALUE';

/** The real request, carrying both real secrets in its real header block. */
function upsertRequestWithSecrets(): {
  method: string;
  url: string;
  headers: Record<string, string>;
} {
  return buildUpsertRequest(CONTRACT, {
    base: 'https://qstash.upstash.io',
    qstashToken: QSTASH_TOKEN,
    cronSecret: CRON_SECRET,
  });
}

/** A source WIDER than the projection: the five fields plus the whole request. */
function wideSource(): PlannerScheduleIntent {
  const request = upsertRequestWithSecrets();
  const wide = {
    scheduleId: CONTRACT.scheduleId,
    destination: CONTRACT.destination,
    cron: '*/3 19,20,21 * * *',
    method: CONTRACT.method,
    retries: CONTRACT.retries,
    headers: request.headers,
    url: request.url,
    rawRequest: request,
  };
  // Assigned through a variable, so TypeScript's excess-property check does not
  // hide at compile time the very leak this test exists to catch at runtime.
  return wide as PlannerScheduleIntent;
}

function leaksASecret(value: unknown): boolean {
  const serialized = JSON.stringify(value) ?? '';
  return (
    serialized.includes(QSTASH_TOKEN) ||
    serialized.includes(CRON_SECRET) ||
    serialized.toLowerCase().includes('authorization')
  );
}

test('the intent projection carries the five allowlisted fields and nothing else', () => {
  const projected = projectPlannerScheduleIntent(wideSource());

  assert.deepEqual(Object.keys(projected).sort(), [
    'cron',
    'destination',
    'method',
    'retries',
    'scheduleId',
  ]);
  assert.equal(leaksASecret(projected), false, 'no secret and no header name reaches the record');
});

test('the secret scan DETECTS a leak — positive control for the allowlist test', () => {
  // Without this, "no secret reached the record" could be true because the
  // harness cannot see one. A spread is the exact mutation the projection exists
  // to prevent, so the control is the defect itself.
  const spreadInsteadOfAllowlist = { ...wideSource() };

  assert.equal(
    leaksASecret(spreadInsteadOfAllowlist),
    true,
    'the scan must flag a projection that carried the header block'
  );
  assert.ok(
    (JSON.stringify(spreadInsteadOfAllowlist) ?? '').includes(QSTASH_TOKEN),
    'and specifically the management token'
  );
});

test('a whole built record carries no secret, headers or raw request', () => {
  const request = upsertRequestWithSecrets();
  const intent = projectPlannerScheduleIntent(wideSource());
  const run = buildPollingPlannerRun({
    at: new Date('2026-09-06T04:00:00.000Z'),
    invocationId: null,
    dayStartMs: 1_764_028_800_000,
    windows: [
      // A wider window object, for the same reason the intent source is wider.
      { startMs: 0, denseEndMs: 1, slowEndMs: 2, kickoffCount: 1, request } as PollingWindow,
    ],
    dense: { intent, previousCron: '*/3 * * * *', action: 'applied', outcome: 'confirmed' },
    slow: { intent, previousCron: null, action: 'skipped', outcome: 'unchanged' },
  });

  assert.equal(leaksASecret(run), false);
  assert.deepEqual(Object.keys(run.windows[0] ?? {}).sort(), [
    'denseEndMs',
    'kickoffCount',
    'slowEndMs',
    'startMs',
  ]);
});

// ---------------------------------------------------------------------------
// Ordering and the bound
// ---------------------------------------------------------------------------

function intent(overrides: Partial<PlannerScheduleIntent> = {}): PlannerScheduleIntent {
  return {
    scheduleId: CONTRACT.scheduleId,
    destination: CONTRACT.destination,
    cron: CONTRACT.cron,
    method: CONTRACT.method,
    retries: CONTRACT.retries,
    ...overrides,
  };
}

function minimalRun(at: string, cron = '*/3 * * * *'): PollingPlannerRun {
  return {
    at,
    invocationId: null,
    dayStartMs: 1_764_028_800_000,
    windows: [],
    dense: null,
    slow: scheduleRun(intent({ cron }), null, 'applied', 'confirmed'),
  };
}

test('arrival order does not matter — runs are sorted by time', () => {
  const later = minimalRun('2026-09-06T12:00:00.000Z', '1 * * * *');
  const earlier = minimalRun('2026-09-06T06:00:00.000Z', '*/3 19 * * *');

  const series = appendPollingPlannerRun({ runs: [later], droppedRuns: 0 }, earlier);

  assert.deepEqual(
    series.runs.map((run) => run.at),
    ['2026-09-06T06:00:00.000Z', '2026-09-06T12:00:00.000Z']
  );
});

test('the bound is enforced from the OLD end, so the newest run always survives', () => {
  // `inspect` reads the newest entry. Trimming the wrong end would make the
  // record answer with a stale intent forever, which is worse than having none.
  let series: PollingPlannerRunSeries = { runs: [], droppedRuns: 0 };
  const total = POLLING_PLANNER_MAX_RUNS + 100;
  for (let day = 0; day < total; day += 1) {
    series = appendPollingPlannerRun(series, minimalRun(new Date(day * 86_400_000).toISOString()));
  }

  assert.equal(series.runs.length, POLLING_PLANNER_MAX_RUNS);
  assert.equal(
    series.runs[series.runs.length - 1]?.at,
    new Date((total - 1) * 86_400_000).toISOString()
  );
  assert.equal(series.runs[0]?.at, new Date(100 * 86_400_000).toISOString());
});

// ---------------------------------------------------------------------------
// Fail-closed parsing
// ---------------------------------------------------------------------------

test('a present-but-unusable stored value is REFUSED on the write path', () => {
  // The defect this guard exists to close. The tolerant reader returns
  // `{runs: []}` for anything it cannot understand, so appending onto it would
  // write ONE run over six months of planner history and report success —
  // destroying the record that answers "when did this cron start diverging".
  for (const stored of [
    'a string where an object belongs',
    42,
    { runs: 'not an array' },
    { renamedInAFutureShape: [] },
    // Present and non-empty, but nothing in it survives parsing — partial jsonb
    // corruption looks exactly like this.
    { runs: [{ at: 'not-a-date' }, { nope: true }] },
  ]) {
    assert.equal(
      readPollingPlannerRunsForWrite(stored).ok,
      false,
      `refused: ${JSON.stringify(stored)}`
    );
  }
});

test('absence is NOT corruption, and one damaged run does not condemn the series', () => {
  // Positive control, and the limit of the guard. Failing closed on a first write
  // would mean the planner could never start recording; failing closed on ONE bad
  // row would stop it permanently to protect the rest.
  const absent = readPollingPlannerRunsForWrite(undefined);
  assert.equal(absent.ok, true, 'a first write is not corruption');
  assert.deepEqual(absent.ok && absent.series.runs, []);

  const good = minimalRun('2026-09-06T06:00:00.000Z');
  const partial = readPollingPlannerRunsForWrite({
    runs: [{ at: 'not-a-date' }, JSON.parse(JSON.stringify(good)) as unknown],
  });
  assert.equal(partial.ok, true, 'one bad row does not condemn the series');
  assert.equal(partial.ok && partial.series.runs.length, 1, 'the good row survives');
});

test('a run whose WINDOW is corrupt is dropped whole, not silently narrowed', () => {
  // The windows are the plan's input, so a row missing one is not a smaller true
  // statement — it is a false one, and the record exists to say what the planner
  // actually derived.
  const good = minimalRun('2026-09-06T06:00:00.000Z');
  const withWindows = {
    ...good,
    windows: [{ startMs: 0, denseEndMs: 10, slowEndMs: 20, kickoffCount: 1 }],
  };
  const inverted = {
    ...good,
    windows: [{ startMs: 30, denseEndMs: 10, slowEndMs: 20, kickoffCount: 1 }],
  };

  assert.equal(
    parsePollingPlannerRuns({ runs: [withWindows] }).runs.length,
    1,
    'positive control: the same row parses when its window is ordered'
  );
  assert.equal(parsePollingPlannerRuns({ runs: [inverted] }).runs.length, 0);
  assert.equal(
    parsePollingPlannerRuns({
      runs: [
        { ...good, windows: [{ startMs: 0, denseEndMs: 10, slowEndMs: null, kickoffCount: 1 }] },
      ],
    }).runs.length,
    0,
    'a null bound fails every overlap test downstream and must not be stored as usable'
  );
});

test('a field that inspect would PRINT is validated to a printable shape', () => {
  // The recorded intent reaches an operator's terminal through `inspect`'s
  // summary and its divergence messages. A value that arrived there unvalidated
  // would make the record an injection channel into the one output read while
  // diagnosing a tampering signal.
  const good = minimalRun('2026-09-06T06:00:00.000Z');
  const corrupt = [
    { cron: 'rm -rf / # */3 * * * *' },
    { cron: '' },
    { scheduleId: 'has spaces' },
    { destination: 'http://turfwar.games/api/cron/live-scores' },
    { destination: 'https://user:pass@turfwar.games/api/cron/live-scores' },
    { destination: 'not-a-url' },
    { method: 'get' },
    { retries: -1 },
    { retries: 1.5 },
    { retries: '0' },
  ];
  for (const override of corrupt) {
    const row = {
      ...good,
      slow: { ...good.slow, intent: { ...good.slow.intent, ...override } },
    };
    assert.equal(
      parsePollingPlannerRuns({ runs: [row] }).runs.length,
      0,
      `accepted an unprintable intent field: ${JSON.stringify(override)}`
    );
  }
  assert.equal(
    parsePollingPlannerRuns({ runs: [good] }).runs.length,
    1,
    'positive control: the unmodified row parses'
  );
});

test('a present-but-unusable previousCron is corruption, not "not established"', () => {
  // Null means the planner could not establish a previous cron. Coercing a
  // damaged value to null would let a corrupt row masquerade as a first run,
  // which is exactly the extrapolation slice 3b must not have to make.
  const good = minimalRun('2026-09-06T06:00:00.000Z');
  const damaged = { ...good, slow: { ...good.slow, previousCron: 'not; a cron' } };
  const established = { ...good, slow: { ...good.slow, previousCron: '*/3 * * * *' } };
  const unknown = { ...good, slow: { ...good.slow, previousCron: null } };

  assert.equal(parsePollingPlannerRuns({ runs: [damaged] }).runs.length, 0);
  assert.equal(
    parsePollingPlannerRuns({ runs: [established] }).runs[0]?.slow.previousCron,
    '*/3 * * * *'
  );
  assert.equal(parsePollingPlannerRuns({ runs: [unknown] }).runs[0]?.slow.previousCron, null);
});

test('a corrupt invocationId degrades to null rather than losing the run', () => {
  // Correlation is best-effort; the record is not. Losing the link to a receipt
  // costs a cross-reference, losing the run costs the history itself.
  const good = minimalRun('2026-09-06T06:00:00.000Z');
  const row = { ...good, invocationId: { not: 'a string' } };

  const parsed = parsePollingPlannerRuns({ runs: [row] });
  assert.equal(parsed.runs.length, 1, 'the run survives');
  assert.equal(parsed.runs[0]?.invocationId, null);
});

// ---------------------------------------------------------------------------
// The lookup inspect uses
// ---------------------------------------------------------------------------

test('the newest recorded intent wins, and both schedules of a run are searched', () => {
  const dense = scheduleRun(
    intent({ scheduleId: 'turfwar-live-scores-dense', cron: '*/3 19,20 * * *' }),
    null,
    'applied',
    'confirmed'
  );
  const slow = scheduleRun(
    intent({ scheduleId: 'turfwar-live-scores-slow', cron: '1 21,22 * * *' }),
    null,
    'applied',
    'confirmed'
  );
  const older: PollingPlannerRun = {
    ...minimalRun('2026-09-05T04:00:00.000Z'),
    dense: { ...dense, intent: { ...dense.intent, cron: '*/3 12,13 * * *' } },
    slow,
  };
  const newer: PollingPlannerRun = { ...minimalRun('2026-09-06T04:00:00.000Z'), dense, slow };

  const series: PollingPlannerRunSeries = { runs: [older, newer], droppedRuns: 0 };
  assert.equal(intentCron(series, 'turfwar-live-scores-dense'), '*/3 19,20 * * *');
  assert.equal(intentCron(series, 'turfwar-live-scores-slow'), '1 21,22 * * *');
  assert.deepEqual(latestRecordedIntentForSchedule(series, 'turfwar-odds-hourly'), {
    kind: 'none',
  });
  assert.deepEqual(
    latestRecordedIntentForSchedule({ runs: [], droppedRuns: 0 }, 'turfwar-live-scores-dense'),
    { kind: 'none' }
  );
});

function intentCron(series: PollingPlannerRunSeries, scheduleId: string): string | null {
  const resolved = latestRecordedIntentForSchedule(series, scheduleId);
  return resolved.kind === 'intent' ? resolved.intent.cron : null;
}

// ---------------------------------------------------------------------------
// Remediation round 1 — both reviews, 2026-09-06
// ---------------------------------------------------------------------------

test('the allowlist is enforced at the SINK, not only in the constructor', () => {
  // Codex P1 and /code-review #2, found independently. `buildPollingPlannerRun`
  // projects, but it is OPTIONAL — TypeScript's excess-property check fires only
  // on object literals, so a run assembled from a variable reached `txn.write`
  // with its surplus keys intact. Everything stored now passes through
  // `appendPollingPlannerRun`, which projects.
  const request = upsertRequestWithSecrets();
  const wideRun = {
    ...minimalRun('2026-09-06T06:00:00.000Z'),
    headers: request.headers,
    rawRequest: request,
    slow: {
      intent: wideSource(),
      previousCron: null,
      action: 'applied',
      outcome: 'confirmed',
      headers: request.headers,
    },
  } as PollingPlannerRun;

  assert.equal(leaksASecret(wideRun), true, 'positive control: the input really does carry both');

  const appended = appendPollingPlannerRun({ runs: [], droppedRuns: 0 }, wideRun);
  assert.equal(leaksASecret(appended), false, 'nothing that reaches the durable write carries one');
  assert.equal(leaksASecret(projectPollingPlannerRun(wideRun)), false);
  assert.deepEqual(Object.keys(appended.runs[0] ?? {}).sort(), [
    'at',
    'dayStartMs',
    'dense',
    'invocationId',
    'slow',
    'windows',
  ]);
  assert.deepEqual(Object.keys(appended.runs[0]?.slow ?? {}).sort(), [
    'action',
    'intent',
    'outcome',
    'previousCron',
  ]);
});

test('a destination carrying control characters is refused', () => {
  // Codex P2, verified against the runtime: `new URL()` ACCEPTS embedded control
  // characters and only strips or percent-encodes them in `.href`, while the
  // parser returned the original string. A stored destination could therefore
  // forge an output line in the divergence message it is interpolated into.
  const good = minimalRun('2026-09-06T06:00:00.000Z');
  const forged = 'https://turfwar.games/a\nREFUSED: schedule diverges from the fixed contract:';
  const escaped = `https://turfwar.games/a${String.fromCharCode(27)}[31m`;

  for (const destination of [forged, escaped, 'https://turfwar.games/a\tb', 'https://a.b/\r']) {
    // Positive control ON THE SAME INPUT: `new URL()` alone would have let it by,
    // so the test proves the added check is what refuses it.
    assert.doesNotThrow(() => new URL(destination), 'new URL accepts it — that is the hole');
    const row = { ...good, slow: { ...good.slow, intent: { ...good.slow.intent, destination } } };
    assert.equal(
      parsePollingPlannerRuns({ runs: [row] }).runs.length,
      0,
      `accepted a destination carrying a control character: ${JSON.stringify(destination)}`
    );
  }
});

test('dropped rows are COUNTED, so a silent loss becomes a visible one', () => {
  // Owner decision 2026-09-06 on /code-review #6. Row-level tolerance stays —
  // one bad row must not stop the planner recording forever — but below the
  // refusal threshold the write used to report success while history shrank with
  // no trace. The count is that trace; the retained rows' `at` gap gives roughly
  // when. Preserving unparsed rows verbatim is filed separately, because
  // `providerUsageSeries` carries the identical exposure and one twin must not
  // diverge from the other.
  const good = JSON.parse(JSON.stringify(minimalRun('2026-09-06T06:00:00.000Z'))) as unknown;
  const parsed = parsePollingPlannerRuns({ runs: [{ at: 'not-a-date' }, good, { nope: true }] });

  assert.equal(parsed.runs.length, 1, 'the good row survives');
  assert.equal(parsed.droppedRuns, 2);

  // Cumulative: a later parse adds to what earlier writes already recorded.
  assert.equal(
    parsePollingPlannerRuns({ runs: [{ at: 'not-a-date' }], droppedRuns: 40 }).droppedRuns,
    41
  );
  // Absent on rows written before the field, which understates rather than refuses.
  assert.equal(parsePollingPlannerRuns({ runs: [good] }).droppedRuns, 0);
  // Appending discards nothing, so it carries the count through untouched.
  assert.equal(
    appendPollingPlannerRun({ runs: [], droppedRuns: 7 }, minimalRun('2026-09-07T06:00:00.000Z'))
      .droppedRuns,
    7
  );
});

test('trimming to the bound is NOT counted as a dropped row', () => {
  // Positive control for the counter's meaning. Counting the bound would fire the
  // loss signal every day from run 401 onward and make the field useless.
  let series: PollingPlannerRunSeries = { runs: [], droppedRuns: 0 };
  for (let day = 0; day < POLLING_PLANNER_MAX_RUNS + 10; day += 1) {
    series = appendPollingPlannerRun(series, minimalRun(new Date(day * 86_400_000).toISOString()));
  }

  assert.equal(series.runs.length, POLLING_PLANNER_MAX_RUNS);
  assert.equal(
    series.droppedRuns,
    0,
    'ten runs left by the bound, none of them lost to corruption'
  );
});

// ---------------------------------------------------------------------------
// The comparison basis inspect uses
// ---------------------------------------------------------------------------

function runWithOutcome(
  at: string,
  cron: string,
  outcome: PlannerScheduleOutcome
): PollingPlannerRun {
  return {
    ...minimalRun(at),
    slow: scheduleRun(intent({ cron }), null, 'applied', outcome),
  };
}

test('an intent that was never SENT is not what inspect judges against', () => {
  // Both reviews. `failed` is documented as "exit 3 — nothing sent", so QStash
  // still holds the previous cron; judging against the derived one would report a
  // divergence forever, on the job the record exists to protect.
  const series: PollingPlannerRunSeries = {
    runs: [
      runWithOutcome('2026-09-04T04:00:00.000Z', '*/3 12 * * *', 'confirmed'),
      runWithOutcome('2026-09-05T04:00:00.000Z', '*/3 19 * * *', 'failed'),
      runWithOutcome('2026-09-06T04:00:00.000Z', '*/3 20 * * *', 'refused'),
    ],
    droppedRuns: 0,
  };

  assert.equal(
    intentCron(series, 'turfwar-live-scores-3m'),
    '*/3 12 * * *',
    'the newest intent KNOWN to be in force, not the newest recorded'
  );
});

test('a skipped-but-matching run is in force, exactly like a confirmed one', () => {
  const series: PollingPlannerRunSeries = {
    runs: [
      runWithOutcome('2026-09-05T04:00:00.000Z', '*/3 12 * * *', 'confirmed'),
      runWithOutcome('2026-09-06T04:00:00.000Z', '*/3 19 * * *', 'unchanged'),
    ],
    droppedRuns: 0,
  };

  assert.equal(intentCron(series, 'turfwar-live-scores-3m'), '*/3 19 * * *');
});

test('an INDETERMINATE run stops the walk rather than asserting an older intent', () => {
  // The upsert may or may not have landed, so neither cron is known to be in
  // force. Falling through would assert exactly the certainty the outcome exists
  // to deny — the PLATFORM-127 lesson, where a predicate kept consuming a derived
  // input until the fix was deletion.
  const series: PollingPlannerRunSeries = {
    runs: [
      runWithOutcome('2026-09-05T04:00:00.000Z', '*/3 12 * * *', 'confirmed'),
      runWithOutcome('2026-09-06T04:00:00.000Z', '*/3 19 * * *', 'indeterminate'),
    ],
    droppedRuns: 0,
  };

  assert.deepEqual(latestRecordedIntentForSchedule(series, 'turfwar-live-scores-3m'), {
    kind: 'indeterminate',
  });
  // Positive control: the same series without the indeterminate run resolves.
  assert.equal(
    intentCron(
      { runs: [series.runs[0] as PollingPlannerRun], droppedRuns: 0 },
      'turfwar-live-scores-3m'
    ),
    '*/3 12 * * *'
  );
});

test('every outcome the type admits is classified — no silent default', () => {
  // The invariant over the space, not over the three outcomes that came to mind.
  const expected: Record<PlannerScheduleOutcome, 'intent' | 'indeterminate' | 'none'> = {
    confirmed: 'intent',
    unchanged: 'intent',
    refused: 'none',
    failed: 'none',
    indeterminate: 'indeterminate',
  };
  for (const outcome of OUTCOMES) {
    const series: PollingPlannerRunSeries = {
      runs: [runWithOutcome('2026-09-06T04:00:00.000Z', '*/3 19 * * *', outcome)],
      droppedRuns: 0,
    };
    assert.equal(
      latestRecordedIntentForSchedule(series, 'turfwar-live-scores-3m').kind,
      expected[outcome],
      `outcome ${outcome} is unclassified`
    );
  }
});

// ---------------------------------------------------------------------------
// Remediation round 2 — validation derived from each field's CONSUMER
// ---------------------------------------------------------------------------

test('a future-dated run is refused, because `at` is the ordering key', () => {
  // Codex P2. `sortAndBound` keeps the newest at the tail, so ONE row stamped
  // ahead of real time pins the comparison basis forever while valid runs are
  // trimmed off the old end — a merely-old timestamp self-heals on the next run,
  // a future one does not. `schedulerExecutionStatus` reached the same conclusion
  // for the same reason.
  //
  // `nowMs` is INJECTED rather than fixed in the fixture: a hardcoded future date
  // stops being future, and the test would then pass for the wrong reason at
  // every commit after it.
  const nowMs = Date.parse('2026-09-06T12:00:00.000Z');
  const at = (offsetMs: number) => new Date(nowMs + offsetMs).toISOString();

  const within = { ...minimalRun(at(POLLING_PLANNER_FUTURE_SKEW_MS - 1_000)) };
  const beyond = { ...minimalRun(at(POLLING_PLANNER_FUTURE_SKEW_MS + 1_000)) };

  assert.equal(
    parsePollingPlannerRuns({ runs: [within] }, nowMs).runs.length,
    1,
    'ordinary clock skew is tolerated, exactly as the receipt store tolerates it'
  );
  assert.equal(parsePollingPlannerRuns({ runs: [beyond] }, nowMs).runs.length, 0);
  assert.equal(
    parsePollingPlannerRuns({ runs: [beyond] }, nowMs).droppedRuns,
    1,
    'and the refusal is counted, so it is visible rather than silent'
  );
  // Positive control on the SAME row: it is only the clock that refuses it.
  assert.equal(
    parsePollingPlannerRuns({ runs: [beyond] }, nowMs + 10_000).runs.length,
    1,
    'once real time catches up, the same row is ordinary'
  );
});

test('a dayStartMs that is not an exact UTC midnight is refused', () => {
  // Codex P2, and it overturns a decision I documented in round 1. I argued the
  // record should PRESERVE evidence of a planner defect rather than erase it.
  // That was wrong on its own terms: a preserved-but-unmarked corrupt day is
  // indistinguishable from a good one to `synthesizePollingCrons`, which requires
  // an exact midnight because an offset rotates the whole hour field — the same
  // window at 06:00Z arms hours 13-21 instead of 19-23. Item 102's own rule is
  // that a corrupt plan must SURFACE. It does: the row is dropped and counted.
  const good = minimalRun('2026-09-06T06:00:00.000Z');
  const midnight = 1_764_028_800_000;

  assert.equal(
    parsePollingPlannerRuns({ runs: [{ ...good, dayStartMs: midnight }] }).runs.length,
    1
  );
  for (const offset of [1, -1, 43_200_000, 3_600_000]) {
    assert.equal(
      parsePollingPlannerRuns({ runs: [{ ...good, dayStartMs: midnight + offset }] }).runs.length,
      0,
      `accepted a day start offset by ${offset}ms`
    );
  }
});

test('the unsafe-character class is the TERMINAL’s contract, not ASCII intuition', () => {
  // Codex P2 round 2. Round 1 covered C0, DEL and C1 — what "control character"
  // suggests — and missed the Unicode line separators and the bidi overrides.
  // Measured: `new URL()` ACCEPTS every one of these, so it backstops none of it.
  const good = minimalRun('2026-09-06T06:00:00.000Z');
  const unsafe = [
    0x0000, 0x001f, 0x007f, 0x0085, 0x009f, 0x2028, 0x2029, 0x202a, 0x202e, 0x2066, 0x2069,
  ];

  for (const code of unsafe) {
    const destination = `https://turfwar.games/a${String.fromCharCode(code)}b`;
    assert.doesNotThrow(
      () => new URL(destination),
      `new URL accepts U+${code.toString(16)} — that is why this check exists`
    );
    const row = { ...good, slow: { ...good.slow, intent: { ...good.slow.intent, destination } } };
    assert.equal(
      parsePollingPlannerRuns({ runs: [row] }).runs.length,
      0,
      `accepted U+${code.toString(16).padStart(4, '0')}`
    );
  }
  // Positive control: an ordinary non-ASCII character is NOT rejected — the rule
  // is about what a terminal does with a character, not about it being unusual.
  const accented = { ...good.slow.intent, destination: 'https://turfwar.games/café' };
  assert.equal(
    parsePollingPlannerRuns({ runs: [{ ...good, slow: { ...good.slow, intent: accented } }] }).runs
      .length,
    1
  );
});
