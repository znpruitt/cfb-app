import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildUpsertRequest,
  CRON,
  DESTINATION,
  METHOD,
  RETRIES,
  SCHEDULE_ID,
} from '../../../../scripts/manage-usage-sample-schedule.ts';

/**
 * Item 127 — contract pins for the seventh QStash schedule, matching what the six
 * sibling managers already pin. Without these, a drifted cron expression or a
 * duplicate Vercel cron definition for this path would ship unnoticed.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

test('the usage-sample contract is the fixed six-hourly GET schedule', () => {
  assert.equal(SCHEDULE_ID, 'turfwar-usage-sample-6h');
  assert.equal(DESTINATION, 'https://turfwar.games/api/cron/usage-sample');
  assert.equal(CRON, '0 */6 * * *');
  assert.equal(METHOD, 'GET');
  assert.equal(RETRIES, 0, 'the route is idempotent per run; scheduler retries are always zero');
});

test('the upsert forwards CRON_SECRET and asks QStash to redact it', () => {
  const request = buildUpsertRequest({
    base: 'https://qstash.upstash.io',
    qstashToken: 'token-value',
    cronSecret: 'secret-value',
  });

  assert.equal(request.headers['Upstash-Cron'], '0 */6 * * *');
  assert.equal(request.headers['Upstash-Forward-Authorization'], 'Bearer secret-value');
  assert.equal(
    request.headers['Upstash-Redact-Fields'],
    'header[Authorization]',
    'the forwarded route credential must not land in QStash readable state'
  );
  assert.equal(request.headers['Upstash-Retries'], '0');
});

test('vercel.json declares only the lifecycle crons and no usage-sample cron', () => {
  // A duplicate definition here would double-fire the sampler and, on Hobby,
  // reject the sub-daily expression at deploy time.
  const config = JSON.parse(readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8')) as {
    crons?: Array<{ path?: string }>;
  };
  const paths = (config.crons ?? []).map((entry) => entry.path).sort();
  assert.deepEqual(paths, ['/api/cron/season-rollover', '/api/cron/season-transition']);
});

test('package.json binds manage:usage-sample-schedule', () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  assert.equal(
    pkg.scripts?.['manage:usage-sample-schedule'],
    'tsx scripts/manage-usage-sample-schedule.ts'
  );
});
