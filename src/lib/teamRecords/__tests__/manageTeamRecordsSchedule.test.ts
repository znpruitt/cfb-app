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
  runManageSchedule,
  SCHEDULE_ID,
  type FetchLike,
  type RunDeps,
  type ScheduleReadback,
} from '../../../../scripts/manage-team-records-schedule.ts';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);
const TOKEN = 'qstash-token-SECRET-VALUE';
const CRON_SECRET = 'cron-secret-SECRET-VALUE';
const REDACTED_AUTH = 'REDACTED:opaque-digest';

const goodSchedule: ScheduleReadback = {
  scheduleId: SCHEDULE_ID,
  destination: DESTINATION,
  cron: CRON,
  method: METHOD,
  retries: 0,
  isPaused: false,
  header: { Authorization: [REDACTED_AUTH] },
};

type MockResponse = { status: number; body?: unknown; throws?: boolean };

function harness(
  argv: string[],
  env: Record<string, string | undefined>,
  responses: MockResponse[]
) {
  const out: string[] = [];
  const err: string[] = [];
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  let index = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    const response = responses[index++] ?? { status: 500 };
    if (response.throws) throw new Error('network down');
    return { status: response.status, json: async () => response.body ?? {} };
  };
  const deps: RunDeps = {
    argv,
    env,
    fetchImpl,
    log: (line) => out.push(line),
    errorLog: (line) => err.push(line),
  };
  return { deps, out, err, calls };
}

test('the team-records contract is the fixed hourly external GET schedule', () => {
  assert.equal(SCHEDULE_ID, 'turfwar-team-records-hourly');
  assert.equal(DESTINATION, 'https://turfwar.games/api/cron/team-records');
  assert.equal(CRON, '0 * * * *');
  assert.equal(METHOD, 'GET');

  const vercel = JSON.parse(readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8')) as {
    crons?: Array<{ path?: string }>;
  };
  assert.ok(
    !(vercel.crons ?? []).some((cron) => cron.path === '/api/cron/team-records'),
    'the team-records trigger stays external to vercel.json'
  );
});

test('the upsert request carries only the approved hourly QStash contract', () => {
  const request = buildUpsertRequest({
    base: DEFAULT_QSTASH_BASE,
    qstashToken: TOKEN,
    cronSecret: CRON_SECRET,
  });
  assert.equal(request.method, 'POST');
  assert.equal(request.url, `${DEFAULT_QSTASH_BASE}/v2/schedules/${DESTINATION}`);
  assert.deepEqual(request.headers, {
    Authorization: `Bearer ${TOKEN}`,
    'Upstash-Schedule-Id': SCHEDULE_ID,
    'Upstash-Cron': '0 * * * *',
    'Upstash-Method': 'GET',
    'Upstash-Retries': '0',
    'Upstash-Forward-Authorization': `Bearer ${CRON_SECRET}`,
    'Upstash-Redact-Fields': 'header[Authorization]',
  });
});

test('inspect is read-only and all mutations require --apply', () => {
  assert.deepEqual(parseScheduleArgs([]), { action: 'inspect', apply: false });
  for (const action of ['upsert', 'pause', 'resume']) {
    const parsed = parseScheduleArgs([action]);
    assert.ok('error' in parsed);
    assert.match(parsed.error, /--apply/);
  }
});

test('inspect verifies the exact redacted schedule and cites its runbook proof', async () => {
  const run = harness([], { QSTASH_TOKEN: TOKEN }, [{ status: 200, body: goodSchedule }]);
  assert.equal(await runManageSchedule(run.deps), 0);
  assert.equal(run.calls.length, 1);
  assert.equal(run.calls[0]?.method, 'GET');
  assert.match(run.out.join('\n'), /§8k step 4/);
  assert.ok(!run.out.join('\n').includes('opaque-digest'));
});

test('missing credentials and a poisoned QStash origin fail closed', async () => {
  const missingToken = harness([], {}, []);
  assert.equal(await runManageSchedule(missingToken.deps), 3);
  assert.equal(missingToken.calls.length, 0);

  const missingSecret = harness(['upsert', '--apply'], { QSTASH_TOKEN: TOKEN }, []);
  assert.equal(await runManageSchedule(missingSecret.deps), 3);
  assert.equal(missingSecret.calls.length, 0);

  const poisoned = harness(
    [],
    { QSTASH_TOKEN: TOKEN, QSTASH_URL: 'https://qstash.upstash.io.evil.example' },
    []
  );
  assert.equal(await runManageSchedule(poisoned.deps), 3);
  assert.equal(poisoned.calls.length, 0);
});

test('management endpoints are fixed and no shared or job-specific delete path exists', () => {
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
  assert.deepEqual(evaluateScheduleContract(goodSchedule), { ok: true, mismatches: [] });

  for (const relative of [
    ['scripts', 'manage-team-records-schedule.ts'],
    ['scripts', 'lib', 'qstashSchedule.ts'],
  ]) {
    const source = readFileSync(path.join(REPO_ROOT, ...relative), 'utf8');
    assert.ok(!/method:\s*'DELETE'/.test(source));
    assert.ok(!/buildDeleteRequest/.test(source));
  }
});
