import { randomUUID } from 'node:crypto';

import { getAppStateEntries, withAppStateKeyTransaction } from './appStateStore.ts';

/**
 * PLATFORM-693 v2 — durable "this year's standings bust is still owed" state.
 *
 * ## Why this exists
 *
 * `schedulerExecutionStatus` is latest-only monotonic persistence, ONE ROW PER JOB, so
 * the next run's receipt replaces the failing one. A per-run record therefore cannot
 * carry a per-year standing fact: *"no walk was needed this run"* and *"no walk is
 * outstanding"* are different claims, and without this module nothing distinguishes
 * them. The concrete failure that forced it — a run commits, the bust throws, the year
 * records `partial`; the operator follows the repair link and re-runs; content is now
 * unchanged so the refresh takes the no-walk path, records success, and the warning
 * disappears with standings permanently stale, because they are `revalidate: false`
 * and tag-only.
 *
 * ## THE CONTRACT THIS VERSION EXISTS TO FIX
 *
 * v1 was rebuilt rather than edited because its contract used **a value standing in for
 * a different value**, three times, and the type and signatures were shaped around
 * those substitutions:
 *
 * - It had no identity, and pressed `since` into that role. **`since` is the fault's
 *   AGE, and age is not identity**, and a
 *   re-record reproduced both unchanged — so the generation guard could not see the
 *   concurrent re-record it existed for.
 * - `clear` returned `void` because it must never throw, which conflated *"did not
 *   throw"* with *"did clear"*. Four failed clears reported zero still pending.
 * - `stillPending` was derived from the drained slice because that is where the loop
 *   already was, not because that is the quantity. Ten pending years drained four and
 *   reported zero.
 *
 * Three concepts, three fields, and every count derived from the thing it names.
 *
 * ## Its own scope, never the lease record
 *
 * `releaseScheduleRefreshLease` writes `{ lease: null }` — a WHOLE-RECORD replacement —
 * so a pending flag co-located there is destroyed by the release at the end of the very
 * run that recorded it. **Self-erasing, not untidy.**
 *
 * ## The pending unit is a YEAR
 *
 * Replay re-walks every league for the year, so no slug ever enters this record or the
 * count-only surfaces it feeds. Re-walking is idempotent: `revalidateTag` on an
 * already-busted tag is a no-op. Over-invalidation is correct HERE and wrong on the
 * commit path, and the discriminator is EVIDENCE — the replay path names a year known
 * to have a failed bust, while the commit path has no evidence any bust failed.
 */

export const STANDINGS_INVALIDATION_PENDING_SCOPE = 'standings-invalidation-pending';

/**
 * How many pending years one drain attempts.
 *
 * A RAIL AGAINST PATHOLOGICAL GROWTH of the pending set, and nothing more. It asserts
 * no cost model, deliberately: the rebuild an invalidation causes is deferred to the
 * next READ, so an entry nobody reads costs nothing, the rebuilds never land together,
 * and the active year is already invalidated by every content-changed refresh. A
 * measured standings rebuild would not decide this number and is RETIRED, not deferred.
 */
export const MAX_PENDING_DRAIN_PER_RUN = 4;

export type PendingStandingsInvalidation = {
  /** The year whose canonical standings are still owed a bust. */
  year: number;
  /**
   * IDENTITY of this obligation — a fresh token on every record, never a counter.
   *
   * A counter cannot work here, because clearing removes the record and a counter would
   * restart: a drain holding a stale observation of "1" would match a freshly recorded
   * "1" and erase an obligation it never repaired. A token is identity rather than
   * order, so a later record can never collide with a stale observation.
   */
  token: string;
  /** The fault's AGE, preserved across re-records. Not identity. */
  since: string;
};

function isPendingRecord(value: unknown): value is PendingStandingsInvalidation {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.year === 'number' &&
    Number.isInteger(row.year) &&
    // A v1 record carries no token and therefore FAILS this check, which means
    // `readAllPending` DROPS IT: it is never listed, drained, counted or cleared. That
    // is the truth, and an earlier comment here claimed the opposite — that a drain
    // would re-observe it and succeed — while the test one file over pinned the drop.
    // Harmless in fact (v1 never reached `main`, so no such row exists), and recorded
    // because a comment asserting a recovery that does not happen is the defect this
    // module's own history is made of. Anything unreadable is surfaced by the counter
    // below rather than vanishing.
    typeof row.token === 'string' &&
    row.token.length > 0 &&
    typeof row.since === 'string'
  );
}

/**
 * Every outstanding obligation, in ONE query.
 *
 * `getAppStateEntries` returns keys and values together. v1 listed keys and then issued
 * a read per key, which is the shape this rebuild exists not to keep.
 */
async function readAllPending(): Promise<{
  records: PendingStandingsInvalidation[];
  unreadable: number;
}> {
  const entries = await getAppStateEntries<unknown>(STANDINGS_INVALIDATION_PENDING_SCOPE);
  const records: PendingStandingsInvalidation[] = [];
  let unreadable = 0;
  for (const entry of entries) {
    if (isPendingRecord(entry.value)) {
      records.push(entry.value);
      continue;
    }
    // A CLEARED MARKER is `null` and is not a fault — see the note where it is written.
    if (entry.value === null) continue;
    // ANYTHING ELSE is an obligation this module can no longer read, and dropping it
    // silently would destroy the obligation in the one module whose purpose is to stop
    // obligations being destroyed. It cannot be drained (the walk needs a year it can
    // trust), so it is COUNTED and LOGGED instead of vanishing.
    unreadable += 1;
    console.error('unreadable pending standings-invalidation record', { key: entry.key });
  }
  return { records, unreadable };
}

/**
 * The obligation outstanding for ONE year, or `undefined`.
 *
 * Exists because R3's two post-walk clear sites must observe the obligation BEFORE
 * their walk: a clear needs the token it is clearing, and reading it after the walk
 * would observe whatever landed during it — which is the race the token closes.
 *
 * NEVER THROWS: an unreadable store yields `undefined`, so a caller treats it as
 * "nothing to clear" and the obligation survives for the cron's drain.
 */
export async function readPendingStandingsInvalidation(
  year: number
): Promise<PendingStandingsInvalidation | undefined> {
  try {
    return (await readAllPending()).records.find((record) => record.year === year);
  } catch {
    return undefined;
  }
}

/**
 * Mark year `year` as owing a standings bust.
 *
 * Every call records a NEW OBLIGATION and therefore a new `token`, even when one is
 * already outstanding — that is what lets a clear tell a pre-walk observation from an
 * obligation recorded while the walk ran. `since` carries forward, because the fault's
 * age survives a re-record.
 *
 * NEVER THROWS. Every caller runs after a durable commit, so a failure here must not
 * turn a completed state change into a 500 — the invariant the original swallow was
 * right about, even while it was wrong about what to do with the failure.
 */
export async function recordPendingStandingsInvalidation(
  year: number,
  now: () => string = () => new Date().toISOString(),
  nextToken: () => string = () => randomUUID()
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
          token: nextToken(),
          since: existing?.since ?? now(),
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
 * Clear year `year`'s obligation, but only the exact one the caller observed.
 *
 * RETURNS WHETHER IT CONFIRMED A CLEAR, and that is load-bearing rather than
 * convenience: this function must never throw, so a `void` return would make "the store
 * failed", "another obligation arrived" and "cleared" indistinguishable — which is how
 * four failed clears came to report zero still pending.
 *
 * THE RACE THE TOKEN CLOSES: a walk takes time, and another writer can commit the same
 * year and record a new obligation while it runs. The key transaction serializes the
 * WRITES, not the walk. `since` carries forward across re-records, so it cannot
 * distinguish generations — only the token can.
 *
 * The no-op case is decided BEFORE opening a transaction. `withAppStateKeyTransaction`
 * takes a per-key `pg_advisory_xact_lock` before running its callback, so deciding
 * inside would serialize every caller on this key. Reading first does not avoid a pooled
 * client (`getAppStateEntries` takes one too); it avoids the LOCK.
 *
 * AN EARLIER VERSION OF THIS NOTE CLAIMED the single-scope commit site is reachable by
 * NON-ADMIN cold reads. It is NOT — every non-admin path returns before the commit
 * (`route.ts:743`). That claim came from a review finding and was written here without
 * being checked: a finding's PREMISE arrives wrapped in the authority of its conclusion,
 * and adjudication is aimed at the conclusion. The conclusion held; the premise did not.
 */
export async function clearPendingStandingsInvalidation(
  year: number,
  observed: PendingStandingsInvalidation
): Promise<boolean> {
  try {
    const current = (await readAllPending()).records.find((record) => record.year === year);
    if (!current || current.token !== observed.token) return false;

    return await withAppStateKeyTransaction(
      STANDINGS_INVALIDATION_PENDING_SCOPE,
      String(year),
      async (txn) => {
        // Re-checked INSIDE the lock: the read above is advisory, and an obligation can
        // land between it and here.
        const inside = (await txn.read<unknown>())?.value;
        if (!isPendingRecord(inside) || inside.token !== observed.token) return false;
        // WRITTEN `null`, DELIBERATELY NOT DELETED — and this is a correctness choice,
        // not an oversight, so do not "fix" it.
        //
        // `AppStateKeyTxn` exposes read/write/readKey/writeKey/lockKey and NO delete, so
        // a generation-checked delete does not exist. Both routes to one are worse than
        // the marker they remove:
        //   - Deleting after COMMIT reopens the exact race the token closes. An
        //     obligation can land between the commit and the delete, and the delete
        //     removes it — the erasure this module exists to prevent, reintroduced by
        //     the cleanup for it.
        //   - Calling `deleteAppState` inside this callback is a nested store call while
        //     holding a transaction client, which is #595's shape against a
        //     three-connection pool.
        //
        // The cost a delete would save is already gone: `readAllPending` reads the whole
        // scope in ONE query, so a cleared marker is a filtered row in a result set
        // rather than a round trip, and the row count is bounded by distinct years ever
        // pended. `isPendingRecord` rejects `null`, which is what keeps a marker from
        // ever being read back as an obligation — pinned by test.
        await txn.write<null>(null);
        return true;
      }
    );
  } catch (error) {
    console.error('could not clear a pending standings invalidation', {
      year,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * The obligations this run should attempt, OLDEST FAULT FIRST.
 *
 * **THIS ORDERING CAN STARVE, AND THAT IS A KNOWN COST OF REMOVING `attempts` — it is
 * stated here rather than discovered later.** This list used to order fewest-attempts
 * first, precisely so that `MAX_PENDING_DRAIN_PER_RUN` permanently unrepairable years
 * could not hold every slot on every run while a newer, REPAIRABLE year was never
 * attempted. Ordering by effort made the cap rotate; ordering by age does not.
 *
 * The counter that made rotation possible was removed because it was load-bearing for a
 * severity escalation that could not work (a successful clear wiped the history, so the
 * escalation was unreachable for the flapping fault it targeted). Rotation was the
 * counter's ONE surviving justification, and it is not enough on its own to keep a field
 * whose bookkeeping produced two defects. The starvation is filed rather than fixed.
 *
 * NEVER THROWS — an unavailable store yields an empty list, so a drain can never fail
 * the run it runs inside.
 */
export async function listPendingStandingsInvalidations(
  limit: number = MAX_PENDING_DRAIN_PER_RUN
): Promise<PendingStandingsInvalidation[]> {
  try {
    const { records } = await readAllPending();
    records.sort((a, b) => Date.parse(a.since) - Date.parse(b.since) || a.year - b.year);
    return records.slice(0, limit);
  } catch (error) {
    console.error('could not list pending standings invalidations', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * How many years still owe a bust, across the WHOLE durable set.
 *
 * Deliberately not derived from the drained slice: that is capped at
 * `MAX_PENDING_DRAIN_PER_RUN`, so ten pending years would drain four and report zero
 * while six stayed stale.
 *
 * THIS COMMENT USED TO SAY *"never throws — an unreadable store reports 0"*, and that
 * was false when it was written: the body already returned `'unavailable'`, for the
 * reason its own `catch` states. Corrected here rather than left, because a comment
 * promising 0 is exactly what would license a caller to skip handling the unknown —
 * the false all-clear this module exists to prevent, arriving through the documentation
 * instead of the code. Pinned by *"a store failure reports
 * UNAVAILABLE, never zero"* in `standingsInvalidationPending.test.ts`.
 *
 * UNREADABLE ROWS COUNT. They are obligations this module can no longer act on, and
 * reporting them as zero would be the false all-clear in a new costume.
 */
export async function countPendingStandingsInvalidations(): Promise<number | 'unavailable'> {
  try {
    const { records, unreadable } = await readAllPending();
    // Unreadable rows COUNT. They are obligations this module can no longer act on, and
    // reporting them as zero would be the false all-clear in a new costume.
    return records.length + unreadable;
  } catch {
    // NOT 0. A transient store failure is not an empty set, and returning a count here
    // would let a deferred receipt write publish a false all-clear over a standing
    // warning while the standings are still stale — this issue's own defect, one more
    // time. The caller must decide what to do with "unknown", and what it must not do
    // is overwrite a known prior with it.
    return 'unavailable';
  }
}

/**
 * Attempt every obligation this run is willing to take, then report how many remain
 * across the whole durable set.
 *
 * RETURNS ONLY A LOWER BOUND, and deliberately not "how many are still pending": a count
 * taken here is a PRE-RUN snapshot: the run's own per-year refreshes can still clear an overflow obligation
 * through the authority's discharge, or record a new one, after this returns. The
 * caller recounts immediately before building its receipt, and uses `observed` ONLY as a
 * fallback when that fresh count is unavailable — where reporting zero would be a false
 * all-clear. Drain volume (attempted, cleared) still has no reader and is not computed.
 *
 * Pure cache work: it re-walks a recorded year and makes no provider call, which is what
 * replay was required to be.
 *
 * NEVER THROWS.
 */
export async function drainPendingStandingsInvalidations(
  walk: (year: number) => Promise<{ result: 'complete' | 'partial' | 'registry-failed' }>,
  limit: number = MAX_PENDING_DRAIN_PER_RUN
): Promise<{ observed: number }> {
  const pending = await listPendingStandingsInvalidations(limit);
  for (const record of pending) {
    try {
      const outcome = await walk(record.year);
      // CLEAR ONLY ON A WALK THAT ACTUALLY BUSTED. `complete` already encodes
      // `invalidated === attempted`, so a walk that busted nothing cannot clear a fault
      // it never repaired. The observed record is passed, so an obligation recorded
      // DURING the walk survives this clear.
      if (outcome.result === 'complete') {
        // A clear that DECLINES means a newer obligation landed mid-walk, and the
        // token is what refuses it. Nothing is recorded either way: a walk that failed
        // leaves the obligation exactly as it was, which IS the fault report.
        await clearPendingStandingsInvalidation(record.year, record);
      }
    } catch (error) {
      console.error('a pending standings invalidation drain threw', {
        year: record.year,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { observed: pending.length };
}

/**
 * Discharge ONE year's outstanding obligation, if it has one. The second of two
 * triggers.
 *
 * TWO TRIGGERS BECAUSE THERE ARE TWO REACHABILITY GAPS, not two placements of one idea:
 * the cron's drain cannot cover the MANUAL paths, and this cannot cover a zero-target
 * run, because the authority is never called when there are no targets. This one sits
 * on the path every full-season caller takes — cron, season-transition, historical
 * repair, and the manual `/api/schedule?bypassCache=1` the System Health repair link
 * drives — which is what makes the designated repair actually repair.
 *
 * Returns nothing, and its failure is deliberately not reported by a return value: the
 * OBLIGATION ITSELF is the durable trace and the cron's drain retries it. A returned
 * flag no caller reads is a computed value with no reader.
 *
 * SCOPE, stated because the v1 comment overstated it: this runs AFTER the provider fetch
 * and commit, so a provider failure returns before reaching it. **It is not a
 * provider-outage repair path** — the cron's drain, which runs ahead of all provider
 * work, is.
 *
 * NEVER THROWS.
 */
export async function dischargePendingStandingsInvalidation(
  year: number,
  walk: (year: number) => Promise<{ result: 'complete' | 'partial' | 'registry-failed' }>
): Promise<void> {
  let observed: PendingStandingsInvalidation | undefined;
  try {
    observed = (await readAllPending()).records.find((record) => record.year === year);
  } catch {
    // Unreadable is not a discharge; the obligation survives and the cron retries.
    return;
  }
  if (!observed) return;

  try {
    const outcome = await walk(year);
    // NOTHING IS RECORDED ON FAILURE, and that deletes a defect rather than fixing one.
    // This used to charge an attempt whenever the clear returned false — but
    // `clearPendingStandingsInvalidation` returns false BOTH when a newer obligation
    // landed mid-walk AND from its own catch when the store threw, so a successful walk
    // whose clear hit a transient error was charged for a repair that worked. The drain
    // path never did this. With the counter gone the question does not arise.
    if (outcome.result === 'complete') await clearPendingStandingsInvalidation(year, observed);
  } catch (error) {
    console.error('a pending standings invalidation discharge threw', {
      year,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
