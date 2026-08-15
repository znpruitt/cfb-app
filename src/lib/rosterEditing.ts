/**
 * PLATFORM-099 — the roster editor's pure decisions: which rows the table shows
 * and in what order, and what a save will actually do.
 *
 * Extracted from `RosterEditorPanel.tsx` because putting them there took that
 * component from 456 to 599 lines, against the `AGENTS.md` guardrail that shared
 * logic moves to `src/lib/` as a component approaches ~600. Review caught it.
 *
 * Being out here is also what makes them testable: the panel fetches its roster
 * on mount, so a statically rendered assertion only ever sees the loading state —
 * coverage that looks real and observes nothing.
 */

export type TeamEntry = { school: string; conference: string };

export type SortKey = 'school' | 'conference' | 'owner';
export type SortDir = 'asc' | 'desc';

export const SORTABLE_COLUMNS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'school', label: 'Team' },
  { key: 'conference', label: 'Conference' },
  { key: 'owner', label: 'Owner' },
];

/**
 * The rows the table shows, filtered and ordered — PLATFORM-099.
 *
 * Sortable by OWNER, because the task that brings a commissioner to this page is
 * "fix what this person holds", and by school or conference a person's teams are
 * scattered down a 130-row table.
 *
 * Ordered by the COMMITTED owners, deliberately: ordering by the unsaved edit map
 * re-sorts on every KEYSTROKE, so typing into an unowned team's field moves that
 * row out of the unowned block mid-word and the input slides away under the
 * cursor. A row settling into place on Save is the far smaller surprise.
 *
 * Exported so the ordering is testable directly. The component fetches on mount,
 * so a rendered assertion would only ever see its loading state.
 */
export function selectRosterRows(
  teams: readonly TeamEntry[],
  opts: { search: string; sortKey: SortKey; sortDir: SortDir; savedOwners: Map<string, string> }
): TeamEntry[] {
  const { search, sortKey, sortDir, savedOwners } = opts;
  const needle = search.toLowerCase();
  return teams
    .filter((t) => t.school.toLowerCase().includes(needle))
    .sort((a, b) => {
      if (sortKey === 'owner') {
        const ao = savedOwners.get(a.school) ?? '';
        const bo = savedOwners.get(b.school) ?? '';
        // Unowned teams sort LAST in both directions rather than clumping at the
        // top under descending: they are the backdrop to this task, not part of
        // it, and an empty string sorts before every name.
        if (ao === '' && bo !== '') return 1;
        if (bo === '' && ao !== '') return -1;
        const byOwner = ao.localeCompare(bo);
        const cmp = byOwner !== 0 ? byOwner : a.school.localeCompare(b.school);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const av = sortKey === 'school' ? a.school : a.conference;
      const bv = sortKey === 'school' ? b.school : b.conference;
      const cmp = av.localeCompare(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });
}

/**
 * How many teams the OPERATOR has edited — the Save gate.
 *
 * Iterates the catalog rather than the maps, so it can only ever count rows the
 * table actually shows. `handleOwnerChange` writes unconditionally, so typing a
 * character into an unowned field and deleting it leaves `school -> ''` that the
 * saved map lacks; normalizing both sides to `''` makes that the non-change it
 * is.
 */
export function countEditedTeams(
  savedOwners: Map<string, string>,
  draftOwners: Map<string, string>,
  teams: readonly TeamEntry[]
): number {
  let n = 0;
  for (const { school } of teams) {
    if ((savedOwners.get(school) ?? '') !== (draftOwners.get(school) ?? '')) n++;
  }
  return n;
}

/**
 * Rows the save will DELETE because their team is not in the catalog.
 *
 * `buildCsv` emits rows only for teams present in `teams`, so a stored roster row
 * whose school is absent from it disappears on save while both maps hold it
 * identically. Reported separately rather than folded into the edit count, and
 * that separation is a correction: one number served as both the Save gate and
 * the confirmation's headline, and `teams` is the STATIC `teams.json` import
 * while the stored CSV was validated against the mutable team database seeded
 * from it. A school present in one and not the other pinned the count at >= 1
 * permanently — which collapsed the gate back to `hasChanges` and inflated every
 * real edit by a number the operator cannot see, since those rows are not in the
 * table.
 */
export function countDroppedRows(
  savedOwners: Map<string, string>,
  teams: readonly TeamEntry[]
): number {
  const catalogSchools = new Set(teams.map((t) => t.school));
  let n = 0;
  for (const [school, owner] of savedOwners) {
    if (owner !== '' && !catalogSchools.has(school)) n++;
  }
  return n;
}
