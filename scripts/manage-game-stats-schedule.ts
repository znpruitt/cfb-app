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
 * Strict parsing: an optional single positional action (defaults to `inspect`)
 * plus the lone `--apply` flag. Any unknown token, a second action, or a
 * mutating action without `--apply` is a refusal — there is no implicit mutate.
 */
export function parseScheduleArgs(argv: readonly string[]): ScheduleCliArgs | { error: string } {
  let action: ScheduleAction | null = null;
  let apply = false;
  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg.startsWith('--')) return { error: `unknown argument: ${arg}` };
    if (action !== null) return { error: `unexpected extra argument: ${arg}` };
    if (arg === 'inspect' || arg === 'upsert' || arg === 'pause' || arg === 'resume') {
      action = arg;
      continue;
    }
    return { error: `unknown action: ${arg} (expected inspect | upsert | pause | resume)` };
  }
  const resolved: ScheduleAction = action ?? 'inspect';
  if (MUTATING_ACTIONS.has(resolved) && !apply) {
    return { error: `\`${resolved}\` mutates the schedule — re-run with --apply` };
  }
  return { action: resolved, apply };
}

/** Resolve the management base host (env override, else the canonical default). */
export function resolveQstashBase(env: Record<string, string | undefined>): string {
  const raw = env.QSTASH_URL?.trim();
  const base = raw && raw.length > 0 ? raw : DEFAULT_QSTASH_BASE;
  return base.replace(/\/+$/, '');
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
};

/** Header NAMES only — values are structurally discarded so a secret can never surface. */
export function redactHeaderNames(header: unknown): string[] {
  if (!header || typeof header !== 'object' || Array.isArray(header)) return [];
  return Object.keys(header as Record<string, unknown>).sort();
}

function hasForwardedAuthorization(header: unknown): boolean {
  return redactHeaderNames(header).some((name) => /(^|-)authorization$/i.test(name));
}

function isEmptyish(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

/**
 * Compare a readback against the FIXED contract. Never reads any header value —
 * only the presence of a forwarded Authorization header by name. Returns the
 * exact set of divergences (empty = verified-good).
 */
export function evaluateScheduleContract(schedule: ScheduleReadback): {
  ok: boolean;
  mismatches: string[];
} {
  const mismatches: string[] = [];
  if (schedule.scheduleId !== SCHEDULE_ID)
    mismatches.push(
      `scheduleId is ${JSON.stringify(schedule.scheduleId)}, expected ${SCHEDULE_ID}`
    );
  if (schedule.destination !== DESTINATION)
    mismatches.push(
      `destination is ${JSON.stringify(schedule.destination)}, expected ${DESTINATION}`
    );
  if (schedule.cron !== CRON)
    mismatches.push(`cron is ${JSON.stringify(schedule.cron)}, expected ${CRON}`);
  if (schedule.method !== METHOD)
    mismatches.push(`method is ${JSON.stringify(schedule.method)}, expected ${METHOD}`);
  if (Number(schedule.retries) !== RETRIES)
    mismatches.push(`retries is ${JSON.stringify(schedule.retries)}, expected ${RETRIES}`);
  if (!hasForwardedAuthorization(schedule.header))
    mismatches.push('no forwarded Authorization header is present');
  if (!isEmptyish(schedule.callback)) mismatches.push('a callback is set (must be none)');
  if (!isEmptyish(schedule.failureCallback))
    mismatches.push('a failure callback is set (must be none)');
  return { ok: mismatches.length === 0, mismatches };
}

/** A fully-redacted, printable summary of a readback (never contains a secret). */
export function summarizeSchedule(schedule: ScheduleReadback): Record<string, unknown> {
  return {
    scheduleId: schedule.scheduleId,
    destination: schedule.destination,
    cron: schedule.cron,
    method: schedule.method,
    retries: schedule.retries,
    isPaused: schedule.isPaused,
    callback: isEmptyish(schedule.callback) ? null : 'set',
    failureCallback: isEmptyish(schedule.failureCallback) ? null : 'set',
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
  const base = resolveQstashBase(deps.env);
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
