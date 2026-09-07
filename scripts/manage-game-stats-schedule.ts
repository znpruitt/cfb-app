// Operator CLI for the EXTERNAL game-stats trigger schedule (PLATFORM-086H3E).
//
// The 15-minute game-stats poll no longer runs from a Vercel cron (Vercel's
// Hobby plan rejects sub-daily cron expressions at deploy time). Instead an
// external QStash schedule calls the UNCHANGED route
//
//   GET https://turfwar.games/api/cron/game-stats
//     Authorization: Bearer <CRON_SECRET>   (forwarded by QStash)
//
// every 15 minutes. All schedule policy — the fixed message contract, the
// inspect-first/apply-gated safety, fail-closed behavior, redaction, exit codes,
// and the guarantee that only QStash management endpoints are ever hit — lives
// in the shared, contract-parameterized `scripts/lib/qstashSchedule.ts`
// (PLATFORM-086B2B). This file only binds the game-stats CONTRACT into it and
// re-exports the bound helpers, so its runtime behavior is byte-identical to
// before the extraction. It carries NO QStash runtime dependency (plain fetch),
// never deletes, and treats the schedule's identity/destination/message contract
// as FIXED constants.
//
// Usage:
//   tsx scripts/manage-game-stats-schedule.ts [inspect]          # READ-ONLY: read back + verify the contract
//   tsx scripts/manage-game-stats-schedule.ts upsert --apply     # create/overwrite the fixed schedule
//   tsx scripts/manage-game-stats-schedule.ts pause  --apply     # pause deliveries
//   tsx scripts/manage-game-stats-schedule.ts resume --apply     # resume deliveries
//
// Default execution (and any action WITHOUT `--apply`) is read-only: `inspect`
// only reads; `upsert`/`pause`/`resume` refuse unless `--apply` is present.
//
// Secrets: `QSTASH_TOKEN` (management auth) and `CRON_SECRET` (the value QStash
// forwards to the route) are read from the environment and are NEVER printed.
// `QSTASH_TOKEN` must never be committed. It IS configured in Vercel since
// PLATFORM-102 slice 4, because the deployed polling planner rewrites the
// live-scores and game-stats schedules daily; Upstash documents no scoped
// management token, so that copy is full-privilege. Owner decision, with the
// rationale in `docs/deployment-runbook.md` §4.

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
import { GAME_STATS_DENSE_CONTRACT } from './lib/plannerScheduleContracts.ts';
import { createPlannerIntentReader } from './lib/plannerIntentReader.ts';

// === The schedule contract, now declared ONCE for two writers ===
//
// PLATFORM-102 slice 4 moved it to `scripts/lib/plannerScheduleContracts.ts`. The
// deployed planner rewrites this schedule daily and this CLI still inspects,
// pauses and resumes it, so the two must agree on the id and destination byte for
// byte — one declaration is the only way that is a property rather than a habit.
// The re-exports below are unchanged, so every existing importer still resolves.
const CONTRACT = GAME_STATS_DENSE_CONTRACT;

export const SCHEDULE_ID = CONTRACT.scheduleId;
export const DESTINATION = CONTRACT.destination;
/**
 * The FIXED FALLBACK cron — NOT the cadence this schedule runs since slice 4.
 *
 * The planner rewrites this expression once a day from the canonical schedule, so
 * the live cron is whatever it last recorded. This constant is what an `upsert`
 * writes when NO recorded intent exists: the bootstrap, and the state a wiped
 * record store restores. It is the pre-planner always-on cadence, so it
 * over-approximates rather than under-covers, and the next planner run narrows it.
 */
export const CRON = CONTRACT.cron;
export const METHOD = CONTRACT.method;
export const RETRIES = CONTRACT.retries;
export { DEFAULT_QSTASH_BASE };
export type { FetchLike, RunDeps, ScheduleReadback } from './lib/qstashSchedule.ts';

// Contract-independent policy is re-exported straight through.
export { parseScheduleArgs, redactHeaderNames, resolveQstashBase, scrubSecrets };

// Contract-dependent helpers, bound to the game-stats contract so their public
// signatures (and thus runtime behavior) are exactly what they were before the
// shared extraction.
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
// PLANNER-OWNED since slice 4, so this CLI reads the planner's recorded intent:
// `inspect` judges the live schedule against what the planner last recorded rather
// than against a constant it no longer follows, and `upsert` writes that same
// intent rather than clobbering it with the fallback.
if (invokedDirectly)
  void runScheduleCli(CONTRACT, { readRecordedIntent: createPlannerIntentReader() });
