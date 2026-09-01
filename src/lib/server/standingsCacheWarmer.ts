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

function pendingRevalidates(): Record<string, Promise<unknown>> {
  return workAsyncStorage.getStore()?.pendingRevalidates ?? {};
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
  try {
    const leagues = await getLeagues();
    if (leagues.length === 0) return;

    // The advisory key serializes cache maintenance for this year across
    // instances. Score commits remain outside this lock; every committing writer
    // enters it afterwards, so the final holder always recomputes from the newest
    // durable score view instead of allowing an older warm to publish last.
    await withAppStateKeyTransaction('standings-cache-warm', String(year), async () => {
      // `revalidateTag` queues work until an App Route finalizes. Warming before
      // that queue drains writes a snapshot which the same request then evicts.
      // Await the request's incremental-cache invalidator directly so the warm
      // is ordered strictly after expiration.
      const invalidatedImmediately = await invalidateCanonicalStandings(leagues, year);
      if (!invalidatedImmediately) return;

      const pendingBefore = new Map(Object.entries(pendingRevalidates()));
      await Promise.allSettled(leagues.map((league) => warmCanonicalStandings(league.slug, year)));
      // `unstable_cache` publishes through `pendingRevalidates` in an App Route.
      // Hold the cross-instance lock until these new writes settle; otherwise a
      // later writer could invalidate/warm and release before this older write
      // lands.
      const newWrites = Object.entries(pendingRevalidates())
        .filter(([key, promise]) => pendingBefore.get(key) !== promise)
        .map(([, promise]) => promise);
      await Promise.allSettled(newWrites);
    });
  } catch {
    // Non-fatal — scores already persisted; the next reader can recompute.
  }
}
