// Operator CLI for the fixed hourly Team records QStash heartbeat.
// The application-owned 6h floor / 12h ceiling decides whether `/records` is
// due; this schedule only gives that policy an hourly recovery trigger.

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

export const SCHEDULE_ID = 'turfwar-team-records-hourly';
export const DESTINATION = 'https://turfwar.games/api/cron/team-records';
export const CRON = '0 * * * *';
export const METHOD = 'GET';
export const RETRIES = 0;
export { DEFAULT_QSTASH_BASE };
export type { FetchLike, RunDeps, ScheduleReadback } from './lib/qstashSchedule.ts';

const CONTRACT: ScheduleContract = {
  scheduleId: SCHEDULE_ID,
  destination: DESTINATION,
  cron: CRON,
  method: METHOD,
  retries: RETRIES,
  usage:
    'usage: tsx scripts/manage-team-records-schedule.ts [inspect]\n' +
    '       tsx scripts/manage-team-records-schedule.ts <upsert|pause|resume> --apply',
  debugEnvVar: 'MANAGE_TEAM_RECORDS_SCHEDULE_DEBUG',
  failureTag: 'manage-team-records-schedule-failed',
  authProofRef: '§8k step 5',
};

export { parseScheduleArgs, redactHeaderNames, resolveQstashBase, scrubSecrets };

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

const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void runScheduleCli(CONTRACT);
