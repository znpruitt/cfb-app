import { densePhase, slowPhase, utcHoursCovered, type PollingWindow } from './pollingWindows';

/**
 * PLATFORM-102 slice 2 — synthesize the cron expressions that cover slice 1's
 * polling windows, and derive the scheduler delivery expectation from the same
 * input.
 *
 * Pure and deterministic: no clock, no I/O, no durable state, and no consumer.
 * Slice 3 records what this derives; slice 4 sends it to QStash.
 *
 * TWO CRONS, NOT ONE. A window carries two phases at two cadences — the dense
 * phase (three-minute polling while games are live) and the slow phase (hourly
 * reconciliation out to `kickoff + 24h`) — and ONE expression cannot express
 * both. `parseCron` in `schedulerDeliveryHealth.ts` applies a single minute-set
 * to every hour it matches, so the union of the two phases is two rectangles,
 * not one. A single expression could only pay the dense rate across the
 * sixteen-hour tail — giving back most of the saving, since the 24h guarantee is
 * why October reads 74% armed — or go dark at the dense end, which is exactly the
 * failure the `slowEndMs` docstring records: "a cron built from the dense windows
 * alone goes dark straight past the eligibility bound, so such a final is never
 * collected at all". So `live-scores` and `game-stats` each get TWO schedules.
 * QStash identity is the arbitrary `Upstash-Schedule-Id`, independent of
 * `destination`, so two ids may target one route.
 *
 * COMMA-SEPARATED EXPLICIT HOURS ONLY, NEVER A RANGE. `parseCronField` handles
 * `*`, a stepped wildcard, a bare integer, and comma lists — nothing else. A
 * range such as `12-23` parses to an EMPTY set, `cronMatchesUtc` then never
 * matches, and `previousScheduleSlotMs` walks its full 366-day backstop and
 * returns the floored cutoff. Delivery health would be silently wrong with
 * nothing failing. `utcHoursCovered` already returns the list form this needs.
 *
 * ONE UTC DAY PER PLAN. `utcHoursCovered` projects onto a single day and a cron
 * has no date field, so the expressions describe the planning day and then repeat
 * daily until rewritten. A window crossing midnight is covered on each day it
 * touches by THAT day's plan — a requirement on slice 4's daily rewrite, not a
 * property these functions can hold on their own.
 *
 * OVER-COVERING IS SAFE, UNDER-COVERING IS NOT — the asymmetry `utcHoursCovered`
 * already states: the handler guards, not the cron, decide whether a provider
 * call happens.
 */

/** The slow reconciliation schedule fires once per covered hour. */
export const SLOW_STEP_MINUTES = 60;

/**
 * The minute past the hour the slow schedule fires at — deliberately NOT zero.
 *
 * Both dense rates include minute 0 — a three-minute step and a fifteen-minute
 * step alike — so an hourly slow
 * schedule on the hour dispatches at the same instant as a dense poll in every
 * dense hour. These are two QStash schedules against one route, and that route
 * takes no invocation lock: both invocations pass target selection, both begin
 * provider-refresh attempts, and both reach the provider. So the collision is a
 * duplicate BILLED CFBD call once an hour while a game is open, not merely a
 * duplicate wakeup. One minute of offset removes it, and no dense step in 1..60
 * that divides an hour can land on it.
 */
export const SLOW_OFFSET_MINUTE = 1;

const MINUTE_MS = 60_000;
const HOURS_PER_DAY = 24;
const DAY_MS = HOURS_PER_DAY * 60 * MINUTE_MS;
const ALL_HOURS: readonly number[] = Array.from({ length: HOURS_PER_DAY }, (_, hour) => hour);

export type SynthesizedCron = {
  /** The expression: minute field, explicit hour field, wildcard date fields. */
  cron: string;
  /** The UTC hours it fires in, ascending. `0..23` when the hour field is `*`. */
  hours: readonly number[];
  /** Minutes between firings inside a covered hour; 60 means the top of the hour. */
  stepMinutes: number;
};

export type PollingCronPlan = {
  /**
   * The dense schedule, or `null` when the planning day has no dense hours at
   * all — an offseason day, or one holding only another day's reconciliation
   * tail. A schedule that should not fire is absent here; it is never emitted as
   * an expression that fires nowhere, because no cron can express that.
   */
  dense: SynthesizedCron | null;
  /**
   * The slow schedule, ALWAYS present, and it covers EVERY armed hour — the
   * dense phase's hours as well as the reconciliation tail's.
   *
   * The dense schedule is therefore purely additive: it raises the rate inside
   * the dense hours, and the never-under-cover property holds on this expression
   * alone rather than on a union that has to be reasoned about. The alternative,
   * a slow cron over the tail hours only, leaves a real gap to reason about on an
   * ordinary Saturday, whose cluster ends after midnight so the day has dense
   * hours and no tail hours at all. Paying one extra wakeup per dense hour — nine
   * against that day's ~180 — buys the simpler invariant.
   *
   * It is always present because no cron expression can mean "never", so the
   * zero-window offseason is carried here rather than by deleting the schedule,
   * which would also cost `inspect` and delivery health their subject.
   */
  slow: SynthesizedCron;
};

export type CronSynthesisOptions = {
  /** The dense cadence, in minutes — today's `live-scores` 3 / `game-stats` 15. */
  denseStepMinutes: number;
  /** Defaults to {@link SLOW_STEP_MINUTES}; exposed for tests, not for tuning. */
  slowStepMinutes?: number;
};

/**
 * Synthesize the dense and slow cron expressions covering `windows` on the UTC
 * day starting at `dayStartMs`.
 *
 * An EMPTY window list is a real plan for a day with no games, not a missing
 * one: it yields a slow schedule over every hour and no dense schedule. The
 * caller distinguishes "no plan exists" from "a plan with no windows" — see
 * `schedulerDeliveryHealth.ts`'s optional plan argument — because collapsing the
 * two would make the offseason and the no-op fallback the same input.
 */
export function synthesizePollingCrons(
  windows: readonly PollingWindow[],
  dayStartMs: number,
  options: CronSynthesisOptions
): PollingCronPlan {
  validDayStart(dayStartMs);
  const denseStepMinutes = validStep(options.denseStepMinutes, 'denseStepMinutes');
  const slowStepMinutes = validStep(
    options.slowStepMinutes ?? SLOW_STEP_MINUTES,
    'slowStepMinutes'
  );

  const denseHours = utcHoursCovered(windows.map(densePhase), dayStartMs);
  // Every hour any window touches, at either rate. The two phases are contiguous
  // — the slow one begins where the dense one ends — so this is the full armed
  // extent projected onto the day.
  const armedHours = utcHoursCovered(
    windows.flatMap((window) => [densePhase(window), slowPhase(window)]),
    dayStartMs
  );

  return {
    dense: denseHours.length === 0 ? null : buildCron(denseHours, denseStepMinutes),
    // No armed hours at all is a day with no games — the offseason, and every
    // other dead day, which are the same case and not a special one. The schedule
    // still has to hold an expression, so it holds the widest safe one: hourly,
    // all day. Safe for the reason over-approximation always is here, and it
    // keeps delivery health resolving at the slow cadence year-round.
    slow: buildCron(armedHours.length === 0 ? ALL_HOURS : armedHours, slowStepMinutes),
  };
}

export type DeliveryExpectation = {
  cron: string;
  cadenceLabel: string;
  graceMs: number;
};

/**
 * The scheduler-delivery expectation for a job running the plan's schedules —
 * Item 102 collision 2, replacing the hardcoded cadence and grace.
 *
 * ONE ROW, TWO SCHEDULES. `SchedulerDeliveryHealthRow` carries a single cron, and
 * this slice deliberately does not widen it (the gate forbids reaching into
 * `SchedulerDeliveryState` or its consumers). So the expectation is taken from
 * the DENSE schedule whenever the day has one, and from the slow schedule
 * otherwise. Grace is two dense intervals — six minutes for `live-scores`,
 * thirty for `game-stats` — which is exactly what the fixed policies carry today.
 *
 * THIS EXPECTATION IS NOT YET TRUTHFUL, AND SLICE 3 OWNS THE FIX. An earlier
 * version of this comment claimed it "never raises a false alarm". That was
 * wrong, and review found it: `previousScheduleSlotMs` treats a cron as ETERNAL,
 * but a planner-owned cron is REWRITTEN DAILY, so it extrapolates today's hour
 * set backwards onto a day that ran a different plan and derives a required slot
 * that never existed. Measured against the real parser: an armed day whose cron
 * narrows to hours 19–23 at the three-minute step, preceded by a dead day that
 * genuinely last fired
 * at 23:00, computes a required slot of 23:57 and reads `late` from 00:06 until
 * the window opens — roughly nineteen hours of false alarm on an ordinary game
 * day, on the two rows that matter most. The same extrapolation hides a real
 * outage in the other direction: with a morning cluster, a receipt at 08:57 still
 * reads `on-time` at 23:59, fifteen hours later.
 *
 * The cause is extrapolation itself, not the choice of governing schedule. The
 * fix is for delivery health to read what the planner actually scheduled —
 * slice 3's durable record already stores the previous cron — rather than
 * projecting one backwards. An always-on hourly schedule would only make the
 * extrapolation accidentally correct. Do not build that here: the gate for this
 * slice stops at the health row reading durable state, which is precisely what
 * the real fix requires. Slice 3 also owns the two-cron row that restores
 * six-minute in-window detection.
 */
export function deliveryExpectationForPlan(plan: PollingCronPlan): DeliveryExpectation {
  const governing = plan.dense ?? plan.slow;
  return {
    cron: governing.cron,
    cadenceLabel: describePlan(plan),
    // Two intervals of the governing cadence: one interval is the dispatch, the
    // second is the jitter and execution allowance. This reproduces today's
    // 6-minute and 30-minute constants exactly.
    graceMs: 2 * governing.stepMinutes * MINUTE_MS,
  };
}

/**
 * How many times a plan's schedules fire in the planning day.
 *
 * Reporting only — it is the figure Item 102's projection is stated in, and slice
 * 3's durable record needs the same number to explain what a run derived. It is
 * never a gate.
 */
export function plannedRunsPerDay(plan: PollingCronPlan): {
  dense: number;
  slow: number;
  total: number;
} {
  const dense = plan.dense ? plan.dense.hours.length * firingsPerHour(plan.dense.stepMinutes) : 0;
  const slow = plan.slow.hours.length * firingsPerHour(plan.slow.stepMinutes);
  return { dense, slow, total: dense + slow };
}

function firingsPerHour(stepMinutes: number): number {
  // A stepped minute field fires at 0, step, 2·step … below 60.
  return Math.ceil(60 / stepMinutes);
}

function buildCron(hours: readonly number[], stepMinutes: number): SynthesizedCron {
  return {
    cron: `${minuteField(stepMinutes)} ${hourField(hours)} * * *`,
    hours: [...hours],
    stepMinutes,
  };
}

function minuteField(stepMinutes: number): string {
  return stepMinutes >= 60 ? String(SLOW_OFFSET_MINUTE) : `*/${stepMinutes}`;
}

/**
 * `*` for a full day, otherwise the explicit comma list. NEVER a range: see the
 * module docstring — `parseCronField` reads `12-23` as an empty set and delivery
 * health then fails with nothing to show for it.
 */
function hourField(hours: readonly number[]): string {
  return hours.length === HOURS_PER_DAY ? '*' : hours.join(',');
}

/**
 * `dayStartMs` must be an exact UTC midnight, and it is checked rather than
 * assumed because both ways of getting it wrong fail SILENTLY and in the one
 * direction this module cannot survive.
 *
 * `utcHoursCovered` pushes the loop INDEX, so an offset day start rotates the
 * whole hour field: the same window at `06:00Z` yields hours 13–21 instead of
 * 19–23, arming six hours early and going dark over the actual kickoff. A
 * non-finite value is worse — every overlap test fails, so an armed day
 * degrades to no dense schedule and an all-day slow one, which is exactly the
 * shape of a legitimate offseason plan and indistinguishable from it.
 */
function validDayStart(dayStartMs: number): number {
  if (!Number.isFinite(dayStartMs) || dayStartMs % DAY_MS !== 0) {
    throw new Error(`dayStartMs must be an exact UTC midnight, received ${dayStartMs}`);
  }
  return dayStartMs;
}

function validStep(stepMinutes: number, field: string): number {
  if (!Number.isInteger(stepMinutes) || stepMinutes < 1 || stepMinutes > 60) {
    throw new Error(`${field} must be an integer minute step in 1..60, received ${stepMinutes}`);
  }
  return stepMinutes;
}

/**
 * The day's actual shape, rendered verbatim as the System Health cadence detail.
 * Item 102 requires the label to describe the plan rather than restate a fixed
 * rule, because a static "every 3 minutes" is false the moment the cron narrows.
 */
function describePlan(plan: PollingCronPlan): string {
  const slow = describeSchedule(plan.slow);
  return plan.dense === null ? slow : `${describeSchedule(plan.dense)}, ${slow}`;
}

function describeSchedule(schedule: SynthesizedCron): string {
  const cadence = schedule.stepMinutes >= 60 ? 'hourly' : `every ${schedule.stepMinutes} min`;
  if (schedule.hours.length === HOURS_PER_DAY) {
    return cadence === 'hourly'
      ? `hourly (:${String(SLOW_OFFSET_MINUTE).padStart(2, '0')} UTC)`
      : `${cadence} (all day UTC)`;
  }
  return `${cadence} at ${describeHours(schedule.hours)} UTC`;
}

/**
 * Consecutive hours as ranges — `18:00–23:00` means it fires in each of hours 18
 * through 23. No cap is needed: a cluster's dense phase alone runs eight hours,
 * so a day holds at most three armed stretches.
 */
function describeHours(hours: readonly number[]): string {
  const groups: Array<[number, number]> = [];
  for (const hour of hours) {
    const last = groups[groups.length - 1];
    if (last && hour === last[1] + 1) last[1] = hour;
    else groups.push([hour, hour]);
  }
  return groups
    .map(([start, end]) => (start === end ? clock(start) : `${clock(start)}–${clock(end)}`))
    .join(', ');
}

function clock(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
