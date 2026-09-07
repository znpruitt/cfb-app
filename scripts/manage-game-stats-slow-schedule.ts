// Operator CLI for the game-stats RECONCILIATION (slow) trigger schedule (PLATFORM-102 slice 4).
//
// // A SECOND QStash schedule against the same unchanged `/api/cron/game-stats`
// route, covering the reconciliation tail — kickoff + 24h — at an hourly cadence
// while the dense schedule covers the game hours at fifteen minutes. One cron
// expression cannot carry both cadences; see the live-scores twin and
// `src/lib/schedule/pollingCron.ts` for why.
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
//   tsx scripts/manage-game-stats-slow-schedule.ts [inspect]          # READ-ONLY: read back + verify
//   tsx scripts/manage-game-stats-slow-schedule.ts upsert --apply     # write the schedule
//   tsx scripts/manage-game-stats-slow-schedule.ts pause  --apply     # pause deliveries
//   tsx scripts/manage-game-stats-slow-schedule.ts resume --apply     # resume deliveries
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
import { GAME_STATS_SLOW_CONTRACT } from './lib/plannerScheduleContracts.ts';
import { createPlannerIntentReader } from './lib/plannerIntentReader.ts';

const CONTRACT = GAME_STATS_SLOW_CONTRACT;

export const SCHEDULE_ID = CONTRACT.scheduleId;
export const DESTINATION = CONTRACT.destination;
/**
 * The FIXED FALLBACK cron, not the cadence this schedule runs. The polling planner rewrites this
 * schedule daily, so the live cron is whatever the planner last recorded; this
 * constant is only what an `upsert` writes when NO recorded intent exists — the
 * bootstrap, and the state a wiped record store restores. It over-approximates
 * on purpose, and the next planner run narrows it.
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
if (invokedDirectly)
  void runScheduleCli(CONTRACT, { readRecordedIntent: createPlannerIntentReader() });
