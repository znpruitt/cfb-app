// Operator CLI for the EXTERNAL Odds trigger schedule (PLATFORM-086C2).
//
// The hourly Odds poll runs from an external QStash schedule (Vercel's Hobby plan
// rejects sub-daily cron expressions at deploy time, and the Odds cadence is
// application-owned regardless) that calls the route
//
//   GET https://turfwar.games/api/cron/odds
//     Authorization: Bearer <CRON_SECRET>   (forwarded by QStash)
//
// every hour. The application's pure polling policy — not the schedule — owns the
// 6-hour baseline / 2-hour America/Chicago pregame cadence; the hourly trigger is
// only the heartbeat that lets the policy decide whether a provider request is due.
//
// All schedule policy — the fixed message contract, inspect-first/apply-gated
// safety, fail-closed behavior, provider-side Authorization redaction, exit codes,
// and the guarantee that only QStash management endpoints are ever hit — lives in
// the shared, contract-parameterized `scripts/lib/qstashSchedule.ts`; this file
// only binds the Odds CONTRACT into it. It carries NO QStash runtime dependency
// (plain fetch), NEVER deletes, and treats the schedule's identity/destination/
// message contract as FIXED constants.
//
// This CLI PROVISIONS/controls the schedule; it does NOT itself activate Odds
// automation. Activation (creating the schedule against production + opening the
// gates) is the separate, operator-run post-merge step in the deployment runbook
// (§8g); until then the route stays dormant and no schedule exists.
//
// Usage:
//   tsx scripts/manage-odds-schedule.ts [inspect]        # READ-ONLY: read back + verify the contract
//   tsx scripts/manage-odds-schedule.ts upsert --apply   # create/overwrite the fixed schedule
//   tsx scripts/manage-odds-schedule.ts pause  --apply   # pause deliveries
//   tsx scripts/manage-odds-schedule.ts resume --apply   # resume deliveries
//
// Default execution (and any action WITHOUT `--apply`) is read-only.
//
// Secrets: `QSTASH_TOKEN` (management auth) and `CRON_SECRET` (the value QStash
// forwards to the route) are read from the environment and are NEVER printed.
// `QSTASH_TOKEN` is management-only and must live outside Vercel and the repo.
// Rotating `CRON_SECRET` requires pausing then re-upserting ALL FIVE schedules
// (game-stats, live-scores, Odds, weekly schedule, rankings) before the new
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
export const SCHEDULE_ID = 'turfwar-odds-hourly';
export const DESTINATION = 'https://turfwar.games/api/cron/odds';
export const CRON = '0 * * * *';
export const METHOD = 'GET';
export const RETRIES = 0;
export { DEFAULT_QSTASH_BASE };
export type { FetchLike, RunDeps, ScheduleReadback } from './lib/qstashSchedule.ts';

const USAGE =
  'usage: tsx scripts/manage-odds-schedule.ts [inspect]\n' +
  '       tsx scripts/manage-odds-schedule.ts <upsert|pause|resume> --apply';

const CONTRACT: ScheduleContract = {
  scheduleId: SCHEDULE_ID,
  destination: DESTINATION,
  cron: CRON,
  method: METHOD,
  retries: RETRIES,
  usage: USAGE,
  debugEnvVar: 'MANAGE_ODDS_SCHEDULE_DEBUG',
  failureTag: 'manage-odds-schedule-failed',
  authProofRef: '§8g step 5',
};

// Contract-independent policy is re-exported straight through.
export { parseScheduleArgs, redactHeaderNames, resolveQstashBase, scrubSecrets };

// Contract-dependent helpers, bound to the Odds contract.
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
