// Operator CLI for the polling-planner daily trigger schedule (PLATFORM-102 slice 4).
//
// // The daily run that derives the polling windows, synthesizes each planner-owned
// job's dense and slow crons, records what it derived, and brings the four
// schedules it owns to that state. This CLI provisions the PLANNER's own
// trigger; it does not plan anything itself.
//
// It supplies NO recorded-intent reader, because this schedule is not
// planner-owned — `upsert` writes the fixed contract, which is the whole point.
//
// All schedule policy — the message contract, the inspect-first/apply-gated
// safety, fail-closed behavior, provider-side Authorization redaction, exit
// codes, and the guarantee that only QStash management endpoints are ever hit —
// lives in the shared `scripts/lib/qstashSchedule.ts`. The CONTRACT itself lives
// in `scripts/lib/plannerScheduleContracts.ts` rather than in this file, because
// the deployed planner writes the same schedule and the two must agree on its id
// and destination byte for byte.
//
// Usage:
//   tsx scripts/manage-polling-planner-schedule.ts [inspect]          # READ-ONLY: read back + verify
//   tsx scripts/manage-polling-planner-schedule.ts upsert --apply     # write the schedule
//   tsx scripts/manage-polling-planner-schedule.ts pause  --apply     # pause deliveries
//   tsx scripts/manage-polling-planner-schedule.ts resume --apply     # resume deliveries
//
// Default execution (and any action WITHOUT `--apply`) is read-only.
//
// Secrets: `QSTASH_TOKEN` (management auth) and `CRON_SECRET` (the value QStash
// forwards to the route) are read from the environment and are NEVER printed.
// Since PLATFORM-102 slice 4 the deployed planner ALSO holds `QSTASH_TOKEN` in the
// Vercel environment — see `docs/deployment-runbook.md` — so this is one of two
// copies rather than the only one. It still must never be committed to the repo.

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
  scrubSecrets,
  summarizeSchedule as summarizeScheduleShared,
  type QstashRequest,
  type RunDeps,
  type ScheduleReadback,
} from './lib/qstashSchedule.ts';
import { runScheduleCli } from './lib/qstashScheduleCli.ts';
import { POLLING_PLANNER_CONTRACT } from './lib/plannerScheduleContracts.ts';

const CONTRACT = POLLING_PLANNER_CONTRACT;

export const SCHEDULE_ID = CONTRACT.scheduleId;
export const DESTINATION = CONTRACT.destination;
/**
 * The FIXED FALLBACK cron, not the cadence this schedule runs. This is the ONE schedule on the
 * planner's list that the planner does not own, and it must stay that way: the
 * job that rewrites the other four cannot be rewriting its own trigger, or a
 * planner that stopped could not be restarted from the repo. 23:50 UTC, ten
 * minutes before the day it plans.
 */
export const CRON = CONTRACT.cron;
export const METHOD = CONTRACT.method;
export const RETRIES = CONTRACT.retries;
export { DEFAULT_QSTASH_BASE };
export type { FetchLike, RunDeps, ScheduleReadback } from './lib/qstashSchedule.ts';

// Contract-independent policy is re-exported straight through.
export { parseScheduleArgs, redactHeaderNames, resolveQstashBase, scrubSecrets };

// Contract-dependent helpers, bound to this schedule's contract.
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
