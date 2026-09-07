import {
  IDLE_SLOW_HOUR,
  plannedRunsPerDay,
  SLOW_OFFSET_MINUTE,
  type PollingCronPlan,
} from '../schedule/pollingCron';
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

/**
 * Re-serialize an hour set into the dense expression's own form.
 *
 * NOT a second synthesizer: the hours come from `synthesizePollingCrons`, and this
 * only writes them back in the format that function emits — a comma list, or `*`
 * for a full day, NEVER a range (`parseCronField` reads `12-23` as an empty set,
 * and delivery health then answers from a 366-day backstop).
 *
 * It exists for the CUTOVER. The planner installs tomorrow's expression at 23:50,
 * and a cron has no date field, so tomorrow's hour set governs the last ten
 * minutes of today. Measured on the production 2026 record: 2026-09-12 is dense
 * through hour 23 and 2026-09-13 is not, so the swap dropped the 23:51, 23:54 and
 * 23:57 polls and the next delivery was 00:00 — a twelve-minute hole in
 * live-score polling during prime-time games, on every night whose hour sets
 * differ that way. Carrying today's still-future armed hours into the installed
 * expression closes it; the cost is that those hours stay armed one extra day.
 */
export function denseCronForHours(hours: readonly number[], stepMinutes: number): string {
  const unique = [...new Set(hours)].sort((a, b) => a - b);
  // NO CRON EXPRESSES "no hours". An empty set emitted `*/3  * * *` — four fields
  // once the double space collapses — which the record's character-class pattern
  // ADMITS and `parseCron` then rejects, so it would have been stored, sent to
  // QStash, and surfaced a day later as `plan-unreadable`. Unreachable from the one
  // caller, but this is exported and the failure is silent at the write end.
  if (unique.length === 0) {
    throw new Error('denseCronForHours requires at least one hour; no cron means "never"');
  }
  return `*/${stepMinutes} ${unique.length === 24 ? '*' : unique.join(',')} * * *`;
}

/** The hours of `today`'s dense plan that have not yet elapsed at `nowMs`. */
export function carriedDenseHours(
  todayDenseHours: readonly number[],
  nowMs: number,
  todayStartMs: number
): number[] {
  const currentHour = Math.floor((nowMs - todayStartMs) / (60 * 60 * 1000));
  if (currentHour < 0 || currentHour > 23) return [];
  return todayDenseHours.filter((hour) => hour >= currentHour);
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

/**
 * How many times the DESIRED schedules fire in the planning day.
 *
 * `plannedRunsPerDay` counts the raw plan, and on an unarmed day the plan's slow
 * expression still carries all 24 hours while {@link desiredJobState} installs one
 * daily slot — so the raw figure over-reported a quiet day by 24 firings per job.
 * That is the number this whole item's justification is stated in, so it is
 * counted from what is actually installed.
 */
export function plannedFiringsFor(
  plan: PollingCronPlan,
  dense: DesiredScheduleState,
  slow: DesiredScheduleState
): number {
  const raw = plannedRunsPerDay(plan);
  const densePart = dense.kind === 'armed' ? countFirings(dense.cron, raw.dense) : 0;
  const slowPart = slow.kind === 'armed' ? countFirings(slow.cron, plan.slow.hours.length) : 0;
  return densePart + slowPart;
}

/**
 * Firings a synthesized expression produces in a day, read from the expression
 * itself so an overridden cron is counted as installed rather than as planned.
 * Falls back to the plan's own figure for a shape this cannot read.
 */
function countFirings(cron: string, fallback: number): number {
  const [minuteField, hourField] = cron.split(' ');
  if (!minuteField || !hourField) return fallback;
  const hours = hourField === '*' ? 24 : hourField.split(',').length;
  const perHour = minuteField.startsWith('*/')
    ? Math.ceil(60 / Number(minuteField.slice(2)))
    : minuteField.split(',').length;
  return Number.isFinite(perHour) && perHour > 0 ? hours * perHour : fallback;
}

/**
 * The dense state to APPLY, once today's still-open hours are taken into account.
 *
 * THE CARRY OUTRANKS THE PAUSE. Gating it on an armed tomorrow skipped it on the
 * branch where the hole is worst: a 16:00 UTC kickoff's eight-hour dense phase
 * ends at exactly midnight, so today covers hour 23 and tomorrow covers nothing —
 * and the planner PAUSED at 23:50 with today's window still open, dropping the
 * 23:51/23:54/23:57 polls with nothing until the slow slot at 00:01.
 *
 * Both reviewers found it; one measured ZERO occurrences across the 2026 season,
 * which makes it structural rather than live. It is guarded anyway because the
 * mechanism already exists — this is a condition, not a new mechanism — and "zero
 * in 2026" is a fact about one season's slate, not about the code.
 *
 * It self-clears: tomorrow's run sees an empty carry and applies the pause, so the
 * cost is at most one extra day of the carried hours.
 */
export function denseDesiredForCutover(input: {
  /** The plan for the day being planned. */
  plan: PollingCronPlan;
  /** The plan for the day the planner is running IN. */
  todayPlan: PollingCronPlan;
  /** What the plan alone asks for. */
  desired: DesiredScheduleState;
  nowMs: number;
  todayStartMs: number;
}): DesiredScheduleState {
  const carried = carriedDenseHours(
    input.todayPlan.dense?.hours ?? [],
    input.nowMs,
    input.todayStartMs
  );
  if (carried.length === 0) return input.desired;
  return {
    kind: 'armed',
    cron: denseCronForHours(
      [...(input.plan.dense?.hours ?? []), ...carried],
      // The step the CARRIED hours were synthesized at; both days resolve the same
      // per-job constant, and today's is the one that produced them.
      input.todayPlan.dense?.stepMinutes ?? input.plan.dense?.stepMinutes ?? 3
    ),
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
  /**
   * The row for the durable record.
   *
   * `null` means SILENT — the store's one encoding of "not expected to fire" —
   * and it is emitted ONLY on positive evidence that the schedule is not firing:
   * a confirmed pause, or a readback that already said `isPaused: true`, or a
   * schedule that does not exist. An unconfirmed pause is never silence; see
   * {@link applySchedule}.
   */
  run: PlannerScheduleRun | null;
  /** Reporting only: what the planner did, for the runtime event and receipt. */
  action: 'upsert' | 'pause' | 'resume' | 'none';
  /** The record's outcome for this schedule — what became of its CRON. */
  outcome: PlannerScheduleOutcome;
  /**
   * Did the schedule reach the state the plan asked for?
   *
   * SEPARATE FROM {@link outcome}, because a successful upsert followed by a
   * failed resume is a confirmed cron on a schedule that still delivers nothing.
   * Folding the resume into the record's outcome made the record report
   * `indeterminate`, which `installedState` reads as "no honest basis" — so the
   * schedule contributed NO required slot and a real outage that day went
   * unmeasured, while the cron the planner wrote sat in QStash. The record now
   * keeps the cron fact and this flag carries the delivery fact, so an unresumed
   * schedule reads `late` (which is true) instead of vanishing from measurement.
   */
  healthy: boolean;
};

/**
 * Bring ONE schedule to its desired state, and describe what happened.
 *
 * READ FIRST, THEN ACT. QStash makes both mutations idempotent — a create under
 * an existing `Upstash-Schedule-Id` updates it, and pausing an already-paused
 * schedule has no effect — so the read is not needed for safety. It is needed for
 * TRUTH: `previousCron` exists so that no later reader has to extrapolate what
 * was in force, and a skip can only be recorded as `unchanged` by something that
 * actually looked.
 *
 * SILENCE REQUIRES POSITIVE EVIDENCE. Three reviewers independently found the
 * same root here: every paused-desired branch used to return `run: null`,
 * including the ones where the planner never learned the live state or the pause
 * request did not land. `installedState` reads a null as `silent`, which
 * contributes no required slot and cannot raise an alarm — so a dense schedule
 * still firing every three minutes recorded as deliberately off, for a full day,
 * and delivery health had nothing to say about it. A pause is a DESTRUCTIVE
 * action and its record must assert only what the run established.
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

  // A PAUSED schedule's cron is not in force, and an UNREADABLE pause state is not
  // evidence that it is. `!== true` admitted `null` — `readPauseState`'s explicit
  // "could not be read" — and copied the cron in as the cron in force, which is
  // the same guard-the-meaning-miss-the-shape defect this module's docstring cites.
  const previousCron = state.kind === 'present' && state.paused === false ? state.cron : null;

  /** What the planner would write if it were arming this schedule. */
  const intentFor = (cron: string) => ({
    scheduleId: contract.scheduleId,
    destination: contract.destination,
    cron,
    method: contract.method,
    retries: contract.retries,
  });

  if (desired.kind === 'paused') {
    // POSITIVE EVIDENCE OF SILENCE — a schedule that does not exist is not firing,
    // and one QStash already reports as paused is not firing. Creating a schedule
    // solely to pause it would provision a live cron for the interval between the
    // two calls, on the one day the plan says it must not fire.
    if (state.kind === 'absent') {
      return { run: null, action: 'none', outcome: 'unchanged', healthy: true };
    }
    if (state.kind === 'error') {
      // NO evidence at all: the planner never learned whether this schedule
      // exists or is firing. Recording silence here asserts exactly what the run
      // failed to establish. `failed` with no `previousCron` resolves to
      // `plan-incomplete`, which is the honest answer — the row says the plan
      // cannot be judged rather than that nothing was due.
      return {
        run: {
          intent: intentFor(contract.cron),
          previousCron: null,
          action: 'skipped',
          outcome: 'failed',
        },
        action: 'none',
        outcome: 'failed',
        healthy: false,
      };
    }
    if (state.paused === true) {
      return { run: null, action: 'none', outcome: 'unchanged', healthy: true };
    }
    // `state.paused === null` is an unreadable pause state and takes this branch on
    // purpose: pausing is idempotent, so acting on an unknown costs one request,
    // while assuming "already paused" leaves a stale dense schedule firing all day.
    const outcome = await runAction(contract, deps, 'pause');
    if (outcome === 'confirmed') {
      return { run: null, action: 'pause', outcome, healthy: true };
    }
    // THE PAUSE DID NOT LAND, so the live cron is still what governs. Recording it
    // as the intent leaves `priorCronState` pointing at the expression that is
    // actually firing, and delivery health measures against that — instead of
    // treating a schedule that never stopped as deliberately silent.
    return {
      run: {
        intent: intentFor(state.cron ?? contract.cron),
        previousCron: state.cron,
        action: 'applied',
        outcome,
      },
      action: 'pause',
      outcome,
      healthy: false,
    };
  }

  const row = (
    action: 'applied' | 'skipped',
    outcome: PlannerScheduleOutcome
  ): PlannerScheduleRun => ({ intent: intentFor(desired.cron), previousCron, action, outcome });

  if (state.kind === 'error') {
    // Nothing was sent, so an OLDER intent still governs — which is exactly what
    // `failed` means to `latestRecordedIntentForSchedule` and to the timeline.
    return { run: row('skipped', 'failed'), action: 'none', outcome: 'failed', healthy: false };
  }
  if (state.kind === 'present' && state.contractOk) {
    // The full contract matched, INCLUDING the pause state, so there is nothing
    // to send. Contract equality rather than cron equality: a schedule holding
    // the right cron with its forwarded Authorization no longer redacted must
    // still be rewritten.
    return {
      run: row('skipped', 'unchanged'),
      action: 'none',
      outcome: 'unchanged',
      healthy: true,
    };
  }

  const outcome = await runAction({ ...contract, cron: desired.cron }, deps, 'upsert');
  // A schedule that exists and is paused needs BOTH: the new cron, then the
  // resume. Upsert first — a resume that lands before a failed upsert arms
  // yesterday's expression, while an upsert that lands before a failed resume
  // leaves the right cron installed for the next run to resume.
  let resumed = true;
  if (outcome === 'confirmed' && state.kind === 'present' && state.paused !== false) {
    resumed = (await runAction(contract, deps, 'resume')) === 'confirmed';
  }
  return {
    run: row('applied', outcome),
    action: 'upsert',
    outcome,
    healthy: outcome === 'confirmed' && resumed,
  };
}
