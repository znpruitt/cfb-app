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
 * roughly THIRTEEN months — a season plus the offseason either side. `inspect`
 * reads only the newest entry, which is a subset of what is kept.
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
 * ~400 runs at one planner run per day is about THIRTEEN months per job — a
 * season plus the offseason either side, which is the horizon this is sized for.
 * (An earlier comment said "six months"; 400 days is not six months, and the
 * constant was never the thing that was wrong. `providerUsageSeries` states its
 * own bound the same way: 1,700 samples at four a day is ~14 months.) Trimmed on
 * every write, so the bound is structural and there is no cleanup job to forget.
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

export type PollingPlannerRunSeries = {
  runs: PollingPlannerRun[];
  /**
   * How many stored rows have EVER been discarded as unparseable, cumulative
   * across every write — owner decision 2026-09-06, and the smallest honest
   * answer to a real hole.
   *
   * Row-level tolerance means a damaged row is dropped so one bad row cannot stop
   * the planner recording forever. The complaint review raised is not that rows
   * are dropped but that they were dropped SILENTLY: below the refusal threshold
   * the write reports `recorded` while history quietly shrinks. This counts them,
   * so a later reader can see that loss happened and how much — and read roughly
   * WHEN off the gap in the retained rows' `at` values.
   *
   * It deliberately does NOT change the drop semantics. Preserving unparsed rows
   * verbatim is the better end state, but `providerUsageSeries` carries the
   * identical exposure and changing one twin leaves two behaviours for one
   * problem — so that is filed as its own item covering both stores, not decided
   * here. Absent on rows written before this field, which reads as 0.
   */
  droppedRuns: number;
};

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
  return projectPollingPlannerRun({
    at: input.at.toISOString(),
    invocationId: input.invocationId,
    dayStartMs: input.dayStartMs,
    windows: [...input.windows],
    dense: input.dense,
    slow: input.slow,
  });
}

/**
 * The allowlist AT THE SINK.
 *
 * Both reviewers found the same defect independently, and it was one mistake
 * rather than two: the projection lived in {@link buildPollingPlannerRun}, which
 * is an OPTIONAL constructor. TypeScript's excess-property check fires only on
 * object literals, so a caller assembling a run from a variable — a contract
 * spread over a request, say — could hand `recordPollingPlannerRun` a
 * structurally wider object, and every surplus key including `headers` would be
 * serialized into the durable row verbatim. A guarantee enforced at a
 * constructor is a convention; enforced here, on the one path every stored run
 * passes through, it is a property.
 */
export function projectPollingPlannerRun(run: PollingPlannerRun): PollingPlannerRun {
  return {
    at: run.at,
    invocationId: run.invocationId,
    dayStartMs: run.dayStartMs,
    windows: run.windows.map(projectPollingWindow),
    dense: run.dense === null ? null : projectPlannerScheduleRun(run.dense),
    slow: projectPlannerScheduleRun(run.slow),
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
// EVERY FIELD IS VALIDATED AGAINST ITS CONSUMER'S CONTRACT, not against a
// hand-chosen notion of well-formedness. That distinction is the second review
// round's root cause: validating each field to what LOOKED reasonable admitted
// values that a specific downstream consumer forbids, and each round then found
// the next such value rather than the last one. Stated per field:
//
//   at            → the sole ordering key AND the bound. Must be a parseable
//                   instant that is not implausibly FUTURE: `sortAndBound` keeps
//                   the newest at the tail, so one future-dated row pins the
//                   comparison basis forever while valid runs are trimmed off the
//                   old end. `schedulerExecutionStatus` reached the same
//                   conclusion for the same reason (`PRIOR_FUTURE_SKEW_TOLERANCE_MS`).
//   dayStartMs    → `synthesizePollingCrons`, whose `validDayStart` requires an
//                   EXACT UTC midnight because an offset rotates the whole hour
//                   field — the same window at 06:00Z arms hours 13-21 instead of
//                   19-23. An earlier version of this parser accepted any finite
//                   value on the theory that the record should preserve evidence
//                   of a planner defect. That was wrong: a preserved-but-unmarked
//                   corrupt day is indistinguishable from a good one to the
//                   consumer, and Item 102's own rule is that a corrupt plan must
//                   SURFACE rather than be used. Refusing is now visible, because
//                   the row is counted in `droppedRuns`.
//   windows       → `validWindows`: finite and `start <= denseEnd <= slowEnd`.
//   intent.*      → an operator's TERMINAL, via `inspect`'s summary and its
//                   divergence messages. See {@link hasUnsafeCharacter}.
//   invocationId  → correlation only, never printed, so it degrades to null
//                   rather than costing the row.

const MAX_CRON_LENGTH = 120;
const MAX_SCHEDULE_ID_LENGTH = 120;
const MAX_DESTINATION_LENGTH = 300;
/**
 * How far past real time a stored `at` may be before the row is corruption.
 * Mirrors `schedulerExecutionStatus`'s `PRIOR_FUTURE_SKEW_TOLERANCE_MS` and its
 * reasoning: a legitimate row is stamped at its own run instant, so a value
 * meaningfully ahead of now is a damaged row or a foreign writer — and unlike a
 * merely-old timestamp, which self-heals on the next run, a future one PINS the
 * newest end of the series indefinitely.
 */
export const POLLING_PLANNER_FUTURE_SKEW_MS = 5 * 60 * 1000;

/** `synthesizePollingCrons`' own day unit; `validDayStart` is modulo this. */
const DAY_MS = 24 * 60 * 60 * 1000;

const MAX_METHOD_LENGTH = 10;
const MAX_RETRIES = 10;

/** Cron fields only: digits, `*`, `/`, `,`, `-` and single spaces. */
const CRON_PATTERN = /^[0-9*/,\- ]+$/;
const SCHEDULE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;
const METHOD_PATTERN = /^[A-Z]{3,10}$/;

/**
 * C0 controls, DEL, and the C1 range. Checked EXPLICITLY rather than left to the
 * field patterns, because one field is not pattern-matched at all.
 *
 * `parseDestination` validates through `new URL()`, and `new URL()` SILENTLY
 * ACCEPTS embedded control characters — it strips `\n`, `\r` and `\t` and
 * percent-encodes ESC when producing `.href`, but the constructor does not throw.
 * The parser then returned the ORIGINAL string, so the normalization never
 * touched the value that was stored and later printed. Measured:
 * `https://turfwar.games/a\nREFUSED: forged line` parses clean, and
 * `inspect`'s divergence message interpolates it verbatim — letting a corrupt
 * record forge an output line or emit terminal escapes during the exact
 * diagnosis that output exists for.
 */
/**
 * Characters that are unsafe in the CONSUMER of these strings — an operator's
 * terminal — rather than characters that merely look unusual.
 *
 * Deriving the class from the consumer is what this round corrected. The first
 * pass covered C0, DEL and C1, which is what "control character" suggests; it
 * missed U+2028 and U+2029, which terminate a line in several renderers, and the
 * bidi overrides, which visually reorder text so a value can read as something it
 * is not. `new URL()` accepts EVERY one of them — measured:
 *
 *   U+2028 LINE SEPARATOR | flagged by the old scan: false | new URL: ACCEPTED
 *   U+2029 PARAGRAPH SEP  | flagged by the old scan: false | new URL: ACCEPTED
 *   U+202E RTL OVERRIDE   | flagged by the old scan: false | new URL: ACCEPTED
 *
 * so the URL parser is not a backstop for any of it.
 *
 * Scanned rather than matched by a regex: ESLint's `no-control-regex` refuses the
 * literal, and suppressing a rule that exists to catch this class of character —
 * inside the one function whose job is to catch it — would be the wrong trade.
 */
function hasUnsafeCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
    // U+2028 LINE SEPARATOR, U+2029 PARAGRAPH SEPARATOR.
    if (code === 0x2028 || code === 0x2029) return true;
    // Bidi embedding/override (U+202A-U+202E) and isolates (U+2066-U+2069).
    if (code >= 0x202a && code <= 0x202e) return true;
    if (code >= 0x2066 && code <= 0x2069) return true;
  }
  return false;
}

/**
 * The gate every printable field passes, applied at the VALIDATOR rather than at
 * each call site. The cron, scheduleId and method patterns already exclude these
 * characters by construction; this makes that a property of the parser instead of
 * a property of three regexes that a fourth field turned out not to share.
 */
function printableString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > maxLength) return null;
  return hasUnsafeCharacter(value) ? null : value;
}

function parseCronExpression(value: unknown): string | null {
  const text = printableString(value, MAX_CRON_LENGTH);
  if (text === null) return null;
  if (!CRON_PATTERN.test(text)) return null;
  return text.trim().length === 0 ? null : text;
}

function parseScheduleId(value: unknown): string | null {
  const text = printableString(value, MAX_SCHEDULE_ID_LENGTH);
  if (text === null) return null;
  return SCHEDULE_ID_PATTERN.test(text) ? text : null;
}

/**
 * A destination must be printable AND parse as an https URL with no embedded
 * userinfo — the same fail-closed instinct as `resolveQstashBase`, for the same
 * reason: this string is echoed to an operator, and a credential can be smuggled
 * in a URL's userinfo without looking like one. `new URL()` alone is NOT that
 * check; see {@link hasUnsafeCharacter}.
 */
function parseDestination(value: unknown): string | null {
  const text = printableString(value, MAX_DESTINATION_LENGTH);
  if (text === null) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return text;
}

function parseMethod(value: unknown): string | null {
  const text = printableString(value, MAX_METHOD_LENGTH);
  if (text === null) return null;
  return METHOD_PATTERN.test(text) ? text : null;
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
function parseRun(value: unknown, nowMs: number): PollingPlannerRun | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const raw = typeof record.at === 'string' ? record.at : '';
  if (!raw) return null;
  const parsedAt = Date.parse(raw);
  if (Number.isNaN(parsedAt)) return null;
  // The ordering key's contract: a run happened, so it is not in the future.
  if (parsedAt > nowMs + POLLING_PLANNER_FUTURE_SKEW_MS) return null;
  const dayStartMs = parseFiniteNumber(record.dayStartMs);
  // `validDayStart`'s contract, applied here rather than left to the consumer:
  // an offset day rotates the entire cron hour field, and nothing throws on that
  // path for a fallback to catch.
  if (dayStartMs === null || dayStartMs % DAY_MS !== 0) return null;
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
export function parsePollingPlannerRuns(
  value: unknown,
  // Injected so the future-skew bound is testable without a fixture that rots:
  // a hardcoded future date stops being future, and the test then passes for the
  // wrong reason at every commit after it.
  nowMs: number = Date.now()
): PollingPlannerRunSeries {
  const empty: PollingPlannerRunSeries = { runs: [], droppedRuns: 0 };
  if (typeof value !== 'object' || value === null) return empty;
  const raw = (value as { runs?: unknown }).runs;
  if (!Array.isArray(raw)) return empty;
  const runs: PollingPlannerRun[] = [];
  for (const entry of raw) {
    const run = parseRun(entry, nowMs);
    if (run) runs.push(run);
  }
  // The count CARRIED FORWARD from previous writes plus the rows this parse just
  // discarded. A stored value written before the field reads as 0, so an older
  // row is understated rather than rejected.
  const carried = parseDroppedRuns((value as { droppedRuns?: unknown }).droppedRuns);
  const droppedRuns = carried + (raw.length - runs.length);
  return runs.length > 0 ? sortAndBound(runs, droppedRuns) : { runs: [], droppedRuns };
}

/** Absent or unusable reads as 0 — understating a loss beats rejecting a series. */
function parseDroppedRuns(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/**
 * Sort by time and enforce the bound. `sort` is stable, so runs sharing an `at`
 * keep insertion order, and nothing is deduplicated — two planner runs in the
 * same millisecond is a redelivery worth seeing, not a collision worth hiding.
 */
function sortAndBound(runs: PollingPlannerRun[], droppedRuns: number): PollingPlannerRunSeries {
  const sorted = [...runs].sort((a, b) => a.at.localeCompare(b.at));
  // Trimming to the bound is NOT a drop: it is the designed retention, and
  // counting it would make the loss signal fire every day from row 401 onward.
  return { runs: sorted.slice(-POLLING_PLANNER_MAX_RUNS), droppedRuns };
}

/**
 * Append one run. Sorting and the bound are applied to the whole set; the
 * dropped-row count carries through untouched, because appending discards
 * nothing.
 */
export function appendPollingPlannerRun(
  series: PollingPlannerRunSeries,
  run: PollingPlannerRun
): PollingPlannerRunSeries {
  return sortAndBound([...series.runs, projectPollingPlannerRun(run)], series.droppedRuns);
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
  value: unknown,
  nowMs: number = Date.now()
): { ok: true; series: PollingPlannerRunSeries } | { ok: false } {
  if (value === null || value === undefined) {
    return { ok: true, series: { runs: [], droppedRuns: 0 } };
  }
  if (typeof value !== 'object') return { ok: false };
  const raw = (value as { runs?: unknown }).runs;
  if (!Array.isArray(raw)) return { ok: false };
  const parsed = parsePollingPlannerRuns(value, nowMs);
  if (raw.length > 0 && parsed.runs.length === 0) return { ok: false };
  return { ok: true, series: parsed };
}

// ---------------------------------------------------------------------------
// Durable read / write
// ---------------------------------------------------------------------------

/**
 * Is this thrown value our own refusal, at any wrapping depth? `appStateStore`
 * may wrap a callback throw once (cleanup failure) or twice (cleanup + retained
 * lock failure), and both carry the original on `cause`.
 */
function isUnreadableRefusal(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (current instanceof PollingPlannerRecordUnreadableError) return true;
    current = current instanceof Error ? current.cause : null;
  }
  return false;
}

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
    // UNWRAP before classifying. A callback throw whose ROLLBACK also fails is
    // re-wrapped by `appStateStore` as `AppStateTxnCleanupError` (with the
    // original on `cause`), and a coinciding lock failure wraps it once more as
    // `AppStateTxnCallbackLockError`. A bare `instanceof` therefore missed the
    // refusal and reported `not-recorded` — "durably absent" — for a row that is
    // present and corrupt, losing the one signal that needs an operator.
    if (isUnreadableRefusal(error)) return 'unreadable';
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
 * The intent `inspect` should judge a live schedule against — the newest one
 * KNOWN TO BE IN FORCE, which is not the same as the newest one recorded.
 *
 * Both reviews found the earlier version returned the newest matching intent
 * unconditionally, and the type itself says why that is wrong:
 * {@link PlannerScheduleOutcome} models `failed` as "exit 3 — nothing sent". A
 * run that DERIVED cron C2 and failed to send it leaves QStash holding C1, so
 * comparing against C2 reports a divergence forever — a permanent false tampering
 * signal on the job the record exists to protect, with nothing telling the
 * operator the planner itself failed.
 *
 * So the walk is outcome-aware, newest first:
 *
 * - `confirmed` / `unchanged` — this intent is what QStash holds. Use it.
 * - `refused` / `failed` — nothing was sent, so an OLDER intent still governs.
 *   Keep walking.
 * - `indeterminate` — the upsert MAY or may not have landed. Neither this intent
 *   nor the prior one is known to be in force, so there is no honest basis and
 *   the walk STOPS. Falling through to an older intent would assert exactly the
 *   certainty the outcome exists to deny — the PLATFORM-127 lesson, where a
 *   predicate kept consuming a derived input until the fix was deletion.
 *
 * Still a lookup, not an interpretation of history: it answers nothing about
 * which cron was in force at a given INSTANT, which is slice 3b's question. Both
 * schedules of a run are searched because a planner-owned job has two — dense and
 * slow — under one job key.
 */
export type RecordedIntentResolution =
  | { kind: 'intent'; intent: PlannerScheduleIntent }
  /** A run for this schedule may or may not have applied; no basis exists. */
  | { kind: 'indeterminate' }
  /** The series holds no run for this schedule at all. */
  | { kind: 'none' };

export function latestRecordedIntentForSchedule(
  series: PollingPlannerRunSeries,
  scheduleId: string
): RecordedIntentResolution {
  for (let index = series.runs.length - 1; index >= 0; index -= 1) {
    const run = series.runs[index];
    if (!run) continue;
    for (const schedule of [run.slow, run.dense]) {
      if (!schedule || schedule.intent.scheduleId !== scheduleId) continue;
      if (schedule.outcome === 'indeterminate') return { kind: 'indeterminate' };
      if (schedule.outcome === 'confirmed' || schedule.outcome === 'unchanged') {
        return { kind: 'intent', intent: schedule.intent };
      }
      // `refused` / `failed`: nothing reached QStash, so keep walking back.
    }
  }
  return { kind: 'none' };
}
