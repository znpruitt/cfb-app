// The QStash schedule contracts the polling-window planner owns, plus the
// planner's own daily trigger (PLATFORM-102 slice 4).
//
// WHY THEY LIVE IN ONE FILE RATHER THAN IN EACH SCRIPT. Every other job declares
// its contract inside its own `manage-*` CLI, because the CLI is the only thing
// that provisions it. These four have TWO writers — the deployed planner route
// rewrites them daily, and an operator still needs `inspect`/`pause`/`resume` —
// and the two must agree on the schedule id and destination byte for byte or the
// planner writes one schedule while the operator inspects another. One
// declaration is the only way that agreement is a property rather than a habit.
//
// Pure data with a type-only import, so both a Node script and a Next.js route
// can hold it. No secret, no environment read, no I/O.

import type { ScheduleContract } from './qstashSchedule.ts';

/**
 * The FIXED cron each planner-owned schedule falls back to when no recorded
 * intent exists — the bootstrap, and the state a wiped record store restores.
 *
 * Each one OVER-APPROXIMATES on purpose. The dense fallbacks are exactly the
 * cadences `live-scores` and `game-stats` run today, so falling back costs Active
 * CPU and changes nothing about correctness; the handler guards, not the cron,
 * decide whether a provider call happens. The slow fallback is the dead-day expression `slowHoursFor`
 * itself emits — hourly at the dispatch offset, every hour — for the same reason.
 * The next planner run overwrites either within a day.
 */
const DENSE_FALLBACK_LIVE_SCORES = '*/3 * * * *';
const DENSE_FALLBACK_GAME_STATS = '*/15 * * * *';
const SLOW_FALLBACK = '1 * * * *';

/**
 * The planner's own trigger, and the ONE schedule on this list it does not own —
 * it is a fixed daily cron like every pre-102 job, and it must be, or the thing
 * that rewrites the schedules would be rewriting its own.
 *
 * 23:50 UTC, ten minutes before the day it plans. A cron has no date field, so
 * yesterday's expression fires yesterday's hour set again today until it is
 * rewritten; a Saturday-night cluster runs into Sunday hours 0-8, which are not
 * in Saturday's expression. Planning the day before it starts is what closes
 * that gap — see `resolvePlanningDayStartMs`.
 */
export const POLLING_PLANNER_CRON = '50 23 * * *';

const BASE = 'https://turfwar.games/api/cron';

function contract(fields: {
  scheduleId: string;
  destination: string;
  cron: string;
  usageScript: string;
  debugEnvVar: string;
  failureTag: string;
  authProofRef: string;
}): ScheduleContract {
  return {
    scheduleId: fields.scheduleId,
    destination: fields.destination,
    cron: fields.cron,
    method: 'GET',
    retries: 0,
    usage:
      `usage: tsx scripts/${fields.usageScript} [inspect]\n` +
      `       tsx scripts/${fields.usageScript} <upsert|pause|resume> --apply`,
    debugEnvVar: fields.debugEnvVar,
    failureTag: fields.failureTag,
    authProofRef: fields.authProofRef,
  };
}

/**
 * `live-scores` DENSE — the existing three-minute schedule, kept under its
 * original id.
 *
 * THE ID IS DELIBERATELY NOT RENAMED even though `-3m` stops being true the
 * moment the planner narrows it. Renaming means provisioning a new schedule and
 * retiring the old one, and this module never deletes — so the old three-minute
 * schedule would go on firing 480 times a day until an operator removed it by
 * hand, which is the entire saving this slice exists to produce. Reusing the id
 * makes the cutover a single idempotent upsert that narrows what is already
 * there.
 */
export const LIVE_SCORES_DENSE_CONTRACT: ScheduleContract = contract({
  scheduleId: 'turfwar-live-scores-3m',
  destination: `${BASE}/live-scores`,
  cron: DENSE_FALLBACK_LIVE_SCORES,
  usageScript: 'manage-live-scores-schedule.ts',
  debugEnvVar: 'MANAGE_LIVE_SCORES_SCHEDULE_DEBUG',
  failureTag: 'manage-live-scores-schedule-failed',
  authProofRef: '§8f step 5',
});

/**
 * `live-scores` SLOW — the reconciliation schedule, new in slice 4.
 *
 * A SECOND schedule against the SAME route, which QStash permits because
 * identity is the arbitrary `Upstash-Schedule-Id` and not the destination. One
 * expression cannot carry both cadences: `parseCron` applies a single minute-set
 * to every hour it matches, so the union of a three-minute dense phase and an
 * hourly sixteen-hour tail is two rectangles, not one.
 */
export const LIVE_SCORES_SLOW_CONTRACT: ScheduleContract = contract({
  scheduleId: 'turfwar-live-scores-slow',
  destination: `${BASE}/live-scores`,
  cron: SLOW_FALLBACK,
  usageScript: 'manage-live-scores-slow-schedule.ts',
  debugEnvVar: 'MANAGE_LIVE_SCORES_SLOW_SCHEDULE_DEBUG',
  failureTag: 'manage-live-scores-slow-schedule-failed',
  authProofRef: '§8f step 5',
});

export const GAME_STATS_DENSE_CONTRACT: ScheduleContract = contract({
  scheduleId: 'turfwar-game-stats-15m',
  destination: `${BASE}/game-stats`,
  cron: DENSE_FALLBACK_GAME_STATS,
  usageScript: 'manage-game-stats-schedule.ts',
  debugEnvVar: 'MANAGE_GAME_STATS_SCHEDULE_DEBUG',
  failureTag: 'manage-game-stats-schedule-failed',
  authProofRef: '§8e',
});

export const GAME_STATS_SLOW_CONTRACT: ScheduleContract = contract({
  scheduleId: 'turfwar-game-stats-slow',
  destination: `${BASE}/game-stats`,
  cron: SLOW_FALLBACK,
  usageScript: 'manage-game-stats-slow-schedule.ts',
  debugEnvVar: 'MANAGE_GAME_STATS_SLOW_SCHEDULE_DEBUG',
  failureTag: 'manage-game-stats-slow-schedule-failed',
  authProofRef: '§8e',
});

export const POLLING_PLANNER_CONTRACT: ScheduleContract = contract({
  scheduleId: 'turfwar-polling-planner-daily',
  destination: `${BASE}/polling-planner`,
  cron: POLLING_PLANNER_CRON,
  usageScript: 'manage-polling-planner-schedule.ts',
  debugEnvVar: 'MANAGE_POLLING_PLANNER_SCHEDULE_DEBUG',
  failureTag: 'manage-polling-planner-schedule-failed',
  authProofRef: '§8n',
});

/** The two schedules one planner-owned job runs, dense first. */
export type PlannerJobContracts = { dense: ScheduleContract; slow: ScheduleContract };

export const PLANNER_JOB_CONTRACTS: Record<'live-scores' | 'game-stats', PlannerJobContracts> = {
  'live-scores': { dense: LIVE_SCORES_DENSE_CONTRACT, slow: LIVE_SCORES_SLOW_CONTRACT },
  'game-stats': { dense: GAME_STATS_DENSE_CONTRACT, slow: GAME_STATS_SLOW_CONTRACT },
};
