import { draftScope } from '../draft.ts';
import { preseasonOwnerScope } from '../preseasonOwnerStore.ts';
import { listAppStateScopes } from './appStateStore.ts';

/**
 * PLATFORM-086F2I — does stored data still exist under a league slug?
 *
 * Deleting a league removes ONE entry from the registry array. Every durable
 * scope keyed by the slug survives, and four of them hold owner names. Nothing
 * in the app deletes them, so a slug that once held a league keeps its data
 * indefinitely.
 *
 * That matters at creation: `POST /api/admin/leagues` refuses a slug that a LIVE
 * league occupies, but nothing stopped a new league from taking a slug whose
 * previous occupant's rosters, drafts, and archives were still in storage — the
 * new league would adopt them, showing one set of people's names to a commissioner
 * with no relationship to them.
 *
 * This is a STOPGAP, and the comment should stay honest about that: it refuses
 * REUSE, it deletes nothing, and it is not a privacy-erasure feature. Actually
 * removing the data is deferred work.
 */

/**
 * Scopes that are EXACTLY `<prefix>:<slug>` — no trailing segment.
 *
 * These must be compared for equality, never by prefix: `draft:tsc` is a prefix
 * of `draft:tsc-old`, so a prefix test would report that `tsc` has residual data
 * because an unrelated league named `tsc-old` exists. That failure mode makes the
 * guard reject slugs it should allow, which is indistinguishable from the guard
 * working until someone is blocked for no reason.
 */
function exactScopesFor(slug: string): string[] {
  return [
    draftScope(slug),
    preseasonOwnerScope(slug),
    // `standings-archive:<slug>` — the season archives. Spelled out rather than
    // imported because `seasonArchive.ts` keeps `archiveScope` private, and the
    // key shape is pinned by tests on both sides.
    `standings-archive:${slug}`,
  ];
}

/**
 * Scopes of the form `<prefix>:<slug>:<something>` — year- or season-suffixed.
 *
 * The trailing colon is load-bearing for the same reason as above: `owners:tsc`
 * matches `owners:tsc-old:2025`, while `owners:tsc:` cannot.
 */
function scopePrefixesFor(slug: string): string[] {
  return [
    `owners:${slug}:`,
    `insights-suppression:${slug}:`,
    `postseason-overrides:${slug}:`,
    // Legacy league-scoped aliases. The runtime layer was removed by
    // PLATFORM-064/067, but stored rows from before that are still data written
    // under this slug and still count as residue.
    `aliases:${slug}:`,
  ];
}

/**
 * Every scope that still holds data for `slug`, in a deterministic order.
 *
 * Returns the scope NAMES, not their contents: the caller reports that residue
 * exists and where, and never echoes stored values — these scopes contain owner
 * names.
 */
export async function findResidualLeagueScopes(slug: string): Promise<string[]> {
  const found = new Set<string>();

  // One listing per prefix family. `listAppStateScopes` matches by prefix, so an
  // exact scope is checked by listing its own name and comparing.
  await Promise.all([
    ...exactScopesFor(slug).map(async (scope) => {
      const scopes = await listAppStateScopes(scope);
      if (scopes.includes(scope)) found.add(scope);
    }),
    ...scopePrefixesFor(slug).map(async (prefix) => {
      for (const scope of await listAppStateScopes(prefix)) found.add(scope);
    }),
  ]);

  return [...found].sort();
}
