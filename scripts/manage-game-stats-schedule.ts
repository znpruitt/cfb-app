// Operator CLI for the EXTERNAL game-stats trigger schedule (PLATFORM-086H3E).
//
// The 15-minute game-stats poll no longer runs from a Vercel cron (Vercel's
// Hobby plan rejects sub-daily cron expressions at deploy time). Instead an
// external QStash schedule calls the UNCHANGED route
//
//   GET https://turfwar.games/api/cron/game-stats
//     Authorization: Bearer <CRON_SECRET>   (forwarded by QStash)
//
// every 15 minutes. This CLI is the ONLY checked-in tool that provisions and
// controls that schedule through the QStash MANAGEMENT API. It carries NO
// QStash runtime dependency (plain fetch), never deletes, and treats the
// schedule's identity, destination, and message contract as FIXED constants.
//
// Usage:
//   tsx scripts/manage-game-stats-schedule.ts [inspect]          # READ-ONLY: read back + verify the contract
//   tsx scripts/manage-game-stats-schedule.ts upsert --apply     # create/overwrite the fixed schedule
//   tsx scripts/manage-game-stats-schedule.ts pause  --apply     # pause deliveries
//   tsx scripts/manage-game-stats-schedule.ts resume --apply     # resume deliveries
//
// Default execution (and any action WITHOUT `--apply`) is read-only: `inspect`
// only reads; `upsert`/`pause`/`resume` refuse unless `--apply` is present.
//
// Secrets: `QSTASH_TOKEN` (management auth) and `CRON_SECRET` (the value QStash
// forwards to the route) are read from the environment and are NEVER printed —
// not in output, logs, or errors; readback header VALUES are always redacted.
// `QSTASH_TOKEN` is management-only and must live outside Vercel and the repo.
//
// Exit codes: 0 = confirmed action / verified-good inspection;
//             2 = refused (bad arguments, an action without --apply, or an
//                 absent/divergent schedule on inspect) — nothing mutated;
//             3 = management unreachable / a required credential is missing
//                 (fail closed — no mutation attempted);
//             4 = INDETERMINATE — a mutation's response could not be confirmed,
//                 so the schedule MAY or may not have changed. Inspect (read-
//                 only) before any retry; never retry blindly;
//             1 = unexpected error.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';

// === The FIXED schedule contract (never operator-tunable) ===
export const SCHEDULE_ID = 'turfwar-game-stats-15m';
export const DESTINATION = 'https://turfwar.games/api/cron/game-stats';
export const CRON = '*/15 * * * *';
export const METHOD = 'GET';
export const RETRIES = 0;
/** The management base; the official QStash convention is `QSTASH_URL`, default host below. */
export const DEFAULT_QSTASH_BASE = 'https://qstash.upstash.io';

export type ScheduleAction = 'inspect' | 'upsert' | 'pause' | 'resume';
const MUTATING_ACTIONS: ReadonlySet<ScheduleAction> = new Set(['upsert', 'pause', 'resume']);

const USAGE =
  'usage: tsx scripts/manage-game-stats-schedule.ts [inspect]\n' +
  '       tsx scripts/manage-game-stats-schedule.ts <upsert|pause|resume> --apply';

export type ScheduleCliArgs = { action: ScheduleAction; apply: boolean };

/**
 * Redact a rejected argument before it is echoed. An operator can paste a
 * secret by mistake (`--token=<QSTASH_TOKEN>`, or a bare secret), so the VALUE
 * after `=` is dropped and any long/opaque token is reduced to a length
 * descriptor — the error names the shape of the mistake, never its secret.
 */
export function redactArg(arg: string): string {
  const eq = arg.indexOf('=');
  if (eq !== -1) return `${arg.slice(0, eq)}=<redacted>`;
  if (arg.length > 16) return `<redacted:${arg.length} chars>`;
  return arg;
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
  return { ok: true, base: `${url.protocol}//${url.host}` };
}

export type QstashRequest = { method: string; url: string; headers: Record<string, string> };

/**
 * The EXACT QStash create/upsert request for the fixed schedule. Because the
 * schedule id is pinned via `Upstash-Schedule-Id`, a create is idempotent — it
 * overwrites the same schedule. This is the "approved contract" the CLI emits
 * and a test asserts byte-for-byte. `cronSecret` is placed only in the
 * `Upstash-Forward-Authorization` value (forwarded to the route), never logged.
 */
export function buildUpsertRequest(params: {
  base: string;
  qstashToken: string;
  cronSecret: string;
}): QstashRequest {
  return {
    method: 'POST',
    url: `${params.base}/v2/schedules/${DESTINATION}`,
    headers: {
      Authorization: `Bearer ${params.qstashToken}`,
      'Upstash-Schedule-Id': SCHEDULE_ID,
      'Upstash-Cron': CRON,
      'Upstash-Method': METHOD,
      'Upstash-Retries': String(RETRIES),
      'Upstash-Forward-Authorization': `Bearer ${params.cronSecret}`,
    },
  };
}

export function buildGetRequest(params: { base: string; qstashToken: string }): QstashRequest {
  return {
    method: 'GET',
    url: `${params.base}/v2/schedules/${SCHEDULE_ID}`,
    headers: { Authorization: `Bearer ${params.qstashToken}` },
  };
}

export function buildPauseRequest(params: { base: string; qstashToken: string }): QstashRequest {
  return {
    method: 'POST',
    url: `${params.base}/v2/schedules/${SCHEDULE_ID}/pause`,
    headers: { Authorization: `Bearer ${params.qstashToken}` },
  };
}

export function buildResumeRequest(params: { base: string; qstashToken: string }): QstashRequest {
  return {
    method: 'POST',
    url: `${params.base}/v2/schedules/${SCHEDULE_ID}/resume`,
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
 * True only when the readback carries an EXACTLY-named `Authorization` header
 * (case-insensitive, never a `*-Authorization` suffix like `X-Authorization`,
 * which the route would not receive) with a NON-EMPTY value. The value is
 * length-checked, never read into any message.
 */
function hasForwardedAuthorization(header: unknown): boolean {
  if (!header || typeof header !== 'object' || Array.isArray(header)) return false;
  for (const [name, value] of Object.entries(header as Record<string, unknown>)) {
    if (name.toLowerCase() !== 'authorization') continue;
    if (Array.isArray(value))
      return value.some((v) => typeof v === 'string' && v.trim().length > 0);
    if (typeof value === 'string') return value.trim().length > 0;
    return false;
  }
  return false;
}

function isEmptyish(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    value === 0 ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' && value !== null && Object.keys(value).length === 0)
  );
}

/**
 * Compare a readback against the FIXED contract. Divergence messages reference
 * ONLY the known-safe expected constants — never the raw readback value — so a
 * misconfigured field that embedded a secret cannot leak through the very
 * inspection meant to diagnose it. Header values are never read (presence +
 * non-emptiness only). Returns the exact set of divergences (empty = good).
 */
export function evaluateScheduleContract(schedule: ScheduleReadback): {
  ok: boolean;
  mismatches: string[];
} {
  const mismatches: string[] = [];
  if (schedule.scheduleId !== SCHEDULE_ID)
    mismatches.push(`scheduleId diverges from the fixed id \`${SCHEDULE_ID}\``);
  if (schedule.destination !== DESTINATION)
    mismatches.push(`destination diverges from the fixed value \`${DESTINATION}\``);
  if (schedule.cron !== CRON) mismatches.push(`cron diverges from \`${CRON}\``);
  if (schedule.method !== METHOD) mismatches.push(`method diverges from \`${METHOD}\``);
  // Strict: exactly 0 (numeric or its string form) — no coercion that would let
  // `null`/absent read as zero retries.
  if (schedule.retries !== RETRIES && schedule.retries !== String(RETRIES))
    mismatches.push(`retries diverges from ${RETRIES}`);
  if (!hasForwardedAuthorization(schedule.header))
    mismatches.push('no forwarded, non-empty Authorization header is present');
  // No callbacks, no queue/flow-control (queue), no delay, no scheduler-level
  // retry policy — each verified present-but-empty, reported without its value.
  const banned: Array<[keyof ScheduleReadback, string]> = [
    ['callback', 'a callback is set (must be none)'],
    ['failureCallback', 'a failure callback is set (must be none)'],
    ['delay', 'a delay is set (must be none)'],
    ['flowControlKey', 'a flow-control/queue key is set (must be none)'],
    ['parallelism', 'a parallelism/queue limit is set (must be none)'],
    ['rate', 'a rate limit is set (must be none)'],
    ['period', 'a period is set (must be none)'],
    ['retryDelayExpression', 'a scheduler retry-delay policy is set (must be none)'],
  ];
  for (const [field, message] of banned) {
    if (!isEmptyish(schedule[field])) mismatches.push(message);
  }
  return { ok: mismatches.length === 0, mismatches };
}

/** Strip any `user:pass@` userinfo from a URL-ish value; leave non-URLs as-is. */
function redactUrlUserinfo(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
      return `${url.toString()} (userinfo redacted)`;
    }
    return value;
  } catch {
    return value;
  }
}

/** A fully-redacted, printable summary of a readback (never contains a secret). */
export function summarizeSchedule(schedule: ScheduleReadback): Record<string, unknown> {
  return {
    scheduleId: schedule.scheduleId,
    // A misconfigured destination could embed `user:pass@` userinfo — redact it.
    destination: redactUrlUserinfo(schedule.destination),
    cron: schedule.cron,
    method: schedule.method,
    retries: schedule.retries,
    isPaused: schedule.isPaused,
    callback: isEmptyish(schedule.callback) ? null : 'set',
    failureCallback: isEmptyish(schedule.failureCallback) ? null : 'set',
    delay: isEmptyish(schedule.delay) ? null : 'set',
    flowControlKey: isEmptyish(schedule.flowControlKey) ? null : 'set',
    retryDelayExpression: isEmptyish(schedule.retryDelayExpression) ? null : 'set',
    headerNames: redactHeaderNames(schedule.header),
  };
}

// === Orchestration (dependency-injected for tests: no global fetch, no exit) ===

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string> }
) => Promise<{ status: number; json: () => Promise<unknown> }>;

export type RunDeps = {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  fetchImpl: FetchLike;
  log: (line: string) => void;
  errorLog: (line: string) => void;
};

async function readSchedule(
  deps: RunDeps,
  base: string,
  token: string
): Promise<{ kind: 'ok'; schedule: ScheduleReadback } | { kind: 'absent' } | { kind: 'error' }> {
  const req = buildGetRequest({ base, qstashToken: token });
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

async function runInspect(deps: RunDeps, base: string, token: string): Promise<number> {
  const read = await readSchedule(deps, base, token);
  if (read.kind === 'error') {
    deps.errorLog('FAILED: could not read the schedule from QStash management. No change made.');
    return 3;
  }
  if (read.kind === 'absent') {
    deps.errorLog(
      `REFUSED: schedule \`${SCHEDULE_ID}\` is not provisioned. Run \`upsert --apply\` first.`
    );
    return 2;
  }
  deps.log(`[inspect] ${SCHEDULE_ID}: ${JSON.stringify(summarizeSchedule(read.schedule))}`);
  const { ok, mismatches } = evaluateScheduleContract(read.schedule);
  if (ok) {
    deps.log('[inspect] verified: the schedule matches the fixed contract.');
    return 0;
  }
  deps.errorLog(
    `REFUSED: schedule diverges from the fixed contract:\n - ${mismatches.join('\n - ')}`
  );
  return 2;
}

async function runMutation(
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
    deps.log(`[apply] ${SCHEDULE_ID}: \`${action}\` confirmed.`);
    return 0;
  }
  if (action !== 'upsert' && res.status === 404) {
    deps.errorLog(
      `REFUSED: schedule \`${SCHEDULE_ID}\` is not provisioned — nothing to ${action}.`
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
 * Run the CLI with injected dependencies and return the intended exit code.
 * Pure of `process`/global fetch so tests can drive every path and assert that
 * no credential is ever emitted and only QStash management endpoints are hit.
 */
export async function runManageSchedule(deps: RunDeps): Promise<number> {
  const parsed = parseScheduleArgs(deps.argv);
  if ('error' in parsed) {
    deps.errorLog(`REFUSED: ${parsed.error}\n${USAGE}`);
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

  if (parsed.action === 'inspect') return runInspect(deps, base, token);

  if (parsed.action === 'upsert') {
    const cronSecret = deps.env.CRON_SECRET?.trim() ?? '';
    if (cronSecret.length === 0) {
      deps.errorLog('FAILED: CRON_SECRET is not set (forwarded route credential). Fail closed.');
      return 3;
    }
    const req = buildUpsertRequest({ base, qstashToken: token, cronSecret });
    return runMutation(
      deps,
      'upsert',
      req,
      (status, body) =>
        status >= 200 &&
        status < 300 &&
        !!body &&
        typeof body === 'object' &&
        (body as { scheduleId?: unknown }).scheduleId === SCHEDULE_ID
    );
  }

  const req =
    parsed.action === 'pause'
      ? buildPauseRequest({ base, qstashToken: token })
      : buildResumeRequest({ base, qstashToken: token });
  return runMutation(deps, parsed.action, req, (status) => status >= 200 && status < 300);
}

async function main(): Promise<void> {
  // `.env.local` (gitignored, operator-held) wins; `.env` fills gaps. QSTASH_TOKEN
  // must live here or in the shell — never in the repo or Vercel.
  dotenv.config({ path: path.join(process.cwd(), '.env.local') });
  dotenv.config();

  const nativeFetch: FetchLike = async (url, init) => {
    const res = await fetch(url, { method: init.method, headers: init.headers, cache: 'no-store' });
    return { status: res.status, json: () => res.json() };
  };

  let code = 1;
  try {
    code = await runManageSchedule({
      argv: process.argv.slice(2),
      env: process.env,
      fetchImpl: nativeFetch,
      log: (line) => console.log(line),
      // Redacted by default: raw errors could carry a URL, token, or SQL. Detail
      // is available only through an explicitly enabled debug channel, and even
      // then this CLI never formats a credential into a message.
      errorLog: (line) => console.error(line),
    });
  } catch (err) {
    const detail =
      process.env.MANAGE_GAME_STATS_SCHEDULE_DEBUG === '1' && err instanceof Error
        ? `: ${err.message}`
        : '';
    console.error(
      `unexpected error [manage-game-stats-schedule-failed] (set MANAGE_GAME_STATS_SCHEDULE_DEBUG=1 for detail)${detail}`
    );
    code = 1;
  }
  process.exit(code);
}

// Run only when invoked directly, so tests import the pure helpers and the
// injected-deps orchestration without triggering the process-exiting wrapper.
const invokedDirectly =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
