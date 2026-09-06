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
 * matches, and `previousScheduleSlotMs` decrements past its whole 366-day
 * backstop — returning an instant a YEAR before the cutoff, not the floored
 * cutoff an earlier version of this comment claimed. The consequence is worse
 * than "silently wrong": every receipt satisfies a required slot that far back,
 * so every row reads `on-time` forever and a real outage is hidden.
 * `utcHoursCovered` already returns the list form this needs.
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
export const SLOW_STEP_MINUTES: number = 60;

/**
 * The minute past the hour the slow schedule fires at — deliberately NOT zero.
 *
 * Every dense rate includes minute 0, so an hourly slow schedule on the hour
 * would dispatch at the same instant as a dense poll in any hour the two share.
 * These are two QStash schedules against one route, and that route takes no
 * invocation lock: both invocations pass target selection, both begin provider-
 * refresh attempts, and both reach the provider. The collision is therefore a
 * duplicate BILLED CFBD call, not merely a duplicate wakeup.
 *
 * The PRIMARY guarantee is that the two hour sets are disjoint — the slow
 * schedule subtracts the dense hours — so on all but one shape no shared hour
 * exists to collide in. The exception is a FULLY dense day, where the idle slot
 * has nowhere unshared to go; see {@link IDLE_SLOW_HOUR}. This offset is what
 * keeps even that day free of a simultaneous dispatch, and it is kept besides
 * because the disjointness is one filter expression a future change could drop.
 * An earlier version of this comment claimed tail-only hours already shrank the
 * overlap "to the boundary hour a window's two phases share". That was measured
 * false: on a three-cluster day an early cluster's 24-hour tail spans the later
 * clusters' dense phases, and the sets shared TWELVE hours, each one a duplicate
 * billed call. Subtracting is what actually removes them.
 *
 * An earlier version of this comment asserted that no dense step could land on
 * the offset. That was FALSE at both ends of the range the validator admitted:
 * a step of 60 emitted this very minute as a literal, making the dense cron
 * byte-identical to the slow one, and a step of 1 fires every minute including
 * this one. {@link validDenseStep} now REJECTS both, so the property is enforced
 * rather than asserted.
 */
export const SLOW_OFFSET_MINUTE = 1;

/**
 * The fallback hour a slow schedule occupies on a day that has dense hours but no
 * reconciliation hours of its own — an ordinary Saturday, whose cluster ends
 * after midnight so its tail lands entirely on the next day's plan.
 *
 * Such a day needs no slow coverage: the dense cron covers every armed hour it
 * has. But the QStash schedule still exists and must hold an expression, so it
 * holds the cheapest honest one — a single daily slot, one wakeup — placed in the
 * first hour the dense schedule does NOT poll.
 *
 * IT SHARES A DENSE HOUR ON EXACTLY ONE SHAPE, and that is the single honest
 * exception to the disjointness invariant: a FULLY dense day — a full slate whose
 * clusters chain through midnight — has no unshared hour to offer, so the slot
 * necessarily lands in one and bills one duplicate call that day.
 *
 * Hour zero is not an arbitrary choice that happens to work. On the idle path
 * every reconciliation hour is already a dense hour, and a tail runs sixteen
 * hours past its own dense end, so the tail either falls wholly on the next day —
 * leaving this day's dense hours late and hour zero free — or the dense phase
 * covers everything. Measured across 400,000 generated shapes: of 27,217
 * idle-path days, hour zero was dense in 3,238, and all 3,238 were fully dense.
 * Zero were the mixed case. The sweep asserts that, so a future change that makes
 * the mixed case reachable fails rather than quietly billing duplicates.
 *
 * Review found this constant returned unconditionally while the docstring claimed
 * the two hour sets were simply disjoint — true on 3,911 of 4,000 shapes, false
 * on the busiest one.
 */
export const IDLE_SLOW_HOUR = 0;

const MINUTE_MS = 60_000;
const HOURS_PER_DAY = 24;
const DAY_MS = HOURS_PER_DAY * 60 * MINUTE_MS;
const ALL_HOURS: readonly number[] = Array.from({ length: HOURS_PER_DAY }, (_, hour) => hour);

export type SynthesizedCron = {
  /** The expression: minute field, explicit hour field, wildcard date fields. */
  cron: string;
  /** The UTC hours it fires in, ascending. `0..23` when the hour field is `*`. */
  hours: readonly number[];
  /**
   * Minutes between firings inside a covered hour. A step of 60 fires ONCE per
   * covered hour, at {@link SLOW_OFFSET_MINUTE} past — never at the top of the
   * hour, which is the minute the dense schedule owns.
   */
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
   * The slow schedule, ALWAYS present, covering the RECONCILIATION TAIL only.
   *
   * Coverage is a property of the two crons TOGETHER: the dense cron covers the
   * dense hours, this one covers the tail hours, and their union is every armed
   * hour by construction. An earlier version widened this to the full armed
   * extent so the guarantee would rest on one expression alone. That bought
   * nothing — review measured `dense + tail-only` leaving zero uncovered hours on
   * every real shape, including the Saturday case the widening was justified by —
   * and it COST a billed provider call in every dense hour, since the route takes
   * no invocation lock and selects a target for both runs. Roughly 21 live-score
   * calls an hour against 20, and 5 game-stats against 4, in exactly the hours
   * games are live. Item 102 funds Active CPU, not provider quota; in-window
   * spend is Item 95 portion 2, gated on Item 94.
   *
   * It is always present because no cron expression can mean "never", so a day
   * with no tail is carried by {@link IDLE_SLOW_HOUR} and a day with nothing at
   * all by the full-day fallback — rather than by deleting the schedule, which
   * would also cost `inspect` and delivery health their subject.
   */
  slow: SynthesizedCron;
};

export type CronSynthesisOptions = {
  /** The dense cadence, in minutes — today's `live-scores` 3 / `game-stats` 15. */
  denseStepMinutes: number;
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
 *
 * THE CALLER OWES THESE WINDOWS EVERY KICKOFF IT WANTS COVERED, INCLUDING TBD
 * ONES. `derivePollingWindows` returns `{ windows, unconfirmed }` and deliberately
 * does not cluster `startTimeTBD` rows, because their published instant is a
 * placeholder 12 to 19 hours off — 421 of 3,679 rows on the shipped 2026 record.
 * Passing `derivePollingWindows(kickoffs).windows` straight through therefore
 * plans a cron that goes dark over every TBD game's real kickoff. Deciding what
 * to do with them — arm their whole day, or wait for CFBD to publish a time — is
 * the caller's, exactly as slice 1 designed, and this function has no way to tell
 * that a decision was skipped.
 */
export function synthesizePollingCrons(
  windows: readonly PollingWindow[],
  dayStartMs: number,
  options: CronSynthesisOptions
): PollingCronPlan {
  validDayStart(dayStartMs);
  validWindows(windows);
  const denseStepMinutes = validDenseStep(options.denseStepMinutes);

  const denseHours = utcHoursCovered(windows.map(densePhase), dayStartMs);
  const tailHours = utcHoursCovered(windows.map(slowPhase), dayStartMs);
  // An hour the dense schedule already polls twenty times needs no hourly
  // reconciliation on top, and adding one bills a second provider call in it.
  // Subtracting is free: the dense cron covers those hours, so the pair still
  // covers every armed hour.
  const reconciliationHours = tailHours.filter((hour) => !denseHours.includes(hour));

  return {
    dense: denseHours.length === 0 ? null : buildDenseCron(denseHours, denseStepMinutes),
    slow: buildSlowCron(slowHoursFor(denseHours, reconciliationHours)),
  };
}

/**
 * Which hours the slow schedule occupies — the reconciliation hours the dense
 * schedule does NOT already cover, or the cheapest honest stand-in when there are
 * none.
 *
 * Three cases, and only the first does any reconciliation work:
 *
 * - Reconciliation hours on this day: cover exactly those. Together with the
 *   dense cron that is every armed hour, with no hour covered twice.
 * - None, but dense hours exist: either the cluster ends after midnight so its
 *   tail belongs to tomorrow's plan, or the tail falls entirely inside hours the
 *   dense schedule already polls. Nothing here needs slow coverage, so this is a
 *   single daily slot to keep the schedule alive.
 * - Neither: a dead day. Hourly, all day — the widest safe expression, which
 *   keeps delivery health resolving at the slow cadence through the offseason.
 */
function slowHoursFor(
  denseHours: readonly number[],
  reconciliationHours: readonly number[]
): readonly number[] {
  if (reconciliationHours.length > 0) return reconciliationHours;
  if (denseHours.length === 0) return ALL_HOURS;
  // The idle slot lands in a dense hour ONLY on a fully dense day, where no
  // unshared hour exists — see {@link IDLE_SLOW_HOUR}, and the sweep that pins
  // it. Searching for a free hour here would be defending an unreachable case.
  return [IDLE_SLOW_HOUR];
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

function buildDenseCron(hours: readonly number[], stepMinutes: number): SynthesizedCron {
  return {
    cron: `*/${stepMinutes} ${hourField(hours)} * * *`,
    hours: [...hours],
    stepMinutes,
  };
}

function buildSlowCron(hours: readonly number[]): SynthesizedCron {
  // The slow schedule's minute is the OFFSET, never a step. One shared helper
  // chose between the two on `stepMinutes >= 60`, which meant an hourly cadence
  // below an hour would silently emit a stepped field — and a stepped field
  // always contains minute 0, the minute every dense rate also fires at. That is
  // the hole the `slowStepMinutes` option was deleted for, and it survived in the
  // constant feeding the same branch. Two builders cannot take each other's path.
  if (SLOW_STEP_MINUTES < 60) {
    throw new Error('SLOW_STEP_MINUTES below an hour cannot carry the dispatch offset');
  }
  return {
    cron: `${SLOW_OFFSET_MINUTE} ${hourField(hours)} * * *`,
    hours: [...hours],
    stepMinutes: SLOW_STEP_MINUTES,
  };
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

/**
 * The dense step, checked against the slow schedule's offset rather than assumed
 * clear of it. A step of 60 would emit the offset minute as a literal — a dense
 * cron byte-identical to the slow one — and a step that divides the offset fires
 * on it too. Both were reachable through this function before review found them.
 */
function validDenseStep(stepMinutes: number): number {
  const step = validStep(stepMinutes, 'denseStepMinutes');
  if (step >= 60 || SLOW_OFFSET_MINUTE % step === 0) {
    throw new Error(
      `denseStepMinutes ${step} collides with the slow schedule at minute ${SLOW_OFFSET_MINUTE}`
    );
  }
  return step;
}

/**
 * Window bounds must be finite, for the reason {@link validDayStart} exists: a
 * NaN or null bound (a stored plan is JSON) fails every overlap test silently, so
 * an armed day yields no dense schedule and an all-day slow one — the exact shape
 * of a legitimate offseason plan, and indistinguishable from it. Nothing throws
 * on that path, so the policy's own fallback would not catch it either: a live
 * game day would poll hourly straight through kickoff.
 */
function validWindows(windows: readonly PollingWindow[]): void {
  for (const window of windows) {
    if (
      !Number.isFinite(window.startMs) ||
      !Number.isFinite(window.denseEndMs) ||
      !Number.isFinite(window.slowEndMs)
    ) {
      throw new Error('polling windows must carry finite startMs, denseEndMs and slowEndMs');
    }
    // Ordering fails the same silent way finiteness does: an inverted bound makes
    // its phase an empty or nonsense span, so an armed day yields a garbage cron
    // or the offseason shape, and nothing throws for the policy fallback to catch.
    if (!(window.startMs <= window.denseEndMs && window.denseEndMs <= window.slowEndMs)) {
      throw new Error('polling windows must satisfy startMs <= denseEndMs <= slowEndMs');
    }
  }
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
  // The dispatch minute travels with the hourly cadence on BOTH branches. This
  // string renders verbatim as the System Health "Cadence" detail, and a label
  // that said plain "hourly" for a narrowed schedule would have an operator
  // expecting a top-of-hour receipt and mis-diagnosing the correct one at :01.
  const hourly = schedule.stepMinutes >= 60;
  const cadence = hourly
    ? `hourly (:${String(SLOW_OFFSET_MINUTE).padStart(2, '0')})`
    : `every ${schedule.stepMinutes} min`;
  if (schedule.hours.length === HOURS_PER_DAY) {
    return hourly
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
