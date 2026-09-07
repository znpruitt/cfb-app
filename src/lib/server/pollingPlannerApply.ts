import { IDLE_SLOW_HOUR, SLOW_OFFSET_MINUTE, type PollingCronPlan } from '../schedule/pollingCron';
import type { PollingWindow } from '../schedule/pollingWindows';

import type { PlannerScheduleOutcome, PlannerScheduleRun } from './pollingPlannerRecord';

import {
  readScheduleState,
  runManageSchedule,
  type RunDeps,
  type ScheduleContract,
} from '../../../scripts/lib/qstashSchedule.ts';

/**
 * PLATFORM-102 slice 4 — turning one day's cron plan into QStash state, and into
 * the row that records what was actually sent.
 *
 * THIS IS THE SLICE'S SINK, and the branch family's recurring failure is a guard
 * placed on what something MEANS while what it IS goes unchecked. Two of them are
 * here and both are load-bearing:
 *
 *   - `previousCron` is copied out of a live readback into a durable row whose
 *     parser REJECTS THE WHOLE RUN if it is present and unusable, so the shape
 *     check happens in `readScheduleState` before the value ever reaches this
 *     module. A tampered cron costs a field, never the day's record.
 *   - A PAUSED schedule's cron is not "the cron in force"; it is nothing. Copying
 *     it into `previousCron` makes the NEXT run's `spanState` see a record that
 *     planned no dense schedule against an observation of one live — which that
 *     reader classifies as a contradiction (`plan-incomplete`), so every day
 *     following a dense-less day would have reported an unreadable plan.
 *
 * Nothing here logs, and nothing returns a request, a header block or a response
 * body: `runManageSchedule` is driven with silent sinks and only its EXIT CODE is
 * kept. That code is the record's own vocabulary (`PlannerScheduleOutcome`), so
 * what the planner reports and what the CLI would report cannot disagree.
 */

/** What the plan wants one schedule to be, once the day's windows are known. */
export type DesiredScheduleState =
  | { kind: 'armed'; cron: string }
  /**
   * `paused`, never `deleted`. A paused schedule stays retrievable, so `inspect`
   * can still check it and the tamper signal survives; deleting makes it vanish
   * and reappear daily as a new schedule, which is what slices 3a and 3b exist to
   * protect against. It is also what lets the planner express "deliberately off"
   * without the record needing a field for it.
   */
  | { kind: 'paused' };

/**
 * The dead-day slow expression: ONE firing a day, at the hour and minute
 * `pollingCron.ts` already reserves for an idle slot.
 *
 * WHY NOT THE PLAN'S OWN DEAD-DAY EXPRESSION, and why not a pause either. This is
 * the one place slice 4 departs from a literal reading of the owner's rule, so it
 * is stated in full.
 *
 * `slowHoursFor` returns ALL 24 HOURS for a day with no windows, and says why:
 * "the widest safe expression, which keeps delivery health resolving at the slow
 * cadence through the offseason". That reason no longer holds — slice 3b made
 * delivery health read the RECORD rather than extrapolate from a live cron, so it
 * needs no firings to keep resolving — and 24 hourly wakeups per job on a day
 * with nothing to reconcile is precisely the spend this item exists to remove.
 *
 * The owner's rule for that day is "both paused". The DENSE schedule is paused,
 * exactly as ruled. The SLOW one cannot be, and the obstacle is the durable
 * record rather than a preference: `PollingPlannerRun.slow` is NON-NULLABLE and
 * `dense: null` is the store's only encoding of "not expected to fire". Pausing
 * slow while recording it as armed would make delivery health require an hourly
 * receipt from a schedule that delivers nothing — a false `late` every hour of
 * the offseason, which is the exact defect Item 102 was opened to remove, merely
 * relocated. Recording it as `refused` instead raises `plan-incomplete`, a
 * standing yellow row claiming the plan is unreadable when it is perfectly known.
 * There is no third encoding.
 *
 * So the slow schedule stays armed at its cheapest honest expression: one wakeup
 * a day, which is 1/24th of what slice 2 would have spent and leaves the record,
 * the row and QStash all saying the same true thing. The residual cost against a
 * literal "both paused" is TWO wakeups a day across both jobs. Closing it needs
 * `slow` to become nullable in slice 3a's store, which this slice may not edit —
 * recorded as a follow-up rather than worked around.
 */
export const DEAD_DAY_SLOW_CRON = `${SLOW_OFFSET_MINUTE} ${IDLE_SLOW_HOUR} * * *`;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Is any window armed on the planning day at all?
 *
 * Computed from the WINDOWS, never inferred from the synthesized expression. The
 * tempting inference — "no dense cron and a 24-hour slow cron means a dead day" —
 * is false on a real and routine shape: a Saturday kickoff at 23:00 UTC has a
 * reconciliation tail running to 23:00 Sunday, so a game-free Sunday has no dense
 * hours and all 24 tail hours, and reads as dead while it is still reconciling a
 * live game's final.
 */
export function dayIsArmed(windows: readonly PollingWindow[], dayStartMs: number): boolean {
  const dayEndMs = dayStartMs + DAY_MS;
  return windows.some((window) => window.startMs < dayEndMs && window.slowEndMs > dayStartMs);
}

export type DesiredJobState = { dense: DesiredScheduleState; slow: DesiredScheduleState };

/**
 * The owner's three-state rule, 2026-09-07, applied to one job's two schedules:
 *
 *   - games today                       → dense over the game hours, slow over the tail
 *   - no games, yesterday's tail open    → slow only, dense PAUSED
 *   - nothing at all                     → dense PAUSED, slow at {@link DEAD_DAY_SLOW_CRON}
 *
 * `plan.dense === null` is the planner's own statement that the day has no dense
 * hours, so it is the pause trigger and no separate reading of the windows is
 * needed for it.
 */
export function desiredJobState(
  plan: PollingCronPlan,
  windows: readonly PollingWindow[],
  dayStartMs: number
): DesiredJobState {
  const armed = dayIsArmed(windows, dayStartMs);
  return {
    dense: plan.dense === null ? { kind: 'paused' } : { kind: 'armed', cron: plan.dense.cron },
    slow: armed
      ? { kind: 'armed', cron: plan.slow.cron }
      : { kind: 'armed', cron: DEAD_DAY_SLOW_CRON },
  };
}

/** Injected so a test drives every path without a network, a clock or a secret. */
export type PlannerQstashDeps = {
  /** The environment the CLI orchestration reads its credentials and base from. */
  env: Record<string, string | undefined>;
  fetchImpl: RunDeps['fetchImpl'];
};

/**
 * A CLI exit code, read as what it says about the durable world.
 *
 * 0 confirmed; 2 refused (nothing mutated); 3 fail-closed (nothing sent); 4 the
 * mutation MAY or may not have landed. 1 is the wrapper's unexpected-error code
 * and no mutation is known to have been sent, so it reads as `failed`. Nothing
 * rounds 4 to either side — the record models it precisely because rounding it is
 * the defect.
 */
export function outcomeForExitCode(code: number): PlannerScheduleOutcome {
  switch (code) {
    case 0:
      return 'confirmed';
    case 2:
      return 'refused';
    case 4:
      return 'indeterminate';
    default:
      return 'failed';
  }
}

/** The worse of two outcomes, so a two-step apply reports its weakest link. */
const OUTCOME_SEVERITY: Record<PlannerScheduleOutcome, number> = {
  confirmed: 0,
  unchanged: 0,
  refused: 2,
  failed: 3,
  // Worst, because it is the only one that leaves the durable world UNKNOWN.
  indeterminate: 4,
};

function worseOutcome(
  a: PlannerScheduleOutcome,
  b: PlannerScheduleOutcome
): PlannerScheduleOutcome {
  return OUTCOME_SEVERITY[b] > OUTCOME_SEVERITY[a] ? b : a;
}

async function runAction(
  contract: ScheduleContract,
  deps: PlannerQstashDeps,
  action: 'upsert' | 'pause' | 'resume'
): Promise<PlannerScheduleOutcome> {
  const code = await runManageSchedule(contract, {
    argv: [action, '--apply'],
    env: deps.env,
    fetchImpl: deps.fetchImpl,
    // SILENT SINKS. The orchestration never prints a credential, but it does
    // print schedule ids and divergence text, and this run's only durable output
    // is an allowlisted row. Discarding the lines is what keeps that true by
    // construction rather than by reading every message.
    log: () => {},
    errorLog: () => {},
    // NO RECORD READER, deliberately — the planner derives its plan from the
    // canonical schedule and writes THAT. Routing it through
    // `resolveExpectedContract` would make it read its own previous output to
    // choose its next one, and would deadlock the very first run, which has no
    // record. The reader belongs to the operator CLI, which has no plan.
  });
  return outcomeForExitCode(code);
}

export type AppliedSchedule = {
  /** The row for the durable record, or `null` for a paused schedule. */
  run: PlannerScheduleRun | null;
  /** Reporting only: what the planner did, for the runtime event and receipt. */
  action: 'upsert' | 'pause' | 'resume' | 'none';
  outcome: PlannerScheduleOutcome;
};

/**
 * Bring ONE schedule to its desired state, and describe what happened.
 *
 * READ FIRST, THEN ACT. QStash makes both mutations idempotent — a create under
 * an existing `Upstash-Schedule-Id` updates it, and pausing an already-paused
 * schedule has no effect — so the read is not needed for safety. It is needed for
 * TRUTH: `previousCron` exists so that no later reader has to extrapolate what
 * was in force, and a skip can only be recorded as `unchanged` by something that
 * actually looked. It also lets an unchanged day cost one GET instead of an
 * upsert that re-sends the forwarded route credential for no reason.
 */
export async function applySchedule(
  contract: ScheduleContract,
  desired: DesiredScheduleState,
  deps: PlannerQstashDeps
): Promise<AppliedSchedule> {
  const expectPaused = desired.kind === 'paused';
  const expectedContract =
    desired.kind === 'armed' ? { ...contract, cron: desired.cron } : contract;
  const state = await readScheduleState(contract, deps, {
    contract: expectedContract,
    expectPaused,
  });

  // A PAUSED schedule's cron is not in force. See the module docstring: recording
  // it makes the next run's cross-check read a contradiction where there is none.
  const previousCron = state.kind === 'present' && state.paused !== true ? state.cron : null;

  if (desired.kind === 'paused') {
    // Nothing to pause is already the desired state. Creating a schedule solely
    // to pause it would provision a live cron for the interval between the two
    // calls, on the one day the plan says it must not fire.
    if (state.kind === 'absent') return { run: null, action: 'none', outcome: 'unchanged' };
    if (state.kind === 'error') return { run: null, action: 'none', outcome: 'failed' };
    if (state.paused === true) return { run: null, action: 'none', outcome: 'unchanged' };
    // `state.paused === null` is an UNREADABLE pause state, and it takes this
    // branch on purpose: pausing is idempotent, so acting on an unknown costs one
    // request, while assuming "already paused" would leave a stale dense schedule
    // firing all day — the failure this rule exists to prevent.
    return { run: null, action: 'pause', outcome: await runAction(contract, deps, 'pause') };
  }

  const intent = {
    scheduleId: contract.scheduleId,
    destination: contract.destination,
    cron: desired.cron,
    method: contract.method,
    retries: contract.retries,
  };
  const row = (
    action: 'applied' | 'skipped',
    outcome: PlannerScheduleOutcome
  ): PlannerScheduleRun => ({
    intent,
    previousCron,
    action,
    outcome,
  });

  if (state.kind === 'error') {
    // Nothing was sent, so an OLDER intent still governs — which is exactly what
    // `failed` means to `latestRecordedIntentForSchedule` and to the timeline.
    return { run: row('skipped', 'failed'), action: 'none', outcome: 'failed' };
  }
  if (state.kind === 'present' && state.contractOk) {
    // The full contract matched, INCLUDING the pause state, so there is nothing
    // to send. Contract equality rather than cron equality: a schedule holding
    // the right cron with its forwarded Authorization no longer redacted must
    // still be rewritten.
    return { run: row('skipped', 'unchanged'), action: 'none', outcome: 'unchanged' };
  }

  let outcome = await runAction({ ...contract, cron: desired.cron }, deps, 'upsert');
  // A schedule that exists and is paused needs BOTH: the new cron, then the
  // resume. Upsert first — a resume that lands before a failed upsert arms
  // yesterday's expression, while an upsert that lands before a failed resume
  // leaves the right cron installed for the next run to resume.
  if (outcome === 'confirmed' && state.kind === 'present' && state.paused !== false) {
    outcome = worseOutcome(outcome, await runAction(contract, deps, 'resume'));
  }
  return {
    run: row('applied', outcome),
    action: 'upsert',
    outcome,
  };
}
