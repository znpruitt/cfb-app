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
  METHOD,
  RETRIES,
  SCHEDULE_ID,
} from '../../../../scripts/manage-schedule-presentation-schedule.ts';
import { CRON as SCHEDULE_REFRESH_CRON } from '../../../../scripts/manage-schedule-refresh-schedule.ts';

/**
 * PLATFORM-757a — the EXTERNAL QStash trigger CLI for the standalone
 * schedule-presentation job.
 *
 * ## Scope of this file, stated because it is deliberately narrow
 *
 * The CLI's BEHAVIOUR — inspect-first, apply-gating, fail-closed on a missing
 * credential, Authorization redaction, management-endpoint-only, exit codes — is
 * contract-parameterized in `scripts/lib/qstashSchedule.ts` and is already
 * asserted across every CLI at once by
 * `src/lib/server/__tests__/qstashScheduleRecordedIntent.test.ts`, which this
 * slice added this schedule to. Re-testing it here would be a copy that stops
 * matching the shared policy the moment it changes.
 *
 * What is UNIQUE to this schedule, and therefore lives here, is its contract
 * values and the one cadence decision the slice actually made.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const TOKEN = 'qstash-token-must-never-print';
const CRON_SECRET = 'cron-secret-must-never-print';

test('the presentation contract is the fixed Tuesday 13:00 UTC GET schedule', () => {
  assert.equal(SCHEDULE_ID, 'turfwar-schedule-presentation-weekly');
  assert.equal(DESTINATION, 'https://turfwar.games/api/cron/schedule-presentation');
  assert.equal(CRON, '0 13 * * 2');
  assert.equal(METHOD, 'GET');
  assert.equal(RETRIES, 0);
});

test('it runs an hour AFTER the weekly schedule job, which is the cadence decision', () => {
  // Not a coincidence to be re-derived by a reader: the job is scheduled after
  // the schedule cron so it reads a fresh canonical schedule, and far enough
  // after that the two never hit CFBD together. Both halves are asserted, so a
  // later edit that moved either cron onto the other's slot fails here rather
  // than producing two jobs racing the same provider.
  assert.equal(SCHEDULE_REFRESH_CRON, '0 12 * * 2', 'the schedule job is unchanged at 12:00');
  assert.equal(CRON, '0 13 * * 2');
  const hourOf = (cron: string): number => Number(cron.split(' ')[1]);
  const dayOf = (cron: string): string => cron.split(' ')[4];
  assert.equal(dayOf(CRON), dayOf(SCHEDULE_REFRESH_CRON), 'same weekday');
  assert.equal(
    hourOf(CRON) - hourOf(SCHEDULE_REFRESH_CRON),
    1,
    'presentation runs exactly one hour later'
  );
});

test('vercel.json declares no schedule-presentation cron (the trigger is external QStash)', () => {
  const config = JSON.parse(readFileSync(path.join(REPO_ROOT, 'vercel.json'), 'utf8')) as {
    crons?: Array<{ path?: string }>;
  };
  assert.ok(
    !(config.crons ?? []).some((c) => c.path === '/api/cron/schedule-presentation'),
    'vercel.json must not declare a schedule-presentation cron'
  );
});

test('buildUpsertRequest emits exactly the fixed contract with the approved headers only', () => {
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
    'Upstash-Cron': '0 13 * * 2',
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

test('get/pause/resume hit exactly the management schedule endpoints, and nothing deletes', () => {
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
  for (const build of [buildGetRequest, buildPauseRequest, buildResumeRequest]) {
    const req = build({ base: DEFAULT_QSTASH_BASE, qstashToken: TOKEN });
    assert.notEqual(req.method, 'DELETE', 'no path in this CLI may delete a schedule');
  }
});
