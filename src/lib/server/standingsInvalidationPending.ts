import { getAppState, listAppStateKeys, withAppStateKeyTransaction } from './appStateStore.ts';

/**
 * PLATFORM-693 — durable "this year's standings bust is still owed" state.
 *
 * ## Why this exists at all
 *
 * Recording a failed invalidation is not enough on its own. `schedulerExecutionStatus`
 * is latest-only monotonic persistence, ONE ROW PER JOB, so the next run's receipt
 * replaces the failing one. That makes a per-run record unable to carry a per-year
 * standing fact: *"no walk was needed this run"* and *"no walk is outstanding"* are
 * different claims, and without this module nothing in the system distinguishes them.
 *
 * The concrete failure that forced it: a run commits rows, the bust throws, the year
 * records `partial`. The operator follows the repair link and re-runs. Content is now
 * unchanged, so the refresh takes the no-walk-needed path, records success, and the
 * warning disappears — with standings permanently stale, because canonical standings
 * are `revalidate: false` and tag-only. **A warning that clears itself is worse than
 * the silence this item was opened to fix.**
 *
 * ## Why its own scope, and not a field on the lease record
 *
 * `SCHEDULE_REFRESH_CONTROL_SCOPE` is the obvious neighbour and is WRONG:
 * `releaseScheduleRefreshLease` writes `{ lease: null }` — a WHOLE-RECORD replacement,
 * not a field update — so a pending flag co-located there would be destroyed by the
 * release at the end of the very run that recorded it. A durable fault cannot live
 * inside an ephemeral record.
 *
 * ## The pending unit is a YEAR, not a league
 *
 * Replay re-walks every league for the year. That keeps slugs out of this record
 * entirely — no identifier ever reaches a policed log or receipt surface — and it is
 * idempotent for free, because `revalidateTag` on an already-busted tag is a no-op.
 *
 * ## Serialization
 *
 * Every mutation goes through `withAppStateKeyTransaction` on its own key. The refresh
 * authority does hold a lease across the post-commit bust, but the lease is
 * token-checked and reclaimable once expired, so it serializes the common case and not
 * the correctness case. A mechanism that holds "almost always" is the worst kind to
 * depend on: the failure is rare enough never to be reproduced and real enough to
 * happen.
 */

export const STANDINGS_INVALIDATION_PENDING_SCOPE = 'standings-invalidation-pending';

/**
 * How many pending years one drain discharges.
 *
 * A RAIL AGAINST PATHOLOGICAL GROWTH of the pending set, nothing more. It deliberately
 * asserts no cost model: an invalidated entry is rebuilt only when something next
 * reads it, so what a drain actually costs is bounded by readership, which is not
 * measured here and is not what this bound protects against (`AGENTS.md` — classify a
 * comment claim before writing it).
 *
 * What IS structural: the drain is never additive waste on the active year. A
 * content-changed refresh busts that year unconditionally, so draining it is redundant
 * with work the run already did; an unchanged refresh busts only on a score repair, so
 * a pending active year means a bust was genuinely owed and failed. Steady state is a
 * single key listing, because the pending set is normally empty.
 */
export const MAX_PENDING_DRAIN_PER_RUN = 4;

export type PendingStandingsInvalidation = {
  /** The year whose canonical standings are still owed a bust. */
  year: number;
  /** ISO instant the year first became pending, retained across failed drains. */
  since: string;
  /** Drain attempts so far, so a persistently failing year is visible, not silent. */
  attempts: number;
};

function isPendingRecord(value: unknown): value is PendingStandingsInvalidation {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.year === 'number' &&
    Number.isInteger(row.year) &&
    typeof row.since === 'string' &&
    typeof row.attempts === 'number' &&
    Number.isInteger(row.attempts) &&
    row.attempts >= 0
  );
}

/**
 * Mark year `year` as owing a standings bust. Idempotent: an existing record keeps its
 * original `since`, so the age of the fault survives repeated failures rather than
 * being reset by the most recent one.
 *
 * NEVER THROWS. Every caller runs after a durable commit, so a failure here must not
 * turn a completed state change into a 500 — the same invariant that made the original
 * swallow correct about what must not happen, even while it was wrong about how.
 */
export async function recordPendingStandingsInvalidation(
  year: number,
  now: () => string = () => new Date().toISOString()
): Promise<void> {
  try {
    await withAppStateKeyTransaction(
      STANDINGS_INVALIDATION_PENDING_SCOPE,
      String(year),
      async (txn) => {
        const prior = (await txn.read<unknown>())?.value;
        const existing = isPendingRecord(prior) ? prior : null;
        await txn.write<PendingStandingsInvalidation>({
          year,
          since: existing?.since ?? now(),
          attempts: existing?.attempts ?? 0,
        });
      }
    );
  } catch (error) {
    console.error('could not record a pending standings invalidation', {
      year,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Clear year `year`'s pending record, but ONLY if it is still the generation the
 * caller observed before its cache walk.
 *
 * THE RACE THIS CLOSES, which an unconditional write does not: a walk takes time, and
 * another schedule writer can commit the same year and record a NEW obligation while
 * it runs. The key transaction serializes the writes, not the walk — so a blind clear
 * would erase an obligation recorded after the walk began, leaving the newest mutation
 * stale with no marker. Re-recording deliberately preserves `since`, so `since` alone
 * cannot distinguish generations; `attempts` moves independently. Both are compared.
 *
 * Passing no `observed` clears unconditionally, which is correct only where no walk
 * preceded the call.
 *
 * NEVER THROWS: every caller runs after a durable commit, and a failure here must not
 * turn a completed state change into a 500.
 */
export async function clearPendingStandingsInvalidation(
  year: number,
  observed?: PendingStandingsInvalidation
): Promise<void> {
  try {
    await withAppStateKeyTransaction(
      STANDINGS_INVALIDATION_PENDING_SCOPE,
      String(year),
      async (txn) => {
        const current = (await txn.read<unknown>())?.value;
        // Nothing pending — do not write. A blind write would create a JSON-null row
        // per refreshed year, and the single-scope commit site is reachable by
        // NON-ADMIN cold reads, so every cold public read that commits would take a
        // pooled client and an advisory lock on this key.
        if (!isPendingRecord(current)) return;
        if (
          observed &&
          (current.since !== observed.since || current.attempts !== observed.attempts)
        ) {
          // A newer obligation arrived while the walk ran. Leave it standing.
          return;
        }
        await txn.write<null>(null);
      }
    );
  } catch (error) {
    console.error('could not clear a pending standings invalidation', {
      year,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Record one failed drain attempt, retaining `since`. Never throws. */
export async function recordPendingDrainAttempt(year: number): Promise<void> {
  try {
    await withAppStateKeyTransaction(
      STANDINGS_INVALIDATION_PENDING_SCOPE,
      String(year),
      async (txn) => {
        const prior = (await txn.read<unknown>())?.value;
        if (!isPendingRecord(prior)) return;
        await txn.write<PendingStandingsInvalidation>({
          ...prior,
          attempts: prior.attempts + 1,
        });
      }
    );
  } catch {
    // Attempt bookkeeping is the least important thing here; the record itself is the
    // fault report and it survives regardless.
  }
}

/**
 * The pending years, oldest fault first, capped at `MAX_PENDING_DRAIN_PER_RUN`.
 *
 * NEVER THROWS — returns an empty list when the store is unavailable, so a drain can
 * never fail the run it runs inside. The refresh succeeded; CARRIES forbids reporting
 * otherwise because a cache repair could not be attempted.
 */
export async function listPendingStandingsInvalidations(
  limit: number = MAX_PENDING_DRAIN_PER_RUN
): Promise<PendingStandingsInvalidation[]> {
  let keys: string[];
  try {
    keys = await listAppStateKeys(STANDINGS_INVALIDATION_PENDING_SCOPE);
  } catch (error) {
    console.error('could not list pending standings invalidations', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  const records: PendingStandingsInvalidation[] = [];
  for (const key of keys) {
    try {
      const row = await getAppState<unknown>(STANDINGS_INVALIDATION_PENDING_SCOPE, key);
      if (isPendingRecord(row?.value)) records.push(row.value);
    } catch {
      // One unreadable key must not hide the rest.
    }
  }

  // FEWEST ATTEMPTS FIRST, then oldest fault. Oldest-first alone STARVES: four years
  // whose walks keep failing would hold every slot on every run forever, and a fifth,
  // repairable year would never be attempted. Ordering by attempts makes a
  // persistently-failing year yield to a fresher one automatically, so the cap rotates
  // instead of merely bounding the damage.
  records.sort(
    (a, b) =>
      a.attempts - b.attempts || Date.parse(a.since) - Date.parse(b.since) || a.year - b.year
  );
  return records.slice(0, limit);
}

/**
 * Discharge outstanding standings invalidations, oldest fault first.
 *
 * Lives HERE rather than in the cron route so the clear-decision is unit-testable:
 * the route cannot inject a walk that busts nothing, because its harness installs a
 * work store that makes `revalidateTag` succeed. That gap was real — a mutation
 * clearing the record unconditionally left the route suite GREEN, so the route test's
 * name claimed a discrimination it did not make.
 *
 * Pure cache work: no provider call, which is what the acceptance boundary required
 * of replay, so it still repairs during a provider outage.
 *
 * NEVER THROWS. The pending record IS the failure report — a drain that fails leaves
 * it uncleared, which is durable evidence that cannot lie by omission.
 */
export type PendingDrainSummary = {
  /** Pending years this run walked. */
  attempted: number;
  /** Years whose walk busted and whose record was cleared. */
  cleared: number;
  /** Years still owing a bust after this run — the only one of the three that is a FAULT. */
  stillPending: number;
};

export async function drainPendingStandingsInvalidations(
  walk: (year: number) => Promise<{ result: 'complete' | 'partial' | 'registry-failed' }>,
  limit: number = MAX_PENDING_DRAIN_PER_RUN
): Promise<PendingDrainSummary> {
  const pending = await listPendingStandingsInvalidations(limit);
  let cleared = 0;
  for (const record of pending) {
    try {
      const outcome = await walk(record.year);
      // CLEAR ONLY ON A WALK THAT ACTUALLY BUSTED. `complete` already encodes
      // `invalidated === attempted`, so a no-op walk cannot clear a fault it never
      // repaired — that would be this item's own defect relocated into its repair path.
      // The observed generation is passed so a newer obligation recorded DURING the
      // walk is not erased by this clear.
      if (outcome.result === 'complete') {
        await clearPendingStandingsInvalidation(record.year, record);
        cleared += 1;
      } else {
        await recordPendingDrainAttempt(record.year);
      }
    } catch (error) {
      console.error('a pending standings invalidation drain threw', {
        year: record.year,
        error: error instanceof Error ? error.message : String(error),
      });
      await recordPendingDrainAttempt(record.year);
    }
  }
  return { attempted: pending.length, cleared, stillPending: pending.length - cleared };
}

/**
 * Discharge ONE year's outstanding bust, if it has one. The second of the two
 * triggers.
 *
 * Lives on the path every full-season caller takes — cron, season-transition,
 * historical repair, and the manual `/api/schedule?bypassCache=1` that the System
 * Health repair link drives — so it is the only trigger the MANUAL paths reach. The
 * cron's drain cannot cover them, exactly as this cannot cover a zero-target run.
 *
 * Without it the designated repair does not repair: a failed bust means content is
 * almost certainly unchanged, so the refresh takes the no-walk-needed sentinel and
 * reports success while the standings stay stale. Both reviewers found that
 * independently.
 *
 * Returns whether a discharge was attempted, so a caller can record it. Never throws.
 */
export async function dischargePendingStandingsInvalidation(
  year: number,
  walk: (year: number) => Promise<{ result: 'complete' | 'partial' | 'registry-failed' }>
): Promise<{ attempted: boolean; cleared: boolean }> {
  let observed: PendingStandingsInvalidation | null = null;
  try {
    const row = await getAppState<unknown>(STANDINGS_INVALIDATION_PENDING_SCOPE, String(year));
    if (isPendingRecord(row?.value)) observed = row.value;
  } catch {
    // Unreadable is not a discharge; the record survives and the cron retries.
    return { attempted: false, cleared: false };
  }
  if (!observed) return { attempted: false, cleared: false };

  try {
    const outcome = await walk(year);
    if (outcome.result !== 'complete') {
      await recordPendingDrainAttempt(year);
      return { attempted: true, cleared: false };
    }
    await clearPendingStandingsInvalidation(year, observed);
    return { attempted: true, cleared: true };
  } catch (error) {
    console.error('a pending standings invalidation discharge threw', {
      year,
      error: error instanceof Error ? error.message : String(error),
    });
    await recordPendingDrainAttempt(year);
    return { attempted: true, cleared: false };
  }
}
