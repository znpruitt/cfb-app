import { synthesizePollingCrons, type PollingCronPlan } from '@/lib/schedule/pollingCron';
import type { PollingWindow } from '@/lib/schedule/pollingWindows';

import { POLLING_PLANNER_CRON } from '../../../scripts/lib/plannerScheduleContracts.ts';
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
   * The expression this row was MEASURED against — the entry in
   * {@link schedules} that produced {@link requiredStartedAt}, or, when nothing
   * is due, the first schedule whose expression is known. `null` only when no
   * schedule is known at all.
   *
   * It is deliberately not an independent "governing" pick: naming a schedule
   * absent from `schedules` is the display-versus-measurement divergence that
   * `schedules` exists to make impossible.
   */
  cron: string | null;
  cadenceLabel: string;
  graceMs: number | null;
  /**
   * The slot a valid receipt must reach to be on-time — the LATEST required slot
   * across {@link schedules}, because one job runs one route from two schedules
   * and a receipt satisfying only the slower one hides the faster one's outage.
   *
   * `null` when NOTHING IS DUE: every schedule is known and none has a slot whose
   * grace has expired. That is the planner's first hours, and it is not the same
   * as having no basis — a row with no obligation cannot be late.
   */
  requiredStartedAt: string | null;
  /**
   * EVERY schedule this job has, each with its own state — one entry on the
   * fixed contract, two once the planner owns the cron. Never empty.
   *
   * Published because it is what makes a partial wiring detectable: the row's
   * `requiredStartedAt`, `cron` and `graceMs` all come from the entry that
   * produced the latest slot, so a build that displayed one schedule while
   * measuring against another would contradict its own row.
   */
  schedules: readonly SchedulerDeliveryScheduleView[];
  deliveryState: SchedulerDeliveryState;
  /**
   * Why `unavailable`, when the reason is this row's PLAN rather than the receipt
   * scope. Set only when NO schedule is known at all; a row that lost one of two
   * schedules still reports on the other, and carries that schedule's reason in
   * its own {@link schedules} entry.
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
  /**
   * PLATFORM-102 slice 4 — the daily planner, at 23:50 UTC so the day it plans is
   * installed before that day begins.
   *
   * A FIXED contract, and it stays one: this is the job that rewrites the other
   * two, and a planner whose own cron the planner owned could not be recovered
   * from the repo. It is therefore never in {@link PLANNER_OWNED_JOBS} and never
   * resolves through the record.
   *
   * The grace is deliberately TIGHT for a daily job — 65 minutes, matching the
   * lifecycle crons — because lateness here is not a lost datapoint. Past midnight
   * an unrun planner means today's schedules are still yesterday's, and on the
   * transition that matters most (a dead day followed by a game day) it means the
   * dense schedule is still PAUSED while games are live.
   */
  'polling-planner': {
    cron: POLLING_PLANNER_CRON,
    cadenceLabel: 'daily (23:50 UTC)',
    graceMs: 65 * MINUTE_MS,
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

/**
 * The full delivery policy for one job (source derived, never a second map) —
 * the FIXED contract, always.
 *
 * THE PREDICTIVE `plan` PARAMETER IS GONE (PLATFORM-102 slice 4). Slice 2 left it
 * here as the seam slice 3 was expected to wire; slice 3b answered the question
 * differently and wired the durable RECORD instead, because the hazard was
 * extrapolation itself. Windows re-synthesized here describe what THIS BUILD
 * would have scheduled, not what QStash was actually holding — and now that the
 * planner really does write records, a second predicted answer beside the
 * recorded one is not merely unused, it is a live way for two parts of the page
 * to disagree. `resolveDeliverySchedules` is the only path that narrows a
 * planner-owned job's expectation, and it reads what was recorded.
 *
 * `AGENTS.md`: a module left with no production consumer must say why in the code
 * — or go. This one goes.
 */
export function schedulerDeliveryPolicy(job: ExternalSchedulerJob): SchedulerDeliveryPolicy {
  const policy = DELIVERY_POLICIES[job];
  return {
    job,
    source: schedulerSourceForJob(job),
    cron: policy.cron,
    cadenceLabel: policy.cadenceLabel,
    graceMs: policy.graceMs,
  };
}

/** Every delivery policy, one per scheduled job, in canonical order. */
export function schedulerDeliveryPolicies(): SchedulerDeliveryPolicy[] {
  return EXTERNAL_SCHEDULER_JOBS.map((job) => schedulerDeliveryPolicy(job));
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

/**
 * Parse one cron field (`*`, a `*`-slash-step, a single number, or a comma list)
 * into a set — or `null` for a field holding anything else.
 *
 * IT FAILS CLOSED ON A PART IT CANNOT READ, and did not. An unrecognized part
 * used to be DROPPED while its siblings were kept, so a comma list containing a
 * RANGE silently narrowed the schedule: `8,12-23` parsed to hour 8 alone. The
 * planner record's own stored pattern admits `-`, so this arrives from durable,
 * operator-writable input, and the consequence is the failure this module exists
 * to prevent — measured on the shipped classifier, a receipt 14h33m stale
 * classified `on-time` against a schedule narrowed from twelve hours to one,
 * beside a `cron` field still naming the full expression.
 *
 * Rejecting rather than SUPPORTING ranges is deliberate: an expression this
 * parser cannot read is one System Health cannot measure, and the whole slice's
 * rule is that such a record surfaces rather than being reinterpreted.
 */
function parseCronField(field: string, min: number, max: number): ReadonlySet<number> | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    if (part === '*') {
      for (let n = min; n <= max; n++) out.add(n);
      continue;
    }
    // MATCHED, not coerced. `Number('')` is 0, so an empty part — a trailing or
    // doubled comma, which the record's stored pattern admits — was accepted as
    // slot ZERO in any field where 0 is in range. Measured: a recorded
    // `19,20,21,22,23,` invented hour 0 and moved the required slot to 00:57.
    // That is the same failure as the dropped range, one character over, and it
    // survived the fix for it because the fix guarded the VALUE and not the
    // shape.
    const stepped = /^\*\/(\d+)$/.exec(part);
    if (stepped) {
      const step = Number(stepped[1]);
      if (step <= 0) return null;
      for (let n = min; n <= max; n += step) out.add(n);
      continue;
    }
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    if (n < min || n > max) return null;
    out.add(n);
  }
  return out.size > 0 ? out : null;
}

/**
 * Parse a five-field UTC cron, or `null` for anything this parser cannot read.
 *
 * EXACTLY FIVE FIELDS. An earlier version defaulted a missing field to `*` and
 * ignored extra ones, so a six-field seconds-first expression read as minute 0
 * of every third hour, and a bare one-field stepped minute read as every three
 * minutes all day — plausible, wrong, and silent. That was tolerable while every
 * expression came from constants in this file; PLATFORM-102 slice 3b makes it
 * read DURABLE, OPERATOR-WRITABLE input, whose stored pattern admits both
 * shapes, and this slice's whole rule is that an expression it cannot read must
 * surface rather than be reinterpreted.
 */
function parseCron(cron: string): ParsedCron | null {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  const minutes = parseCronField(minute, 0, 59);
  const hours = parseCronField(hour, 0, 23);
  const daysOfMonth = parseCronField(dom, 1, 31);
  const months = parseCronField(month, 1, 12);
  const daysOfWeek = parseCronField(dow, 0, 6);
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;
  return { minutes, hours, daysOfMonth, months, daysOfWeek };
}

/** February in a LEAP year — the 29th is reachable, the 30th and 31st never are. */
const DAYS_IN_MONTH: readonly number[] = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Whether any date at all satisfies the expression's calendar fields.
 *
 * STRUCTURAL, not probed. An earlier version asked "did this fire in the last
 * eight days?", which cannot separate an impossible calendar from a merely
 * SPARSE one: it reported a perfectly valid `0 0 1 * *` as a corrupt record on
 * the fifteenth of the month. The calendar answers the question exactly.
 *
 * Cron's day rule does the rest: when BOTH day-of-month and day-of-week are
 * restricted a date matches if EITHER does, so any restricted day-of-week keeps
 * an expression satisfiable whatever its day-of-month says. Only a
 * month/day-of-month pair no month contains — `0 0 31 2 *` — is impossible.
 */
function cronCalendarIsSatisfiable(parsed: ParsedCron): boolean {
  if (parsed.daysOfWeek.size < 7) return true;
  for (const month of parsed.months) {
    const last = DAYS_IN_MONTH[month - 1] ?? 31;
    for (const day of parsed.daysOfMonth) if (day <= last) return true;
  }
  return false;
}

/**
 * Whether a UTC instant's DATE matches the parsed cron.
 *
 * Day matching follows standard cron semantics: when BOTH day-of-month and
 * day-of-week are restricted a date matches if EITHER matches; otherwise the
 * restricted field (or `*`) applies. All supported policies restrict at most one
 * of the two, so this reduces to a simple AND for them.
 *
 * Split from the clock half because the walk steps DAYS: the date is constant
 * across a day, so re-deciding it every minute was most of the cost of a sparse
 * expression, and the whole-instant matcher it replaced had no other caller.
 */
function cronDateMatchesUtc(parsed: ParsedCron, instantMs: number): boolean {
  const d = new Date(instantMs);
  if (!parsed.months.has(d.getUTCMonth() + 1)) return false;
  const domRestricted = parsed.daysOfMonth.size < 31;
  const dowRestricted = parsed.daysOfWeek.size < 7;
  const domOk = parsed.daysOfMonth.has(d.getUTCDate());
  const dowOk = parsed.daysOfWeek.has(d.getUTCDay());
  return domRestricted && dowRestricted ? domOk || dowOk : domOk && dowOk;
}

/**
 * A RUNAWAY GUARD, not a policy.
 *
 * The walk steps whole days across the calendar and scans minutes only inside a
 * day the date fields match, so it does not need a bound tuned to any cadence —
 * which is what the previous design got wrong three times over. No SATISFIABLE
 * expression this parser accepts goes longer than eight years without firing
 * (`0 0 29 2 *` is the extreme), and `cronCalendarIsSatisfiable` rejects the
 * unsatisfiable ones outright, so this cap is unreachable in practice.
 */
const MAX_SLOT_LOOKBACK_DAYS = 9 * 366;

/**
 * The most recent fixed UTC schedule slot at or before `cutoffMs`. Deterministic
 * and pure: floors to the minute, then walks backward minute-by-minute checking
 * the parsed cron. Correct across minute/hour/day/month/year boundaries; DST is
 * irrelevant because every comparison is UTC.
 */
export function previousScheduleSlotMs(cron: string, cutoffMs: number): number {
  const floorMs = Math.floor(cutoffMs / MINUTE_MS) * MINUTE_MS;
  const notBeforeMs = floorMs - MAX_SLOT_LOOKBACK_DAYS * DAY_MS;
  const parsed = parseCron(cron);
  // An unreadable expression FAILS CLOSED, exactly as one matching nothing does:
  // it answers with an instant far in the past, so a coverage checker built on
  // this reads "does not fire here" rather than inventing a slot.
  const slot = parsed === null ? null : previousSlotWithin(parsed, floorMs, notBeforeMs);
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
  for (let days = 0; days <= MAX_SLOT_LOOKBACK_DAYS; days += 1) {
    if (instant < notBeforeMs) return null;
    const dayStartMs = Math.floor(instant / DAY_MS) * DAY_MS;
    // Minutes are scanned ONLY inside a day the calendar admits. Stepping every
    // minute across a sparse expression cost ~527,000 `Date` allocations per
    // schedule — measured at 132 ms of blocking CPU per job per render, on the
    // page of a project whose entire point is an Active CPU budget. Skipping a
    // non-matching day costs one date comparison.
    if (cronDateMatchesUtc(parsed, instant)) {
      // Minute and hour sets are non-empty by construction, so the first day the
      // calendar admits necessarily contains a firing.
      const stopMs = Math.max(dayStartMs, notBeforeMs);
      for (let candidate = instant; candidate >= stopMs; candidate -= MINUTE_MS) {
        const d = new Date(candidate);
        if (parsed.hours.has(d.getUTCHours()) && parsed.minutes.has(d.getUTCMinutes())) {
          return candidate;
        }
      }
    }
    instant = dayStartMs - MINUTE_MS;
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
  const governing = governingSchedule(fixedSchedules(job, nowMs).entries);
  // The fixed contract always measures, so this is production's own answer on
  // that branch — computed by the SAME resolver `buildDeliveryRow` uses, not a
  // second computation beside it.
  return Date.parse(governing?.requiredStartedAt ?? new Date(nowMs).toISOString());
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
 * Why one schedule, or a whole row, has no basis to judge delivery against.
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

/**
 * Which of a job's schedules one row entry describes. `fixed` is the pinned
 * contract every job carries today and the seven unowned jobs keep forever.
 */
export type SchedulerScheduleKind = 'fixed' | 'dense' | 'slow';

/**
 * ONE SCHEDULE'S STATE, and the unit the row is built out of.
 *
 * A job the planner owns runs TWO schedules that fail INDEPENDENTLY, and the
 * earlier design could not say so: the row carried a single reason under an
 * invariant that a reason blanked the row, so any uncertainty anywhere was
 * all-or-nothing. Three review findings across two rounds were that one defect
 * at different levels — an unknown span blanking the row, an `indeterminate`
 * dense upsert switching off `missing`/`late` for a job whose slow schedule was
 * fully determinate, and the planner's FIRST run blanking both rows for 176
 * measured minutes on the day slice 4's cutover begins. Per-schedule state is
 * the shape the data has.
 *
 * Three states, and the difference between the last two is the whole point:
 *
 * - MEASURED — `requiredStartedAt` is set, and `cron`/`graceMs` describe the
 *   expression that produced it.
 * - NOT DUE — the expression is known and has no slot whose grace has expired.
 *   An unknown PAST cannot create an obligation, so a schedule whose history is
 *   unreadable but whose present is known is not late; it is not yet due.
 * - UNAVAILABLE — the expression in force NOW is unknown or unusable, so
 *   nothing can be said about this schedule at all.
 */
export type SchedulerDeliveryScheduleView = {
  schedule: SchedulerScheduleKind;
  /**
   * The expression this entry describes — the one in force at
   * {@link requiredStartedAt} when measured, the one in force now when not due.
   * `null` only when no expression is known.
   */
  cron: string | null;
  /**
   * Two firing intervals of THIS expression — the one named in `cron`, not the
   * one in force now. The two differ whenever the slot belongs to a span the
   * planner has since replaced, and pairing them across expressions is what made
   * an hourly slot answerable in six minutes.
   */
  graceMs: number | null;
  /** The slot this schedule requires; `null` when nothing is due yet. */
  requiredStartedAt: string | null;
  /** Why this schedule has no basis; `null` when it is measured or not due. */
  unavailableReason: SchedulerPlanUnavailableReason | null;
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
 * How far back the recorded-timeline walk looks. One bound, chosen once.
 *
 * It was two, picked per expression, and that was the defect: the bound was
 * derived from the CURRENT cron while the walk crosses OLDER spans, so a monthly
 * schedule replaced by a daily one had its real obligation skipped by the daily
 * cron's narrower floor. Guessing a window per cadence is the wrong shape of
 * answer — the walk is now cheap because it steps DAYS over the calendar, so it
 * can afford the same generous bound for every expression.
 */
const PLANNER_SLOT_LOOKBACK_MS = MAX_SLOT_LOOKBACK_DAYS * DAY_MS;

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
  // Absence of evidence is not disagreement. `null` is the store's documented
  // first-run value, and unresolving on it would blank delivery health on the
  // first run of every new schedule id.
  if (nextPreviousCron === null) return inferred;
  switch (inferred.kind) {
    case 'cron':
      // Two direct claims about one span. Agreement confirms it; disagreement
      // means a row was dropped or the cron changed outside the planner, and
      // picking a side would be the guess this slice removes.
      return inferred.cron === nextPreviousCron
        ? inferred
        : { kind: 'unknown', reason: 'plan-incomplete' };
    case 'unknown':
      // THE OBSERVATION RESOLVES WHAT THE RUN COULD NOT. An `indeterminate` run
      // leaves two candidates — its intent, or the cron it was replacing — and
      // the next run's `previousCron` says which was live. A `refused` run with
      // no recorded previous cron leaves the same question, answered the same
      // way. Returning `unknown` here discarded evidence the record holds: a
      // known 22:00 obligation was dropped and a fourteen-hour-stale receipt
      // read `on-time`.
      return { kind: 'cron', cron: nextPreviousCron };
    case 'silent':
      // The record planned no schedule of this kind while the next run observed
      // one live. That is Item 102's item 5 surfacing as a conflict, and which
      // side governs is slice 4's decision, not this reader's.
      return { kind: 'unknown', reason: 'plan-incomplete' };
  }
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
    const parsed = parseCron(segment.state.cron);
    if (parsed === null) return { kind: 'unknown', reason: 'plan-unreadable' };
    const graceMs = 2 * schedule.stepMinutes * MINUTE_MS;
    const cutoffMs = nowMs - graceMs;
    if (segment.fromMs <= cutoffMs) {
      // `toMs` is exclusive, so the last instant this span governs is one
      // millisecond earlier; the walk floors to the minute from there.
      const slot = previousSlotWithin(
        parsed,
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
  /**
   * Whether the calendar fields admit EVERY day. "Once daily" is a claim about
   * the calendar, not the clock: `0 12 * * 2` fires once, on Tuesdays, and
   * labelling it "once daily" told an operator to expect it seven times a week.
   */
  everyDay: boolean;
};

function recordedScheduleFromCron(cron: string): RecordedSchedule | null {
  const parsed = parseCron(cron);
  if (parsed === null) return null;
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
  if (!cronCalendarIsSatisfiable(parsed)) return null;
  const minutes = [...parsed.minutes];
  return {
    cron,
    hours: [...parsed.hours].sort((a, b) => a - b),
    stepMinutes,
    dispatchMinute: minutes.length === 1 ? (minutes[0] ?? null) : null,
    everyDay:
      parsed.daysOfMonth.size === 31 && parsed.months.size === 12 && parsed.daysOfWeek.size === 7,
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
function describeRecordedSchedules(resolved: readonly ResolvedOneSchedule[]): string {
  const parts: string[] = [];
  for (const { view, currentCron } of resolved) {
    // No expression and no fault is a `dense: null` day: there is no schedule to
    // describe, and naming one would invent it.
    if (currentCron === null && view.unavailableReason === null) continue;
    const described =
      currentCron === null
        ? `${view.schedule} schedule unknown`
        : describeRecorded(recordedScheduleFromCron(currentCron));
    // Both schedules falling back to the SAME expression is a real shape — a
    // `refused` run leaves one cron governing both — and repeating its
    // description told the operator the job runs two identical schedules.
    if (!parts.includes(described)) parts.push(described);
  }
  return parts.length > 0 ? parts.join(', ') : PLAN_UNAVAILABLE_CADENCE_LABEL['plan-incomplete'];
}

function describeRecorded(schedule: RecordedSchedule | null): string {
  if (schedule === null) return 'schedule unreadable';
  const hourly = schedule.stepMinutes >= 60;
  const minute = String(schedule.dispatchMinute ?? 0).padStart(2, '0');
  // ONCE A DAY IS NOT HOURLY. An hourly step across a SINGLE hour fires once,
  // and this is the planner's own idle-slot shape (`pollingCron.ts`
  // IDLE_SLOW_HOUR, "a single daily slot, one wakeup") — so the label an
  // operator reads most often on a quiet day promised twenty-four firings where
  // there is one.
  if (hourly && schedule.hours.length === 1) {
    const hour = String(schedule.hours[0] ?? 0).padStart(2, '0');
    // "Daily" is the CALENDAR's word and only the calendar may say it; the
    // single firing is the CLOCK's fact and is true either way. Gating the whole
    // phrase on `everyDay` sent a weekly `0 12 * * 2` back to the "hourly"
    // fallback — twenty-four firings promised where there is one a week, the
    // same overstatement this branch was added to remove, one shape over.
    const once = schedule.everyDay
      ? `once daily (${hour}:${minute} UTC)`
      : `once at ${hour}:${minute} UTC`;
    return schedule.everyDay ? once : `${once}, on selected days`;
  }
  const cadence = hourly ? `hourly (:${minute})` : `every ${schedule.stepMinutes} min`;
  const clock =
    schedule.hours.length === HOURS_IN_A_DAY
      ? hourly
        ? `hourly (:${minute} UTC)`
        : `${cadence} (all day UTC)`
      : `${cadence} at ${describeRecordedHours(schedule.hours)} UTC`;
  // The hour ranges describe the CLOCK; a restricted day-of-month, month or
  // day-of-week narrows the CALENDAR, and saying nothing about it implied the
  // schedule runs every day. Not spelled out, because no planner run emits one
  // and inventing a calendar describer for a hand edit is not this slice's job —
  // but not silently overstated either.
  return schedule.everyDay ? clock : `${clock}, on selected days`;
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

/** One schedule's published entry, plus the expression it runs NOW. */
type ResolvedOneSchedule = {
  view: SchedulerDeliveryScheduleView;
  /** The expression in force now; `null` when none is known or none exists. */
  currentCron: string | null;
};

/** The schedules one row is built from. NEVER empty — every job has at least one. */
type ResolvedSchedules = {
  entries: SchedulerDeliveryScheduleView[];
  /** The label describing every schedule this job runs, unresolved ones included. */
  cadenceLabel: string;
};

/** The fixed contract as one schedule — the seven unowned jobs, and any job with no record. */
function fixedSchedules(job: ExternalSchedulerJob, nowMs: number): ResolvedSchedules {
  const policy = DELIVERY_POLICIES[job];
  const requiredMs = previousScheduleSlotMs(policy.cron, nowMs - policy.graceMs);
  return {
    cadenceLabel: policy.cadenceLabel,
    entries: [
      {
        schedule: 'fixed',
        cron: policy.cron,
        graceMs: policy.graceMs,
        requiredStartedAt: new Date(requiredMs).toISOString(),
        unavailableReason: null,
      },
    ],
  };
}

/**
 * One schedule's state, from the timeline the record establishes.
 *
 * UNAVAILABLE IS ABOUT THE PRESENT, NOT THE PAST. If the expression in force NOW
 * cannot be established or cannot be read, nothing can be said about this
 * schedule. But a walk that finds no slot — because an older span is silent, or
 * unknown, or the lookback runs out — means only that nothing is DUE: the
 * current expression is known, and an unknown past cannot create an obligation
 * the job could have missed. Collapsing those two is what blanked the row for a
 * measured 176 minutes on the planner's very first run.
 */
function resolveSchedule(
  series: PollingPlannerRunSeries,
  kind: ScheduleKind,
  nowMs: number
): ResolvedOneSchedule {
  const unavailable = (reason: SchedulerPlanUnavailableReason): ResolvedOneSchedule => ({
    currentCron: null,
    view: {
      schedule: kind,
      cron: null,
      graceMs: null,
      requiredStartedAt: null,
      unavailableReason: reason,
    },
  });

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
  if (!current) return unavailable('plan-incomplete');
  if (current.state.kind === 'unknown') return unavailable(current.state.reason);
  if (current.state.kind === 'silent') {
    // `dense: null` — no expression at all, under either reading Item 102's item
    // 5 leaves open. Not an error, and nothing to be late for.
    return {
      currentCron: null,
      view: {
        schedule: kind,
        cron: null,
        graceMs: null,
        requiredStartedAt: null,
        unavailableReason: null,
      },
    };
  }
  const schedule = recordedScheduleFromCron(current.state.cron);
  // A recorded expression no parser can read — a wrong field count, or a
  // calendar like `0 0 31 2 *` that no year satisfies — is a CORRUPT record, not
  // an absent one. Falling back to the fixed contract here would claim a firing
  // every three minutes while the real schedule is dark, which is inherited
  // item 3 exactly: a false alarm dressed as a real one.
  if (!schedule) return unavailable('plan-unreadable');

  const found = previousSlotInForce(segments, nowMs, nowMs - PLANNER_SLOT_LOOKBACK_MS);
  const graceMs = 2 * schedule.stepMinutes * MINUTE_MS;
  if (found.kind !== 'slot') {
    // Not due. The expression is known and published, so the row can still name
    // what this job is supposed to be running.
    return {
      currentCron: schedule.cron,
      view: {
        schedule: kind,
        cron: schedule.cron,
        graceMs,
        requiredStartedAt: null,
        unavailableReason: null,
      },
    };
  }
  return {
    // The label answers "what does this job run NOW"; the entry answers "what
    // produced this slot". They differ whenever the slot belongs to a span the
    // planner has since replaced, and conflating them made the Cadence line
    // describe an expression that is no longer installed.
    currentCron: schedule.cron,
    view: {
      schedule: kind,
      // `cron` and `graceMs` come from the SAME span as the slot, so the
      // published entry is internally consistent.
      cron: found.cron,
      graceMs: found.graceMs,
      requiredStartedAt: new Date(found.atMs).toISOString(),
      unavailableReason: null,
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
 *
 * A JOB'S TWO SCHEDULES FAIL INDEPENDENTLY and are resolved independently. One
 * of them losing its basis costs the row that schedule, never the row itself —
 * an `indeterminate` dense upsert used to switch off `missing` and `late` for a
 * job whose slow schedule was perfectly determinate, for up to a day.
 */
function resolveDeliverySchedules(
  job: ExternalSchedulerJob,
  nowMs: number,
  record: PollingPlannerReadResult
): ResolvedSchedules {
  if (!isPlannerOwnedJob(job) || record.kind === 'absent') return fixedSchedules(job, nowMs);
  const refuse = (reason: SchedulerPlanUnavailableReason): ResolvedSchedules => ({
    cadenceLabel: PLAN_UNAVAILABLE_CADENCE_LABEL[reason],
    entries: (['dense', 'slow'] as const).map((schedule) => ({
      schedule,
      cron: null,
      graceMs: null,
      requiredStartedAt: null,
      unavailableReason: reason,
    })),
  });
  if (record.kind === 'unreadable') return refuse('plan-unreadable');
  if (record.kind === 'failed') return refuse('plan-store-failed');
  if (record.series.runs.length === 0) return refuse('plan-incomplete');

  const resolved = [
    resolveSchedule(record.series, 'dense', nowMs),
    resolveSchedule(record.series, 'slow', nowMs),
  ];
  return {
    entries: resolved.map((entry) => entry.view),
    cadenceLabel: describeRecordedSchedules(resolved),
  };
}

/** The entry that decides the row: the latest required slot, else the first known expression. */
function governingSchedule(
  entries: readonly SchedulerDeliveryScheduleView[]
): SchedulerDeliveryScheduleView | null {
  let latest: SchedulerDeliveryScheduleView | null = null;
  for (const entry of entries) {
    if (entry.requiredStartedAt === null) continue;
    if (
      latest === null ||
      Date.parse(entry.requiredStartedAt) > Date.parse(latest.requiredStartedAt!)
    ) {
      latest = entry;
    }
  }
  // `max` over the measured schedules — item 2. One job runs one route from two
  // schedules, so a receipt satisfying only the slower one hides the faster
  // one's outage.
  if (latest !== null) return latest;
  return entries.find((entry) => entry.cron !== null) ?? null;
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
  const governing = governingSchedule(schedules.entries);
  // No basis AT ALL — every schedule this job has lost its expression. One
  // schedule failing is NOT this case: the row reports on the other and carries
  // the failure in that schedule's own entry.
  const planUnavailableReason =
    governing === null
      ? (schedules.entries.find((entry) => entry.unavailableReason !== null)?.unavailableReason ??
        'plan-incomplete')
      : null;
  const base = {
    job,
    source: schedulerSourceForJob(job),
    // Never the fixed contract on a refusal: its cadence is what the planner
    // replaced, and restating it is inherited item 3's false alarm.
    cron: governing?.cron ?? null,
    cadenceLabel: schedules.cadenceLabel,
    graceMs: governing?.graceMs ?? null,
    requiredStartedAt: governing?.requiredStartedAt ?? null,
    schedules: schedules.entries,
    planUnavailableReason,
  };

  if (entriesByJob === null) {
    return { ...base, deliveryState: 'unavailable', receipt: null };
  }
  if (!entriesByJob.has(job)) {
    // `missing` is a fact about the RECEIPT — none exists — and stays true
    // whatever the schedule is doing. Its issue text no longer assumes a
    // required slot, because a row with nothing due does not have one.
    return {
      ...base,
      deliveryState: planUnavailableReason === null ? 'missing' : 'unavailable',
      receipt: null,
    };
  }
  const receipt = parseSchedulerExecutionReceipt(entriesByJob.get(job), job, nowMs);
  if (receipt === null) {
    // `invalid` is also a receipt fact, reported even alongside a plan fault —
    // which the row still carries in `planUnavailableReason` and in `schedules`.
    return { ...base, deliveryState: 'invalid', receipt: null };
  }
  if (planUnavailableReason !== null) {
    // THE RECEIPT IS PUBLISHED. Withholding it made `schedulerExecutionIssues`
    // and `lifecycleIntegrityIssues` skip the job, so a planner-record failure
    // silently suppressed `scheduler-execution-failed` and
    // `lifecycle-data-unusable` for the two most important jobs. Execution
    // outcome and delivery TIMING are separate facts; only timing lost its basis.
    return { ...base, deliveryState: 'unavailable', receipt };
  }
  if (base.requiredStartedAt === null) {
    // NOTHING IS DUE — every schedule is known and none has a slot whose grace
    // has expired. A row with no obligation cannot be LATE, and an earlier
    // version concluded from that it must be `on-time`. It must not: `on-time`
    // asserts delivery is timely, and nothing here measured that.
    //
    // The asymmetry is what settles it. The same shape with NO receipt reports
    // `missing`, so absence raised a warning while a receipt five days stale
    // rendered a green "On time" dot — measured across thirteen hours of slice
    // 4's cutover morning, on the idle-slot shape `slowHoursFor` emits on any
    // day with dense hours and no reconciliation tail. That is the false alarm
    // this slice exists to remove, pointing the other way.
    //
    // `unavailable` is not a fault here; it is this module's word for "no basis
    // to judge", which is exactly the fact. The receipt travels with it, so the
    // row still shows when the job last ran, and no issue is raised for a state
    // nothing is wrong with.
    return { ...base, deliveryState: 'unavailable', receipt };
  }
  // Delivery timeliness is `startedAt` vs the required slot ONLY — never the
  // execution result/reason/provider flag/target, and never `updatedAt`.
  const deliveryState: SchedulerDeliveryState =
    Date.parse(receipt.startedAt) >= Date.parse(base.requiredStartedAt) ? 'on-time' : 'late';
  return { ...base, deliveryState, receipt };
}
