// The operator CLI's bridge to the planner's durable record (PLATFORM-102
// slice 4). `qstashSchedule.ts` declares {@link RecordedIntentReader} and
// deliberately imports no store; this is the file that supplies one, and it is
// wired only into the four planner-owned scripts.
//
// WHY THE CLI NEEDS IT AT ALL. Once the planner rewrites a cron daily, an
// operator running `inspect` against the fixed constant would be told the
// schedule diverges every single day, and one running `upsert --apply` would
// overwrite the planner's narrow cron with the wide fallback — which the next
// `inspect` would then refuse. Slice 3a built the reader seam for exactly this
// and left it unwired; this is where slice 4 wires it.

import type { RecordedIntentLookup, RecordedIntentReader } from './qstashSchedule.ts';

import { operatorReadOnlyEnv } from './operatorEnv.ts';
import { PLANNER_JOB_CONTRACTS } from './plannerScheduleContracts.ts';

type PlannerJob = keyof typeof PLANNER_JOB_CONTRACTS;

/** Which planner-owned job a schedule id belongs to, or null for anything else. */
export function plannerJobForScheduleId(scheduleId: string): PlannerJob | null {
  for (const job of Object.keys(PLANNER_JOB_CONTRACTS) as PlannerJob[]) {
    const { dense, slow } = PLANNER_JOB_CONTRACTS[job];
    if (dense.scheduleId === scheduleId || slow.scheduleId === scheduleId) return job;
  }
  return null;
}

/**
 * The store's four read states plus the walk's three resolutions, mapped onto the
 * CLI's lookup vocabulary. One place, so the two cannot describe one event
 * differently.
 *
 * `ok` + `none` resolves to `absent` and NOT to a refusal: the series is readable
 * and simply holds no run for this schedule, which is the bootstrap — the first
 * `upsert` of a schedule the planner has never touched has nothing else to write.
 * `failed` becomes `unavailable` rather than `unreadable`, because a store outage
 * says nothing about whether a record exists and sending an operator to look for
 * a corrupt row that may not exist is the wrong errand.
 */
export function lookupFromStore(
  read:
    | { kind: 'absent' }
    | { kind: 'unreadable' }
    | { kind: 'failed' }
    | { kind: 'ok'; series: unknown },
  resolve: () =>
    | { kind: 'none' }
    | { kind: 'indeterminate' }
    | {
        kind: 'intent';
        intent: {
          scheduleId: string;
          destination: string;
          cron: string;
          method: string;
          retries: number;
        };
      }
): RecordedIntentLookup {
  if (read.kind === 'absent') return { kind: 'absent' };
  if (read.kind === 'unreadable') return { kind: 'unreadable' };
  if (read.kind === 'failed') return { kind: 'unavailable' };
  const resolved = resolve();
  if (resolved.kind === 'none') return { kind: 'absent' };
  if (resolved.kind === 'indeterminate') return { kind: 'indeterminate' };
  return { kind: 'intent', intent: resolved.intent };
}

/**
 * The connection string a record read uses: `DATABASE_URL_RO`, and ONLY that.
 *
 * `CLAUDE.md` keeps production read access in `.env.operator.local` as a
 * read-only `audit_ro` role limited to CONNECT/USAGE/SELECT, and deliberately
 * keeps `DATABASE_URL` out of `.env.local` so a dev server can never point at
 * production. An operator following that setup has the read-only credential —
 * requiring the write one made `inspect` and `upsert` exit 3 before contacting
 * QStash, which broke the routine §8e/§8f check, §8l rotation, and the
 * provisioning of the two schedules this slice adds.
 *
 * NO FALLBACK TO `DATABASE_URL`. A preference is not a guarantee: with a fallback,
 * a blank or missing `DATABASE_URL_RO` silently turned "read through the read-only
 * rail" into a read through the primary, which is the sentence above this function
 * claiming something the code did not enforce. Reading a record is a `SELECT` and
 * nothing here ever needs write access, so the rail is the only option and the
 * guarantee is structural.
 */
export function plannerRecordConnectionString(
  env: Record<string, string | undefined>
): string | null {
  return env.DATABASE_URL_RO?.trim() || null;
}

/**
 * Re-exported so this module's long-standing import path and its contract test
 * keep working. The IMPLEMENTATION moved to `operatorEnv.ts` when issue #703 added
 * the write-side reader beside it: one module owns how an operator credential is
 * read, so the two cannot grow separate answers to the same question.
 */
export { operatorReadOnlyEnv };

/**
 * A reader for the four planner-owned schedules, or `unavailable` when this
 * process cannot honestly answer.
 *
 * IT READS THROUGH THE OPERATOR'S READ-ONLY RAIL, and only that — see
 * {@link plannerRecordConnectionString} and {@link operatorReadOnlyEnv}.
 *
 * With NO connection string it still refuses (`unavailable`), because
 * `appStateStore`'s local-file fallback would otherwise answer `absent` from an
 * empty store and the CLI would write the fixed contract over a planner-owned
 * cron — the clobber this reader exists to prevent, reached through the door
 * beside it.
 *
 * A schedule id the planner does not own also answers `absent`, which is the
 * pre-slice-4 behaviour byte for byte; the reader is only ever attached to the
 * four it does own, and this makes a mis-wiring safe rather than surprising.
 */
export function createPlannerIntentReader(
  env?: Record<string, string | undefined>
): RecordedIntentReader {
  return async (scheduleId: string): Promise<RecordedIntentLookup> => {
    const job = plannerJobForScheduleId(scheduleId);
    if (job === null) return { kind: 'absent' };
    // Resolved LAZILY and only for a schedule the planner owns, so a CLI for one
    // of the other six never reads the operator file at all.
    const connectionString = plannerRecordConnectionString(env ?? operatorReadOnlyEnv());
    if (!connectionString) return { kind: 'unavailable' };

    // The store's PARSER, not its reader. `readPollingPlannerRuns` goes through
    // `appStateStore`, which needs `DATABASE_URL` and silently falls back to a
    // LOCAL FILE without one — so an operator would have read an empty local store,
    // been told `absent`, and had the CLI write the fixed contract over a cron the
    // planner owns. One `SELECT` against the read-only rail avoids both, and
    // reusing the store's own classifier means no parsing logic is duplicated.
    const [
      { default: pg },
      {
        POLLING_PLANNER_RECORD_SCOPE,
        pollingPlannerRecordKey,
        readPollingPlannerRunsForWrite,
        latestRecordedIntentForSchedule,
      },
    ] = await Promise.all([import('pg'), import('../../src/lib/server/pollingPlannerRecord.ts')]);

    const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
    let value: unknown;
    try {
      await client.connect();
      const result = await client.query(
        'select value from app_state where scope = $1 and key = $2',
        [POLLING_PLANNER_RECORD_SCOPE, pollingPlannerRecordKey(job)]
      );
      if (result.rows.length === 0) return { kind: 'absent' };
      value = result.rows[0]?.value;
    } catch {
      return { kind: 'unavailable' };
    } finally {
      await client.end().catch(() => {});
    }
    if (value === null || value === undefined) return { kind: 'absent' };

    // The SAME classifier `readPollingPlannerRuns` uses: a present value that
    // yields nothing is `unreadable` (refuse), while individual damaged rows are
    // dropped tolerantly. Reusing it is what keeps the CLI and the store from
    // describing one stored value two different ways.
    const parsed = readPollingPlannerRunsForWrite(value);
    if (!parsed.ok) return { kind: 'unreadable' };
    return lookupFromStore({ kind: 'ok', series: parsed.series }, () =>
      latestRecordedIntentForSchedule(parsed.series, scheduleId)
    );
  };
}
