import type { PollingWindow } from '../schedule/pollingWindows.ts';
import {
  AppStateTxnCleanupError,
  AppStateTxnFinalizeError,
  getAppState,
  withAppStateKeyTransaction,
} from './appStateStore.ts';
import type { ExternalSchedulerJob } from './schedulerExecutionStatus.ts';

/**
 * PLATFORM-102 slice 3a — the durable record of what the polling planner derived
 * and what it sent.
 *
 * WHY THIS EXISTS. Today `scripts/lib/qstashSchedule.ts` holds each schedule's
 * cron as a FIXED constant and `inspect` diffs live QStash state against it, so
 * it can say a cron is CORRECT rather than merely CURRENT. That is also the
 * reconstructibility argument that justified putting `QSTASH_TOKEN` in the Vercel
 * environment at all: a stopped or retimed schedule is restorable from the repo.
 * Slice 4 makes the cron planner-owned and rewrites it daily, which destroys both
 * properties at once — the job that most needs a tampering signal becomes the one
 * without one. This record is the replacement: `inspect` diffs against the last
 * recorded INTENT instead of a constant that no longer exists.
 *
 * WHY DURABLE AND NOT A RUNTIME LOG. Vercel runtime logs expire far too fast to
 * serve as incident history. That is Item 126's layer 2, and rebuilding the same
 * defect in a new place is explicitly out of bounds for this item.
 *
 * WHY A BOUNDED SERIES AND NOT LATEST-ONLY. "When did this cron start diverging"
 * is the question the record exists to answer, and latest-only cannot answer it.
 * The planner writes once a day per job, so {@link POLLING_PLANNER_MAX_RUNS} is
 * roughly six months — a season plus the offseason either side. `inspect` reads
 * only the newest entry, which is a subset of what is kept.
 *
 * ALLOWLIST-ONLY, AND WHY A DENYLIST WILL NOT DO. `buildUpsertRequest` carries
 * TWO secrets in its header block — `Authorization: Bearer <QSTASH_TOKEN>` and
 * `Upstash-Forward-Authorization: Bearer <CRON_SECRET>`. QStash redacts only the
 * second, only in ITS OWN readable state, and only through the
 * `Upstash-Redact-Fields: header[Authorization]` field set in the same request —
 * none of which touches the plaintext object this process holds. So every stored
 * field here is an explicit per-field copy of a closed operational primitive
 * ({@link projectPlannerScheduleIntent}), never a spread and never a header,
 * request or response body. A denylist fails open the moment a header is added;
 * an allowlist fails closed the moment a field is.
 *
 * NOTHING IN PRODUCTION WRITES A RECORD. Slice 3a ships dormant: no route, no
 * cron and no CLI calls {@link recordPollingPlannerRun}. Records are written by
 * tests only until slice 4 activates the planner.
 *
 * SCOPE OF THIS MODULE: storage and parsing. Slice 3b owns INTERPRETATION — the
 * non-extrapolating delivery slot, the two-cron row, and corrupt-plan surfacing.
 * {@link readPollingPlannerRuns} hands 3b the series and stops there.
 */

export const POLLING_PLANNER_RECORD_SCOPE = 'polling-planner-record';

/**
 * ~400 runs at one planner run per day is about six months per job, bounded the
 * way `providerUsageSeries` bounds its own series: trimmed on every write, so the
 * bound is structural and there is no cleanup job to forget.
 */
export const POLLING_PLANNER_MAX_RUNS = 400;

/**
 * The durable key for one job's series.
 *
 * The KEY carries the job identity and the rows do not, so a row can never claim
 * a job different from the one it is filed under. Typed to
 * `ExternalSchedulerJob` — the same nine-job identity space the Item 126 receipts
 * use, which is what makes `invocationId` correlation meaningful — rather than to
 * the two-job `PlannerOwnedJob` union. That union lives in
 * `schedulerDeliveryHealth.ts`, which slice 3b makes a CONSUMER of this store;
 * importing it here would make the consumer a dependency of its own source.
 * Deciding which jobs the planner owns is the planner's job, not the store's.
 */
export function pollingPlannerRecordKey(job: ExternalSchedulerJob): string {
  return job;
}

/**
 * The allowlisted projection of ONE QStash schedule the planner intended to
 * provision. These five fields are exactly what `evaluateScheduleContract`
 * compares a live readback against, which is what makes the record a drop-in
 * replacement for the fixed contract.
 */
export type PlannerScheduleIntent = {
  /** `Upstash-Schedule-Id` — the pinned identity that makes upsert idempotent. */
  scheduleId: string;
  /** The exact route URL QStash calls. */
  destination: string;
  /** The synthesized cron expression for this run. */
  cron: string;
  /** The HTTP method QStash uses to call the route. */
  method: string;
  /** Scheduler-level retries. */
  retries: number;
};

/** Whether the planner sent the upsert or left the live schedule alone. */
export type PlannerScheduleAction = 'applied' | 'skipped';

/**
 * What became of one schedule on one planner run. The vocabulary is the CLI's own
 * exit-code vocabulary so the two can never describe the same event differently:
 * `confirmed` (exit 0), `unchanged` (a deliberate skip), `refused` (exit 2),
 * `failed` (exit 3 — fail closed, nothing sent), `indeterminate` (exit 4 — the
 * mutation MAY or may not have landed, and nothing downstream may round that to
 * either).
 */
export type PlannerScheduleOutcome =
  | 'confirmed'
  | 'unchanged'
  | 'refused'
  | 'failed'
  | 'indeterminate';

export type PlannerScheduleRun = {
  /** What the planner derived and would send. */
  intent: PlannerScheduleIntent;
  /**
   * The cron in force before this run, or null when it could not be established
   * (a first run, or a schedule QStash had not yet been asked about). Recorded so
   * a later reader never has to EXTRAPOLATE a previous cron from a current one —
   * the defect slice 3b exists to fix.
   */
  previousCron: string | null;
  action: PlannerScheduleAction;
  outcome: PlannerScheduleOutcome;
};

export type PollingPlannerRun = {
  /** When the planner ran, normalized ISO. The only ordering key. */
  at: string;
  /**
   * Item 126 Tier A correlation, and `string | null` on purpose:
   * `createSchedulerInvocationId` (`schedulerExecutionStatus.ts:331`) returns null
   * when UUID generation fails, and a planner record must never be lost to that.
   * Correlation is best-effort, exactly as the receipt is.
   */
  invocationId: string | null;
  /** Midnight UTC of the day planned — `utcHoursCovered`'s own contract. */
  dayStartMs: number;
  /** The input windows the plan was derived from. */
  windows: PollingWindow[];
  /**
   * The dense schedule, or null when the planning day has no dense hours at all.
   * Mirrors `PollingCronPlan.dense`, which is nullable for the same reason: a
   * schedule that should not fire is absent, never an expression that fires
   * nowhere.
   */
  dense: PlannerScheduleRun | null;
  /** The slow schedule. Always present — no cron expression can mean "never". */
  slow: PlannerScheduleRun;
};

export type PollingPlannerRunSeries = { runs: PollingPlannerRun[] };

// ---------------------------------------------------------------------------
// Projection (the write side of the allowlist)
// ---------------------------------------------------------------------------

/**
 * Copy the five allowlisted schedule fields and NOTHING else.
 *
 * The parameter is deliberately structural, so a caller may hand this the whole
 * upsert request, or a contract spread over a synthesized cron, or any wider
 * object that happens to satisfy the five fields — and every surplus key,
 * `headers` above all, is discarded because it is never read. Written as five
 * explicit assignments rather than a spread or a denylist: a spread carries
 * whatever it is given, and a denylist starts failing open the day a header is
 * added upstream.
 */
export function projectPlannerScheduleIntent(source: PlannerScheduleIntent): PlannerScheduleIntent {
  return {
    scheduleId: source.scheduleId,
    destination: source.destination,
    cron: source.cron,
    method: source.method,
    retries: source.retries,
  };
}

/** The same per-field discipline for a window. */
export function projectPollingWindow(window: PollingWindow): PollingWindow {
  return {
    startMs: window.startMs,
    denseEndMs: window.denseEndMs,
    slowEndMs: window.slowEndMs,
    kickoffCount: window.kickoffCount,
  };
}

/**
 * The ONE place a planner run becomes a stored row, so what the planner reports
 * and what is written down cannot disagree.
 *
 * `plannedRunsPerDay` is deliberately NOT stored even though `pollingCron.ts`
 * anticipates it: it is derivable from the cron already here, and a stored copy
 * is a second source of truth that can disagree with the expression it describes.
 */
export function buildPollingPlannerRun(input: {
  at: Date;
  invocationId: string | null;
  dayStartMs: number;
  windows: readonly PollingWindow[];
  dense: PlannerScheduleRun | null;
  slow: PlannerScheduleRun;
}): PollingPlannerRun {
  return {
    at: input.at.toISOString(),
    invocationId: input.invocationId,
    dayStartMs: input.dayStartMs,
    windows: input.windows.map(projectPollingWindow),
    dense: input.dense === null ? null : projectPlannerScheduleRun(input.dense),
    slow: projectPlannerScheduleRun(input.slow),
  };
}

function projectPlannerScheduleRun(run: PlannerScheduleRun): PlannerScheduleRun {
  return {
    intent: projectPlannerScheduleIntent(run.intent),
    previousCron: run.previousCron,
    action: run.action,
    outcome: run.outcome,
  };
}

// ---------------------------------------------------------------------------
// Parsing (the read side)
// ---------------------------------------------------------------------------
//
// Every scalar below is validated to a shape narrow enough to PRINT, because
// `inspect` renders the recorded intent in its summary and in its divergence
// messages. A field that reached those sinks unvalidated would turn the record
// into an injection channel for the one output the operator reads while
// diagnosing a tampering signal.

const MAX_CRON_LENGTH = 120;
const MAX_SCHEDULE_ID_LENGTH = 120;
const MAX_DESTINATION_LENGTH = 300;
const MAX_RETRIES = 10;

/** Cron fields only: digits, `*`, `/`, `,`, `-` and single spaces. */
const CRON_PATTERN = /^[0-9*/,\- ]+$/;
const SCHEDULE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const METHOD_PATTERN = /^[A-Z]{3,10}$/;

function parseCronExpression(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_CRON_LENGTH) return null;
  if (!CRON_PATTERN.test(value)) return null;
  if (value.trim().length === 0) return null;
  return value;
}

function parseScheduleId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_SCHEDULE_ID_LENGTH) return null;
  return SCHEDULE_ID_PATTERN.test(value) ? value : null;
}

/**
 * A destination must parse as an https origin-and-path URL with no embedded
 * userinfo — the same fail-closed instinct as `resolveQstashBase`, for the same
 * reason: this string is echoed to an operator, and a credential can be smuggled
 * in a URL's userinfo without looking like one.
 */
function parseDestination(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_DESTINATION_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return value;
}

function parseMethod(value: unknown): string | null {
  return typeof value === 'string' && METHOD_PATTERN.test(value) ? value : null;
}

function parseRetries(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return null;
  return value >= 0 && value <= MAX_RETRIES ? value : null;
}

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseIntent(value: unknown): PlannerScheduleIntent | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const scheduleId = parseScheduleId(record.scheduleId);
  const destination = parseDestination(record.destination);
  const cron = parseCronExpression(record.cron);
  const method = parseMethod(record.method);
  const retries = parseRetries(record.retries);
  if (
    scheduleId === null ||
    destination === null ||
    cron === null ||
    method === null ||
    retries === null
  ) {
    return null;
  }
  return { scheduleId, destination, cron, method, retries };
}

const ACTIONS: ReadonlySet<string> = new Set<PlannerScheduleAction>(['applied', 'skipped']);
const OUTCOMES: ReadonlySet<string> = new Set<PlannerScheduleOutcome>([
  'confirmed',
  'unchanged',
  'refused',
  'failed',
  'indeterminate',
]);

function parseScheduleRun(value: unknown): PlannerScheduleRun | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const intent = parseIntent(record.intent);
  if (intent === null) return null;
  const previousCron =
    record.previousCron === null || record.previousCron === undefined
      ? null
      : parseCronExpression(record.previousCron);
  // `undefined`/`null` are a legitimate "not established"; anything present and
  // unusable is corruption, and silently reading it as "unknown" would let a
  // damaged row masquerade as a first run.
  if (previousCron === null && record.previousCron !== null && record.previousCron !== undefined) {
    return null;
  }
  const action =
    typeof record.action === 'string' && ACTIONS.has(record.action) ? record.action : null;
  const outcome =
    typeof record.outcome === 'string' && OUTCOMES.has(record.outcome) ? record.outcome : null;
  if (action === null || outcome === null) return null;
  return {
    intent,
    previousCron,
    action: action as PlannerScheduleAction,
    outcome: outcome as PlannerScheduleOutcome,
  };
}

/**
 * Window bounds mirror `synthesizePollingCrons`' own `validWindows` exactly —
 * finite, and `startMs <= denseEndMs <= slowEndMs`. Both failure modes are silent
 * downstream: a NaN bound fails every overlap test, so an armed day degrades to
 * the offseason shape and nothing throws for a fallback to catch.
 */
function parseWindow(value: unknown): PollingWindow | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const startMs = parseFiniteNumber(record.startMs);
  const denseEndMs = parseFiniteNumber(record.denseEndMs);
  const slowEndMs = parseFiniteNumber(record.slowEndMs);
  const kickoffCount = record.kickoffCount;
  if (startMs === null || denseEndMs === null || slowEndMs === null) return null;
  if (!(startMs <= denseEndMs && denseEndMs <= slowEndMs)) return null;
  if (typeof kickoffCount !== 'number' || !Number.isSafeInteger(kickoffCount) || kickoffCount < 0) {
    return null;
  }
  return { startMs, denseEndMs, slowEndMs, kickoffCount };
}

/**
 * One stored run.
 *
 * A window that fails to parse DROPS THE WHOLE ROW rather than being skipped. The
 * windows are the plan's input, so a row missing one of them is not a smaller
 * true statement — it is a false one, and the record's entire purpose is to say
 * what the planner actually derived.
 *
 * `invocationId` is the exception: an unusable value degrades to null instead of
 * discarding the row, because correlation is best-effort and losing the record
 * costs more than losing the link to a receipt.
 */
function parseRun(value: unknown): PollingPlannerRun | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const raw = typeof record.at === 'string' ? record.at : '';
  if (!raw) return null;
  const parsedAt = Date.parse(raw);
  if (Number.isNaN(parsedAt)) return null;
  const dayStartMs = parseFiniteNumber(record.dayStartMs);
  if (dayStartMs === null) return null;
  if (!Array.isArray(record.windows)) return null;
  const windows: PollingWindow[] = [];
  for (const entry of record.windows) {
    const window = parseWindow(entry);
    if (window === null) return null;
    windows.push(window);
  }
  const slow = parseScheduleRun(record.slow);
  if (slow === null) return null;
  const dense =
    record.dense === null || record.dense === undefined ? null : parseScheduleRun(record.dense);
  if (dense === null && record.dense !== null && record.dense !== undefined) return null;
  return {
    // NORMALIZED to the canonical UTC form rather than stored verbatim. Ordering
    // is lexicographic, which is chronological only for that shape, so a row
    // written by an older build or edited by hand would otherwise sort into the
    // wrong place and then be trimmed from the wrong end by the bound.
    at: new Date(parsedAt).toISOString(),
    invocationId:
      typeof record.invocationId === 'string' && record.invocationId.length > 0
        ? record.invocationId
        : null,
    dayStartMs,
    windows,
    dense,
    slow,
  };
}

/**
 * Tolerant of anything: a malformed stored value yields an EMPTY series rather
 * than throwing. On a READ that is right — degrade rather than take a caller
 * down. It is NOT right on a write; see {@link readPollingPlannerRunsForWrite}.
 */
export function parsePollingPlannerRuns(value: unknown): PollingPlannerRunSeries {
  if (typeof value !== 'object' || value === null) return { runs: [] };
  const raw = (value as { runs?: unknown }).runs;
  if (!Array.isArray(raw)) return { runs: [] };
  const runs: PollingPlannerRun[] = [];
  for (const entry of raw) {
    const run = parseRun(entry);
    if (run) runs.push(run);
  }
  return runs.length > 0 ? sortAndBound(runs) : { runs: [] };
}

/**
 * Sort by time and enforce the bound. `sort` is stable, so runs sharing an `at`
 * keep insertion order, and nothing is deduplicated — two planner runs in the
 * same millisecond is a redelivery worth seeing, not a collision worth hiding.
 */
function sortAndBound(runs: PollingPlannerRun[]): PollingPlannerRunSeries {
  const sorted = [...runs].sort((a, b) => a.at.localeCompare(b.at));
  return { runs: sorted.slice(-POLLING_PLANNER_MAX_RUNS) };
}

/** Append one run. Sorting and the bound are applied to the whole set. */
export function appendPollingPlannerRun(
  series: PollingPlannerRunSeries,
  run: PollingPlannerRun
): PollingPlannerRunSeries {
  return sortAndBound([...series.runs, run]);
}

/**
 * The WRITE-path read, which — unlike {@link parsePollingPlannerRuns} — refuses
 * to treat an unusable stored value as an empty one.
 *
 * The tolerant reader returns `{runs: []}` for anything it cannot understand. On
 * a WRITE that is catastrophic: the append would write a one-entry array over six
 * months of planner history and report success, destroying the record that exists
 * precisely to answer "when did this cron start diverging".
 *
 * ABSENT is still fine — that is a first write. Individual unparseable ROWS are
 * still dropped tolerantly, because they are bounded and independently validated,
 * and failing closed on one bad row would stop the planner recording anything
 * ever again. Only a value that is PRESENT and yields nothing is refused.
 */
export function readPollingPlannerRunsForWrite(
  value: unknown
): { ok: true; series: PollingPlannerRunSeries } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, series: { runs: [] } };
  if (typeof value !== 'object') return { ok: false };
  const raw = (value as { runs?: unknown }).runs;
  if (!Array.isArray(raw)) return { ok: false };
  const parsed = parsePollingPlannerRuns(value);
  if (raw.length > 0 && parsed.runs.length === 0) return { ok: false };
  return { ok: true, series: parsed };
}

// ---------------------------------------------------------------------------
// Durable read / write
// ---------------------------------------------------------------------------

/** Thrown inside the write transaction to abort it without clobbering the row. */
class PollingPlannerRecordUnreadableError extends Error {
  constructor() {
    super('polling planner record is present but unreadable');
    this.name = 'PollingPlannerRecordUnreadableError';
  }
}

/**
 * `recorded` — durably stored. `not-recorded` — durably absent. `unreadable` —
 * a present prior could not be read, so nothing was written and the stored value
 * is exactly as it was found. `indeterminate` — genuinely unknown, and nothing
 * downstream may round it to either.
 */
export type PollingPlannerWriteOutcome =
  | 'recorded'
  | 'not-recorded'
  | 'indeterminate'
  | 'unreadable';

export async function recordPollingPlannerRun(
  job: ExternalSchedulerJob,
  run: PollingPlannerRun
): Promise<PollingPlannerWriteOutcome> {
  try {
    // Read, append and write inside one key transaction. Read-modify-write
    // outside a lock is last-write-wins: Postgres upserts do not compare, and the
    // file store's lock begins inside the write, after the read.
    await withAppStateKeyTransaction(
      POLLING_PLANNER_RECORD_SCOPE,
      pollingPlannerRecordKey(job),
      async (txn) => {
        const record = await txn.read<unknown>();
        const prior = readPollingPlannerRunsForWrite(record?.value);
        // Abort rather than append onto an empty stand-in for a row we could not
        // read. The throw rolls the transaction back, so the stored value is left
        // exactly as found for an operator to inspect.
        if (!prior.ok) throw new PollingPlannerRecordUnreadableError();
        await txn.write(appendPollingPlannerRun(prior.series, run));
      }
    );
    return 'recorded';
  } catch (error) {
    if (error instanceof PollingPlannerRecordUnreadableError) return 'unreadable';
    // A COMMIT or ROLLBACK failing AFTER mutation SQL was submitted leaves
    // durability genuinely unknown — `appStateStore` sets the threshold at
    // `writeAttempted` precisely because a submitted mutation may have executed
    // server-side. That uncertainty is REPORTED, not guessed at.
    const uncertain =
      (error instanceof AppStateTxnFinalizeError || error instanceof AppStateTxnCleanupError) &&
      error.writeAttempted;
    return uncertain ? 'indeterminate' : 'not-recorded';
  }
}

/**
 * The store's read, and the whole of what slice 3a exposes to a reader.
 *
 * FOUR STATES, because collapsing any two of them is the defect this slice
 * exists to prevent. `absent` is a job the planner has never run and is the ONLY
 * state that licenses a fallback to a fixed constant. `unreadable` (present but
 * yielding nothing) and `failed` (the store itself could not be read) are
 * refusals: treating either as absence turns a broken record into a permanent
 * false "correct" on the one job that most needs a tampering signal.
 *
 * DELIBERATELY NOT BUILT: `getPreviousCronForDay(job, day)` or anything shaped
 * like it. Deriving "what cron was in force on day D" is slice 3b's, and its
 * requirements are not settled until 3b works out how one delivery row consumes
 * two crons. Guessing at them from a slice away is speculative generality.
 */
export type PollingPlannerReadResult =
  | { kind: 'absent' }
  | { kind: 'ok'; series: PollingPlannerRunSeries }
  | { kind: 'unreadable' }
  | { kind: 'failed' };

export async function readPollingPlannerRuns(
  job: ExternalSchedulerJob
): Promise<PollingPlannerReadResult> {
  let record: { value: unknown } | null;
  try {
    record = await getAppState<unknown>(POLLING_PLANNER_RECORD_SCOPE, pollingPlannerRecordKey(job));
  } catch {
    return { kind: 'failed' };
  }
  if (record === null || record.value === null || record.value === undefined) {
    return { kind: 'absent' };
  }
  const parsed = readPollingPlannerRunsForWrite(record.value);
  if (!parsed.ok) return { kind: 'unreadable' };
  // A present row that parses to nothing was already refused above; an empty
  // stored series is a real, readable state and is returned as such.
  return { kind: 'ok', series: parsed.series };
}

/**
 * The newest recorded intent for one schedule id, or null if the series holds
 * none.
 *
 * This is a LOOKUP by stored key, not an interpretation of history: it answers
 * "what did the planner last intend for this schedule", which is exactly what
 * `inspect` diffs against, and it answers nothing about which cron was in force
 * at any given instant. Both schedules of a run are searched because a
 * planner-owned job has two — a dense schedule and a slow one — under one job
 * key.
 */
export function latestRecordedIntentForSchedule(
  series: PollingPlannerRunSeries,
  scheduleId: string
): PlannerScheduleIntent | null {
  for (let index = series.runs.length - 1; index >= 0; index -= 1) {
    const run = series.runs[index];
    if (!run) continue;
    if (run.slow.intent.scheduleId === scheduleId) return run.slow.intent;
    if (run.dense && run.dense.intent.scheduleId === scheduleId) return run.dense.intent;
  }
  return null;
}
