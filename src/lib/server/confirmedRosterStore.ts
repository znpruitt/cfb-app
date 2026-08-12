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
export async function getConfirmedRoster(slug: string, year: number): Promise<ConfirmedRoster> {
  const [confirmedRecord, ownersCsvRecord] = await Promise.all([
    // Read through the shared key builder rather than `getPreseasonOwners`, so a
    // legacy row of the wrong SHAPE reaches the selector as the untrusted value
    // it is instead of being asserted into `string[] | null`.
    getAppState<unknown>(preseasonOwnerScope(slug), String(year)),
    getAppState<unknown>(`owners:${slug}:${year}`, 'csv'),
  ]);

  return selectConfirmedRoster({
    confirmedOwnersRecord: confirmedRecord?.value ?? null,
    ownersCsvRecord: ownersCsvRecord?.value ?? null,
  });
}
