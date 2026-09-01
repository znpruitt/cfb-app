import { workAsyncStorage } from 'next/dist/server/app-render/work-async-storage.external';

import { getLeagues } from '@/lib/leagueRegistry';
import {
  getCanonicalStandings,
  invalidateStandings,
  standingsYearTag,
} from '@/lib/selectors/leagueStandings';
import { withAppStateKeyTransaction } from '@/lib/server/appStateStore';

type CanonicalStandingsWarmer = (slug: string, year: number) => Promise<unknown>;
type CanonicalStandingsInvalidator = (
  leagues: Array<{ slug: string }>,
  year: number
) => Promise<boolean>;
type DurableLockAttemptObserver = (year: number) => void;

let standingsMaintenanceTail: Promise<void> = Promise.resolve();
let observeDurableLockAttempt: DurableLockAttemptObserver | null = null;

let warmCanonicalStandings: CanonicalStandingsWarmer = (slug, year) =>
  getCanonicalStandings({ slug, year });
async function invalidateCanonicalStandingsImmediately(
  leagues: Array<{ slug: string }>,
  year: number
): Promise<boolean> {
  const store = workAsyncStorage.getStore();
  const incrementalCache = store?.incrementalCache;
  const immediateInvalidator = incrementalCache?.revalidateTag;
  if (typeof immediateInvalidator !== 'function') {
    // Outside an App Router cache context there is no cache to warm. Preserve
    // the established best-effort invalidation behavior, but do not pretend a
    // persistent warm was published.
    for (const league of leagues) invalidateStandings(league.slug, year);
    return false;
  }

  await immediateInvalidator.call(
    incrementalCache,
    leagues.map((league) => standingsYearTag(league.slug, year))
  );
  return true;
}

let invalidateCanonicalStandings: CanonicalStandingsInvalidator =
  invalidateCanonicalStandingsImmediately;

/** Test-only seam for observing/non-fatally failing the post-write warm. */
export function __setCanonicalStandingsWarmerForTests(
  warmer: CanonicalStandingsWarmer | null
): void {
  warmCanonicalStandings = warmer ?? ((slug, year) => getCanonicalStandings({ slug, year }));
}

export function __setCanonicalStandingsInvalidatorForTests(
  invalidator: CanonicalStandingsInvalidator | null
): void {
  invalidateCanonicalStandings = invalidator ?? invalidateCanonicalStandingsImmediately;
}

export function __setStandingsDurableLockAttemptObserverForTests(
  observer: DurableLockAttemptObserver | null
): void {
  observeDurableLockAttempt = observer;
}

function pendingRevalidates(): Record<string, Promise<unknown>> {
  return workAsyncStorage.getStore()?.pendingRevalidates ?? {};
}

async function withInProcessStandingsMaintenanceLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = standingsMaintenanceTail;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(
    () => held,
    () => held
  );
  standingsMaintenanceTail = tail;

  await previous.then(
    () => undefined,
    () => undefined
  );
  try {
    return await operation();
  } finally {
    release();
    if (standingsMaintenanceTail === tail) standingsMaintenanceTail = Promise.resolve();
  }
}

async function invalidateWithoutDurableLock(
  leagues: Array<{ slug: string }>,
  year: number
): Promise<void> {
  try {
    await invalidateCanonicalStandings(leagues, year);
  } catch {
    // The score write is already durable. Cache maintenance remains best-effort.
  }
}

async function maintainStandingsForYear(year: number, warm: boolean): Promise<void> {
  try {
    // Every same-process caller queues BEFORE acquiring a PostgreSQL client,
    // including callers for different years. The pool has three clients, and a
    // maintenance operation holds one advisory-lock client while canonical
    // standings reads borrow ordinary clients. Allowing three different-year
    // operations to enter together would consume the pool and leave all three
    // waiting indefinitely for a nested read. Cross-instance ordering remains
    // per-year through the advisory key below; pools are process-local.
    await withInProcessStandingsMaintenanceLock(async () => {
      const leagues = await getLeagues();
      if (leagues.length === 0) return;

      try {
        observeDurableLockAttempt?.(year);
        // The advisory key serializes cache maintenance for this year across
        // instances. Score commits remain outside this lock; every committing
        // writer enters it afterwards, so the final holder observes the newest
        // durable score view.
        await withAppStateKeyTransaction('standings-cache-warm', String(year), async () => {
          // Public `revalidateTag` queues work until an App Route finalizes.
          // Await the request's incremental-cache invalidator directly so the
          // warm is ordered strictly after expiration.
          const invalidatedImmediately = await invalidateCanonicalStandings(leagues, year);
          if (!warm || !invalidatedImmediately) return;

          const pendingBefore = new Map(Object.entries(pendingRevalidates()));
          await Promise.allSettled(
            leagues.map((league) => warmCanonicalStandings(league.slug, year))
          );
          // `unstable_cache` publishes through `pendingRevalidates` in an App
          // Route. Hold both locks until these new writes settle so an older
          // publication cannot land after a newer invalidation.
          const newWrites = Object.entries(pendingRevalidates())
            .filter(([key, promise]) => pendingBefore.get(key) !== promise)
            .map(([, promise]) => promise);
          await Promise.allSettled(newWrites);
        });
      } catch {
        // A durable-lock/client failure must not erase the established
        // post-commit invalidation attempt. Retrying without serialization can
        // leave a cold cache, but it prevents a tag-only snapshot from remaining
        // valid indefinitely.
        await invalidateWithoutDurableLock(leagues, year);
      }
    });
  } catch {
    // Non-fatal — scores already persisted; a later mutation can recover.
  }
}

/**
 * Invalidate and immediately recompute canonical standings for every league at
 * `year`. Scores are season-scoped, not league-scoped, so score writers walk
 * the registry. The writer pays the recomputation once so the next member
 * request reads a warm snapshot.
 *
 * Failures remain non-fatal because callers invoke this only after durable
 * scores have committed; a cold cache is preferable to relabelling or rolling
 * back a valid score write.
 */
export async function invalidateAndWarmStandingsForYear(year: number): Promise<void> {
  await maintainStandingsForYear(year, true);
}

/** Invalidate after a durable score commit without publishing an intermediate warm. */
export async function invalidateStandingsForYear(year: number): Promise<void> {
  await maintainStandingsForYear(year, false);
}
