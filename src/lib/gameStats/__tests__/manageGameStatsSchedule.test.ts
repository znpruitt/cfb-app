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
  summarizeSchedule,
  type FetchLike,
  type RunDeps,
  type ScheduleReadback,
} from '../../../../scripts/manage-game-stats-schedule.ts';

// PLATFORM-086H3E — the external QStash trigger CLI. The 15-minute game-stats
// poll is no longer a Vercel cron (Hobby rejects sub-daily crons); QStash calls
// the UNCHANGED route. These tests lock the fixed message contract, the
// inspect-first/apply-gated safety, fail-closed behavior, and — critically —
// that no credential (management token or forwarded route secret) can ever be
// printed, and that only QStash management endpoints are ever hit.

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

const goodSchedule: ScheduleReadback = {
  scheduleId: SCHEDULE_ID,
  destination: DESTINATION,
  cron: CRON,
  method: METHOD,
  retries: 0,
  isPaused: false,
  header: { Authorization: ['Bearer forwarded'] },
};

// === 1. vercel.json contains no game-stats cron, keeps the two lifecycle crons ===

test('vercel.json declares only the two daily lifecycle crons (game-stats is external)', () => {
  const config = JSON.parse(readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8')) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };
  const crons = config.crons ?? [];
  assert.ok(
    !crons.some((c) => c.path === '/api/cron/game-stats'),
    'vercel.json must not declare a game-stats cron'
  );
  assert.deepEqual(crons.map((c) => c.path).sort(), [
    '/api/cron/season-rollover',
    '/api/cron/season-transition',
  ]);
  for (const c of crons) assert.equal(c.schedule, '0 0 * * *');
});

// === 2. The CLI generates EXACTLY the approved QStash contract ===

test('buildUpsertRequest emits exactly the fixed contract', () => {
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
    'Upstash-Cron': '*/15 * * * *',
    'Upstash-Method': 'GET',
    'Upstash-Retries': '0',
    'Upstash-Forward-Authorization': `Bearer ${CRON_SECRET}`,
  });
  // No callback / failure-callback / queue / workflow / scheduler-retry headers.
  const names = Object.keys(req.headers).join(',').toLowerCase();
  for (const banned of ['callback', 'failure', 'queue', 'workflow', 'delay', 'flow-control']) {
    assert.ok(!names.includes(banned), `contract must not set ${banned}`);
  }
});

test('get/pause/resume requests hit exactly the management schedule endpoints', () => {
  assert.equal(
    buildGetRequest({ base: DEFAULT_QSTASH_BASE, qstashToken: TOKEN }).url,
    `${DEFAULT_QSTASH_BASE}/v2/schedules/${SCHEDULE_ID}`
  );
  assert.equal(buildGetRequest({ base: DEFAULT_QSTASH_BASE, qstashToken: TOKEN }).method, 'GET');
  assert.equal(
    buildPauseRequest({ base: DEFAULT_QSTASH_BASE, qstashToken: TOKEN }).url,
    `${DEFAULT_QSTASH_BASE}/v2/schedules/${SCHEDULE_ID}/pause`
  );
  assert.equal(
    buildResumeRequest({ base: DEFAULT_QSTASH_BASE, qstashToken: TOKEN }).url,
    `${DEFAULT_QSTASH_BASE}/v2/schedules/${SCHEDULE_ID}/resume`
  );
});

test('resolveQstashBase defaults, accepts valid https origins, and fails closed on poison', () => {
  assert.deepEqual(resolveQstashBase({}), { ok: true, base: DEFAULT_QSTASH_BASE });
  assert.deepEqual(resolveQstashBase({ QSTASH_URL: 'https://qstash-us-east-1.upstash.io/' }), {
    ok: true,
    base: 'https://qstash-us-east-1.upstash.io',
  });
  for (const bad of [
    'http://collector.example', // not https → credentials must never go in the clear
    'https://collector.example/v2/schedules', // a path → not an origin base
    'https://user:pass@qstash.upstash.io', // embeds userinfo
    'https://qstash.upstash.io?x=1', // has a query
    'not-a-url',
  ]) {
    const r = resolveQstashBase({ QSTASH_URL: bad });
    assert.equal(r.ok, false, bad);
  }
});

// === 3. Default execution and non---apply actions are read-only ===

test('the default action is inspect (read-only)', () => {
  assert.deepEqual(parseScheduleArgs([]), { action: 'inspect', apply: false });
  assert.deepEqual(parseScheduleArgs(['inspect']), { action: 'inspect', apply: false });
});

test('mutating actions REFUSE without --apply', () => {
  for (const action of ['upsert', 'pause', 'resume']) {
    const parsed = parseScheduleArgs([action]);
    assert.ok('error' in parsed, `${action} must refuse without --apply`);
    assert.match((parsed as { error: string }).error, /--apply/);
  }
});

test('inspect issues only a single GET and never mutates', async () => {
  const { deps, calls } = harness([], { QSTASH_TOKEN: TOKEN }, [
    { status: 200, body: goodSchedule },
  ]);
  const code = await runManageSchedule(deps);
  assert.equal(code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.method, 'GET');
});

// === 4. Fail-closed: unknown args, missing creds, divergence, ambiguous mutation ===

test('unknown arguments are refused', () => {
  assert.ok('error' in parseScheduleArgs(['--bogus']));
  assert.ok('error' in parseScheduleArgs(['frobnicate']));
  assert.ok('error' in parseScheduleArgs(['inspect', 'upsert']));
});

test('a missing management token fails closed (no request attempted)', async () => {
  const { deps, calls } = harness([], {}, []);
  const code = await runManageSchedule(deps);
  assert.equal(code, 3);
  assert.equal(calls.length, 0, 'no management call without a token');
});

test('upsert without CRON_SECRET fails closed before any request', async () => {
  const { deps, calls } = harness(['upsert', '--apply'], { QSTASH_TOKEN: TOKEN }, []);
  const code = await runManageSchedule(deps);
  assert.equal(code, 3);
  assert.equal(calls.length, 0);
});

test('evaluateScheduleContract flags every divergence and passes a matching schedule', () => {
  assert.deepEqual(evaluateScheduleContract(goodSchedule), { ok: true, mismatches: [] });
  const bad = evaluateScheduleContract({
    scheduleId: SCHEDULE_ID,
    destination: DESTINATION,
    cron: '*/5 * * * *',
    method: 'POST',
    retries: 3,
    isPaused: false,
    callback: 'https://x',
    failureCallback: 'https://y',
    header: {},
  });
  assert.equal(bad.ok, false);
  const joined = bad.mismatches.join(' | ');
  for (const needle of [
    'cron',
    'method',
    'retries',
    'Authorization',
    'callback',
    'failure callback',
  ]) {
    assert.match(joined, new RegExp(needle));
  }
});

test('the contract check is strict: auth shape/value, coerced retries, and queue/retry settings all diverge', () => {
  // `X-Authorization` is NOT the `Authorization` header the route receives.
  assert.equal(
    evaluateScheduleContract({ ...goodSchedule, header: { 'X-Authorization': ['Bearer x'] } }).ok,
    false
  );
  // Present but empty, or a non-Bearer shape the route would 401.
  assert.equal(
    evaluateScheduleContract({ ...goodSchedule, header: { Authorization: [''] } }).ok,
    false
  );
  assert.equal(
    evaluateScheduleContract({ ...goodSchedule, header: { Authorization: [] } }).ok,
    false
  );
  assert.equal(
    evaluateScheduleContract({ ...goodSchedule, header: { Authorization: ['Basic attacker'] } }).ok,
    false
  );
  assert.equal(
    evaluateScheduleContract({ ...goodSchedule, header: { Authorization: ['Bearer '] } }).ok,
    false
  );
  // With CRON_SECRET known, the value must match EXACTLY (never printed).
  const expectedAuthorization = 'Bearer the-real-cron-secret';
  assert.equal(
    evaluateScheduleContract(
      { ...goodSchedule, header: { Authorization: ['Bearer the-real-cron-secret'] } },
      { expectedAuthorization }
    ).ok,
    true
  );
  assert.equal(
    evaluateScheduleContract(
      { ...goodSchedule, header: { Authorization: ['Bearer a-different-secret'] } },
      { expectedAuthorization }
    ).ok,
    false
  );
  // retries must be EXACTLY 0 — `null` must not coerce to zero.
  assert.equal(evaluateScheduleContract({ ...goodSchedule, retries: null }).ok, false);
  assert.equal(evaluateScheduleContract({ ...goodSchedule, retries: 2 }).ok, false);
  assert.equal(evaluateScheduleContract({ ...goodSchedule, retries: '0' }).ok, true);
  // queue / flow-control / delay / scheduler retry-delay are all forbidden…
  for (const field of [
    'delay',
    'flowControlKey',
    'parallelism',
    'rate',
    'period',
    'retryDelayExpression',
  ] as const) {
    const s: ScheduleReadback = { ...goodSchedule };
    (s as Record<string, unknown>)[field] = 'x';
    assert.equal(evaluateScheduleContract(s).ok, false, field);
  }
  // …and a malformed banned field is NOT masked by empty-ish coercion:
  // `callback: 0` / `flowControlKey: {}` still diverge (finding-4 regression guard).
  assert.equal(evaluateScheduleContract({ ...goodSchedule, callback: 0 }).ok, false);
  assert.equal(evaluateScheduleContract({ ...goodSchedule, flowControlKey: {} }).ok, false);
  // But a numeric limit of exactly 0 is legitimately "no limit" — not a divergence.
  assert.equal(
    evaluateScheduleContract({ ...goodSchedule, parallelism: 0, rate: 0, period: 0, delay: 0 }).ok,
    true
  );
});

test('divergence messages reference only the fixed constants, never the raw readback value', () => {
  const withSecretDestination = {
    ...goodSchedule,
    destination: `https://x:${CRON_SECRET}@evil.example/path`,
  };
  const { mismatches } = evaluateScheduleContract(withSecretDestination);
  const joined = mismatches.join(' | ');
  assert.ok(!joined.includes(CRON_SECRET), 'the raw divergent destination is never printed');
  assert.match(joined, /destination diverges/);
});

test('rejected arguments never echo a pasted secret value (long OR short, flag OR positional)', () => {
  for (const secret of [
    'super-secret-token-value-1234567890', // long
    'tiny-Sec3t', // short (<=16) — must still not echo
    'AbC123', // very short but token-shaped
  ]) {
    const flagged = parseScheduleArgs([`--token=${secret}`]);
    assert.ok('error' in flagged);
    assert.ok(
      !(flagged as { error: string }).error.includes(secret),
      `flag value redacted: ${secret}`
    );
    const positional = parseScheduleArgs([secret]);
    assert.ok('error' in positional);
    assert.ok(
      !(positional as { error: string }).error.includes(secret),
      `positional value redacted: ${secret}`
    );
  }
});

test('a poisoned or lookalike QSTASH_URL fails closed before any credential leaves the process', async () => {
  for (const bad of [
    'http://collector.example', // not https
    'https://evil.example/v2/schedules', // path
    'https://qstash.upstash.io.evil.example', // lookalike host
    'https://qstash.upstash.io@evil.example', // userinfo host-confusion
    'https://qstash.upstash.io:8443', // non-default port
  ]) {
    const { deps, calls } = harness([], { QSTASH_TOKEN: TOKEN, QSTASH_URL: bad }, [
      { status: 200, body: goodSchedule },
    ]);
    assert.equal(await runManageSchedule(deps), 3, bad);
    assert.equal(calls.length, 0, `no request to ${bad}`);
  }
});

test('resolveQstashBase accepts the canonical and regional hosts but rejects lookalikes', () => {
  assert.equal(resolveQstashBase({ QSTASH_URL: 'https://qstash.upstash.io' }).ok, true);
  assert.equal(resolveQstashBase({ QSTASH_URL: 'https://qstash-eu-west-1.upstash.io' }).ok, true);
  assert.equal(
    resolveQstashBase({ QSTASH_URL: 'https://qstash.upstash.io.evil.example' }).ok,
    false
  );
  assert.equal(resolveQstashBase({ QSTASH_URL: 'https://notqstash.upstash.io' }).ok, false);
});

test('summarizeSchedule redacts userinfo AND query/fragment secrets in a destination', () => {
  for (const destination of [
    `https://user:${CRON_SECRET}@turfwar.games/api/cron/game-stats`,
    `https://turfwar.games/api/cron/game-stats?token=${CRON_SECRET}`,
    `https://turfwar.games/api/cron/game-stats#${CRON_SECRET}`,
  ]) {
    const printed = JSON.stringify(summarizeSchedule({ ...goodSchedule, destination }));
    assert.ok(!printed.includes(CRON_SECRET), `secret redacted from the summary: ${destination}`);
    assert.match(printed, /secrets redacted/);
  }
});

test('inspect reports divergence as a fail-closed refusal (exit 2)', async () => {
  const divergent = { ...goodSchedule, cron: '*/5 * * * *' };
  const { deps } = harness([], { QSTASH_TOKEN: TOKEN }, [{ status: 200, body: divergent }]);
  assert.equal(await runManageSchedule(deps), 2);
});

test('inspect on an absent schedule refuses (exit 2)', async () => {
  const { deps } = harness([], { QSTASH_TOKEN: TOKEN }, [{ status: 404 }]);
  assert.equal(await runManageSchedule(deps), 2);
});

test('inspect on a management error fails closed (exit 3)', async () => {
  const { deps } = harness([], { QSTASH_TOKEN: TOKEN }, [{ status: 503 }]);
  assert.equal(await runManageSchedule(deps), 3);
});

test('a confirmed upsert exits 0 and posts the create endpoint', async () => {
  const { deps, calls } = harness(['upsert', '--apply'], { QSTASH_TOKEN: TOKEN, CRON_SECRET }, [
    { status: 200, body: { scheduleId: SCHEDULE_ID } },
  ]);
  assert.equal(await runManageSchedule(deps), 0);
  assert.equal(calls[0]!.method, 'POST');
  assert.equal(calls[0]!.url, `${DEFAULT_QSTASH_BASE}/v2/schedules/${DESTINATION}`);
});

test('an upsert whose response cannot be confirmed is INDETERMINATE (exit 4)', async () => {
  // 2xx but wrong scheduleId.
  const a = harness(['upsert', '--apply'], { QSTASH_TOKEN: TOKEN, CRON_SECRET }, [
    { status: 200, body: { scheduleId: 'someone-elses-id' } },
  ]);
  assert.equal(await runManageSchedule(a.deps), 4);
  // non-2xx.
  const b = harness(['upsert', '--apply'], { QSTASH_TOKEN: TOKEN, CRON_SECRET }, [{ status: 500 }]);
  assert.equal(await runManageSchedule(b.deps), 4);
  // network throw.
  const c = harness(['upsert', '--apply'], { QSTASH_TOKEN: TOKEN, CRON_SECRET }, [
    { status: 0, throws: true },
  ]);
  assert.equal(await runManageSchedule(c.deps), 4);
});

test('pause/resume confirm on 2xx, refuse on 404, and are indeterminate otherwise', async () => {
  for (const action of ['pause', 'resume'] as const) {
    const ok = harness([action, '--apply'], { QSTASH_TOKEN: TOKEN }, [{ status: 200 }]);
    assert.equal(await runManageSchedule(ok.deps), 0, `${action} 2xx`);
    const absent = harness([action, '--apply'], { QSTASH_TOKEN: TOKEN }, [{ status: 404 }]);
    assert.equal(await runManageSchedule(absent.deps), 2, `${action} 404`);
    const boom = harness([action, '--apply'], { QSTASH_TOKEN: TOKEN }, [{ status: 500 }]);
    assert.equal(await runManageSchedule(boom.deps), 4, `${action} 5xx`);
  }
});

// === 5. Credentials are NEVER printed ===

test('no code path prints the management token or the forwarded route secret', async () => {
  const scenarios: Array<{
    argv: string[];
    env: Record<string, string | undefined>;
    responses: MockResponse[];
  }> = [
    { argv: [], env: { QSTASH_TOKEN: TOKEN }, responses: [{ status: 200, body: goodSchedule }] },
    {
      argv: [],
      env: { QSTASH_TOKEN: TOKEN },
      responses: [{ status: 200, body: { ...goodSchedule, cron: 'x' } }],
    },
    {
      argv: ['upsert', '--apply'],
      env: { QSTASH_TOKEN: TOKEN, CRON_SECRET },
      responses: [{ status: 200, body: { scheduleId: SCHEDULE_ID } }],
    },
    {
      argv: ['upsert', '--apply'],
      env: { QSTASH_TOKEN: TOKEN, CRON_SECRET },
      responses: [{ status: 500 }],
    },
    { argv: ['pause', '--apply'], env: { QSTASH_TOKEN: TOKEN }, responses: [{ status: 200 }] },
    { argv: ['resume', '--apply'], env: { QSTASH_TOKEN: TOKEN }, responses: [{ status: 404 }] },
    { argv: ['--bogus'], env: { QSTASH_TOKEN: TOKEN }, responses: [] },
    { argv: [], env: {}, responses: [] },
    // An operator pasting a secret as an argument must not have it echoed.
    { argv: [`--token=${TOKEN}`], env: { QSTASH_TOKEN: TOKEN }, responses: [] },
    { argv: [CRON_SECRET], env: { QSTASH_TOKEN: TOKEN }, responses: [] },
    // A divergent readback whose destination embeds the secret must not leak it
    // through the summary or the divergence message.
    {
      argv: [],
      env: { QSTASH_TOKEN: TOKEN },
      responses: [
        {
          status: 200,
          body: {
            ...goodSchedule,
            destination: `https://x:${CRON_SECRET}@turfwar.games/api/cron/game-stats`,
          },
        },
      ],
    },
    // A poisoned QSTASH_URL must fail closed without echoing the token.
    {
      argv: [],
      env: { QSTASH_TOKEN: TOKEN, QSTASH_URL: `https://x:${TOKEN}@evil.example` },
      responses: [],
    },
  ];
  for (const s of scenarios) {
    const { deps, out, err } = harness(s.argv, s.env, s.responses);
    await runManageSchedule(deps);
    const all = [...out, ...err].join('\n');
    assert.ok(!all.includes(TOKEN), `token leaked: ${s.argv.join(' ')}`);
    assert.ok(!all.includes(CRON_SECRET), `cron secret leaked: ${s.argv.join(' ')}`);
    // Even a readback containing the forwarded value is redacted to names only.
    assert.ok(!all.includes('Bearer forwarded'));
  }
});

test('redactHeaderNames and summarizeSchedule expose names only, never values', () => {
  assert.deepEqual(redactHeaderNames({ Authorization: ['Bearer x'], 'X-Y': ['z'] }), [
    'Authorization',
    'X-Y',
  ]);
  const summary = summarizeSchedule(goodSchedule);
  assert.deepEqual(summary.headerNames, ['Authorization']);
  assert.ok(!JSON.stringify(summary).includes('Bearer'));
});

// === 6. Every request targets only a QStash management schedule endpoint ===

test('inspect/upsert/pause/resume touch only /v2/schedules management endpoints', async () => {
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

test('the CLI never mints a delete request', () => {
  // There is deliberately no buildDeleteRequest export and no DELETE method used.
  const src = readFileSync(
    path.join(REPO_ROOT, 'scripts', 'manage-game-stats-schedule.ts'),
    'utf8'
  );
  assert.ok(!/method:\s*'DELETE'/.test(src), 'no DELETE mutation');
  assert.ok(!/buildDeleteRequest/.test(src), 'no delete action');
});
