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

import { NO_CLAIM_OWNER } from './standings.ts';

export type TeamEntry = { school: string; conference: string };

/**
 * Whether a stored owner value means "nobody holds this team" — PLATFORM-100.
 *
 * TWO representations, and missing the second is the defect this closes.
 * Before a draft is confirmed an unowned team is simply absent from the roster,
 * so it reads as `''`. `buildConfirmedOwnersCsv` then writes `NoClaim` as a real
 * owner string for EVERY undrafted team, so after confirmation ~120 rows carry
 * it. Treating only `''` as unowned sorted those alphabetically among real
 * owners, which under descending order clumped them at the top — burying the
 * rows a commissioner came to work on, on the page they are sent to in order to
 * fix ownership.
 *
 * Found by the owner in one click on a confirmed league. It survived the tests
 * because the fixture represented unowned teams the FIRST way and the assertion
 * generalised to both.
 */
function isUnowned(owner: string): boolean {
  return owner === '' || owner === NO_CLAIM_OWNER;
}

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
        // Unowned teams sort LAST in both directions rather than clumping at one
        // end: they are the backdrop to this task, not part of it. `isUnowned`
        // rather than an emptiness check, because a confirmed roster spells this
        // `NoClaim`.
        const aUnowned = isUnowned(ao);
        const bUnowned = isUnowned(bo);
        if (aUnowned && !bUnowned) return 1;
        if (bUnowned && !aUnowned) return -1;
        // Two unowned rows are EQUAL on owner and fall to the school tiebreaker.
        // Comparing the raw strings left `''` and `NoClaim` as sub-groups inside
        // the trailing block that swapped ends whenever the direction toggled —
        // reachable on any confirmed league that also has catalog teams with no
        // stored row, a state this panel itself produces. If these rows are the
        // backdrop rather than the task, they should not move at all.
        const byOwner = aUnowned && bUnowned ? 0 : ao.localeCompare(bo);
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
    const before = savedOwners.get(school) ?? '';
    const after = draftOwners.get(school) ?? '';
    // `isUnowned` on BOTH sides — review caught this function sitting between two
    // that were unified and still comparing raw strings. `NoClaim` and `''` are
    // the same fact, so clearing a `NoClaim` field changes nothing about
    // ownership. Bulk Reassign makes that a one-click mass action (From
    // `NoClaim`, To blank — which the field's own placeholder advertises), and it
    // reported "120 teams change owner" for a save that changed nobody's.
    if (isUnowned(before) && isUnowned(after)) continue;
    if (before !== after) n++;
  }
  return n;
}

/**
 * Owner claims the save will DROP because the team is not in the catalog.
 *
 * `buildCsv` emits rows only for teams present in `teams`, so a stored roster row
 * whose school is absent from it disappears on save while both maps hold it
 * identically.
 *
 * Deliberately NOT an exact count of rows deleted: a `NoClaim` orphan row is
 * deleted too, and nobody held it. The figure exists to warn about losing
 * SOMEONE'S TEAM, so the UI says exactly that — review found the number and the
 * sentence describing it had drifted apart, leaving the prompt claiming to count
 * rows while counting owner claims.
 *
 * Reported separately rather than folded into the edit count, and
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
    // `isUnowned`, not an emptiness check — PLATFORM-100. A `NoClaim` row for a
    // team that has left the catalog IS removed by the save, but nobody held it,
    // so counting it inflates "N rows will be removed" with a row whose loss
    // means nothing. The figure exists to warn about losing someone's team.
    if (!isUnowned(owner) && !catalogSchools.has(school)) n++;
  }
  return n;
}
