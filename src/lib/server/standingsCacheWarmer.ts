import { getLeagues } from '@/lib/leagueRegistry';
import { getCanonicalStandings, invalidateStandings } from '@/lib/selectors/leagueStandings';

type CanonicalStandingsWarmer = (slug: string, year: number) => Promise<unknown>;

let warmCanonicalStandings: CanonicalStandingsWarmer = (slug, year) =>
  getCanonicalStandings({ slug, year });

/** Test-only seam for observing/non-fatally failing the post-write warm. */
export function __setCanonicalStandingsWarmerForTests(
  warmer: CanonicalStandingsWarmer | null
): void {
  warmCanonicalStandings = warmer ?? ((slug, year) => getCanonicalStandings({ slug, year }));
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
    for (const league of leagues) {
      invalidateStandings(league.slug, year);
    }
    await Promise.allSettled(leagues.map((league) => warmCanonicalStandings(league.slug, year)));
  } catch {
    // Non-fatal — scores already persisted; the next reader can recompute.
  }
}
