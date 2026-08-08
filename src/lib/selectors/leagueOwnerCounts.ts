import { parseOwnersCsv } from '../parseOwnersCsv.ts';

/**
 * PLATFORM-088 — how many distinct people own teams in a stored roster.
 *
 * Lives here because AGENTS.md invariant 9 is unambiguous: *"All derived league
 * data must be computed in `src/lib/selectors/`. Never inline in UI components.
 * Any derivation found outside `src/lib/selectors/` is an architecture
 * violation."* This counting was previously inline in the homepage RSC, and the
 * first pass at PLATFORM-088 relocated it into `src/components/` — which was
 * worse, not better.
 *
 * Pure: same input, same output, no reads and no side effects. The caller does
 * the storage lookup and hands the CSV text in.
 */

/** The roster sentinel for an unclaimed team — a marker, never a person. */
export const NO_CLAIM_OWNER = 'NoClaim';

export function countDistinctOwners(csvText: string | null | undefined): number {
  if (!csvText) return 0;
  // The shared header-aware parser, never a positional split on the first comma:
  // it locates the owner column by name and handles quoted fields, so a
  // reordered header or a team name containing a comma still counts correctly.
  const owners = new Set(
    parseOwnersCsv(csvText)
      .map((row) => row.owner.trim())
      .filter((owner) => owner.length > 0 && owner !== NO_CLAIM_OWNER)
  );
  return owners.size;
}
