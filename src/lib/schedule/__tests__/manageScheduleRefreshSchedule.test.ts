import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildGetRequest,
  buildPauseRequest,
  buildResumeRequest,
  buildUpsertRequest,
  CRON,
  DEFAULT_QSTASH_BASE,
  DESTINATION,
  evaluateScheduleContract,
  METHOD,
  parseScheduleArgs,
  RETRIES,
  runManageSchedule,
  SCHEDULE_ID,
  summarizeSchedule,
  type FetchLike,
  type RunDeps,
  type ScheduleReadback,
} from '../../../../scripts/manage-schedule-refresh-schedule.ts';

// PLATFORM-086E1B — the EXTERNAL QStash trigger CLI for the weekly schedule
// maintenance. It shares the contract-parameterized policy in
// scripts/lib/qstashSchedule with the game-stats/live-scores/Odds CLIs; these
// tests lock the WEEKLY contract values, the inspect-first/apply-gated safety,
// fail-closed behavior, credential-safety, and that only QStash management
// endpoints are ever hit — activation itself remains a separate operator-run
// runbook step (§8h). Every fetch here is an injected mock: no QStash request
// ever leaves the test process.

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);

const TOKEN = 'qstash-token-SECRET-VALUE';
const CRON_SECRET = 'cron-secret-SECRET-VALUE';

type MockResponse = { status: number; body?: unknown; throws?: boolean };

function mockFetch(responses: MockResponse[]): {
  fetchImpl: FetchLike;
  calls: Array<{ url: string; method: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  let i = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    const r = responses[i++] ?? { status: 500 };
    if (r.throws) throw new Error('network down');
    return { status: r.status, json: async () => r.body ?? {} };
  };
  return { fetchImpl, calls };
}

function harness(
  argv: string[],
  env: Record<string, string | undefined>,
  responses: MockResponse[]
) {
  const out: string[] = [];
  const err: string[] = [];
  const { fetchImpl, calls } = mockFetch(responses);
  const deps: RunDeps = {
    argv,
    env,
    fetchImpl,
    log: (l) => out.push(l),
    errorLog: (l) => err.push(l),
  };
  return { deps, out, err, calls };
}

const REDACTED_AUTH = 'REDACTED:9f2c-opaque-digest-value';
const goodSchedule: ScheduleReadback = {
  scheduleId: SCHEDULE_ID,
  destination: DESTINATION,
  cron: CRON,
  method: METHOD,
  retries: 0,
  isPaused: false,
  header: { Authorization: [REDACTED_AUTH] },
};

// 40 — the fixed weekly contract values are exactly as specified.
test('the weekly-schedule contract is the fixed Tuesday 12:00 UTC GET schedule', () => {
  assert.equal(SCHEDULE_ID, 'turfwar-schedule-weekly');
  assert.equal(DESTINATION, 'https://turfwar.games/api/cron/schedule-refresh');
  assert.equal(CRON, '0 12 * * 2');
  assert.equal(METHOD, 'GET');
  assert.equal(RETRIES, 0);
});

// 49-adjacent — vercel.json declares no weekly-schedule cron (external QStash).
test('vercel.json declares no schedule-refresh cron (the trigger is external QStash)', () => {
  const config = JSON.parse(readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8')) as {
    crons?: Array<{ path?: string }>;
  };
  const crons = config.crons ?? [];
  assert.ok(
    !crons.some((c) => c.path === '/api/cron/schedule-refresh'),
    'vercel.json must not declare a schedule-refresh cron'
  );
});

// 41 — the upsert emits exactly the approved contract: forwarded Authorization +
// provider-side redaction, explicit zero retries, no callback/queue/delay headers.
test('buildUpsertRequest emits exactly the fixed weekly contract with the approved headers only', () => {
  const req = buildUpsertRequest({
    base: DEFAULT_QSTASH_BASE,
    qstashToken: TOKEN,
    cronSecret: CRON_SECRET,
  });
  assert.equal(req.method, 'POST');
  assert.equal(req.url, `${DEFAULT_QSTASH_BASE}/v2/schedules/${DESTINATION}`);
  assert.deepEqual(req.headers, {
    Authorization: `Bearer ${TOKEN}`,
    'Upstash-Schedule-Id': SCHEDULE_ID,
    'Upstash-Cron': '0 12 * * 2',
    'Upstash-Method': 'GET',
    'Upstash-Retries': '0',
    'Upstash-Forward-Authorization': `Bearer ${CRON_SECRET}`,
    'Upstash-Redact-Fields': 'header[Authorization]',
  });
  const names = Object.keys(req.headers).join(',').toLowerCase();
  for (const banned of ['callback', 'failure', 'queue', 'workflow', 'delay', 'flow-control']) {
    assert.ok(!names.includes(banned), `contract must not set ${banned}`);
  }
});

test('get/pause/resume hit exactly the management schedule endpoints', () => {
  assert.equal(
    buildGetRequest({ base: DEFAULT_QSTASH_BASE, qstashToken: TOKEN }).url,
    `${DEFAULT_QSTASH_BASE}/v2/schedules/${SCHEDULE_ID}`
  );
  assert.equal(
    buildPauseRequest({ base: DEFAULT_QSTASH_BASE, qstashToken: TOKEN }).url,
    `${DEFAULT_QSTASH_BASE}/v2/schedules/${SCHEDULE_ID}/pause`
  );
  assert.equal(
    buildResumeRequest({ base: DEFAULT_QSTASH_BASE, qstashToken: TOKEN }).url,
    `${DEFAULT_QSTASH_BASE}/v2/schedules/${SCHEDULE_ID}/resume`
  );
});

// 44 — read-only default; mutations refuse without --apply.
test('the default action is inspect (read-only) and mutations refuse without --apply', () => {
  assert.deepEqual(parseScheduleArgs([]), { action: 'inspect', apply: false });
  for (const action of ['upsert', 'pause', 'resume']) {
    const parsed = parseScheduleArgs([action]);
    assert.ok('error' in parsed, `${action} must refuse without --apply`);
    assert.match((parsed as { error: string }).error, /--apply/);
  }
});

// 43 — inspect accepts exactly one REDACTED:<opaque> value, cites §8h, never mutates.
test('inspect issues a single GET, needs no CRON_SECRET, verifies redaction, cites §8h', async () => {
  const { deps, calls, out } = harness([], { QSTASH_TOKEN: TOKEN }, [
    { status: 200, body: goodSchedule },
  ]);
  assert.equal(await runManageSchedule(deps), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'GET');
  assert.match(out.join('\n'), /provider-side redaction/);
  assert.match(out.join('\n'), /§8h/);
  assert.ok(!out.join('\n').includes('§8g'), 'must not reference the Odds §8g procedure');
  assert.ok(
    !out.join('\n').includes('opaque-digest-value'),
    'the redacted digest is never printed'
  );
});

// 42 — inspect rejects missing, ambiguous, or plaintext Authorization readback.
test('inspect rejects missing, ambiguous, and plaintext Authorization readback', async () => {
  const variants: Array<{ header: unknown; expect: RegExp }> = [
    { header: {}, expect: /no forwarded, non-empty Authorization/ },
    {
      header: { Authorization: [REDACTED_AUTH, REDACTED_AUTH] },
      expect: /multiple forwarded Authorization values/,
    },
    { header: { Authorization: [`Bearer ${CRON_SECRET}`] }, expect: /not redacted/ },
  ];
  for (const variant of variants) {
    const { deps, err } = harness([], { QSTASH_TOKEN: TOKEN }, [
      { status: 200, body: { ...goodSchedule, header: variant.header } },
    ]);
    assert.equal(await runManageSchedule(deps), 2);
    assert.match(err.join('\n'), variant.expect);
    assert.ok(!err.join('\n').includes(CRON_SECRET), 'secret never echoed');
  }
});

test('a paused-but-contract-clean schedule inspects 0 with a loud PAUSED note', async () => {
  const { deps, out } = harness([], { QSTASH_TOKEN: TOKEN }, [
    { status: 200, body: { ...goodSchedule, isPaused: true } },
  ]);
  assert.equal(await runManageSchedule(deps), 0);
  assert.match(out.join('\n'), /PAUSED/);
});

// 46 — missing management credentials fail closed (no request sent).
test('missing QSTASH_TOKEN / missing CRON_SECRET on upsert fail closed with no request', async () => {
  const noToken = harness([], {}, []);
  assert.equal(await runManageSchedule(noToken.deps), 3);
  assert.equal(noToken.calls.length, 0);

  const noSecret = harness(['upsert', '--apply'], { QSTASH_TOKEN: TOKEN }, []);
  assert.equal(await runManageSchedule(noSecret.deps), 3);
  assert.equal(noSecret.calls.length, 0);
});

test('evaluateScheduleContract enforces the weekly contract strictly', () => {
  assert.deepEqual(evaluateScheduleContract(goodSchedule), { ok: true, mismatches: [] });
  // An hourly cron (the Odds cadence) diverges from the weekly contract.
  assert.equal(evaluateScheduleContract({ ...goodSchedule, cron: '0 * * * *' }).ok, false);
  assert.equal(evaluateScheduleContract({ ...goodSchedule, retries: 2 }).ok, false);
  assert.equal(
    evaluateScheduleContract({
      ...goodSchedule,
      destination: 'https://turfwar.games/api/cron/odds',
    }).ok,
    false
  );
});

// 47 — indeterminate mutations exit 4 and instruct inspect-before-retry.
test('a confirmed upsert exits 0; unconfirmed mutations are exit-4 indeterminate with inspect-first advice', async () => {
  const ok = harness(['upsert', '--apply'], { QSTASH_TOKEN: TOKEN, CRON_SECRET }, [
    { status: 200, body: { scheduleId: SCHEDULE_ID } },
  ]);
  assert.equal(await runManageSchedule(ok.deps), 0);
  assert.equal(ok.calls[0]!.url, `${DEFAULT_QSTASH_BASE}/v2/schedules/${DESTINATION}`);

  const indeterminate = harness(['upsert', '--apply'], { QSTASH_TOKEN: TOKEN, CRON_SECRET }, [
    { status: 500 },
  ]);
  assert.equal(await runManageSchedule(indeterminate.deps), 4);
  assert.match(indeterminate.err.join('\n'), /inspect \(read-only\) before any retry/);

  const dropped = harness(['upsert', '--apply'], { QSTASH_TOKEN: TOKEN, CRON_SECRET }, [
    { status: 200, throws: true },
  ]);
  assert.equal(await runManageSchedule(dropped.deps), 4);

  for (const action of ['pause', 'resume'] as const) {
    assert.equal(
      await runManageSchedule(
        harness([action, '--apply'], { QSTASH_TOKEN: TOKEN }, [{ status: 200 }]).deps
      ),
      0
    );
    assert.equal(
      await runManageSchedule(
        harness([action, '--apply'], { QSTASH_TOKEN: TOKEN }, [{ status: 404 }]).deps
      ),
      2
    );
    assert.equal(
      await runManageSchedule(
        harness([action, '--apply'], { QSTASH_TOKEN: TOKEN }, [{ status: 500 }]).deps
      ),
      4
    );
  }
});

// 45 — secret-shaped invalid arguments are redacted, and credentials never print.
test('secret-shaped invalid arguments are redacted and credentials never print on any path', async () => {
  const scenarios = [
    { argv: [], env: { QSTASH_TOKEN: TOKEN }, responses: [{ status: 200, body: goodSchedule }] },
    {
      argv: ['upsert', '--apply'],
      env: { QSTASH_TOKEN: TOKEN, CRON_SECRET },
      responses: [{ status: 500 }],
    },
    { argv: [`--token=${TOKEN}`], env: { QSTASH_TOKEN: TOKEN }, responses: [] },
    { argv: [CRON_SECRET], env: { QSTASH_TOKEN: TOKEN }, responses: [] },
  ];
  for (const s of scenarios) {
    const { deps, out, err } = harness(s.argv, s.env, s.responses);
    await runManageSchedule(deps);
    const all = [...out, ...err].join('\n');
    assert.ok(!all.includes(TOKEN), `token leaked: ${s.argv.join(' ')}`);
    assert.ok(!all.includes(CRON_SECRET), `cron secret leaked: ${s.argv.join(' ')}`);
  }
  // The rejected secret-shaped argument is echoed only as a length descriptor.
  const rejected = harness([CRON_SECRET], { QSTASH_TOKEN: TOKEN }, []);
  assert.equal(await runManageSchedule(rejected.deps), 2);
  assert.match(rejected.err.join('\n'), /<redacted:\d+ chars>/);
});

// 50 — only QStash management endpoints are ever addressed (and only via the mock).
test('every request targets only a /v2/schedules management endpoint with management auth', async () => {
  const runs = [
    { argv: [], env: { QSTASH_TOKEN: TOKEN }, responses: [{ status: 200, body: goodSchedule }] },
    {
      argv: ['upsert', '--apply'],
      env: { QSTASH_TOKEN: TOKEN, CRON_SECRET },
      responses: [{ status: 200, body: { scheduleId: SCHEDULE_ID } }],
    },
    { argv: ['pause', '--apply'], env: { QSTASH_TOKEN: TOKEN }, responses: [{ status: 200 }] },
    { argv: ['resume', '--apply'], env: { QSTASH_TOKEN: TOKEN }, responses: [{ status: 200 }] },
  ];
  for (const r of runs) {
    const { deps, calls } = harness(r.argv, r.env, r.responses);
    await runManageSchedule(deps);
    for (const c of calls) {
      assert.ok(
        c.url.startsWith(`${DEFAULT_QSTASH_BASE}/v2/schedules/`),
        `unexpected endpoint: ${c.url}`
      );
      assert.equal(c.headers.Authorization, `Bearer ${TOKEN}`, 'management auth present');
    }
  }
});

test('summarizeSchedule never echoes header values, and no delete path exists', () => {
  const summary = summarizeSchedule(goodSchedule);
  assert.ok(!JSON.stringify(summary).includes('Bearer'));
  for (const rel of [
    ['scripts', 'manage-schedule-refresh-schedule.ts'],
    ['scripts', 'lib', 'qstashSchedule.ts'],
  ]) {
    const src = readFileSync(path.join(REPO_ROOT, ...rel), 'utf8');
    assert.ok(!/method:\s*'DELETE'/.test(src), `no DELETE mutation in ${rel.join('/')}`);
    assert.ok(!/buildDeleteRequest/.test(src), `no delete action in ${rel.join('/')}`);
  }
});
