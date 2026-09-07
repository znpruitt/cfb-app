import {
  deliveryExpectationForPlan,
  synthesizePollingCrons,
  type PollingCronPlan,
} from '@/lib/schedule/pollingCron';
import type { PollingWindow } from '@/lib/schedule/pollingWindows';
import { getAppStateEntries } from '@/lib/server/appStateStore';
import {
  readPollingPlannerRuns,
  type PlannerScheduleRun,
  type PollingPlannerReadResult,
  type PollingPlannerRun,
  type PollingPlannerRunSeries,
} from '@/lib/server/pollingPlannerRecord';
import {
  EXTERNAL_SCHEDULER_JOBS,
  parseSchedulerExecutionReceipt,
  SCHEDULER_EXECUTION_STATUS_SCOPE,
  schedulerSourceForJob,
  type ExternalSchedulerJob,
  type SchedulerExecutionReceipt,
  type SchedulerSource,
} from '@/lib/server/schedulerExecutionStatus';

/**
 * PLATFORM-086F2E2B — the cache-only server reader + schedule-slot-aware delivery
 * classifier over every durable scheduler-execution receipt.
 *
 * It answers exactly ONE question per job: has this configured job produced a
 * sufficiently recent AUTHENTICATED application execution, given its actual fixed
 * schedule? It deliberately does NOT decide whether provider data is fresh,
 * whether a provider request succeeded, whether automation is enabled, whether
 * QStash/Vercel cryptographically originated the request, or WHY a receipt is
 * missing (scheduler failure vs non-provisioning vs best-effort store failure).
 * Those are separate F2F inputs / external scheduler inspection.
 *
 * Delivery timeliness is derived ONLY from the receipt's `startedAt` against the
 * most recent UTC schedule slot at/before (`now − grace`) — fixed for the seven
 * jobs the planner does not own, and read from the durable planner record for
 * the two it does (PLATFORM-102 slice 3b) — never from the
 * durable `updatedAt`/`completedAt`, and never from `result`/`reason`/
 * `providerCallAttempted`/target contents. So a timely `skipped` or `failure`
 * receipt is still `on-time` (healthy delivery); execution outcome and delivery
 * timing stay separate facts. This slice adds NO route, hook, UI, provider call,
 * scheduler mutation, settings change, receipt write, history, or F2F issue/
 * severity logic — F2F consumes {@link readSchedulerDeliveryHealth} directly.
 */

export type SchedulerDeliveryState = 'on-time' | 'late' | 'missing' | 'invalid' | 'unavailable';

export type SchedulerDeliveryPolicy = {
  job: ExternalSchedulerJob;
  source: SchedulerSource;
  /**
   * The UTC cron expression this job's delivery is measured against. On the fixed
   * branch — every job today, and the seven the planner never owns — it is pinned
   * to the management scripts / `vercel.json` by tests. For a planner-owned job
   * given a plan it is DERIVED and pinned to nothing, so the parity test covers
   * the fixed branch only.
   */
  cron: string;
  cadenceLabel: string;
  /** Scheduler-DELIVERY tolerance (dispatch jitter + execution allowance) — NOT a provider-freshness threshold. */
  graceMs: number;
};

export type SchedulerDeliveryHealthRow = {
  job: ExternalSchedulerJob;
  source: SchedulerSource;
  /**
   * The expression GOVERNING this job now — the fixed contract, or the dense
   * schedule the planner record says is in force (the slow one when the day has
   * no dense phase). `null` when no schedule could be established at all; see
   * {@link planUnavailableReason}.
   */
  cron: string | null;
  cadenceLabel: string;
  graceMs: number | null;
  /**
   * The slot a valid receipt must reach to be on-time — the LATEST required slot
   * across {@link schedules}, because one job runs one route from two schedules
   * and a receipt satisfying only the slower one hides the faster one's outage.
   */
  requiredStartedAt: string;
  /**
   * Every schedule this row was MEASURED against, dense first. One entry on the
   * fixed contract; up to two once the planner owns the cron; empty when no
   * schedule could be established.
   *
   * Published because it is what makes a partial wiring detectable: the row's
   * `requiredStartedAt` is `max` over exactly these entries, so a build that
   * displayed one schedule while measuring against another would contradict its
   * own row.
   */
  schedules: readonly SchedulerDeliveryScheduleView[];
  deliveryState: SchedulerDeliveryState;
  /**
   * Why `unavailable`, when the reason is this row's PLAN rather than the receipt
   * scope. `null` on every row whose schedule resolved — including an
   * `unavailable` row caused by the receipt read failing.
   */
  planUnavailableReason: SchedulerPlanUnavailableReason | null;
  /** The safely-parsed, rebuilt receipt for `on-time`/`late`; `null` otherwise. */
  receipt: SchedulerExecutionReceipt | null;
};

export type SchedulerDeliveryHealthSnapshot = {
  generatedAt: string;
  jobs: SchedulerDeliveryHealthRow[];
};

// ---------------------------------------------------------------------------
// Fixed delivery policies (PLATFORM-086F2E2B §3).

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/**
 * The fixed per-job delivery contract: the exact UTC cron and the scheduler-
 * DELIVERY grace. `source` is NOT stored here — it is DERIVED from the job via
 * `schedulerSourceForJob` (the single ownership map), so no second source map
 * exists. The two lifecycle jobs use a 65-minute grace because Vercel Hobby cron
 * scheduling has per-hour precision of up to ±59 minutes plus a small
 * execution/receipt allowance; these are delivery tolerances, not freshness.
 */
const DELIVERY_POLICIES: Record<
  ExternalSchedulerJob,
  { cron: string; cadenceLabel: string; graceMs: number }
> = {
  'live-scores': { cron: '*/3 * * * *', cadenceLabel: 'every 3 minutes', graceMs: 6 * MINUTE_MS },
  'team-records': {
    cron: '0 * * * *',
    cadenceLabel: 'hourly (top of hour UTC)',
    graceMs: 2 * HOUR_MS,
  },
  'game-stats': { cron: '*/15 * * * *', cadenceLabel: 'every 15 minutes', graceMs: 30 * MINUTE_MS },
  odds: { cron: '0 * * * *', cadenceLabel: 'hourly (top of hour UTC)', graceMs: 2 * HOUR_MS },
  'schedule-refresh': {
    cron: '0 12 * * 2',
    cadenceLabel: 'weekly (Tuesday 12:00 UTC)',
    graceMs: 24 * HOUR_MS,
  },
  rankings: {
    cron: '0 4,22 * * *',
    cadenceLabel: 'twice daily (04:00 & 22:00 UTC)',
    graceMs: 2 * HOUR_MS,
  },
  'season-transition': {
    cron: '0 0 * * *',
    cadenceLabel: 'daily (00:00 UTC)',
    graceMs: 65 * MINUTE_MS,
  },
  'season-rollover': {
    cron: '0 0 * * *',
    cadenceLabel: 'daily (00:00 UTC)',
    graceMs: 65 * MINUTE_MS,
  },
  /**
   * Item 127 — the unconditional usage sampler. Six-hourly, and its grace is a
   * full extra interval: this job writes no canonical data, so a late delivery
   * costs sampling resolution rather than correctness, and paging on a narrow
   * window would make the noisiest row the least important one.
   */
  'usage-sample': {
    cron: '0 */6 * * *',
    cadenceLabel: 'every 6 hours',
    graceMs: 6 * HOUR_MS,
  },
};

// ---------------------------------------------------------------------------
// Planner-derived policy (PLATFORM-102 slice 2, collision 2).
//
// The two polling jobs are the ones whose cron becomes planner-owned, so they
// are the only ones whose delivery expectation may be derived. Everything else
// keeps a fixed contract pinned to the management scripts and `vercel.json`, and
// a plan passed alongside them is IGNORED rather than applied — narrowing a job
// the planner does not own would make delivery health claim a schedule QStash
// was never sent.

export type PlannerOwnedJob = Extract<ExternalSchedulerJob, 'live-scores' | 'game-stats'>;

/**
 * The jobs whose schedules the polling-window planner owns.
 *
 * Typed to the narrow union, not to `ExternalSchedulerJob[]`. Widened, this list
 * accepted any job name and the compiler linked it to nothing: adding one made
 * `isPlannerOwnedJob` a FALSE type predicate, left its dense step `undefined`,
 * and threw a validation error out of a policy function every health path calls.
 */
export const PLANNER_OWNED_JOBS: readonly PlannerOwnedJob[] = ['live-scores', 'game-stats'];

/**
 * The dense cadence each planner-owned job polls at, in minutes. It stays exactly
 * what the job runs today — a faster in-window cadence spends provider quota that
 * dead days never spent, and it is Item 95 portion 2, gated on Item 94. A test
 * pins each value against that job's fixed cron so the two cannot drift.
 */
const PLANNER_DENSE_STEP_MINUTES: Record<PlannerOwnedJob, number> = {
  'live-scores': 3,
  'game-stats': 15,
};

export function isPlannerOwnedJob(job: ExternalSchedulerJob): job is PlannerOwnedJob {
  return (PLANNER_OWNED_JOBS as readonly ExternalSchedulerJob[]).includes(job);
}

/**
 * The planner input a derived policy needs: the windows for one UTC day, and the
 * midnight that day starts at (`utcHoursCovered`'s own contract).
 *
 * ABSENCE AND EMPTINESS ARE DIFFERENT INPUTS, and collapsing them would make two
 * required behaviours the same case. Passing no plan at all means no planner
 * record exists — the policy falls back to the fixed constants byte for byte,
 * which is what makes this slice a no-op against production. Passing a plan whose
 * `windows` is empty is a real plan for a day with no games, and it yields the
 * hourly reconciliation schedule that carries the offseason.
 */
export type PollingPlanInput = {
  windows: readonly PollingWindow[];
  /** Midnight UTC of the day being planned. */
  dayStartMs: number;
};

/** The dense and slow cron expressions one planner-owned job runs for a day. */
export function pollingCronPlanForJob(
  job: PlannerOwnedJob,
  plan: PollingPlanInput
): PollingCronPlan {
  return synthesizePollingCrons(plan.windows, plan.dayStartMs, {
    denseStepMinutes: PLANNER_DENSE_STEP_MINUTES[job],
  });
}

/** The derived expectation, or the fixed contract when synthesis refuses the plan. */
function derivedPolicyOrFixed(
  job: PlannerOwnedJob,
  plan: PollingPlanInput
): { cron: string; cadenceLabel: string; graceMs: number } {
  try {
    return deliveryExpectationForPlan(pollingCronPlanForJob(job, plan));
  } catch {
    return DELIVERY_POLICIES[job];
  }
}

/**
 * The full delivery policy for one job (source derived, never a second map).
 *
 * With no `plan`, every job resolves to its fixed contract exactly as it did
 * before PLATFORM-102 — nothing in production supplies one yet, so this ships
 * dormant. With a plan, the two planner-owned jobs derive their cron, cadence
 * label and grace from the windows instead of the hardcoded constants.
 *
 * THE `plan` PARAMETER IS THE PREDICTIVE PATH, AND DELIVERY HEALTH NO LONGER
 * TAKES IT. Slice 2 left this here as the seam slice 3 was expected to wire;
 * slice 3b answered the question differently and wired the durable RECORD
 * instead, because the hazard was extrapolation itself. Windows re-synthesized
 * here describe what THIS BUILD would have scheduled, not what QStash was
 * actually holding — see `resolveDeliverySchedules`, which reads the recorded
 * expressions. Nothing in production passes this argument, and delivery health
 * must not start: it would reintroduce a second, predicted answer beside the
 * recorded one. Removing it is a slice-4 cleanup, kept out of slice 3b so its
 * diff stays the consumer.
 *
 * A SYNTHESIS FAILURE STILL DEGRADES ONE ROW, never the page — the same
 * guarantee `resolveDeliverySchedules` carries for a corrupt record.
 */
export function schedulerDeliveryPolicy(
  job: ExternalSchedulerJob,
  plan?: PollingPlanInput
): SchedulerDeliveryPolicy {
  const policy =
    plan !== undefined && isPlannerOwnedJob(job)
      ? derivedPolicyOrFixed(job, plan)
      : DELIVERY_POLICIES[job];
  return {
    job,
    source: schedulerSourceForJob(job),
    cron: policy.cron,
    cadenceLabel: policy.cadenceLabel,
    graceMs: policy.graceMs,
  };
}

/** Every delivery policy, one per scheduled job, in canonical order. */
export function schedulerDeliveryPolicies(plan?: PollingPlanInput): SchedulerDeliveryPolicy[] {
  return EXTERNAL_SCHEDULER_JOBS.map((job) => schedulerDeliveryPolicy(job, plan));
}

// ---------------------------------------------------------------------------
// Pure UTC schedule-slot calculation (no cron-parser dependency).

type ParsedCron = {
  minutes: ReadonlySet<number>;
  hours: ReadonlySet<number>;
  daysOfMonth: ReadonlySet<number>;
  months: ReadonlySet<number>;
  daysOfWeek: ReadonlySet<number>;
};

// Parse one cron field (`*`, a `*`-slash-step, a single number, or a comma list) into a set.
function parseCronField(field: string, min: number, max: number): ReadonlySet<number> {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    if (part === '*') {
      for (let n = min; n <= max; n++) out.add(n);
    } else if (part.startsWith('*/')) {
      const step = Number(part.slice(2));
      if (Number.isInteger(step) && step > 0) for (let n = min; n <= max; n += step) out.add(n);
    } else {
      const n = Number(part);
      if (Number.isInteger(n) && n >= min && n <= max) out.add(n);
    }
  }
  return out;
}

function parseCron(cron: string): ParsedCron {
  const [minute, hour, dom, month, dow] = cron.trim().split(/\s+/);
  return {
    minutes: parseCronField(minute ?? '*', 0, 59),
    hours: parseCronField(hour ?? '*', 0, 23),
    daysOfMonth: parseCronField(dom ?? '*', 1, 31),
    months: parseCronField(month ?? '*', 1, 12),
    daysOfWeek: parseCronField(dow ?? '*', 0, 6),
  };
}

/**
 * Whether a UTC instant matches the parsed cron. Day matching follows standard
 * cron semantics: when BOTH day-of-month and day-of-week are restricted a time
 * matches if EITHER matches; otherwise the restricted field (or `*`) applies.
 * All supported policies restrict at most one of the two, so this reduces to a
 * simple AND for them.
 */
function cronMatchesUtc(parsed: ParsedCron, instantMs: number): boolean {
  const d = new Date(instantMs);
  if (!parsed.minutes.has(d.getUTCMinutes())) return false;
  if (!parsed.hours.has(d.getUTCHours())) return false;
  if (!parsed.months.has(d.getUTCMonth() + 1)) return false;
  const domRestricted = parsed.daysOfMonth.size < 31;
  const dowRestricted = parsed.daysOfWeek.size < 7;
  const domOk = parsed.daysOfMonth.has(d.getUTCDate());
  const dowOk = parsed.daysOfWeek.has(d.getUTCDay());
  return domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;
}

// A generous safety cap comfortably above the sparsest supported cadence (weekly
// ≈ 7 days). The walk returns at the first match — for real policies within
// ≤ 7 days — so this cap is only a defensive backstop, never the hot path.
const MAX_SLOT_LOOKBACK_MINUTES = 366 * 24 * 60;

/**
 * The most recent fixed UTC schedule slot at or before `cutoffMs`. Deterministic
 * and pure: floors to the minute, then walks backward minute-by-minute checking
 * the parsed cron. Correct across minute/hour/day/month/year boundaries; DST is
 * irrelevant because every comparison is UTC.
 */
export function previousScheduleSlotMs(cron: string, cutoffMs: number): number {
  const floorMs = Math.floor(cutoffMs / MINUTE_MS) * MINUTE_MS;
  const notBeforeMs = floorMs - MAX_SLOT_LOOKBACK_MINUTES * MINUTE_MS;
  const slot = previousSlotWithin(parseCron(cron), floorMs, notBeforeMs);
  // Unreachable for the supported policies; degrade one minute past the cap,
  // exactly as the open-coded walk this delegates to did.
  return slot ?? notBeforeMs - MINUTE_MS;
}

/**
 * The most recent slot of ONE parsed expression inside `[notBeforeMs, fromMs]`,
 * or `null` when it fires nowhere in that span.
 *
 * Bounded rather than open-ended because the planner walk applies it to each
 * span of a RECORDED timeline in turn: an expression that fires nowhere in one
 * span must fall through to the older one cheaply, and a durable record is
 * operator-writable input that may hold an expression firing once a year.
 */
function previousSlotWithin(
  parsed: ParsedCron,
  fromMs: number,
  notBeforeMs: number
): number | null {
  let instant = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS;
  for (; instant >= notBeforeMs; instant -= MINUTE_MS) {
    if (cronMatchesUtc(parsed, instant)) return instant;
  }
  return null;
}

/**
 * The required slot for a job, as PRODUCTION computes it.
 *
 * Exported so a fixture derives this instead of approximating it. Grace ranges
 * from six minutes (live-scores) to twenty-four hours (schedule-refresh), so a
 * hand-written offset is wrong per job and wrong by a different amount each time:
 * a fixture using `startedAt + 60s` certified a 30-second-old `live-scores`
 * receipt as `late` when production, with a six-minute grace, classifies it
 * on-time. The guard then blessed a state the classifier can never emit, which is
 * the whole failure the guard exists to prevent.
 */
export function requiredStartedAtForJob(job: ExternalSchedulerJob, nowMs: number): number {
  // The FIXED branch, and deliberately the same call `resolveDeliverySchedules`
  // makes for a job with no planner record — not a second computation beside it.
  // Item 102's inherited item 4 is that a display path and a measurement path
  // may drift apart with no test failing; there is no second path to drift.
  return maxRequiredMs(fixedSchedules(job, nowMs).measured);
}

// ---------------------------------------------------------------------------
// Planner-record-derived schedules (PLATFORM-102 slice 3b).
//
// WHY THIS EXISTS. `previousScheduleSlotMs` walks one expression backwards as if
// it were eternal. That is true of the fixed contract and FALSE of a
// planner-owned cron, which slice 4 rewrites daily: on any day whose plan
// differs from yesterday's it derives a required slot THAT NEVER EXISTED.
// Measured on this module's own parser, a game day of `*/3 19,20,21,22,23`
// following a dead day that genuinely last fired at 23:00 under `0 * * * *`
// computes a required slot of 23:57 and reads `late` from 00:00 until the window
// opens at 19:00 — 1,140 minutes, on the two rows that matter most on a game
// day. The same extrapolation hides a real outage in the other direction: with a
// morning cluster, a receipt from 08:57 still reads `on-time` at 23:59.
//
// So delivery health reads what the planner ACTUALLY scheduled. Slice 3a's
// durable record holds, per run and per schedule, the intent it derived, the
// cron in force BEFORE it ran, and the CLI exit-code outcome saying whether
// anything was sent. That is a piecewise-constant timeline of what each schedule
// was doing, and the required slot is found by walking it — never by projecting
// today's expression onto yesterday.

/**
 * Why the durable planner record could not establish a row's schedule.
 *
 * A SEPARATE FIELD, not a sixth `SchedulerDeliveryState` — owner ruling
 * 2026-09-07. `deliveryState` describes the RECEIPT; plan corruption is
 * orthogonal to it, because a row can hold a perfectly good receipt and an
 * unusable plan. Item 102's inherited item 3 asked `invalid`/`unavailable` to
 * carry both facts, and `invalid` renders "Receipt invalid" — which would make
 * the UI assert something false about a receipt that parsed fine. So the STATE
 * is `unavailable`, which already means "no basis to judge" and already renders
 * muted, extended from scope-wide to per-row; the reason travels beside it, and
 * none of the five states' four consumers change.
 *
 * The members keep the distinction slice 3a kept, for the same reason: a corrupt
 * record sends an operator to the planner, a store failure sends them to the
 * database, and NEITHER may be rounded to "no plan yet" — the only read state
 * that licenses the fixed contract.
 */
export type SchedulerPlanUnavailableReason =
  /** Present but yielding nothing — including a recorded cron no parser can read. */
  | 'plan-unreadable'
  /** The store read itself failed. */
  | 'plan-store-failed'
  /** Readable, but no recorded run establishes what was in force. */
  | 'plan-incomplete'
  /** A run reported exit 4 — the upsert may or may not have landed. */
  | 'plan-indeterminate';

/** One schedule a delivery row was actually measured against. */
export type SchedulerDeliveryScheduleView = {
  /** The expression IN FORCE at {@link requiredStartedAt} — recorded, never extrapolated. */
  cron: string;
  /**
   * Two firing intervals of THIS expression — the one named in `cron`, not the
   * one in force now. The two differ whenever the slot belongs to a span the
   * planner has since replaced, and pairing them across expressions is what made
   * an hourly slot answerable in six minutes.
   */
  graceMs: number;
  /** This schedule's most recent slot at/before (`now − graceMs`). */
  requiredStartedAt: string;
};

/** The cadence rendered when no schedule could be established. NEVER the fixed contract. */
const PLAN_UNAVAILABLE_CADENCE_LABEL: Record<SchedulerPlanUnavailableReason, string> = {
  'plan-unreadable': 'schedule unknown — the planner record is unreadable',
  'plan-store-failed': 'schedule unknown — the planner record could not be read',
  'plan-incomplete': 'schedule unknown — no planner run records what is in force',
  'plan-indeterminate': 'schedule unknown — the last planner upsert was indeterminate',
};

const DAY_MS = 24 * HOUR_MS;

/**
 * How far back the recorded-timeline walk looks for a schedule's previous slot.
 *
 * Every schedule slice 2 synthesizes fires at least once a day — the slow cron
 * covers the reconciliation tail, the whole day when there are no dense hours,
 * and a single idle hour otherwise — so a healthy record answers within hours.
 * The cap exists because the record is DURABLE, OPERATOR-WRITABLE input: a
 * hand-edited row could hold an expression that fires only in February, and this
 * walk runs on a path every System Health load calls.
 *
 * EIGHT DAYS, not thirty. Eight covers a weekly-shaped hand edit with a day to
 * spare and bounds the worst case at ~11,520 minute-steps per schedule instead
 * of 43,200. Exhausting it means the recorded expression has not been due in
 * over a week, which for a POLLING schedule is a corrupt record rather than a
 * quiet one — `resolveSchedule` reports it as `plan-unreadable`.
 */
const PLANNER_SLOT_LOOKBACK_MS = 8 * DAY_MS;

type ScheduleKind = 'dense' | 'slow';

/**
 * What one schedule was doing across one span of time.
 *
 * `silent` is the `dense: null` case, and it is DELIBERATELY NOT an error. Under
 * BOTH readings Item 102's item 5 leaves open — "no dense phase today" and "the
 * dense schedule is deliberately off" — the schedule is not expected to fire, so
 * it contributes no required slot and cannot raise a false alarm. What the
 * ambiguity costs is carried forward, not decided here: if slice 4 instead
 * LEAVES a stale dense schedule installed on a dense-less day, that schedule is
 * still firing and its failure is invisible to delivery health until the next
 * day with a dense phase.
 */
type SegmentState =
  | { kind: 'cron'; cron: string }
  | { kind: 'silent' }
  | { kind: 'unknown'; reason: SchedulerPlanUnavailableReason };

/** One span of the recorded timeline: `[fromMs, toMs)` under one state. */
type CronSegment = {
  /** Inclusive; `-Infinity` for the span preceding the oldest recorded run. */
  fromMs: number;
  /** Exclusive; `Infinity` for the span still in force. */
  toMs: number;
  state: SegmentState;
};

/**
 * What one run LEFT IN FORCE for one schedule, read from the CLI's own exit-code
 * vocabulary — the same evidence `latestRecordedIntentForSchedule` walks, asked
 * a different question.
 *
 * - `confirmed` / `unchanged` — the intent is what QStash holds.
 * - `refused` / `failed` — exits 2 and 3 send nothing, so the previous cron stands.
 * - `indeterminate` — exit 4 may or may not have landed. There is no honest
 *   basis, and rounding it to either side asserts exactly the certainty the
 *   outcome exists to deny.
 *
 * `action` IS DELIBERATELY NOT READ. The type admits contradictory pairs
 * (`skipped` + `confirmed` validates), and every such pair collapses to the same
 * expression here, because what was left in force is a property of the outcome
 * alone: `applied`+`confirmed` and `skipped`+`confirmed` both leave `intent.cron`
 * live, and `applied`+`failed` and `skipped`+`failed` both leave `previousCron`.
 * So this consumer is immune to the contradiction; encoding the valid
 * combinations belongs to the store that admits them.
 */
function installedState(run: PollingPlannerRun, kind: ScheduleKind): SegmentState {
  const schedule = kind === 'dense' ? run.dense : run.slow;
  if (!schedule) return { kind: 'silent' };
  switch (schedule.outcome) {
    case 'confirmed':
    case 'unchanged':
      return { kind: 'cron', cron: schedule.intent.cron };
    case 'refused':
    case 'failed':
      return priorCronState(schedule);
    case 'indeterminate':
      return { kind: 'unknown', reason: 'plan-indeterminate' };
  }
}

/**
 * The cron a run found in force BEFORE it ran — the field that removes the
 * guess, and the reason slice 3a records it at all.
 */
function priorCronState(schedule: PlannerScheduleRun): SegmentState {
  return schedule.previousCron === null
    ? { kind: 'unknown', reason: 'plan-incomplete' }
    : { kind: 'cron', cron: schedule.previousCron };
}

/**
 * The state of the span a run OPENS, cross-checked against the evidence the
 * FOLLOWING run recorded about it.
 *
 * `previousCron` on the next run is a direct observation of what was live just
 * before that run — later and stronger than anything inferred from the run that
 * opened the span. Where the two agree the span is known. Where they DISAGREE
 * the record contradicts itself: a row was dropped between them (the store's
 * `droppedRuns`), or the cron was changed outside the planner, which is exactly
 * the tampering the record exists to expose. Asserting either side would be the
 * same guess this slice removes, so the span becomes unknown and the schedule
 * stops contributing a required slot.
 *
 * A `null` following `previousCron` is ABSENCE OF EVIDENCE, not disagreement —
 * the store documents it as "could not be established, a first run". Treating it
 * as a contradiction would blank delivery health on the first run of every new
 * schedule id, which is the state slice 4's cutover starts in.
 *
 * A run that recorded NO schedule of this kind (`dense: null`) against a
 * following non-null `previousCron` is also a contradiction, not a resolution of
 * Item 102's item 5: the record says nothing was planned while the next run saw
 * something live. Which of those governs a live schedule is slice 4's decision,
 * and this reports the conflict rather than picking a side.
 */
function spanState(inferred: SegmentState, nextPreviousCron: string | null): SegmentState {
  if (inferred.kind === 'unknown') return inferred;
  if (nextPreviousCron === null) return inferred;
  if (inferred.kind === 'cron' && inferred.cron === nextPreviousCron) return inferred;
  return { kind: 'unknown', reason: 'plan-incomplete' };
}

/** One schedule's recorded timeline, oldest span first. */
function scheduleTimeline(series: PollingPlannerRunSeries, kind: ScheduleKind): CronSegment[] {
  // Sorted here rather than trusted. The store sorts on read, but a series also
  // arrives through an injected reader, and the walk's correctness must not rest
  // on somebody else's ordering.
  const runs = [...series.runs].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const first = runs[0];
  if (!first) return [];
  const firstSchedule = kind === 'dense' ? first.dense : first.slow;
  const segments: CronSegment[] = [
    {
      fromMs: Number.NEGATIVE_INFINITY,
      toMs: Date.parse(first.at),
      // Before the oldest run the only evidence is that run's `previousCron`; a
      // dense-less oldest run says nothing at all about what preceded it.
      state: firstSchedule
        ? priorCronState(firstSchedule)
        : { kind: 'unknown', reason: 'plan-incomplete' },
    },
  ];
  runs.forEach((run, index) => {
    const next = runs[index + 1];
    const nextSchedule = next ? (kind === 'dense' ? next.dense : next.slow) : null;
    segments.push({
      fromMs: Date.parse(run.at),
      toMs: next ? Date.parse(next.at) : Number.POSITIVE_INFINITY,
      // The newest span has no following run, so nothing cross-checks it.
      state: next
        ? spanState(installedState(run, kind), nextSchedule ? nextSchedule.previousCron : null)
        : installedState(run, kind),
    });
  });
  return segments;
}

type SlotSearch =
  | { kind: 'slot'; atMs: number; cron: string; graceMs: number }
  /** The schedule was not expected to fire at all across the span reached. */
  | { kind: 'silent' }
  | { kind: 'unknown'; reason: SchedulerPlanUnavailableReason }
  /** Every readable span down to the floor, and the expression fired in none. */
  | { kind: 'exhausted' };

/**
 * The most recent slot whose grace has expired, under the expressions that were
 * ACTUALLY in force, newest span first. This is item 1: read, do not predict.
 *
 * GRACE IS PER SPAN, taken from the expression that governed it. An earlier
 * version derived one grace from the CURRENT expression and applied it to a slot
 * belonging to an older one — so a job moving from hourly to a three-minute
 * cadence had its last hourly slot judged with six minutes of tolerance instead
 * of a hundred and twenty, reporting `late` up to two hours before the schedule
 * that produced that slot had run out of allowance. Grace only means anything
 * beside the schedule it belongs to.
 *
 * A span that has not STARTED is skipped: the store admits a run up to five
 * minutes ahead for clock skew, and a plan that has not begun cannot have fired.
 */
function previousSlotInForce(
  segments: readonly CronSegment[],
  nowMs: number,
  floorMs: number
): SlotSearch {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!segment || segment.fromMs > nowMs) continue;
    if (segment.state.kind === 'silent') return { kind: 'silent' };
    if (segment.state.kind === 'unknown') return { kind: 'unknown', reason: segment.state.reason };
    const schedule = recordedScheduleFromCron(segment.state.cron);
    if (!schedule) return { kind: 'unknown', reason: 'plan-unreadable' };
    const graceMs = 2 * schedule.stepMinutes * MINUTE_MS;
    const cutoffMs = nowMs - graceMs;
    if (segment.fromMs <= cutoffMs) {
      // `toMs` is exclusive, so the last instant this span governs is one
      // millisecond earlier; the walk floors to the minute from there.
      const slot = previousSlotWithin(
        parseCron(segment.state.cron),
        Math.min(cutoffMs, segment.toMs - 1),
        Math.max(segment.fromMs, floorMs)
      );
      if (slot !== null) return { kind: 'slot', atMs: slot, cron: segment.state.cron, graceMs };
    }
    if (segment.fromMs <= floorMs) break;
  }
  return { kind: 'exhausted' };
}

/**
 * The interval between firings INSIDE A COVERED HOUR, as the cyclic maximum gap
 * of the minute field. It is not the gap between firings of the whole schedule:
 * a three-minute step restricted to hours 19–23 answers 3, and the nineteen
 * dark hours are the TIMELINE's business, not grace's — no slot exists in them
 * to be late for.
 *
 * Taken from the RECORDED expression, never from `PLANNER_DENSE_STEP_MINUTES`: a
 * step read from this build's constant would describe what this build WOULD
 * synthesize, which is the prediction this slice exists to stop making. The
 * maximum gap rather than the minimum is the forgiving direction WITHIN that
 * hour, so an irregular minute field cannot narrow grace below the widest gap
 * the schedule actually leaves, and a single matching minute is hourly. It
 * reproduces
 * today's constants exactly: a three-minute step yields six minutes of grace,
 * a fifteen-minute step thirty.
 */
function cronStepMinutes(parsed: ParsedCron): number | null {
  const minutes = [...parsed.minutes].sort((a, b) => a - b);
  const first = minutes[0];
  const last = minutes[minutes.length - 1];
  if (first === undefined || last === undefined) return null;
  let step = 60 - last + first;
  for (let index = 1; index < minutes.length; index += 1) {
    step = Math.max(step, minutes[index]! - minutes[index - 1]!);
  }
  return step;
}

/**
 * One recorded expression, read into the shape the row needs. `null` when it
 * matches no instant at all — a corrupt record, not an absent one.
 */
type RecordedSchedule = {
  cron: string;
  /** The UTC hours it fires in, ascending. */
  hours: number[];
  /** Minutes between firings INSIDE a covered hour. */
  stepMinutes: number;
  /**
   * The single minute it dispatches at, when the field names exactly one. A step
   * of sixty and a single minute are the same condition, so this is non-null for
   * every hourly expression and is the minute the label must print.
   */
  dispatchMinute: number | null;
};

function recordedScheduleFromCron(cron: string): RecordedSchedule | null {
  const parsed = parseCron(cron);
  const stepMinutes = cronStepMinutes(parsed);
  if (stepMinutes === null) return null;
  if (
    parsed.hours.size === 0 ||
    parsed.months.size === 0 ||
    parsed.daysOfMonth.size === 0 ||
    parsed.daysOfWeek.size === 0
  ) {
    return null;
  }
  const minutes = [...parsed.minutes];
  return {
    cron,
    hours: [...parsed.hours].sort((a, b) => a - b),
    stepMinutes,
    dispatchMinute: minutes.length === 1 ? (minutes[0] ?? null) : null,
  };
}

const HOURS_IN_A_DAY = 24;

/**
 * The cadence label, built from the RECORDED expressions.
 *
 * It reproduces slice 2's vocabulary deliberately — an operator should not have
 * to learn two — but it will not borrow slice 2's formatter, because that one
 * prints `SLOW_OFFSET_MINUTE` for any hourly schedule. Fed a recorded cron
 * firing at `:30` it rendered "hourly (:01 UTC)" beside a `cron` field saying
 * `30 * * * *`: the row contradicting itself, and a value taken from this
 * build's constant rather than from the record. That is the same class of defect
 * as the extrapolation, one field over.
 */
function describeRecordedSchedules(dense: RecordedSchedule | null, slow: RecordedSchedule): string {
  return dense === null
    ? describeRecorded(slow)
    : `${describeRecorded(dense)}, ${describeRecorded(slow)}`;
}

function describeRecorded(schedule: RecordedSchedule): string {
  const hourly = schedule.stepMinutes >= 60;
  const minute = String(schedule.dispatchMinute ?? 0).padStart(2, '0');
  const cadence = hourly ? `hourly (:${minute})` : `every ${schedule.stepMinutes} min`;
  if (schedule.hours.length === HOURS_IN_A_DAY) {
    return hourly ? `hourly (:${minute} UTC)` : `${cadence} (all day UTC)`;
  }
  return `${cadence} at ${describeRecordedHours(schedule.hours)} UTC`;
}

/** Consecutive hours as ranges — `19:00–23:00` fires in each of hours 19 to 23. */
function describeRecordedHours(hours: readonly number[]): string {
  const groups: Array<[number, number]> = [];
  for (const hour of hours) {
    const last = groups[groups.length - 1];
    if (last && hour === last[1] + 1) last[1] = hour;
    else groups.push([hour, hour]);
  }
  const clock = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;
  return groups
    .map(([start, end]) => (start === end ? clock(start) : `${clock(start)}–${clock(end)}`))
    .join(', ');
}

/** The schedules one row is measured against, or why none could be established. */
type ResolvedSchedules =
  | {
      kind: 'resolved';
      /** The expression governing NOW — dense when the day has one, else slow. */
      cron: string;
      cadenceLabel: string;
      graceMs: number;
      /** Every schedule that produced a required slot, dense first. */
      measured: SchedulerDeliveryScheduleView[];
    }
  | { kind: 'unresolved'; reason: SchedulerPlanUnavailableReason };

type ScheduleResolution =
  | { kind: 'measured'; view: SchedulerDeliveryScheduleView; current: RecordedSchedule }
  /** Not expected to fire inside the lookback; contributes no required slot. */
  | { kind: 'not-due'; current: RecordedSchedule | null }
  | { kind: 'unresolved'; reason: SchedulerPlanUnavailableReason };

/** The fixed contract as a resolution — the seven unowned jobs, and any job with no record. */
function fixedSchedules(
  job: ExternalSchedulerJob,
  nowMs: number
): Extract<ResolvedSchedules, { kind: 'resolved' }> {
  const policy = DELIVERY_POLICIES[job];
  const requiredMs = previousScheduleSlotMs(policy.cron, nowMs - policy.graceMs);
  return {
    kind: 'resolved',
    cron: policy.cron,
    cadenceLabel: policy.cadenceLabel,
    graceMs: policy.graceMs,
    measured: [
      {
        cron: policy.cron,
        graceMs: policy.graceMs,
        requiredStartedAt: new Date(requiredMs).toISOString(),
      },
    ],
  };
}

/**
 * One schedule's required slot, from the timeline the record establishes.
 *
 * TWO KINDS OF "NO SLOT", AND ONLY ONE BLANKS THE ROW. If the expression in
 * force NOW cannot be read, or the record cannot say what is in force now, the
 * schedule is unresolved and the row goes with it — nothing is known about what
 * this job is supposed to do. But an older span being silent or unknown means
 * only that THIS schedule has no measurable slot: the current expression is
 * known and the sibling schedule may be perfectly measurable, so the schedule
 * contributes nothing and the row still reports what it can.
 *
 * That distinction is load-bearing on the planner's FIRST run, whose
 * `previousCron` is null by definition: the earlier version blanked both rows
 * for every hour before the dense window opened, on the first day slice 4 would
 * ever run.
 */
function resolveSchedule(
  series: PollingPlannerRunSeries,
  kind: ScheduleKind,
  nowMs: number
): ScheduleResolution {
  const segments = scheduleTimeline(series, kind);
  // The newest span that has actually STARTED. The store admits a run up to five
  // minutes ahead for clock skew, and a plan that has not begun governs nothing
  // — it must not supply the display, the grace, or an `indeterminate` refusal.
  let current: CronSegment | undefined;
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment && segment.fromMs <= nowMs) {
      current = segment;
      break;
    }
  }
  if (!current) return { kind: 'unresolved', reason: 'plan-incomplete' };
  if (current.state.kind === 'unknown') {
    return { kind: 'unresolved', reason: current.state.reason };
  }
  if (current.state.kind === 'silent') return { kind: 'not-due', current: null };
  const schedule = recordedScheduleFromCron(current.state.cron);
  // A recorded expression no parser can read is a CORRUPT record, not an absent
  // one. Falling back to the fixed contract here would claim a firing every
  // three minutes while the real schedule is dark — inherited item 3 exactly, a
  // false alarm dressed as a real one.
  if (!schedule) return { kind: 'unresolved', reason: 'plan-unreadable' };
  // Readable FIELDS are not proof an expression can ever fire: `0 0 31 2 *`
  // parses cleanly, passes the store's lexical validator, and matches no instant
  // in any year. Probe the expression in force DIRECTLY, so a corrupt current
  // schedule surfaces even where an older span would have answered for it and
  // left the sibling reporting the row healthy. Cheap for a healthy cron — a
  // three-minute cadence matches within three steps — and bounded for a broken
  // one by the same lookback as the walk.
  const everFires = previousSlotWithin(
    parseCron(current.state.cron),
    nowMs,
    nowMs - PLANNER_SLOT_LOOKBACK_MS
  );
  if (everFires === null) return { kind: 'unresolved', reason: 'plan-unreadable' };
  const found = previousSlotInForce(segments, nowMs, nowMs - PLANNER_SLOT_LOOKBACK_MS);
  // Readable fields are not proof an expression can ever fire: `0 0 31 2 *`
  // parses cleanly and matches no instant in any year. Exhausting the whole
  // lookback without a single firing is that, or a schedule so sparse it cannot
  // serve delivery health either way — a corrupt record, and it must surface
  // rather than be quietly dropped while the sibling reports the row healthy.
  if (found.kind === 'exhausted') return { kind: 'unresolved', reason: 'plan-unreadable' };
  if (found.kind === 'unknown' || found.kind === 'silent') {
    return { kind: 'not-due', current: schedule };
  }
  return {
    kind: 'measured',
    current: schedule,
    // `cron` and `graceMs` come from the SAME span, so the published view is
    // internally consistent — the earlier version paired an older span's
    // expression with the current one's tolerance.
    view: {
      cron: found.cron,
      graceMs: found.graceMs,
      requiredStartedAt: new Date(found.atMs).toISOString(),
    },
  };
}

/**
 * The one place a delivery row's schedule facts are decided — display and
 * measurement together, from one input, so they cannot describe different days.
 *
 * `absent` is the ONLY read state that resolves to the fixed contract, which is
 * what makes this a no-op against production: nothing writes a planner record
 * today, so all nine jobs resolve exactly as they did before this slice.
 */
function resolveDeliverySchedules(
  job: ExternalSchedulerJob,
  nowMs: number,
  record: PollingPlannerReadResult
): ResolvedSchedules {
  if (!isPlannerOwnedJob(job) || record.kind === 'absent') return fixedSchedules(job, nowMs);
  if (record.kind === 'unreadable') return { kind: 'unresolved', reason: 'plan-unreadable' };
  if (record.kind === 'failed') return { kind: 'unresolved', reason: 'plan-store-failed' };
  if (record.series.runs.length === 0) return { kind: 'unresolved', reason: 'plan-incomplete' };

  const dense = resolveSchedule(record.series, 'dense', nowMs);
  if (dense.kind === 'unresolved') return dense;
  const slow = resolveSchedule(record.series, 'slow', nowMs);
  if (slow.kind === 'unresolved') return slow;

  const measured = [dense, slow].flatMap((entry) =>
    entry.kind === 'measured' ? [entry.view] : []
  );
  // Every schedule silent at once means the record cannot say when this job was
  // last due. That is no basis, not "nothing is wrong", and it must never read
  // as on-time.
  if (measured.length === 0) return { kind: 'unresolved', reason: 'plan-incomplete' };
  const governing = dense.current ?? slow.current;
  // `PollingPlannerRun.slow` is non-nullable, so a parsed run always carries one
  // — but the row must degrade rather than assume it.
  if (!slow.current || !governing) return { kind: 'unresolved', reason: 'plan-incomplete' };
  return {
    kind: 'resolved',
    cron: governing.cron,
    cadenceLabel: describeRecordedSchedules(dense.current, slow.current),
    graceMs: 2 * governing.stepMinutes * MINUTE_MS,
    measured,
  };
}

/** The LATEST required slot across every measured schedule — item 2's `max`. */
function maxRequiredMs(measured: readonly SchedulerDeliveryScheduleView[]): number {
  return Math.max(...measured.map((entry) => Date.parse(entry.requiredStartedAt)));
}

// ---------------------------------------------------------------------------
// Cache-only reader (PLATFORM-086F2E2B §6).

/** An injected entries-loader seam for deterministic read/parse tests. */
export type SchedulerEntriesLoader = () => Promise<ReadonlyArray<{ key: string; value: unknown }>>;

/** An injected planner-record reader, one call per planner-owned job. */
export type PlannerRecordLoader = (job: PlannerOwnedJob) => Promise<PollingPlannerReadResult>;

export type SchedulerDeliveryHealthOptions = {
  /** ONE clock captured for the whole snapshot (never `Date.now()` per job). */
  nowMs?: number;
  /** Overrides the durable scope read (tests inject fixtures / a throwing loader). */
  loadEntries?: SchedulerEntriesLoader;
  /**
   * Overrides the durable planner-record read — item 4's thread, and the seam
   * that keeps this deterministic without reaching into the store slice 3a owns.
   *
   * The default reads the record for the TWO planner-owned jobs and no others,
   * so a job the planner never owns is never even asked. Nothing writes a record
   * in production yet, so every read answers `absent` and every row is byte-
   * identical to the fixed contract — but the READ is live, and its latency and
   * failure mode are real from the moment this ships.
   */
  loadPlannerRecord?: PlannerRecordLoader;
};

/** Default loader: a single cache-only durable scope read, no memo/write. */
function defaultLoadEntries(): Promise<ReadonlyArray<{ key: string; value: unknown }>> {
  return getAppStateEntries<unknown>(SCHEDULER_EXECUTION_STATUS_SCOPE).then((rows) =>
    // Expose ONLY key + value — the durable `updatedAt` is never a delivery signal.
    rows.map((row) => ({ key: row.key, value: row.value }))
  );
}

/**
 * Read every durable receipt through ONE cache-only scope read and classify
 * each job's delivery. Always returns one state-bearing row per scheduled job, in
 * canonical order — a missing key is `missing`, an unparseable row is `invalid`
 * (never contaminating siblings), a valid row is `on-time`/`late`, and a scope
 * read failure makes EVERY row `unavailable` (never leaking the storage error).
 * No provider call, internal HTTP request, quota probe, or write occurs.
 */
export async function readSchedulerDeliveryHealth(
  options: SchedulerDeliveryHealthOptions = {}
): Promise<SchedulerDeliveryHealthSnapshot> {
  const nowMs = options.nowMs ?? Date.now();
  const load = options.loadEntries ?? defaultLoadEntries;
  const loadPlan = options.loadPlannerRecord ?? readPollingPlannerRuns;

  const entriesPromise = (async (): Promise<Map<string, unknown> | null> => {
    try {
      const entries = await load();
      return new Map(entries.map((entry) => [entry.key, entry.value]));
    } catch {
      // The scope read itself failed — every job is `unavailable`; the thrown
      // storage error and any partial durable value are never exposed.
      return null;
    }
  })();

  const [entriesByJob, planEntries] = await Promise.all([
    entriesPromise,
    Promise.all(
      PLANNER_OWNED_JOBS.map(async (job) => {
        try {
          return [job, await loadPlan(job)] as const;
        } catch {
          // A THROWN reader is the same fact as a failed store read: one row
          // degrades, the page does not. It is NEVER a fall back to the fixed
          // contract, which would claim a cadence the planner has replaced.
          return [job, { kind: 'failed' } as PollingPlannerReadResult] as const;
        }
      })
    ),
  ]);
  const plans = new Map<ExternalSchedulerJob, PollingPlannerReadResult>(planEntries);

  const jobs = EXTERNAL_SCHEDULER_JOBS.map((job) =>
    buildDeliveryRow(
      job,
      entriesByJob,
      nowMs,
      resolveDeliverySchedules(job, nowMs, plans.get(job) ?? { kind: 'absent' })
    )
  );
  return { generatedAt: new Date(nowMs).toISOString(), jobs };
}

function buildDeliveryRow(
  job: ExternalSchedulerJob,
  entriesByJob: Map<string, unknown> | null,
  nowMs: number,
  schedules: ResolvedSchedules
): SchedulerDeliveryHealthRow {
  const source = schedulerSourceForJob(job);
  const unresolved = schedules.kind === 'unresolved';
  const base = unresolved
    ? {
        job,
        source,
        // No basis to judge timing, so NO cadence is claimed — and deliberately
        // not the fixed contract, whose cadence the planner has replaced.
        cron: null,
        cadenceLabel: PLAN_UNAVAILABLE_CADENCE_LABEL[schedules.reason],
        graceMs: null,
        requiredStartedAt: new Date(nowMs).toISOString(),
        schedules: [] as readonly SchedulerDeliveryScheduleView[],
        planUnavailableReason: schedules.reason,
      }
    : {
        job,
        source,
        cron: schedules.cron,
        cadenceLabel: schedules.cadenceLabel,
        graceMs: schedules.graceMs,
        requiredStartedAt: new Date(maxRequiredMs(schedules.measured)).toISOString(),
        schedules: schedules.measured,
        planUnavailableReason: null,
      };

  if (entriesByJob === null) {
    return { ...base, deliveryState: 'unavailable', receipt: null };
  }
  if (!entriesByJob.has(job)) {
    // `missing` MEANS "nothing arrived for the required slot", and its issue text
    // states that slot and the cadence. Neither exists when the plan is
    // unresolved, so the honest answer there is still "no basis".
    return { ...base, deliveryState: unresolved ? 'unavailable' : 'missing', receipt: null };
  }
  const receipt = parseSchedulerExecutionReceipt(entriesByJob.get(job), job, nowMs);
  if (receipt === null) {
    // `invalid` is a fact about the RECEIPT and stays true whatever the plan is
    // doing, so it is reported even alongside a plan fault — which the row still
    // carries in `planUnavailableReason`.
    return { ...base, deliveryState: 'invalid', receipt: null };
  }
  if (unresolved) {
    // THE RECEIPT IS PUBLISHED. An earlier version withheld it, and
    // `schedulerExecutionIssues` and `lifecycleIntegrityIssues` both skip a
    // receiptless row — so a planner-record failure silently suppressed
    // `scheduler-execution-failed` and `lifecycle-data-unusable` for the two most
    // important jobs. Execution outcome and delivery TIMING are separate facts;
    // only the timing one has lost its basis here.
    return { ...base, deliveryState: 'unavailable', receipt };
  }
  // Delivery timeliness is `startedAt` vs the required slot ONLY — never the
  // execution result/reason/provider flag/target, and never `updatedAt`.
  const deliveryState: SchedulerDeliveryState =
    Date.parse(receipt.startedAt) >= maxRequiredMs(schedules.measured) ? 'on-time' : 'late';
  return { ...base, deliveryState, receipt };
}
