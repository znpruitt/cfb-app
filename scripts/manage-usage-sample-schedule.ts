// Operator CLI for the EXTERNAL CFBD usage-sample schedule (Item 127).
//
// Runs from an external QStash schedule — Vercel's Hobby plan rejects sub-daily
// cron expressions at deploy time, and this sampler is deliberately sub-daily —
// calling the route
//
//   GET https://turfwar.games/api/cron/usage-sample
//     Authorization: Bearer <CRON_SECRET>   (forwarded by QStash)
//
// every six hours. The route reads CFBD `/info` and appends one bounded daily
// entry to the durable usage series. `/info` is NOT a billed CFBD call.
//
// WHY IT EXISTS AND WHY IT IS ITS OWN SCHEDULE. `/info` reports usage for the
// CURRENT PERIOD only, the period is calendar-monthly, and CFBD exposes no
// history — so a month boundary destroys the previous month's burn permanently.
// Every OTHER observation point in the app is conditional: the game-stats probe
// sits behind an exact-target gate and yields nothing on a quiet day, and
// System Health only reads on an admin page view. A series built from those
// samples the expensive days and misses the cheap ones, which is exactly
// backwards for a question of the form "what does a Saturday cost by
// comparison".
//
// Attaching it to `season-transition` was tried and reverted: that route holds a
// deliberate guarantee that a refused run makes ZERO outbound provider requests,
// pinned by its own tests. This schedule exists so that guarantee survives.
//
// WHY SIX-HOURLY. `used` is cumulative within the period, so the reading that
// matters most is the last one before a reset, and whatever is missed there is
// gone. Daily sampling bounds that tail loss at 24 hours; six-hourly bounds it
// at six, for an unbilled call.
//
//   tsx scripts/manage-usage-sample-schedule.ts [inspect]        # READ-ONLY: read back + verify the contract
//   tsx scripts/manage-usage-sample-schedule.ts upsert --apply   # create/overwrite the fixed schedule
//   tsx scripts/manage-usage-sample-schedule.ts pause  --apply   # pause deliveries
//   tsx scripts/manage-usage-sample-schedule.ts resume --apply   # resume deliveries
//
// Default execution (and any action WITHOUT `--apply`) is read-only.
//
// Secrets: `QSTASH_TOKEN` (management auth) and `CRON_SECRET` (the value QStash
// forwards to the route) are read from the environment and are NEVER printed.
// `QSTASH_TOKEN` is management-only and must live outside Vercel and the repo.
// Rotating `CRON_SECRET` requires pausing then re-upserting ALL SEVEN schedules
// (game-stats, live-scores, Team records, Odds, weekly schedule, rankings, usage sample)
// before the new
// secret is re-enabled on the routes.

import { pathToFileURL } from 'node:url';

import {
  DEFAULT_QSTASH_BASE,
  buildGetRequest as buildGetRequestShared,
  buildPauseRequest as buildPauseRequestShared,
  buildResumeRequest as buildResumeRequestShared,
  buildUpsertRequest as buildUpsertRequestShared,
  evaluateScheduleContract as evaluateScheduleContractShared,
  parseScheduleArgs,
  redactHeaderNames,
  resolveQstashBase,
  runManageSchedule as runManageScheduleShared,
  runScheduleCli,
  scrubSecrets,
  summarizeSchedule as summarizeScheduleShared,
  type QstashRequest,
  type RunDeps,
  type ScheduleContract,
  type ScheduleReadback,
} from './lib/qstashSchedule.ts';

// === The FIXED schedule contract (never operator-tunable) ===
export const SCHEDULE_ID = 'turfwar-usage-sample-6h';
export const DESTINATION = 'https://turfwar.games/api/cron/usage-sample';
export const CRON = '0 */6 * * *';
export const METHOD = 'GET';
export const RETRIES = 0;
export { DEFAULT_QSTASH_BASE };
export type { FetchLike, RunDeps, ScheduleReadback } from './lib/qstashSchedule.ts';

const USAGE =
  'usage: tsx scripts/manage-usage-sample-schedule.ts [inspect]\n' +
  '       tsx scripts/manage-usage-sample-schedule.ts <upsert|pause|resume> --apply';

const CONTRACT: ScheduleContract = {
  scheduleId: SCHEDULE_ID,
  destination: DESTINATION,
  cron: CRON,
  method: METHOD,
  retries: RETRIES,
  usage: USAGE,
  debugEnvVar: 'MANAGE_USAGE_SAMPLE_SCHEDULE_DEBUG',
  failureTag: 'manage-usage-sample-schedule-failed',
  authProofRef: '§8m',
};

// Contract-independent policy is re-exported straight through.
export { parseScheduleArgs, redactHeaderNames, resolveQstashBase, scrubSecrets };

// Contract-dependent helpers, bound to the usage-sample contract.
export const buildUpsertRequest = (params: {
  base: string;
  qstashToken: string;
  cronSecret: string;
}): QstashRequest => buildUpsertRequestShared(CONTRACT, params);
export const buildGetRequest = (params: { base: string; qstashToken: string }): QstashRequest =>
  buildGetRequestShared(CONTRACT, params);
export const buildPauseRequest = (params: { base: string; qstashToken: string }): QstashRequest =>
  buildPauseRequestShared(CONTRACT, params);
export const buildResumeRequest = (params: { base: string; qstashToken: string }): QstashRequest =>
  buildResumeRequestShared(CONTRACT, params);
export const evaluateScheduleContract = (schedule: ScheduleReadback) =>
  evaluateScheduleContractShared(CONTRACT, schedule);
export const summarizeSchedule = (schedule: ScheduleReadback): Record<string, unknown> =>
  summarizeScheduleShared(CONTRACT, schedule);
export const runManageSchedule = (deps: RunDeps): Promise<number> =>
  runManageScheduleShared(CONTRACT, deps);

// Run only when invoked directly, so tests import the pure helpers and the
// injected-deps orchestration without triggering the process-exiting wrapper.
const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void runScheduleCli(CONTRACT);
