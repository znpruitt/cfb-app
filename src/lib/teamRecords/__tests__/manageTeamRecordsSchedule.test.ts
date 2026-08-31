import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildUpsertRequest,
  CRON,
  DEFAULT_QSTASH_BASE,
  DESTINATION,
  METHOD,
  RETRIES,
  SCHEDULE_ID,
} from '../../../../scripts/manage-team-records-schedule.ts';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..'
);

test('the Team records contract is the fixed hourly external GET schedule', () => {
  assert.equal(SCHEDULE_ID, 'turfwar-team-records-hourly');
  assert.equal(DESTINATION, 'https://turfwar.games/api/cron/team-records');
  assert.equal(CRON, '0 * * * *');
  assert.equal(METHOD, 'GET');
  assert.equal(RETRIES, 0);

  const vercel = JSON.parse(readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8')) as {
    crons?: Array<{ path?: string }>;
  };
  assert.ok(!vercel.crons?.some((entry) => entry.path === '/api/cron/team-records'));
});

test('the Team records upsert forwards and redacts only the fixed route authorization', () => {
  const request = buildUpsertRequest({
    base: DEFAULT_QSTASH_BASE,
    qstashToken: 'qstash-token',
    cronSecret: 'cron-secret',
  });

  assert.equal(request.method, 'POST');
  assert.equal(request.url, `${DEFAULT_QSTASH_BASE}/v2/schedules/${DESTINATION}`);
  assert.deepEqual(request.headers, {
    Authorization: 'Bearer qstash-token',
    'Upstash-Schedule-Id': SCHEDULE_ID,
    'Upstash-Cron': CRON,
    'Upstash-Method': METHOD,
    'Upstash-Retries': String(RETRIES),
    'Upstash-Forward-Authorization': 'Bearer cron-secret',
    'Upstash-Redact-Fields': 'header[Authorization]',
  });
});
