// Shared QStash management-schedule policy for the EXTERNAL cron triggers
// (PLATFORM-086B2B; generalized by PLATFORM-086E1B). The external provider
// polling jobs — game-stats, live-scores, Odds, and the weekly schedule
// maintenance — run from external QStash schedules that call an UNCHANGED route
//
//   GET https://turfwar.games/api/cron/<job>
//     Authorization: Bearer <CRON_SECRET>   (forwarded by QStash)
//
// on a fixed cadence. QStash is the project's scheduling boundary for EXTERNAL
// provider polling generally (internal lifecycle reconciliation stays on Vercel
// Cron in `vercel.json`) — originally motivated by Vercel Hobby rejecting
// sub-daily cron expressions, but not limited to sub-daily jobs (the weekly
// schedule trigger is daily-or-coarser and still lives here). This module is the
// single, contract-parameterized home for provisioning and controlling such a
// schedule through the QStash MANAGEMENT API. It carries NO QStash runtime
// dependency (plain fetch), never deletes, and treats each schedule's identity,
// destination, and message contract as FIXED constants supplied by the per-job
// {@link ScheduleContract}.
//
// Every per-job CLI (scripts/manage-<job>-schedule.ts) binds its contract into
// these functions and re-exports them, so the job scripts stay thin and their
// runtime behavior is defined here once. Secrets (`QSTASH_TOKEN` for management
// auth, `CRON_SECRET` for the value QStash forwards to the route) are read from
// the environment and are NEVER printed — not in output, logs, or errors;
// readback header VALUES are always redacted.
//
// PLATFORM-102 slice 3a widens `inspect`'s SUBJECT without widening its reach:
// when a planner-owned schedule has a durable recorded intent, `inspect` diffs
// live QStash state against THAT rather than against the fixed constant, which is
// what keeps a "correct, not merely current" signal alive once the planner
// rewrites a cron daily. The lookup is INJECTED through
// {@link RecordedIntentReader}; this module still carries no store, no database
// and no application import. See {@link RecordedIntentLookup} for why a read
// FAILURE refuses instead of falling back.
//
// PLATFORM-102 slice 4 wired it, and wired `upsert` to the same authority. FOUR
// of the ten schedules are planner-owned (`live-scores` and `game-stats`, dense
// and slow); their CLIs supply a reader through `qstashScheduleCli.ts`, and the
// other six still resolve `absent` and behave exactly as before. Slice 4 also
// moved the process-facing wrapper out of this file, so that a Next.js route can
// drive the same orchestration the operator drives — one place decides how a
// QStash mutation is confirmed, or the planner and the CLI could report the same
// event differently.
//
// Exit codes (shared by every job): 0 = confirmed action / verified-good
// inspection; 2 = refused (bad arguments, an action without --apply, or an
// absent/divergent schedule on inspect) — nothing mutated; 3 = management
// unreachable / a required credential missing (fail closed — no mutation
// attempted); 4 = INDETERMINATE — a mutation's response could not be confirmed,
// so the schedule MAY or may not have changed (inspect read-only before any
// retry; never retry blindly); 1 = unexpected error.

/** The management base; the official QStash convention is `QSTASH_URL`, default host below. */
export const DEFAULT_QSTASH_BASE = 'https://qstash.upstash.io';

/**
 * The FIXED, per-job schedule contract (never operator-tunable). Everything a
 * job's CLI needs to provision, verify, and control its one schedule. The
 * request/message shape, divergence checks, and summary are all derived from
 * these constants, so a job script only declares them — it holds no logic.
 */
export type ScheduleContract = {
  /** `Upstash-Schedule-Id` — the pinned identity that makes upsert idempotent. */
  scheduleId: string;
  /** The exact route URL QStash calls (also the upsert path segment). */
  destination: string;
  /** The fixed cron expression. */
  cron: string;
  /** The HTTP method QStash uses to call the route. */
  method: string;
  /** Scheduler-level retries — always 0 (the route is idempotent per run). */
  retries: number;
  /** Usage text appended to a REFUSED argument error (names the job's script). */
  usage: string;
  /** Env var that, when `1`, prints scrubbed exception detail in the CLI wrapper. */
  debugEnvVar: string;
  /** Opaque failure tag printed on an unexpected error in the CLI wrapper. */
  failureTag: string;
  /**
   * The deployment-runbook reference for THIS job's exact-authentication
   * scheduled-delivery proof (inspect proves structure + redaction only, never
   * exact route auth). Job-specific so `inspect` sends the operator to the right
   * procedure — game-stats is §8e, live-scores is §8f step 5.
   */
  authProofRef: string;
};

export type ScheduleAction = 'inspect' | 'upsert' | 'pause' | 'resume';
const MUTATING_ACTIONS: ReadonlySet<ScheduleAction> = new Set(['upsert', 'pause', 'resume']);

export type ScheduleCliArgs = { action: ScheduleAction; apply: boolean };

/**
 * Redact a rejected argument before it is echoed. An operator can paste a
 * secret by mistake — as a `--flag=<secret>`, a bare token, or even a
 * secret-shaped `--<secret>` flag name — so NO raw content is ever echoed: the
 * error names only the SHAPE of the mistake (its length). The only valid flag
 * is `--apply` and the only valid positionals are the four known actions, all
 * listed in the usage text, so a length descriptor is enough to orient the
 * operator without risking a credential leak.
 */
export function redactArg(arg: string): string {
  return `<redacted:${arg.length} chars>`;
}

/**
 * Strict parsing: an optional single positional action (defaults to `inspect`)
 * plus the lone `--apply` flag. Any unknown token, a second action, or a
 * mutating action without `--apply` is a refusal — there is no implicit mutate.
 * Rejected tokens are redacted so a mistakenly-pasted secret never reaches logs.
 */
export function parseScheduleArgs(argv: readonly string[]): ScheduleCliArgs | { error: string } {
  let action: ScheduleAction | null = null;
  let apply = false;
  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg.startsWith('--')) return { error: `unknown argument: ${redactArg(arg)}` };
    if (action !== null) return { error: `unexpected extra argument: ${redactArg(arg)}` };
    if (arg === 'inspect' || arg === 'upsert' || arg === 'pause' || arg === 'resume') {
      action = arg;
      continue;
    }
    return {
      error: `unknown action: ${redactArg(arg)} (expected inspect | upsert | pause | resume)`,
    };
  }
  const resolved: ScheduleAction = action ?? 'inspect';
  if (MUTATING_ACTIONS.has(resolved) && !apply) {
    return { error: `\`${resolved}\` mutates the schedule — re-run with --apply` };
  }
  return { action: resolved, apply };
}

/**
 * Resolve the management base host from `QSTASH_URL` (else the canonical
 * default). Validated and fail-closed: the base MUST be an https ORIGIN
 * (scheme + host, no path/query/fragment/userinfo). This is a credential-safety
 * gate — every request carries `QSTASH_TOKEN` and upsert carries the forwarded
 * `CRON_SECRET`, so a mistaken or poisoned `QSTASH_URL` (an http host, a
 * collector origin with a path, embedded userinfo) must NEVER become the target
 * before a single byte is sent. The default and the documented regional hosts
 * (e.g. `https://qstash-us-east-1.upstash.io`) all pass; a divergent host is
 * still surfaced, but only against a valid origin.
 */
export function resolveQstashBase(
  env: Record<string, string | undefined>
): { ok: true; base: string } | { ok: false; reason: string } {
  const raw = env.QSTASH_URL?.trim();
  if (!raw || raw.length === 0) return { ok: true, base: DEFAULT_QSTASH_BASE };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'QSTASH_URL is not a valid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'QSTASH_URL must use https' };
  if (url.username || url.password)
    return { ok: false, reason: 'QSTASH_URL must not embed credentials (userinfo)' };
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash)
    return {
      ok: false,
      reason: 'QSTASH_URL must be an origin (scheme+host), with no path or query',
    };
  if (url.port && url.port !== '443')
    return { ok: false, reason: 'QSTASH_URL must use the default https port' };
  // Host allowlist: the credentials only ever go to an Upstash QStash host —
  // the canonical `qstash.upstash.io` or a regional `qstash-<region>.upstash.io`.
  // This rejects lookalikes such as `qstash.upstash.io.evil.example` and any
  // trailing-dot variant, which the scheme/userinfo/path checks alone allow.
  if (!/^qstash(-[a-z0-9-]+)?\.upstash\.io$/.test(url.hostname))
    return {
      ok: false,
      reason: 'QSTASH_URL host must be an Upstash QStash host (qstash[-region].upstash.io)',
    };
  return { ok: true, base: `${url.protocol}//${url.host}` };
}

export type QstashRequest = { method: string; url: string; headers: Record<string, string> };

/**
 * The EXACT QStash create/upsert request for a job's fixed schedule. Because the
 * schedule id is pinned via `Upstash-Schedule-Id`, a create is idempotent — it
 * overwrites the same schedule. This is the "approved contract" the CLI emits
 * and a test asserts byte-for-byte. `cronSecret` is placed only in the
 * `Upstash-Forward-Authorization` value (forwarded to the route), never logged.
 */
export function buildUpsertRequest(
  contract: ScheduleContract,
  params: { base: string; qstashToken: string; cronSecret: string }
): QstashRequest {
  return {
    method: 'POST',
    url: `${params.base}/v2/schedules/${contract.destination}`,
    headers: {
      Authorization: `Bearer ${params.qstashToken}`,
      'Upstash-Schedule-Id': contract.scheduleId,
      'Upstash-Cron': contract.cron,
      'Upstash-Method': contract.method,
      'Upstash-Retries': String(contract.retries),
      'Upstash-Forward-Authorization': `Bearer ${params.cronSecret}`,
      // Provider-side redaction of the FORWARDED route credential: QStash stores
      // and returns `REDACTED:<opaque>` for this header in the dashboard/API,
      // while still delivering the real `Bearer <CRON_SECRET>` to the route. This
      // keeps the route secret out of QStash's readable state. The raw HTTP-header
      // value is `header[Authorization]` (NOT the SDK's `header: true`).
      'Upstash-Redact-Fields': 'header[Authorization]',
    },
  };
}

export function buildGetRequest(
  contract: ScheduleContract,
  params: { base: string; qstashToken: string }
): QstashRequest {
  return {
    method: 'GET',
    url: `${params.base}/v2/schedules/${contract.scheduleId}`,
    headers: { Authorization: `Bearer ${params.qstashToken}` },
  };
}

export function buildPauseRequest(
  contract: ScheduleContract,
  params: { base: string; qstashToken: string }
): QstashRequest {
  return {
    method: 'POST',
    url: `${params.base}/v2/schedules/${contract.scheduleId}/pause`,
    headers: { Authorization: `Bearer ${params.qstashToken}` },
  };
}

export function buildResumeRequest(
  contract: ScheduleContract,
  params: { base: string; qstashToken: string }
): QstashRequest {
  return {
    method: 'POST',
    url: `${params.base}/v2/schedules/${contract.scheduleId}/resume`,
    headers: { Authorization: `Bearer ${params.qstashToken}` },
  };
}

/** A defensively-typed subset of the QStash get-schedule response. */
export type ScheduleReadback = {
  scheduleId?: unknown;
  cron?: unknown;
  destination?: unknown;
  method?: unknown;
  retries?: unknown;
  isPaused?: unknown;
  callback?: unknown;
  failureCallback?: unknown;
  header?: unknown;
  delay?: unknown;
  flowControlKey?: unknown;
  parallelism?: unknown;
  rate?: unknown;
  period?: unknown;
  retryDelayExpression?: unknown;
};

/** Header NAMES only — values are structurally discarded so a secret can never surface. */
export function redactHeaderNames(header: unknown): string[] {
  if (!header || typeof header !== 'object' || Array.isArray(header)) return [];
  return Object.keys(header as Record<string, unknown>).sort();
}

/**
 * Every RAW entry of the forwarded Authorization from an EXACTLY-named
 * `Authorization` header (case-insensitive, never a `*-Authorization` suffix
 * like `X-Authorization`, which the route would not receive). Entries are
 * returned UNFILTERED — empties and non-strings included — because CARDINALITY
 * must be judged on what QStash would actually send: the route receives one
 * comma-combined header, so `['Bearer x', '']` is two entries and must be
 * rejected, not silently collapsed to one. Entries are compared/shape-checked,
 * never formatted into a message.
 */
function forwardedAuthorizationEntries(header: unknown): unknown[] {
  if (!header || typeof header !== 'object' || Array.isArray(header)) return [];
  const out: unknown[] = [];
  for (const [name, value] of Object.entries(header as Record<string, unknown>)) {
    if (name.toLowerCase() !== 'authorization') continue;
    if (Array.isArray(value)) out.push(...value);
    else out.push(value);
  }
  return out;
}

/**
 * Classify the forwarded Authorization readback. The upsert configures QStash to
 * REDACT this header (`Upstash-Redact-Fields: header[Authorization]`), so a
 * correctly-provisioned schedule reads back as `REDACTED:<opaque>` — QStash still
 * delivers the real `Bearer <CRON_SECRET>` to the route. Inspect therefore proves
 * provider-side redaction is ACTIVE (the plaintext secret is not exposed in
 * QStash's state), NOT that the redacted value is the exact route credential: the
 * digest algorithm/encoding is undocumented and unreproducible without a live
 * schedule, so exact route authentication is proven separately by the job's
 * runbook scheduled-delivery test (contract.authProofRef), never here.
 *   - `ok`         — exactly one entry, `REDACTED:` + a nonempty opaque suffix;
 *   - `missing`    — zero entries, or a non-string/empty sole entry;
 *   - `ambiguous`  — more than one entry (the route would see a comma-combined header);
 *   - `not-redacted` — a single nonempty entry that is NOT redacted (plaintext /
 *                    `Bearer …` / any non-`REDACTED:` value) — redaction is missing.
 * No value is ever formatted into a message.
 */
export function classifyAuthorization(
  header: unknown
): 'ok' | 'missing' | 'ambiguous' | 'not-redacted' {
  const entries = forwardedAuthorizationEntries(header);
  if (entries.length === 0) return 'missing';
  // The route receives ONE header; QStash combines multiple values with commas,
  // so anything but a single entry would 401 even if one entry is correct.
  if (entries.length > 1) return 'ambiguous';
  const value = entries[0];
  if (typeof value !== 'string' || value.trim().length === 0) return 'missing';
  const REDACTED_PREFIX = 'REDACTED:';
  if (value.startsWith(REDACTED_PREFIX) && value.slice(REDACTED_PREFIX.length).trim().length > 0) {
    return 'ok';
  }
  return 'not-redacted';
}

/** Unset for a string/object field: absent, null, or the empty string. */
function isUnset(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}
/** Unset for a numeric limit: also treats `0` as "no limit" (unconfigured). */
function isNumericUnset(value: unknown): boolean {
  return isUnset(value) || value === 0;
}

/**
 * Which authority a readback is judged against (PLATFORM-102 slice 3a).
 *
 * WORDING ONLY — the comparison is byte-identical either way, and `fixed` is the
 * default so every pre-existing caller and every existing message is unchanged.
 * It exists because once the planner owns a cron there is no "fixed contract" to
 * diverge from, and an operator told a planner-owned cron "diverges from the
 * fixed value" would go looking for a constant that no longer governs it.
 */
export type ScheduleAuthority = 'fixed' | 'recorded-intent';

/**
 * The live pause state, read as a SHAPE before it is read as a value.
 *
 * `runInspect` and `summarizeSchedule` both coerce with `isPaused === true`,
 * which is right for a NOTE (anything not-true reads as running, and the note is
 * advisory). It is wrong for a COMPARISON: a readback carrying `"true"`, `1`, or
 * nothing at all would then answer "running" with the same confidence as a real
 * `false`, and a plan that pauses a schedule would be told its pause had landed.
 * That is `e812b3c0` again — a guard on what the value MEANS while what it IS
 * goes unchecked — so a non-boolean is `null`, never a side.
 *
 * ABSENT IS ALSO `null`, deliberately. QStash documents `isPaused` on the
 * get-schedule response; a response without it is a provider contract change, and
 * defaulting it to "not paused" would make a genuinely paused schedule read as
 * armed — silently, in the direction that leaves a dead schedule looking alive.
 */
export function readPauseState(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export type ScheduleComparisonOptions = {
  /** Wording only; see {@link ScheduleAuthority}. */
  authority?: ScheduleAuthority;
  /**
   * The pause state the CALLER's plan requires, compared when supplied and
   * ignored when not — PLATFORM-102 slice 4.
   *
   * Only the planner has this expectation. `inspect` deliberately does NOT supply
   * one: a paused schedule is an OPERATIONAL state an operator may have chosen
   * (the runbook's "to stop one noncritical job" procedure pauses and then
   * inspects), so making a pause a config divergence would refuse the very
   * procedure that creates it. `runInspect` keeps its loud exit-0 note instead.
   *
   * For the planner the reverse holds, and it is the hole Item 102 named: a dense
   * schedule left RUNNING on a dense-less day is indistinguishable from one
   * correctly armed, and its failure stays invisible until the next dense day.
   */
  expectPaused?: boolean;
};

/**
 * Compare a readback against a job's expected contract — the FIXED constants, or
 * the planner's last recorded intent substituted into them. Divergence messages
 * reference ONLY the known-safe expected values — never the raw readback value —
 * so a misconfigured field that embedded a secret cannot leak through the very
 * inspection meant to diagnose it. Header values are never formatted into a
 * message (compared/shape-checked only). Returns the divergences (empty = good).
 */
export function evaluateScheduleContract(
  contract: ScheduleContract,
  schedule: ScheduleReadback,
  options: ScheduleComparisonOptions = {}
): {
  ok: boolean;
  mismatches: string[];
} {
  const authority: ScheduleAuthority = options.authority ?? 'fixed';
  const mismatches: string[] = [];
  const authorityWord = authority === 'fixed' ? 'fixed' : 'recorded';
  if (schedule.scheduleId !== contract.scheduleId)
    mismatches.push(`scheduleId diverges from the ${authorityWord} id \`${contract.scheduleId}\``);
  if (schedule.destination !== contract.destination)
    mismatches.push(
      `destination diverges from the ${authorityWord} value \`${contract.destination}\``
    );
  if (schedule.cron !== contract.cron) mismatches.push(`cron diverges from \`${contract.cron}\``);
  if (schedule.method !== contract.method)
    mismatches.push(`method diverges from \`${contract.method}\``);
  // Strict: exactly 0 (numeric or its string form) — no coercion that would let
  // `null`/absent read as zero retries.
  if (schedule.retries !== contract.retries && schedule.retries !== String(contract.retries))
    mismatches.push(`retries diverges from ${contract.retries}`);
  switch (classifyAuthorization(schedule.header)) {
    case 'missing':
      mismatches.push('no forwarded, non-empty Authorization header is present');
      break;
    case 'ambiguous':
      mismatches.push('multiple forwarded Authorization values are present (must be exactly one)');
      break;
    case 'not-redacted':
      mismatches.push(
        'the forwarded Authorization is not redacted (`Upstash-Redact-Fields: header[Authorization]` missing) — the plaintext route secret would be exposed in QStash'
      );
      break;
    case 'ok':
      break;
  }
  // No callbacks, no queue/flow-control (queue), no delay, no scheduler-level
  // retry policy. String/URL fields must be absent/empty; numeric limits may be
  // absent OR 0 (unconfigured). Each is reported without its value.
  const bannedStringFields: Array<[keyof ScheduleReadback, string]> = [
    ['callback', 'a callback is set (must be none)'],
    ['failureCallback', 'a failure callback is set (must be none)'],
    ['flowControlKey', 'a flow-control/queue key is set (must be none)'],
    ['retryDelayExpression', 'a scheduler retry-delay policy is set (must be none)'],
  ];
  for (const [field, message] of bannedStringFields) {
    if (!isUnset(schedule[field])) mismatches.push(message);
  }
  const bannedNumericFields: Array<[keyof ScheduleReadback, string]> = [
    ['delay', 'a delay is set (must be none)'],
    ['parallelism', 'a parallelism/queue limit is set (must be none)'],
    ['rate', 'a rate limit is set (must be none)'],
    ['period', 'a period is set (must be none)'],
  ];
  for (const [field, message] of bannedNumericFields) {
    if (!isNumericUnset(schedule[field])) mismatches.push(message);
  }
  if (options.expectPaused !== undefined) {
    const live = readPauseState(schedule.isPaused);
    if (live === null) {
      mismatches.push('the pause state could not be read (no boolean `isPaused` in the readback)');
    } else if (live !== options.expectPaused) {
      mismatches.push(
        options.expectPaused
          ? 'the schedule is RUNNING but the plan pauses it — a stale schedule still firing'
          : 'the schedule is PAUSED but the plan arms it — it will deliver nothing until resumed'
      );
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

/**
 * A printable summary DERIVED from the readback — it never echoes a raw
 * untrusted value, so no readback field (a misconfigured destination, a
 * secret-shaped header name, a divergent scalar) can leak a credential. Fields
 * that match the fixed contract show the known-safe expected constant; anything
 * divergent shows `<divergent>`; `isPaused` is a strict boolean; the forwarded
 * Authorization is a status; other forwarded headers are counted, not named.
 */
export function summarizeSchedule(
  contract: ScheduleContract,
  schedule: ScheduleReadback
): Record<string, unknown> {
  const retriesOk =
    schedule.retries === contract.retries || schedule.retries === String(contract.retries);
  const authEntries = forwardedAuthorizationEntries(schedule.header);
  return {
    scheduleId: schedule.scheduleId === contract.scheduleId ? contract.scheduleId : '<divergent>',
    destination:
      schedule.destination === contract.destination ? contract.destination : '<divergent>',
    cron: schedule.cron === contract.cron ? contract.cron : '<divergent>',
    method: schedule.method === contract.method ? contract.method : '<divergent>',
    retries: retriesOk ? contract.retries : '<divergent>',
    isPaused: schedule.isPaused === true,
    // The forwarded Authorization is reported as a status ('ok' = redacted);
    // its value (redacted or not) is never printed.
    authorization: classifyAuthorization(schedule.header),
    // Only the COUNT of forwarded headers — a header NAME could itself be a
    // secret, so names are never printed. The contract expects exactly one
    // (Authorization); any surplus shows here as a count > 1.
    forwardedHeaderCount: redactHeaderNames(schedule.header).length,
    forwardedAuthorizationValueCount: authEntries.length,
    callback: isUnset(schedule.callback) ? 'none' : 'set',
    failureCallback: isUnset(schedule.failureCallback) ? 'none' : 'set',
    delay: isNumericUnset(schedule.delay) ? 'none' : 'set',
    flowControlKey: isUnset(schedule.flowControlKey) ? 'none' : 'set',
    parallelism: isNumericUnset(schedule.parallelism) ? 'none' : 'set',
    rate: isNumericUnset(schedule.rate) ? 'none' : 'set',
    period: isNumericUnset(schedule.period) ? 'none' : 'set',
    retryDelayExpression: isUnset(schedule.retryDelayExpression) ? 'none' : 'set',
  };
}

// === Orchestration (dependency-injected for tests: no global fetch, no exit) ===

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string> }
) => Promise<{ status: number; json: () => Promise<unknown> }>;

/**
 * The five schedule fields the planner records as its INTENT — exactly the
 * fields {@link evaluateScheduleContract} compares, which is what lets a recorded
 * intent stand in for the fixed contract without widening the check.
 *
 * Structurally identical to `PlannerScheduleIntent` in
 * `src/lib/server/pollingPlannerRecord.ts` and deliberately re-declared rather
 * than imported: this module is an operator CLI with no runtime dependency on the
 * application, and importing the store would drag `next/server` and a database
 * client into a script whose whole safety argument is that it carries neither.
 */
export type RecordedScheduleIntent = {
  scheduleId: string;
  destination: string;
  cron: string;
  method: string;
  retries: number;
};

/**
 * The FOUR states of a recorded-intent lookup — PLATFORM-102 slice 3a, owner
 * ruling 2026-09-06. Collapsing any two of them is the defect the fail-closed
 * rule exists to prevent, and each maps onto exactly one state of the durable
 * store's own read so an adapter never has to invent one.
 *
 * - `absent` — the planner has never recorded this schedule. Fall back to the
 *   fixed constant, exactly as before this slice. THE ONLY state that falls back.
 * - `intent` — diff live QStash state against what the planner last intended.
 * - `unreadable` — a record is PRESENT but unusable (corruption, or a shape from
 *   a build that has been rolled back). REFUSE.
 * - `unavailable` — the record STORE could not be read, so whether a record
 *   exists is unknown. REFUSE — and note this is NOT `unreadable`: telling an
 *   operator a record is "present but corrupt" during a store outage sends them
 *   looking for a row that may not exist.
 * - `indeterminate` — a planner upsert for this schedule was left unconfirmed, so
 *   NEITHER the recorded intent nor the one before it is known to be in force.
 *   REFUSE. This variant exists because the store can resolve to exactly this and
 *   an adapter would otherwise have to report it as one of the two above, both of
 *   which would be false.
 *
 * Silently falling back on any of the three refusals would report a tampered
 * schedule as permanently `correct`.
 */
export type RecordedIntentLookup =
  | { kind: 'absent' }
  | { kind: 'intent'; intent: RecordedScheduleIntent }
  | { kind: 'unreadable' }
  | { kind: 'unavailable' }
  | { kind: 'indeterminate' };

/**
 * Reads the planner's last recorded intent for one schedule id.
 *
 * INJECTED, never imported. `RunDeps` has no store access and this module does
 * not give it any. Slice 4 wired a real reader — `scripts/lib/plannerIntentReader.ts`,
 * attached in `qstashScheduleCli.ts` — for the FOUR schedules the planner owns;
 * the other six CLIs supply none, so they resolve `absent` and behave
 * byte-for-byte as they always have.
 *
 * A reader that THROWS resolves to `unavailable`, not `unreadable`: a store
 * outage says nothing about whether a record exists, and the durable side keeps
 * those two states apart for exactly that reason. Both refuse — only the message
 * differs, and it differs because an operator told "present but unreadable" will
 * go looking for a corrupt row that may not exist.
 */
export type RecordedIntentReader = (scheduleId: string) => Promise<RecordedIntentLookup>;

export type RunDeps = {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  fetchImpl: FetchLike;
  log: (line: string) => void;
  errorLog: (line: string) => void;
  /** Optional; absent for every job whose cron is still a fixed constant. */
  readRecordedIntent?: RecordedIntentReader;
};

async function readSchedule(
  contract: ScheduleContract,
  deps: Pick<RunDeps, 'fetchImpl'>,
  base: string,
  token: string
): Promise<{ kind: 'ok'; schedule: ScheduleReadback } | { kind: 'absent' } | { kind: 'error' }> {
  const req = buildGetRequest(contract, { base, qstashToken: token });
  let res: { status: number; json: () => Promise<unknown> };
  try {
    res = await deps.fetchImpl(req.url, { method: req.method, headers: req.headers });
  } catch {
    return { kind: 'error' };
  }
  if (res.status === 404) return { kind: 'absent' };
  if (res.status < 200 || res.status >= 300) return { kind: 'error' };
  try {
    const body = (await res.json()) as ScheduleReadback;
    if (!body || typeof body !== 'object') return { kind: 'error' };
    return { kind: 'ok', schedule: body };
  } catch {
    return { kind: 'error' };
  }
}

/**
 * What the planner needs to know about a live schedule before it decides whether
 * to write — PLATFORM-102 slice 4. A SANITIZED projection, never the readback.
 *
 * The readback is provider state and this slice's sink is a durable record, so
 * the guard belongs here rather than at the record: `previousCron` is copied into
 * a stored row, and the store's parser REJECTS A WHOLE RUN whose `previousCron`
 * is present and unusable. A tampered or merely surprising cron coming back from
 * QStash would therefore have cost the planner its entire day's record — the loss
 * landing on the one field that exists to stop delivery health extrapolating.
 * So `cron` survives only if it is a printable cron-shaped string, and is `null`
 * (the store's own "could not be established") otherwise.
 *
 * `paused` is {@link readPauseState}: a strict boolean, `null` when unreadable.
 * `contractOk` is the full contract comparison, so the planner can tell a
 * schedule that merely holds a different cron from one whose forwarded
 * Authorization has lost its redaction.
 */
export type ScheduleLiveState =
  | { kind: 'absent' }
  | { kind: 'error' }
  | { kind: 'present'; cron: string | null; paused: boolean | null; contractOk: boolean };

/** Cron fields only, and short — the store's `CRON_PATTERN`, re-declared at this boundary. */
const LIVE_CRON_PATTERN = /^[0-9*/,\- ]{1,120}$/;

function safeLiveCron(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (!LIVE_CRON_PATTERN.test(value)) return null;
  return value.trim().length === 0 ? null : value;
}

/**
 * Read one schedule's live state through the same base validation, credential
 * fail-closed ordering and GET request every other action uses.
 *
 * Exported for the planner route, which needs the readback's FACTS (does it
 * exist, what cron does it hold, is it paused, does it still satisfy the
 * contract) to decide between `upsert`, `pause` and doing nothing. It returns no
 * raw provider value, so nothing a caller records or logs can carry one.
 */
export async function readScheduleState(
  contract: ScheduleContract,
  deps: Pick<RunDeps, 'env' | 'fetchImpl'>,
  expected: { contract: ScheduleContract; expectPaused: boolean }
): Promise<ScheduleLiveState> {
  const baseResult = resolveQstashBase(deps.env);
  if (!baseResult.ok) return { kind: 'error' };
  const token = deps.env.QSTASH_TOKEN?.trim() ?? '';
  if (token.length === 0) return { kind: 'error' };
  const read = await readSchedule(contract, deps, baseResult.base, token);
  if (read.kind !== 'ok') return read;
  const { ok } = evaluateScheduleContract(expected.contract, read.schedule, {
    expectPaused: expected.expectPaused,
  });
  return {
    kind: 'present',
    cron: safeLiveCron(read.schedule.cron),
    paused: readPauseState(read.schedule.isPaused),
    contractOk: ok,
  };
}

/**
 * Why a recorded intent could not be used. Each refuses; each says something
 * different, because they send the operator somewhere different.
 */
/**
 * Which action is asking. `indeterminate` is the only reason whose treatment
 * depends on it, and {@link resolveExpectedContract} states why at the branch.
 */
type IntentConsumer = 'inspect' | 'upsert';

type IntentRefusal =
  | 'unreadable'
  | 'unavailable'
  | 'indeterminate'
  | 'foreign'
  | 'malformed'
  | 'contradicts-contract';

/**
 * Which exit code a refusal earns, and it is not a detail: this module's own
 * vocabulary says `2 = refused (… an absent/DIVERGENT schedule on inspect) —
 * nothing mutated` and `3 = management unreachable / a required credential
 * missing (fail closed)`. `contradicts-contract` is a DEFINITE, reproducible
 * divergence — a record that disagrees with the repo's own constants on a field
 * the planner cannot vary — so it belongs with the other divergences. Emitting it
 * as 3 meant a wrapper treating 3 as transient would retry it forever, while a
 * monitor keyed on 2 (the divergence/tamper code) never fired on the ONE signal
 * this slice exists to raise. The rest genuinely cannot determine an answer, so
 * they stay 3.
 */
const INTENT_REFUSAL_EXIT: Record<IntentRefusal, 2 | 3> = {
  unreadable: 3,
  unavailable: 3,
  indeterminate: 3,
  foreign: 3,
  malformed: 3,
  'contradicts-contract': 2,
};

const INTENT_REFUSAL_DETAIL: Record<IntentRefusal, string> = {
  unreadable: 'is present but could not be read',
  unavailable:
    'could not be read — the record store was unavailable, so whether a record exists is unknown',
  indeterminate:
    'records an upsert that was never confirmed, so no cron is known to be in force — re-run the planner, or confirm the live schedule by hand, before trusting this check',
  foreign: 'came back recorded for a DIFFERENT schedule id',
  malformed: 'came back in a shape this CLI will not print',
  'contradicts-contract':
    'disagrees with the fixed contract on a field the planner does not own (destination, method or retries) — the record, the schedule, or both have been tampered with',
};

/**
 * Unsafe in this string's CONSUMER — the operator's terminal — which is the
 * contract that governs it, not "looks like a control character". C0, DEL, C1,
 * the U+2028/U+2029 line separators, and the bidi overrides and isolates.
 * `new URL()` accepts every one of them, so it backstops none of this. Kept
 * byte-identical to the durable store's `hasUnsafeCharacter`, and both are driven
 * by the single frozen `UNSAFE_CHARACTER_CODES` table in
 * `src/lib/server/__tests__/unsafeCharacterTable.ts` — one table, so the claim
 * that they cannot drift is true by construction rather than by discipline. An
 * earlier version of this sentence claimed the pinning while two hand-maintained
 * lists had ALREADY drifted.
 */
function hasUnsafeCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
    if (code === 0x2028 || code === 0x2029) return true;
    if (code >= 0x202a && code <= 0x202e) return true;
    if (code >= 0x2066 && code <= 0x2069) return true;
  }
  return false;
}
const INTENT_CRON_PATTERN = /^[0-9*/,\- ]{1,120}$/;
const INTENT_SCHEDULE_ID_PATTERN = /^[A-Za-z0-9._-]{1,120}$/;
const INTENT_METHOD_PATTERN = /^[A-Z]{3,10}$/;

/**
 * Validate an injected intent BEFORE any of it reaches an output sink.
 *
 * `summarizeSchedule` and `evaluateScheduleContract` both document that they only
 * ever emit the known-safe EXPECTED value and never the raw readback — an
 * invariant that held while the expected value was a compile-time constant. A
 * recorded intent is not one. The durable store validates on read, but the reader
 * here is injected and this module deliberately does not import it, so the
 * guarantee has to be re-established at the boundary that actually prints. The
 * store's `RecordedScheduleIntent` twin is pinned to this shape by a test.
 */
function usableIntent(intent: RecordedScheduleIntent): boolean {
  if (typeof intent !== 'object' || intent === null) return false;
  const strings = [intent.scheduleId, intent.destination, intent.cron, intent.method];
  if (strings.some((value) => typeof value !== 'string' || hasUnsafeCharacter(value))) {
    return false;
  }
  if (!INTENT_SCHEDULE_ID_PATTERN.test(intent.scheduleId)) return false;
  if (!INTENT_CRON_PATTERN.test(intent.cron) || intent.cron.trim().length === 0) return false;
  if (!INTENT_METHOD_PATTERN.test(intent.method)) return false;
  if (!Number.isSafeInteger(intent.retries) || intent.retries < 0 || intent.retries > 10) {
    return false;
  }
  // `new URL()` accepts embedded control characters and only normalizes them in
  // `.href`, so the check above is what makes this one safe — not the reverse.
  if (intent.destination.length > 300) return false;
  let url: URL;
  try {
    url = new URL(intent.destination);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.username && !url.password;
}

/**
 * The contract `inspect` judges the live schedule against, resolved BEFORE any
 * management request is sent — so an unreadable record fails closed without the
 * credential ever leaving the process, the same ordering `resolveQstashBase`
 * already establishes for a poisoned base.
 *
 * A returned intent whose `scheduleId` is not the one being read is refused
 * rather than applied: the schedule was fetched BY `contract.scheduleId`, so
 * substituting a different identity would compare schedule A against intent B and
 * report a divergence that means nothing.
 */
async function resolveExpectedContract(
  contract: ScheduleContract,
  deps: RunDeps,
  action: IntentConsumer
): Promise<
  | { kind: 'ok'; contract: ScheduleContract; authority: ScheduleAuthority }
  | { kind: 'refused'; reason: IntentRefusal }
> {
  if (!deps.readRecordedIntent) return { kind: 'ok', contract, authority: 'fixed' };
  let lookup: RecordedIntentLookup;
  try {
    lookup = await deps.readRecordedIntent(contract.scheduleId);
  } catch {
    return { kind: 'refused', reason: 'unavailable' };
  }
  if (lookup.kind === 'unreadable') return { kind: 'refused', reason: 'unreadable' };
  if (lookup.kind === 'unavailable') return { kind: 'refused', reason: 'unavailable' };
  if (lookup.kind === 'indeterminate') {
    // THE ONE REFUSAL THAT DIVERGES BY ACTION, and it is spelled out here rather
    // than left to the order the two callers happen to run in.
    //
    // On `inspect` a refusal is a DIAGNOSIS: nothing is known to be in force, so
    // saying so is the whole answer. On `upsert` the same refusal means never
    // retrying the one operation whose outcome is unknown, so a single exit 4
    // wedges reprovisioning until a human intervenes — and the thing an operator
    // reaches for `upsert` to do is exactly to make an unknown state definite.
    // QStash documents the create endpoint as an UPDATE when `Upstash-Schedule-Id`
    // names an existing schedule ("the settings of the existing schedule will be
    // updated with the new settings"), so re-issuing is not a duplicate.
    //
    // It falls back to the FIXED contract rather than to the unconfirmed intent
    // because {@link RecordedIntentLookup} does not carry one on this variant —
    // and the fixed cadence is the safe direction: it OVER-approximates, the
    // handler guards remain the correctness protection, and the next planner run
    // overwrites it, so the exposure is at most one cycle.
    if (action === 'upsert') return { kind: 'ok', contract, authority: 'fixed' };
    return { kind: 'refused', reason: 'indeterminate' };
  }
  if (lookup.kind === 'absent') return { kind: 'ok', contract, authority: 'fixed' };
  // SHAPE BEFORE MEANING. The reader is injected, so `intent` may be absent or
  // null at runtime whatever the type says; dereferencing it for the id
  // comparison first threw a TypeError out of `runInspect` and the CLI wrapper
  // turned that into an opaque failure tag — losing the very message this
  // validation exists to produce.
  if (!usableIntent(lookup.intent)) return { kind: 'refused', reason: 'malformed' };
  if (lookup.intent.scheduleId !== contract.scheduleId) {
    return { kind: 'refused', reason: 'foreign' };
  }
  // ONLY `cron` IS SUBSTITUTED, because only `cron` is what the planner produces.
  // `SynthesizedCron` carries a cron and nothing else; `destination`, `method` and
  // `retries` are invariant constants the planner never varies, so letting a
  // record override them widened what `inspect` will bless far past what the
  // planner owns — a record naming `https://evil.example/...`, plus a schedule
  // repointed to match, would have read as verified where the fixed contract
  // exits 2. They are still RECORDED (the record of intent is unchanged); they
  // are simply not the comparison basis.
  //
  // And a record that DISAGREES with the contract on one of them is not ignored
  // either: the planner cannot produce such a record, so its existence is itself
  // the tampering signal, and discarding it quietly would throw that signal away.
  if (
    lookup.intent.destination !== contract.destination ||
    lookup.intent.method !== contract.method ||
    lookup.intent.retries !== contract.retries
  ) {
    return { kind: 'refused', reason: 'contradicts-contract' };
  }
  return {
    kind: 'ok',
    // One explicit field, not a spread: everything else — identity, destination,
    // method, retries, usage text, debug env var, failure tag, auth-proof
    // reference — stays exactly as declared in the repo.
    contract: { ...contract, cron: lookup.intent.cron },
    authority: 'recorded-intent',
  };
}

async function runInspect(
  contract: ScheduleContract,
  deps: RunDeps,
  base: string,
  token: string
): Promise<number> {
  const expected = await resolveExpectedContract(contract, deps, 'inspect');
  if (expected.kind === 'refused') {
    const exit = INTENT_REFUSAL_EXIT[expected.reason];
    deps.errorLog(
      `${exit === 2 ? 'REFUSED' : 'FAILED'}: the planner's recorded intent for ` +
        `\`${contract.scheduleId}\` ${INTENT_REFUSAL_DETAIL[expected.reason]}. Refusing rather ` +
        'than falling back to the fixed contract — a planner-owned cron would then read as ' +
        'verified against a constant it no longer follows. No change made.'
    );
    return exit;
  }
  const expectedContract = expected.contract;
  const read = await readSchedule(contract, deps, base, token);
  if (read.kind === 'error') {
    deps.errorLog('FAILED: could not read the schedule from QStash management. No change made.');
    return 3;
  }
  if (read.kind === 'absent') {
    deps.errorLog(
      `REFUSED: schedule \`${contract.scheduleId}\` is not provisioned. Run \`upsert --apply\` first.`
    );
    return 2;
  }
  // Exit 0 proves schedule STRUCTURE + provider-side redaction: the forwarded
  // Authorization reads back as `REDACTED:<opaque>` (so the plaintext route secret
  // is not exposed in QStash), not that the redacted value is the exact route
  // credential — the digest is undocumented/unreproducible, so exact route
  // authentication is proven separately by the job's runbook scheduled-delivery
  // test (contract.authProofRef). No CRON_SECRET is needed (or usable) here.
  deps.log(
    `[inspect] ${contract.scheduleId}: ${JSON.stringify(
      summarizeSchedule(expectedContract, read.schedule)
    )}`
  );
  // Only emitted on the recorded-intent branch, so the fixed-contract output an
  // operator (and five CLI suites) already know is unchanged to the byte.
  if (expected.authority === 'recorded-intent') {
    deps.log(
      `[inspect] judged against the planner's last recorded intent for \`${contract.scheduleId}\`, ` +
        'not the fixed contract — this schedule is planner-owned.'
    );
  }
  // `fixed` reproduces every existing message to the byte; the other branch is
  // reachable only once a planner reader is injected, which nothing does yet.
  const authorityPhrase =
    expected.authority === 'fixed' ? 'the fixed contract' : "the planner's recorded intent";
  const { ok, mismatches } = evaluateScheduleContract(expectedContract, read.schedule, {
    authority: expected.authority,
  });
  if (!ok) {
    deps.errorLog(
      `REFUSED: schedule diverges from ${authorityPhrase}:\n - ${mismatches.join('\n - ')}`
    );
    return 2;
  }
  // A paused schedule matches the config contract but delivers NOTHING, so the
  // operator must not read exit 0 as "polling is live". (Pause is an operational
  // state, not a config divergence, so it stays exit 0 — but the note is loud.)
  const pausedNote =
    read.schedule.isPaused === true
      ? ' NOTE: the schedule is currently PAUSED — no deliveries until resumed.'
      : '';
  deps.log(
    `[inspect] verified: schedule structure and provider-side redaction match ${authorityPhrase}` +
      `. Exact route authentication is NOT yet proven here — confirm it via the ${contract.authProofRef} ` +
      `scheduled-delivery test (one 200 paused/disabled result, zero provider calls).${pausedNote}`
  );
  return 0;
}

async function runMutation(
  contract: ScheduleContract,
  deps: RunDeps,
  action: 'upsert' | 'pause' | 'resume',
  req: QstashRequest,
  confirm: (status: number, body: unknown) => boolean
): Promise<number> {
  let res: { status: number; json: () => Promise<unknown> };
  try {
    res = await deps.fetchImpl(req.url, { method: req.method, headers: req.headers });
  } catch {
    deps.errorLog(
      `INDETERMINATE: the \`${action}\` request could not be confirmed (no response). The ` +
        'schedule MAY or may not have changed — run inspect (read-only) before any retry.'
    );
    return 4;
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (confirm(res.status, body)) {
    deps.log(`[apply] ${contract.scheduleId}: \`${action}\` confirmed.`);
    return 0;
  }
  if (action !== 'upsert' && res.status === 404) {
    deps.errorLog(
      `REFUSED: schedule \`${contract.scheduleId}\` is not provisioned — nothing to ${action}.`
    );
    return 2;
  }
  deps.errorLog(
    `INDETERMINATE: the \`${action}\` response was not confirmed (status ${res.status}). The ` +
      'schedule MAY or may not have changed — run inspect (read-only) before any retry.'
  );
  return 4;
}

/**
 * Run a job's CLI with injected dependencies and return the intended exit code.
 * Pure of `process`/global fetch so tests can drive every path and assert that
 * no credential is ever emitted and only QStash management endpoints are hit.
 */
export async function runManageSchedule(
  contract: ScheduleContract,
  deps: RunDeps
): Promise<number> {
  const parsed = parseScheduleArgs(deps.argv);
  if ('error' in parsed) {
    deps.errorLog(`REFUSED: ${parsed.error}\n${contract.usage}`);
    return 2;
  }
  // Validate the management base BEFORE any credential is attached to a request —
  // a poisoned QSTASH_URL must never receive QSTASH_TOKEN or the forwarded secret.
  const baseResult = resolveQstashBase(deps.env);
  if (!baseResult.ok) {
    deps.errorLog(`FAILED: ${baseResult.reason}. Fail closed (no request sent).`);
    return 3;
  }
  const base = baseResult.base;
  const token = deps.env.QSTASH_TOKEN?.trim() ?? '';
  if (token.length === 0) {
    deps.errorLog('FAILED: QSTASH_TOKEN is not set (management credential). Fail closed.');
    return 3;
  }

  // Inspect needs no CRON_SECRET — it verifies structure + that the forwarded
  // Authorization is REDACTED, not the exact secret (which QStash redacts).
  if (parsed.action === 'inspect') return runInspect(contract, deps, base, token);

  const cronSecret = deps.env.CRON_SECRET?.trim() ?? '';
  if (parsed.action === 'upsert') {
    if (cronSecret.length === 0) {
      deps.errorLog('FAILED: CRON_SECRET is not set (forwarded route credential). Fail closed.');
      return 3;
    }
    // UPSERT ANSWERS TO THE SAME AUTHORITY `inspect` DOES — PLATFORM-102 slice 4.
    // Slice 3a shipped the machinery and wired only the read side, which left one
    // process holding two authorities: `inspect` blessed the planner's recorded
    // intent while this dispatch wrote the FIXED constant. A planner-owned
    // schedule that went absent was then reprovisioned at the fixed cadence, and
    // the next `inspect` refused what the same CLI had just written.
    //
    // The resolver runs BEFORE the credentials are attached, the same ordering
    // `resolveQstashBase` establishes, so an unreadable record fails closed
    // without `QSTASH_TOKEN` or the forwarded `CRON_SECRET` leaving the process.
    const expected = await resolveExpectedContract(contract, deps, 'upsert');
    if (expected.kind === 'refused') {
      const exit = INTENT_REFUSAL_EXIT[expected.reason];
      deps.errorLog(
        `${exit === 2 ? 'REFUSED' : 'FAILED'}: the planner's recorded intent for ` +
          `\`${contract.scheduleId}\` ${INTENT_REFUSAL_DETAIL[expected.reason]}. Refusing rather ` +
          'than writing the fixed contract — that would clobber a cron the planner owns, and ' +
          'the next inspect would refuse what this run just wrote. Nothing sent.'
      );
      return exit;
    }
    if (expected.authority === 'recorded-intent') {
      deps.log(
        `[upsert] writing the planner's last recorded intent for \`${contract.scheduleId}\`, ` +
          'not the fixed contract — this schedule is planner-owned.'
      );
    }
    const req = buildUpsertRequest(expected.contract, { base, qstashToken: token, cronSecret });
    return runMutation(
      contract,
      deps,
      'upsert',
      req,
      (status, body) =>
        status >= 200 &&
        status < 300 &&
        !!body &&
        typeof body === 'object' &&
        (body as { scheduleId?: unknown }).scheduleId === contract.scheduleId
    );
  }

  const req =
    parsed.action === 'pause'
      ? buildPauseRequest(contract, { base, qstashToken: token })
      : buildResumeRequest(contract, { base, qstashToken: token });
  return runMutation(contract, deps, parsed.action, req, (status) => status >= 200 && status < 300);
}

/**
 * Replace any literal occurrence of the actual QSTASH_TOKEN / CRON_SECRET values
 * with `<redacted>`. Applied to the ONLY free-text sink (the debug exception
 * detail), so even an unexpected exception whose message happens to contain a
 * credential value cannot print it.
 */
export function scrubSecrets(text: string, env: Record<string, string | undefined>): string {
  let out = text;
  for (const key of ['QSTASH_TOKEN', 'CRON_SECRET']) {
    const value = env[key]?.trim();
    if (value && value.length > 0) out = out.split(value).join('<redacted>');
  }
  return out;
}
