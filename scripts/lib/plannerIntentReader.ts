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
 * A reader for the four planner-owned schedules, or `unavailable` when this
 * process cannot honestly answer.
 *
 * THE `DATABASE_URL` CHECK IS THE POINT OF THIS FUNCTION, not a convenience.
 * `appStateStore` falls back to a LOCAL FILE outside production when no database
 * is configured, and an operator's laptop has no `DATABASE_URL` — deliberately,
 * per `CLAUDE.md`, so that a dev server can never point at production. A reader
 * built naively on top of that would read an empty local store, answer `absent`,
 * and the CLI would then write the fixed contract over a cron the planner owns.
 * That is the exact clobber the reader exists to prevent, reached through the
 * door beside it. So: no database, no answer — `unavailable`, which REFUSES.
 *
 * A schedule id the planner does not own also answers `absent`, which is the
 * pre-slice-4 behaviour byte for byte; the reader is only ever attached to the
 * four it does own, and this makes a mis-wiring safe rather than surprising.
 */
export function createPlannerIntentReader(
  env: Record<string, string | undefined> = process.env
): RecordedIntentReader {
  return async (scheduleId: string): Promise<RecordedIntentLookup> => {
    const job = plannerJobForScheduleId(scheduleId);
    if (job === null) return { kind: 'absent' };
    if (!env.DATABASE_URL?.trim()) return { kind: 'unavailable' };
    // Imported dynamically so this module — and every script that holds it — stays
    // free of a database client until a read is actually attempted.
    const { readPollingPlannerRuns, latestRecordedIntentForSchedule } = await import(
      '../../src/lib/server/pollingPlannerRecord.ts'
    );
    const read = await readPollingPlannerRuns(job);
    return lookupFromStore(read, () =>
      read.kind === 'ok'
        ? latestRecordedIntentForSchedule(read.series, scheduleId)
        : { kind: 'none' }
    );
  };
}
