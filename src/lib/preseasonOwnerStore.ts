import { getAppState, setAppState } from './server/appStateStore.ts';

function scope(slug: string): string {
  return `preseason-owners:${slug}`;
}

/**
 * Read the preseason owner names for a league/year, or `null` when none were
 * stored.
 *
 * Cache valid absence, never cache uncertainty (PLATFORM-084A): `null` means a
 * genuine miss — no preseason-owners record exists — which is a legitimate,
 * cacheable state (the caller falls through to the awaiting-kickoff snapshot).
 * A store-read FAILURE is NOT absence: `getAppState` returns `null` only when
 * the row is missing and throws on a real store error, so we deliberately do
 * NOT catch here. Swallowing a failure to `null` would let the canonical
 * standings selector cache "no preseason owners" as valid output when we simply
 * failed to read them.
 */
export async function getPreseasonOwners(slug: string, year: number): Promise<string[] | null> {
  const record = await getAppState<string[]>(scope(slug), String(year));
  return record?.value ?? null;
}

export async function savePreseasonOwners(
  slug: string,
  year: number,
  owners: string[]
): Promise<void> {
  await setAppState<string[]>(scope(slug), String(year), owners);
}
