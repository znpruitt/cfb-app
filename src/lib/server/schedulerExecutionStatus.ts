import { after } from 'next/server';

import type { CfbdSeasonType } from '@/lib/cfbd';
import type { GameStatsCronExecutionReason } from '@/lib/gameStats/cronExecutionLog';
import type {
  LiveScoresCronExecutionReason,
  LiveScoresPollingMode,
} from '@/lib/liveScores/cronExecutionLog';
import type { OddsCronCadence, OddsCronExecutionReason } from '@/lib/odds/cronExecutionLog';
import type { RankingsPublicationWindowKind } from '@/lib/rankings/publicationPolicy';
import type { RankingsCronExecutionReason } from '@/lib/rankings/cronExecutionLog';
import type { ScheduleRefreshCronExecutionReason } from '@/lib/schedule/cronExecutionLog';
import type { WeeklyScheduleRefreshOperation } from '@/lib/schedule/weeklyRefreshOperation';
import type {
  SeasonRolloverCronExecutionReason,
  SeasonTransitionCronExecutionReason,
} from '@/lib/lifecycleCronExecutionLog';
import { withAppStateKeyTransaction } from '@/lib/server/appStateStore';

/**
 * PLATFORM-086F2E1 / F2E2A — latest-only durable execution receipts for the
 * seven scheduled cron routes (`scheduler-execution-status/<job>`): the five
 * QStash-triggered jobs (F2E1, `source: 'qstash'`) plus the two Vercel-native
 * lifecycle crons — season-transition and season-rollover (F2E2A,
 * `source: 'vercel-cron'`).
 *
 * A receipt proves ONE thing the runtime execution-log events cannot durably
 * prove: an AUTHENTICATED scheduled delivery reached the application, when it
 * started/completed, the final result/reason the route's execution tracker
 * established, whether a provider-data request was attempted, and the bounded
 * target the route evaluated. It is the future System Health page's cache-only
 * scheduler-delivery source (reader/classification land in F2E2) and remains
 * completely separate from `provider-refresh-status`, which describes
 * provider-data attempts and durable commits.
 *
 * Contract properties (see docs/architecture/admin-control-plane.md):
 *   - ALLOWLIST-ONLY construction: every stored field is an explicit per-field
 *     copy of a closed operational primitive — never a request/response object,
 *     header, environment value, provider payload, error, URL, credential, or
 *     arbitrary attached state. `invocationId` is an application-generated UUID
 *     created only after successful cron authentication; no QStash header
 *     (`Upstash-Message-Id`, signature, user-agent, …) is ever inspected or
 *     persisted. `source` is DERIVED from `job` (never accepted from a caller)
 *     and names the configured scheduler owner (`qstash` | `vercel-cron`) — it
 *     is NOT a cryptographic provenance claim.
 *   - MONOTONIC latest-only persistence: one row per job, committed inside the
 *     durable per-key transaction. A valid prior record is preserved unless the
 *     incoming receipt is strictly newer by `(startedAt, invocationId)` —
 *     later `startedAt` wins, equal instants tie-break on lexical
 *     `invocationId`, and an exact duplicate never rewrites. `completedAt` and
 *     the store's `updated_at` never decide freshness, so an older overlapping
 *     invocation that completes late cannot overwrite a newer delivery.
 *     A missing, malformed, job-mismatched, obsolete-version, or future-dated
 *     prior record is replaceable (a `startedAt` implausibly ahead of real time
 *     is corruption or a foreign writer that would otherwise pin health forever);
 *     a genuine read failure aborts without writing.
 *   - BEST-EFFORT: every read/lock/transaction/serialization/write failure is
 *     swallowed. A receipt can never change a cron response, mask an exception,
 *     alter provider/status behavior, or emit storage error details. No memo,
 *     history, heartbeat table, cleanup job, or backfill exists.
 *   - POST-RESPONSE: persistence is deferred through stable Next.js `after`, so
 *     receipt storage adds no latency to the QStash response. The receipt
 *     snapshot is built (immutably) BEFORE the callback registers — it never
 *     closes over a route's mutable execution tracker. Registration failures
 *     are swallowed with NO untracked fire-and-forget fallback; direct route
 *     tests inject a deferrer seam instead of relying on request context.
 */

export const SCHEDULER_EXECUTION_STATUS_SCOPE = 'scheduler-execution-status';

/** Bounded multi-year target summaries store at most this many entries. */
export const MAX_SCHEDULER_TARGET_YEARS = 8;

export type ExternalSchedulerJob =
  | 'live-scores'
  | 'game-stats'
  | 'odds'
  | 'schedule-refresh'
  | 'rankings'
  | 'season-transition'
  | 'season-rollover';

/**
 * How a job is scheduled. `source` is NEVER accepted from a route caller — it is
 * derived from `job` through {@link JOB_SOURCE}, so a receipt can only ever claim
 * the scheduler owner its job is actually wired to. `qstash` names the five
 * QStash-triggered jobs (F2E1); `vercel-cron` names the two lifecycle crons
 * scheduled natively by `vercel.json` (F2E2A). Neither is a cryptographic
 * provenance claim — see the module header.
 */
export type SchedulerSource = 'qstash' | 'vercel-cron';

/** The closed job → source contract. The ONLY place a source is decided. */
const JOB_SOURCE: Record<ExternalSchedulerJob, SchedulerSource> = {
  'live-scores': 'qstash',
  'game-stats': 'qstash',
  odds: 'qstash',
  'schedule-refresh': 'qstash',
  rankings: 'qstash',
  'season-transition': 'vercel-cron',
  'season-rollover': 'vercel-cron',
};

export type SchedulerExecutionResult =
  | 'skipped'
  | 'success'
  | 'partial'
  | 'no-op'
  | 'failure'
  | 'in-progress';

/**
 * The union of the five routes' existing closed, stable reason vocabularies —
 * copied verbatim from each route's final execution tracker, never derived from
 * HTTP responses and never a second vocabulary.
 */
export type SchedulerExecutionReason =
  | LiveScoresCronExecutionReason
  | GameStatsCronExecutionReason
  | OddsCronExecutionReason
  | ScheduleRefreshCronExecutionReason
  | RankingsCronExecutionReason
  | SeasonTransitionCronExecutionReason
  | SeasonRolloverCronExecutionReason;

/** The allowlisted, bounded per-job target summary variants. */
export type SchedulerExecutionTarget =
  | {
      kind: 'live-scores';
      year: number;
      mode: LiveScoresPollingMode | null;
      targetGames: number;
      targetPartitions: number;
    }
  | {
      kind: 'game-stats';
      year: number;
      week: number | null;
      seasonType: CfbdSeasonType | null;
    }
  | {
      kind: 'odds';
      year: number;
      cadence: OddsCronCadence | null;
      eligibleGames: number;
    }
  | {
      kind: 'schedule-years';
      totalYears: number;
      truncated: boolean;
      years: Array<{
        year: number;
        operation: WeeklyScheduleRefreshOperation | null;
      }>;
    }
  | {
      kind: 'rankings-years';
      totalYears: number;
      truncated: boolean;
      years: Array<{
        year: number;
        publicationWindow: RankingsPublicationWindowKind | null;
      }>;
    }
  | {
      kind: 'season-transition-years';
      totalYears: number;
      truncated: boolean;
      years: Array<{
        year: number;
        targetLeagues: number;
        probed: boolean;
        transitionedLeagues: number;
      }>;
    }
  | {
      kind: 'season-rollover-years';
      totalYears: number;
      truncated: boolean;
      years: Array<{
        year: number;
        targetLeagues: number;
        rolledOverLeagues: number;
      }>;
    };

/** The exact durable record stored at `scheduler-execution-status/<job>`. */
export type SchedulerExecutionReceipt = {
  version: 1;
  job: ExternalSchedulerJob;
  source: SchedulerSource;
  invocationId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  result: SchedulerExecutionResult;
  reason: SchedulerExecutionReason;
  providerCallAttempted: boolean;
  target: SchedulerExecutionTarget;
};

/**
 * Create the application-owned receipt invocation identity. Called by a route
 * immediately after `verifyCronSecret(...) === 'ok'` and NEVER before —
 * authentication failures must not create or advance a receipt. Identity
 * creation is observability-only: if UUID generation fails the route simply
 * skips its receipt (`null`) without any behavior change.
 */
export function createSchedulerInvocationId(): string | null {
  try {
    return globalThis.crypto.randomUUID();
  } catch {
    return null;
  }
}

/** The bounded `schedule-years` summary from the route's per-year entries. */
export function scheduleYearsTarget(
  entries: ReadonlyArray<{ year: number; operation: WeeklyScheduleRefreshOperation | null }>
): Extract<SchedulerExecutionTarget, { kind: 'schedule-years' }> {
  const years = entries
    .slice(0, MAX_SCHEDULER_TARGET_YEARS)
    .map((entry) => ({ year: entry.year, operation: entry.operation }));
  return {
    kind: 'schedule-years',
    totalYears: entries.length,
    truncated: entries.length > years.length,
    years,
  };
}

/** The bounded `rankings-years` summary from the route's per-year entries. */
export function rankingsYearsTarget(
  entries: ReadonlyArray<{ year: number; publicationWindow: RankingsPublicationWindowKind | null }>
): Extract<SchedulerExecutionTarget, { kind: 'rankings-years' }> {
  const years = entries
    .slice(0, MAX_SCHEDULER_TARGET_YEARS)
    .map((entry) => ({ year: entry.year, publicationWindow: entry.publicationWindow }));
  return {
    kind: 'rankings-years',
    totalYears: entries.length,
    truncated: entries.length > years.length,
    years,
  };
}

/** The bounded `season-transition-years` summary from the route's per-year entries. */
export function seasonTransitionYearsTarget(
  entries: ReadonlyArray<{
    year: number;
    targetLeagues: number;
    probed: boolean;
    transitionedLeagues: number;
  }>
): Extract<SchedulerExecutionTarget, { kind: 'season-transition-years' }> {
  const years = entries.slice(0, MAX_SCHEDULER_TARGET_YEARS).map((entry) => ({
    year: entry.year,
    targetLeagues: entry.targetLeagues,
    probed: entry.probed,
    transitionedLeagues: entry.transitionedLeagues,
  }));
  return {
    kind: 'season-transition-years',
    totalYears: entries.length,
    truncated: entries.length > years.length,
    years,
  };
}

/** The bounded `season-rollover-years` summary from the route's per-year entries. */
export function seasonRolloverYearsTarget(
  entries: ReadonlyArray<{ year: number; targetLeagues: number; rolledOverLeagues: number }>
): Extract<SchedulerExecutionTarget, { kind: 'season-rollover-years' }> {
  const years = entries.slice(0, MAX_SCHEDULER_TARGET_YEARS).map((entry) => ({
    year: entry.year,
    targetLeagues: entry.targetLeagues,
    rolledOverLeagues: entry.rolledOverLeagues,
  }));
  return {
    kind: 'season-rollover-years',
    totalYears: entries.length,
    truncated: entries.length > years.length,
    years,
  };
}

export type SchedulerExecutionReceiptInput = {
  job: ExternalSchedulerJob;
  invocationId: string;
  /** The route's existing entry instant (epoch ms). */
  startedAtMs: number;
  /** Captured once in the route's `finally`, before persistence is scheduled. */
  completedAtMs: number;
  result: SchedulerExecutionResult;
  reason: SchedulerExecutionReason;
  providerCallAttempted: boolean;
  target: SchedulerExecutionTarget;
};

/**
 * Build the immutable allowlisted receipt snapshot. Every field is an explicit
 * copy (the target is rebuilt per-kind field-by-field), so the snapshot shares
 * no structure with a route's mutable execution tracker and an accidentally
 * attached extra property can never survive into durable state. `durationMs`
 * is the nonnegative integer route duration and excludes receipt-storage time.
 */
export function buildSchedulerExecutionReceipt(
  input: SchedulerExecutionReceiptInput
): SchedulerExecutionReceipt | null {
  // The target kind must match the job, and the source is DERIVED from the job
  // (never accepted from the caller) — a receipt can only claim the scheduler
  // owner its job is actually wired to.
  if (JOB_TARGET_KIND[input.job] !== input.target?.kind) return null;
  const target = rebuildTarget(input.target);
  if (target === null) return null;
  return {
    version: 1,
    job: input.job,
    source: JOB_SOURCE[input.job],
    invocationId: input.invocationId,
    startedAt: new Date(input.startedAtMs).toISOString(),
    completedAt: new Date(input.completedAtMs).toISOString(),
    durationMs: Math.max(0, Math.round(input.completedAtMs - input.startedAtMs)),
    result: input.result,
    reason: input.reason,
    providerCallAttempted: input.providerCallAttempted,
    target,
  };
}

/**
 * Persist one receipt with monotonic latest-only semantics. Fully best-effort:
 * every failure (lock acquisition, transaction, read, serialization, write)
 * resolves harmlessly — never throws, never logs storage error details. A
 * genuine prior-record READ failure aborts the transaction without writing
 * (only a readable-but-unusable record is replaceable).
 */
export async function recordSchedulerExecutionReceipt(
  receipt: SchedulerExecutionReceipt
): Promise<void> {
  try {
    // Rebuild the stored value from the explicit allowlist at write time —
    // defense in depth even though the builder already allowlists.
    const stored = rebuildReceipt(receipt);
    if (stored === null) return;
    await withAppStateKeyTransaction(SCHEDULER_EXECUTION_STATUS_SCOPE, stored.job, async (txn) => {
      // The future-skew reference for the prior's `startedAt` is read INSIDE the
      // callback, AFTER any pool-client/advisory-lock wait, so a long contention
      // wait can never make it stale: a legitimate receipt is stamped with its
      // route-entry instant (≤ real time), so a prior dated implausibly ahead of
      // real time can only be corruption or a foreign writer — and left usable it
      // would pin scheduler health forever. Capturing `nowMs` before the wait
      // could misclassify a newer receipt another instance committed during the
      // wait as future-dated and let this older receipt overwrite it, defeating
      // monotonic ordering under contention.
      const nowMs = Date.now();
      // A thrown read propagates (rolling back the transaction): a real read
      // failure must never be mistaken for a replaceable missing record.
      const prior = await txn.read<unknown>();
      const usablePrior = prior ? parseUsablePriorReceipt(prior.value, stored.job, nowMs) : null;
      if (usablePrior && !incomingReceiptWins(stored, usablePrior)) return;
      await txn.write(stored);
    });
  } catch {
    // Best-effort observability — a receipt failure is invisible to callers.
  }
}

type SchedulerReceiptDeferrer = (callback: () => Promise<void>) => void;

// Test-only injected deferrer so direct `node:test` route invocations (which
// have no Next.js request context for `after`) can execute and await the
// persistence callback. Always null in production; reset after every test.
let __receiptDeferrerForTests: SchedulerReceiptDeferrer | null = null;

export function __setSchedulerReceiptDeferrerForTests(
  deferrer: SchedulerReceiptDeferrer | null
): void {
  __receiptDeferrerForTests = deferrer;
}

/**
 * Build the immutable receipt snapshot NOW (capturing `completedAt` before any
 * scheduling), then defer persistence past the response via Next.js `after` so
 * receipt storage adds no latency to the cron response. Both registration and
 * callback failures are swallowed; there is NO untracked fire-and-forget
 * fallback when registration is unavailable.
 */
export function scheduleSchedulerExecutionReceipt(
  input: Omit<SchedulerExecutionReceiptInput, 'completedAtMs'>
): void {
  try {
    const receipt = buildSchedulerExecutionReceipt({ ...input, completedAtMs: Date.now() });
    if (receipt === null) return;
    const persist = async (): Promise<void> => {
      await recordSchedulerExecutionReceipt(receipt);
    };
    if (__receiptDeferrerForTests) {
      __receiptDeferrerForTests(persist);
      return;
    }
    after(persist);
  } catch {
    // Scheduling is best-effort — never alter the response or mask a throw.
  }
}

// ---------------------------------------------------------------------------
// Allowlisted rebuilding + prior-record validation (module-internal policy).

/**
 * A prior receipt's `startedAt` is trusted only up to this margin past real
 * time. A legitimate receipt is stamped with its route-entry instant (≤ now, up
 * to sub-second cross-instance clock skew), so a prior dated meaningfully in the
 * future is corruption or a foreign/incompatible writer. Rejecting it makes such
 * a record replaceable — otherwise its later `startedAt` would win the monotonic
 * comparison and pin scheduler health to malformed data indefinitely (a merely
 * later PAST timestamp self-heals on the next cron run; only a future one pins).
 * The margin generously covers real skew while bounding any residual pin to
 * minutes rather than forever.
 */
const PRIOR_FUTURE_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

const RESULT_VALUES: ReadonlySet<string> = new Set([
  'skipped',
  'success',
  'partial',
  'no-op',
  'failure',
  'in-progress',
]);

const LIVE_SCORES_MODES: ReadonlySet<string> = new Set(['scoreboard', 'final-reconciliation']);
const SEASON_TYPES: ReadonlySet<string> = new Set(['regular', 'postseason']);
const ODDS_CADENCES: ReadonlySet<string> = new Set(['baseline', 'pregame']);
const SCHEDULE_OPERATIONS: ReadonlySet<string> = new Set([
  'preseason-maintenance',
  'ordinary-maintenance',
  'postseason-boundary',
]);
const PUBLICATION_WINDOWS: ReadonlySet<string> = new Set([
  'final-ap-coaches',
  'cfp-publication',
  'opening-week-exception',
  'weekly-ap-coaches',
  'preseason-discovery',
]);

/** The single target `kind` each job's receipt must carry. */
const JOB_TARGET_KIND: Record<ExternalSchedulerJob, SchedulerExecutionTarget['kind']> = {
  'live-scores': 'live-scores',
  'game-stats': 'game-stats',
  odds: 'odds',
  'schedule-refresh': 'schedule-years',
  rankings: 'rankings-years',
  'season-transition': 'season-transition-years',
  'season-rollover': 'season-rollover-years',
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isValidIsoInstant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** Rebuild a target field-by-field; `null` when the shape is not allowlisted. */
function rebuildTarget(target: SchedulerExecutionTarget): SchedulerExecutionTarget | null {
  switch (target.kind) {
    case 'live-scores':
      return {
        kind: 'live-scores',
        year: target.year,
        mode: target.mode,
        targetGames: target.targetGames,
        targetPartitions: target.targetPartitions,
      };
    case 'game-stats':
      return {
        kind: 'game-stats',
        year: target.year,
        week: target.week,
        seasonType: target.seasonType,
      };
    case 'odds':
      return {
        kind: 'odds',
        year: target.year,
        cadence: target.cadence,
        eligibleGames: target.eligibleGames,
      };
    case 'schedule-years':
      return {
        kind: 'schedule-years',
        totalYears: target.totalYears,
        truncated: target.truncated,
        years: target.years
          .slice(0, MAX_SCHEDULER_TARGET_YEARS)
          .map((entry) => ({ year: entry.year, operation: entry.operation })),
      };
    case 'rankings-years':
      return {
        kind: 'rankings-years',
        totalYears: target.totalYears,
        truncated: target.truncated,
        years: target.years
          .slice(0, MAX_SCHEDULER_TARGET_YEARS)
          .map((entry) => ({ year: entry.year, publicationWindow: entry.publicationWindow })),
      };
    case 'season-transition-years':
      return {
        kind: 'season-transition-years',
        totalYears: target.totalYears,
        truncated: target.truncated,
        years: target.years.slice(0, MAX_SCHEDULER_TARGET_YEARS).map((entry) => ({
          year: entry.year,
          targetLeagues: entry.targetLeagues,
          probed: entry.probed,
          transitionedLeagues: entry.transitionedLeagues,
        })),
      };
    case 'season-rollover-years':
      return {
        kind: 'season-rollover-years',
        totalYears: target.totalYears,
        truncated: target.truncated,
        years: target.years.slice(0, MAX_SCHEDULER_TARGET_YEARS).map((entry) => ({
          year: entry.year,
          targetLeagues: entry.targetLeagues,
          rolledOverLeagues: entry.rolledOverLeagues,
        })),
      };
    default:
      return null;
  }
}

/** Rebuild the full receipt from the explicit allowlist; `null` when unusable. */
function rebuildReceipt(receipt: SchedulerExecutionReceipt): SchedulerExecutionReceipt | null {
  if (JOB_TARGET_KIND[receipt.job] !== receipt.target?.kind) return null;
  // The stored source is DERIVED from the job — an incoming receipt that claims
  // the wrong source for its job is normalized to the correct one, never trusted.
  const target = rebuildTarget(receipt.target);
  if (target === null) return null;
  return {
    version: 1,
    job: receipt.job,
    source: JOB_SOURCE[receipt.job],
    invocationId: receipt.invocationId,
    startedAt: receipt.startedAt,
    completedAt: receipt.completedAt,
    durationMs: receipt.durationMs,
    result: receipt.result,
    reason: receipt.reason,
    providerCallAttempted: receipt.providerCallAttempted,
    target,
  };
}

/** Validate one stored multi-year entry list (bounded, allowlisted values). */
function isValidYearEntries(
  value: unknown,
  entryField: 'operation' | 'publicationWindow',
  allowedValues: ReadonlySet<string>
): boolean {
  if (!Array.isArray(value) || value.length > MAX_SCHEDULER_TARGET_YEARS) return false;
  return value.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const row = entry as Record<string, unknown>;
    if (!isFiniteNumber(row.year)) return false;
    const field = row[entryField];
    return field === null || (typeof field === 'string' && allowedValues.has(field));
  });
}

/** True when a stored target is shape-valid for `job`. */
function isValidStoredTarget(value: unknown, job: ExternalSchedulerJob): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const target = value as Record<string, unknown>;
  if (target.kind !== JOB_TARGET_KIND[job]) return false;
  switch (target.kind) {
    case 'live-scores':
      return (
        isFiniteNumber(target.year) &&
        (target.mode === null ||
          (typeof target.mode === 'string' && LIVE_SCORES_MODES.has(target.mode))) &&
        isNonNegativeInteger(target.targetGames) &&
        isNonNegativeInteger(target.targetPartitions)
      );
    case 'game-stats':
      return (
        isFiniteNumber(target.year) &&
        (target.week === null || isFiniteNumber(target.week)) &&
        (target.seasonType === null ||
          (typeof target.seasonType === 'string' && SEASON_TYPES.has(target.seasonType)))
      );
    case 'odds':
      return (
        isFiniteNumber(target.year) &&
        (target.cadence === null ||
          (typeof target.cadence === 'string' && ODDS_CADENCES.has(target.cadence))) &&
        isNonNegativeInteger(target.eligibleGames)
      );
    case 'schedule-years':
      return (
        isNonNegativeInteger(target.totalYears) &&
        typeof target.truncated === 'boolean' &&
        isValidYearEntries(target.years, 'operation', SCHEDULE_OPERATIONS)
      );
    case 'rankings-years':
      return (
        isNonNegativeInteger(target.totalYears) &&
        typeof target.truncated === 'boolean' &&
        isValidYearEntries(target.years, 'publicationWindow', PUBLICATION_WINDOWS)
      );
    case 'season-transition-years':
      return (
        isNonNegativeInteger(target.totalYears) &&
        typeof target.truncated === 'boolean' &&
        isValidLifecycleYearEntries(target.years, [
          { field: 'targetLeagues', kind: 'count' },
          { field: 'probed', kind: 'boolean' },
          { field: 'transitionedLeagues', kind: 'count' },
        ])
      );
    case 'season-rollover-years':
      return (
        isNonNegativeInteger(target.totalYears) &&
        typeof target.truncated === 'boolean' &&
        isValidLifecycleYearEntries(target.years, [
          { field: 'targetLeagues', kind: 'count' },
          { field: 'rolledOverLeagues', kind: 'count' },
        ])
      );
    default:
      return false;
  }
}

/** Validate a lifecycle multi-year entry list (finite year + typed extra fields). */
function isValidLifecycleYearEntries(
  value: unknown,
  fields: ReadonlyArray<{ field: string; kind: 'count' | 'boolean' }>
): boolean {
  if (!Array.isArray(value) || value.length > MAX_SCHEDULER_TARGET_YEARS) return false;
  return value.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const row = entry as Record<string, unknown>;
    if (!isFiniteNumber(row.year)) return false;
    return fields.every(({ field, kind }) =>
      kind === 'boolean' ? typeof row[field] === 'boolean' : isNonNegativeInteger(row[field])
    );
  });
}

/**
 * A prior record is usable ONLY when its version, job, source, invocation
 * identity, timestamps, result, provider flag, and job-compatible target shape
 * are all valid, AND its `startedAt` — the monotonic ordering key — is not dated
 * implausibly in the future. Anything else (missing, malformed, mismatched job,
 * obsolete version, corrupt fields, a future-dated `startedAt`) is replaceable
 * and returns `null`.
 *
 * The future-`startedAt` guard is what actually closes the "malformed prior pins
 * health forever" vector: validating `reason` against the closed vocabulary is
 * both insufficient (a corrupt record with a coincidentally-valid reason such as
 * `unexpected-error` would still win a future-dated comparison) and fragile
 * (it would re-enumerate five cross-module reason unions). A record that is
 * well-formed in every other way but carries an unrecognized `reason` still only
 * pins health if its `startedAt` beats live cron runs — which the future guard
 * prevents; a sane PAST timestamp self-heals on the next run regardless.
 */
function parseUsablePriorReceipt(
  value: unknown,
  job: ExternalSchedulerJob,
  nowMs: number
): SchedulerExecutionReceipt | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (record.job !== job) return null;
  // The source must be the one this job is wired to — a record claiming the wrong
  // source (e.g. a lifecycle job stored as `qstash`) is corrupt and replaceable.
  if (record.source !== JOB_SOURCE[job]) return null;
  if (typeof record.invocationId !== 'string' || record.invocationId.length === 0) return null;
  if (!isValidIsoInstant(record.startedAt) || !isValidIsoInstant(record.completedAt)) return null;
  if (Date.parse(record.startedAt) > nowMs + PRIOR_FUTURE_SKEW_TOLERANCE_MS) return null;
  if (!isNonNegativeInteger(record.durationMs)) return null;
  if (typeof record.result !== 'string' || !RESULT_VALUES.has(record.result)) return null;
  if (typeof record.reason !== 'string' || record.reason.length === 0) return null;
  if (typeof record.providerCallAttempted !== 'boolean') return null;
  if (!isValidStoredTarget(record.target, job)) return null;
  return record as SchedulerExecutionReceipt;
}

/**
 * Monotonic ordering: the incoming receipt wins ONLY when strictly newer by
 * `(startedAt, invocationId)` — later start instant first, lexical
 * `invocationId` on equal instants. An equal-or-newer prior (including an
 * exact duplicate identity) is preserved without a write. `completedAt` and
 * app-state `updated_at` never participate.
 */
function incomingReceiptWins(
  incoming: SchedulerExecutionReceipt,
  prior: SchedulerExecutionReceipt
): boolean {
  const incomingMs = Date.parse(incoming.startedAt);
  const priorMs = Date.parse(prior.startedAt);
  if (incomingMs !== priorMs) return incomingMs > priorMs;
  return incoming.invocationId > prior.invocationId;
}
