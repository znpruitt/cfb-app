import {
  deliveryExpectationForPlan,
  synthesizePollingCrons,
  type PollingCronPlan,
} from '@/lib/schedule/pollingCron';
import type { PollingWindow } from '@/lib/schedule/pollingWindows';
import { getAppStateEntries } from '@/lib/server/appStateStore';
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
 * most recent fixed UTC schedule slot at/before (`now − grace`) — never from the
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
  cron: string;
  cadenceLabel: string;
  graceMs: number;
  /** The most recent fixed UTC slot at/before (`now − grace`); a valid receipt at/after it is on-time. */
  requiredStartedAt: string;
  deliveryState: SchedulerDeliveryState;
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
 * DO NOT WIRE A PLAN HERE BEFORE SLICE 3. The hazard is named at this call site
 * rather than only in the module it comes from, because this parameter is the one
 * thing standing between a stored plan and a live delivery row:
 * `previousScheduleSlotMs` extrapolates a DAILY-REWRITTEN cron backwards onto a
 * day that ran a different plan, so a derived policy reports roughly nineteen
 * hours of false `late` on an ordinary game day, and hides a fifteen-hour outage
 * in the other direction. Slice 3 owns the fix — delivery health reading what the
 * planner actually scheduled — and only then should a caller pass this.
 *
 * A SYNTHESIS FAILURE DEGRADES ONE ROW, never the page. Slice 3 is the slice that
 * starts storing plan data, so a stored `dayStartMs` off by a second is a real
 * future input; synthesis refuses it deliberately, and that refusal must not
 * escape through `readSchedulerDeliveryHealth` and `buildSystemHealthViewModel`
 * to take System Health down. The row falls back to the fixed contract, which is
 * the same shape every other job publishes. Surfacing the corruption itself
 * belongs to slice 3, which owns the record it came from.
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
  const parsed = parseCron(cron);
  let instant = Math.floor(cutoffMs / MINUTE_MS) * MINUTE_MS;
  for (let i = 0; i <= MAX_SLOT_LOOKBACK_MINUTES; i++) {
    if (cronMatchesUtc(parsed, instant)) return instant;
    instant -= MINUTE_MS;
  }
  // Unreachable for the supported policies; degrade to the floored cutoff.
  return instant;
}

/** The slot a valid receipt must reach to be on-time: `previousSlot(now − grace)`. */
function requiredStartedAtMs(policy: SchedulerDeliveryPolicy, nowMs: number): number {
  return previousScheduleSlotMs(policy.cron, nowMs - policy.graceMs);
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
  return requiredStartedAtMs(schedulerDeliveryPolicy(job), nowMs);
}

// ---------------------------------------------------------------------------
// Cache-only reader (PLATFORM-086F2E2B §6).

/** An injected entries-loader seam for deterministic read/parse tests. */
export type SchedulerEntriesLoader = () => Promise<ReadonlyArray<{ key: string; value: unknown }>>;

export type SchedulerDeliveryHealthOptions = {
  /** ONE clock captured for the whole snapshot (never `Date.now()` per job). */
  nowMs?: number;
  /** Overrides the durable scope read (tests inject fixtures / a throwing loader). */
  loadEntries?: SchedulerEntriesLoader;
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

  let entriesByJob: Map<string, unknown> | null;
  try {
    const entries = await load();
    entriesByJob = new Map(entries.map((entry) => [entry.key, entry.value]));
  } catch {
    // The scope read itself failed — every job is `unavailable`; the thrown
    // storage error and any partial durable value are never exposed.
    entriesByJob = null;
  }

  const jobs = EXTERNAL_SCHEDULER_JOBS.map((job) => buildDeliveryRow(job, entriesByJob, nowMs));
  return { generatedAt: new Date(nowMs).toISOString(), jobs };
}

function buildDeliveryRow(
  job: ExternalSchedulerJob,
  entriesByJob: Map<string, unknown> | null,
  nowMs: number
): SchedulerDeliveryHealthRow {
  const policy = schedulerDeliveryPolicy(job);
  const requiredMs = requiredStartedAtMs(policy, nowMs);
  const base = {
    job: policy.job,
    source: policy.source,
    cron: policy.cron,
    cadenceLabel: policy.cadenceLabel,
    graceMs: policy.graceMs,
    requiredStartedAt: new Date(requiredMs).toISOString(),
  };

  if (entriesByJob === null) {
    return { ...base, deliveryState: 'unavailable', receipt: null };
  }
  if (!entriesByJob.has(job)) {
    return { ...base, deliveryState: 'missing', receipt: null };
  }
  const receipt = parseSchedulerExecutionReceipt(entriesByJob.get(job), job, nowMs);
  if (receipt === null) {
    return { ...base, deliveryState: 'invalid', receipt: null };
  }
  // Delivery timeliness is `startedAt` vs the required slot ONLY — never the
  // execution result/reason/provider flag/target, and never `updatedAt`.
  const deliveryState: SchedulerDeliveryState =
    Date.parse(receipt.startedAt) >= requiredMs ? 'on-time' : 'late';
  return { ...base, deliveryState, receipt };
}
