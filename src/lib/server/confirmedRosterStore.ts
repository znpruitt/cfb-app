import { getAppState } from './appStateStore.ts';
import { preseasonOwnerScope } from '../preseasonOwnerStore.ts';
import { selectConfirmedRoster, type ConfirmedRoster } from '../selectors/confirmedRoster.ts';

/**
 * PLATFORM-092 — the storage half of "who is in this league this season".
 *
 * Split from the selector because AGENTS.md → Selectors is explicit that
 * selectors perform no database access, and because `MIN_CONFIRMED_OWNERS` and
 * the name-cleaning helpers have to stay importable by client-reachable modules
 * without dragging `appStateStore` along.
 *
 * Store-read failures PROPAGATE. `getAppState` returns `null` only for genuine
 * absence and throws on a real failure (PLATFORM-084A). Swallowing that here
 * would turn "the store is down" into "this league has no owners", which on this
 * path silently BLOCKS a legitimate draft rather than merely showing an empty
 * surface.
 */
/**
 * The roster AND the owners CSV text it was resolved from, in ONE pass.
 *
 * INSIGHTS-023a — `buildLeagueInsightContext` read `owners:{slug}:{year}` twice
 * per uncached build: once for the team→owner map and once, concurrently, inside
 * `getConfirmedRoster`. Two unsynchronized reads of one row, so a `PUT
 * /api/owners` landing between them yields membership and the roster map from
 * different generations of the same CSV — and the membership source is then
 * classified against a roster that is not the one it was derived from. Callers
 * that need both must take both from here.
 */
export async function readConfirmedRosterInputs(
  slug: string,
  year: number
): Promise<{ roster: ConfirmedRoster; ownersCsv: string | null }> {
  const [confirmedRecord, ownersCsvRecord] = await Promise.all([
    // Read through the shared key builder rather than `getPreseasonOwners`, so a
    // legacy row of the wrong SHAPE reaches the selector as the untrusted value
    // it is instead of being asserted into `string[] | null`.
    getAppState<unknown>(preseasonOwnerScope(slug), String(year)),
    getAppState<unknown>(`owners:${slug}:${year}`, 'csv'),
  ]);

  return {
    roster: selectConfirmedRoster({
      confirmedOwnersRecord: confirmedRecord?.value ?? null,
      ownersCsvRecord: ownersCsvRecord?.value ?? null,
    }),
    ownersCsv: typeof ownersCsvRecord?.value === 'string' ? ownersCsvRecord.value : null,
  };
}

export async function getConfirmedRoster(slug: string, year: number): Promise<ConfirmedRoster> {
  return (await readConfirmedRosterInputs(slug, year)).roster;
}
