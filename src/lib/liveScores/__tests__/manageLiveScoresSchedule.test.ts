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
  redactHeaderNames,
  resolveQstashBase,
  runManageSchedule,
  SCHEDULE_ID,
  scrubSecrets,
  summarizeSchedule,
  type FetchLike,
  type RunDeps,
  type ScheduleReadback,
} from '../../../../scripts/manage-live-scores-schedule.ts';

// PLATFORM-086B2B — the EXTERNAL QStash trigger CLI for the 3-minute live-scores
// poll. It shares the contract-parameterized policy in scripts/lib/qstashSchedule
// with the game-stats CLI; these tests lock the LIVE-SCORES contract values, the
// inspect-first/apply-gated safety, fail-closed behavior, credential-safety, and
// that only QStash management endpoints are ever hit — activation itself remains
// a separate operator-run runbook step (§8e).

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

// === 1. The live-scores contract values are exactly as specified ===

test('the live-scores contract is the fixed 3-minute GET schedule', () => {
  assert.equal(SCHEDULE_ID, 'turfwar-live-scores-3m');
  assert.equal(DESTINATION, 'https://turfwar.games/api/cron/live-scores');
  assert.equal(CRON, '*/3 * * * *');
  assert.equal(METHOD, 'GET');
});

test('vercel.json declares no live-scores cron (the trigger is external QStash)', () => {
  const config = JSON.parse(readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8')) as {
    crons?: Array<{ path?: string }>;
  };
  const crons = config.crons ?? [];
  assert.ok(
    !crons.some((c) => c.path === '/api/cron/live-scores'),
    'vercel.json must not declare a live-scores cron'
  );
});

// === 2. The CLI generates EXACTLY the approved QStash contract ===

test('buildUpsertRequest emits exactly the fixed live-scores contract', () => {
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
    'Upstash-Cron': '*/3 * * * *',
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

// === 3. Default execution and non---apply actions are read-only ===

test('the default action is inspect (read-only) and mutations refuse without --apply', () => {
  assert.deepEqual(parseScheduleArgs([]), { action: 'inspect', apply: false });
  for (const action of ['upsert', 'pause', 'resume']) {
    const parsed = parseScheduleArgs([action]);
    assert.ok('error' in parsed, `${action} must refuse without --apply`);
    assert.match((parsed as { error: string }).error, /--apply/);
  }
});

test('inspect issues a single GET, needs no CRON_SECRET, verifies redaction, and never mutates', async () => {
  const { deps, calls, out } = harness([], { QSTASH_TOKEN: TOKEN }, [
    { status: 200, body: goodSchedule },
  ]);
  assert.equal(await runManageSchedule(deps), 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'GET');
  assert.match(out.join('\n'), /provider-side redaction/);
  assert.match(out.join('\n'), /Exact route authentication is NOT yet proven/);
  // The exact-auth proof for the LIVE-SCORES schedule is runbook §8f step 5 — the
  // inspector must not send the operator to the game-stats §8e procedure.
  assert.match(out.join('\n'), /§8f step 5/);
  assert.ok(!out.join('\n').includes('§8e'), 'must not reference the game-stats §8e procedure');
  assert.ok(
    !out.join('\n').includes('opaque-digest-value'),
    'the redacted digest is never printed'
  );
});

test('inspect refuses plaintext forwarded auth, and flags a paused-but-redacted schedule', async () => {
  const plaintext = harness([], { QSTASH_TOKEN: TOKEN }, [
    {
      status: 200,
      body: { ...goodSchedule, header: { Authorization: [`Bearer ${CRON_SECRET}`] } },
    },
  ]);
  assert.equal(await runManageSchedule(plaintext.deps), 2);
  assert.match(plaintext.err.join('\n'), /not redacted/);
  assert.ok(!plaintext.err.join('\n').includes(CRON_SECRET), 'secret never echoed');

  const paused = harness([], { QSTASH_TOKEN: TOKEN }, [
    { status: 200, body: { ...goodSchedule, isPaused: true } },
  ]);
  assert.equal(await runManageSchedule(paused.deps), 0);
  assert.match(paused.out.join('\n'), /PAUSED/);
});

// === 4. Fail-closed ===

test('missing token, missing CRON_SECRET on upsert, and poisoned QSTASH_URL all fail closed', async () => {
  const noToken = harness([], {}, []);
  assert.equal(await runManageSchedule(noToken.deps), 3);
  assert.equal(noToken.calls.length, 0);

  const noSecret = harness(['upsert', '--apply'], { QSTASH_TOKEN: TOKEN }, []);
  assert.equal(await runManageSchedule(noSecret.deps), 3);
  assert.equal(noSecret.calls.length, 0);

  for (const bad of [
    'http://collector.example',
    'https://qstash.upstash.io.evil.example',
    'https://qstash.upstash.io@evil.example',
  ]) {
    const { deps, calls } = harness([], { QSTASH_TOKEN: TOKEN, QSTASH_URL: bad }, [
      { status: 200, body: goodSchedule },
    ]);
    assert.equal(await runManageSchedule(deps), 3, bad);
    assert.equal(calls.length, 0, `no request to ${bad}`);
  }
});

test('resolveQstashBase / evaluateScheduleContract enforce the live-scores contract strictly', () => {
  assert.deepEqual(resolveQstashBase({}), { ok: true, base: DEFAULT_QSTASH_BASE });
  assert.equal(resolveQstashBase({ QSTASH_URL: 'https://notqstash.upstash.io' }).ok, false);

  assert.deepEqual(evaluateScheduleContract(goodSchedule), { ok: true, mismatches: [] });
  // A 15-minute cron (the game-stats cadence) diverges from the live-scores contract.
  assert.equal(evaluateScheduleContract({ ...goodSchedule, cron: '*/15 * * * *' }).ok, false);
  assert.equal(evaluateScheduleContract({ ...goodSchedule, retries: 2 }).ok, false);
  assert.equal(
    evaluateScheduleContract({ ...goodSchedule, header: { Authorization: ['REDACTED:x', 'y'] } })
      .ok,
    false
  );
});

// === 5. Mutations: confirmation, indeterminacy, endpoint discipline ===

test('a confirmed upsert exits 0 and posts the create endpoint; unconfirmed is indeterminate', async () => {
  const ok = harness(['upsert', '--apply'], { QSTASH_TOKEN: TOKEN, CRON_SECRET }, [
    { status: 200, body: { scheduleId: SCHEDULE_ID } },
  ]);
  assert.equal(await runManageSchedule(ok.deps), 0);
  assert.equal(ok.calls[0]!.url, `${DEFAULT_QSTASH_BASE}/v2/schedules/${DESTINATION}`);

  const wrongId = harness(['upsert', '--apply'], { QSTASH_TOKEN: TOKEN, CRON_SECRET }, [
    { status: 200, body: { scheduleId: 'someone-elses-id' } },
  ]);
  assert.equal(await runManageSchedule(wrongId.deps), 4);
});

test('pause/resume confirm on 2xx, refuse on 404, indeterminate otherwise', async () => {
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

test('every request targets only a /v2/schedules management endpoint with management auth', async () => {
  const runs: Array<{
    argv: string[];
    env: Record<string, string | undefined>;
    responses: MockResponse[];
  }> = [
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

// === 6. Credentials are NEVER printed, and there is no delete path ===

test('no code path prints the management token or the forwarded route secret', async () => {
  const scenarios: Array<{
    argv: string[];
    env: Record<string, string | undefined>;
    responses: MockResponse[];
  }> = [
    { argv: [], env: { QSTASH_TOKEN: TOKEN }, responses: [{ status: 200, body: goodSchedule }] },
    {
      argv: ['upsert', '--apply'],
      env: { QSTASH_TOKEN: TOKEN, CRON_SECRET },
      responses: [{ status: 500 }],
    },
    { argv: ['pause', '--apply'], env: { QSTASH_TOKEN: TOKEN }, responses: [{ status: 200 }] },
    { argv: [`--token=${TOKEN}`], env: { QSTASH_TOKEN: TOKEN }, responses: [] },
    { argv: [CRON_SECRET], env: { QSTASH_TOKEN: TOKEN }, responses: [] },
    {
      argv: [],
      env: { QSTASH_TOKEN: TOKEN },
      responses: [
        {
          status: 200,
          body: {
            ...goodSchedule,
            destination: `https://x:${CRON_SECRET}@turfwar.games/api/cron/live-scores`,
          },
        },
      ],
    },
  ];
  for (const s of scenarios) {
    const { deps, out, err } = harness(s.argv, s.env, s.responses);
    await runManageSchedule(deps);
    const all = [...out, ...err].join('\n');
    assert.ok(!all.includes(TOKEN), `token leaked: ${s.argv.join(' ')}`);
    assert.ok(!all.includes(CRON_SECRET), `cron secret leaked: ${s.argv.join(' ')}`);
    assert.ok(!all.includes(`Bearer ${CRON_SECRET}`));
  }
});

test('summarizeSchedule/redactHeaderNames/scrubSecrets stay credential-safe', () => {
  assert.deepEqual(redactHeaderNames({ Authorization: ['Bearer x'], 'X-Y': ['z'] }), [
    'Authorization',
    'X-Y',
  ]);
  const clean = summarizeSchedule(goodSchedule);
  assert.equal(clean.authorization, 'ok');
  assert.equal(clean.forwardedHeaderCount, 1);
  assert.ok(!JSON.stringify(clean).includes('Bearer'));
  const scrubbed = scrubSecrets(`x ${TOKEN} y Bearer ${CRON_SECRET}`, {
    QSTASH_TOKEN: TOKEN,
    CRON_SECRET,
  });
  assert.ok(!scrubbed.includes(TOKEN) && !scrubbed.includes(CRON_SECRET));
});

test('neither the live-scores script nor the shared policy module mints a delete request', () => {
  for (const rel of [
    ['scripts', 'manage-live-scores-schedule.ts'],
    ['scripts', 'lib', 'qstashSchedule.ts'],
  ]) {
    const src = readFileSync(path.join(REPO_ROOT, ...rel), 'utf8');
    assert.ok(!/method:\s*'DELETE'/.test(src), `no DELETE mutation in ${rel.join('/')}`);
    assert.ok(!/buildDeleteRequest/.test(src), `no delete action in ${rel.join('/')}`);
  }
});
