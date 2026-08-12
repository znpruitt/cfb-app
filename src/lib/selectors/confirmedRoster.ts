import { NO_CLAIM_OWNER } from '../standings.ts';
import { parseOwnersCsv } from '../parseOwnersCsv.ts';

/**
 * PLATFORM-092 — who is in this league for this season.
 *
 * The invariant: **owners must be confirmed before a draft can occur.**
 *
 * The defect underneath it is not a missing check. `DraftState.owners` is a COPY
 * of the season roster, captured when the draft is created, and the only screen
 * that changes owners — `/admin/[slug]/preseason/owners` — never touches the
 * draft record. `/league/[slug]/draft/setup` cannot edit owners at all
 * (`DraftSettingsPanel` holds them in a setter-less `useState`; the component
 * that had the editor is dead code). Nothing reconciles the two, and every
 * mutation path was free to write a third answer.
 *
 * This module is the single answer to the question. Callers do not compare their
 * own owner list against it — they take it.
 *
 * **Why the confirmation record wins over the CSV, when `resolvePreseason` does
 * the opposite.** They answer different questions. This one answers "who is in
 * the league", which the commissioner controls directly, so re-confirming owners
 * must take effect immediately — a CSV-first rule makes adding an owner a silent
 * no-op for the rest of the season. `resolvePreseason` answers "what standings
 * rows can I draw", which needs the team→owner mapping only the CSV carries.
 * Preferring different records for different questions is correct; the mistake
 * would be having two answers to the SAME question.
 *
 * Kept pure (AGENTS.md → Selectors: no database access). The reads live in
 * `src/lib/server/confirmedRosterStore.ts`.
 */

/**
 * A league needs at least two owners to draft. `confirmPreseasonOwners` and
 * `POST /api/draft/[slug]/[year]` both already refuse fewer.
 */
export const MIN_CONFIRMED_OWNERS = 2;

/** Which record supplied the roster. `none` means there is no confirmed roster. */
export type ConfirmedRosterSource = 'preseason-owners' | 'owners-csv' | 'none';

export type ConfirmedRoster = {
  /**
   * Owner names exactly as the commissioner entered them, in recorded order.
   * Empty when `source === 'none'`.
   */
  owners: string[];
  source: ConfirmedRosterSource;
  /** Whether a draft may exist for this league/season. */
  isConfirmed: boolean;
};

export type ConfirmedRosterInput = {
  /**
   * `preseason-owners:{slug}:{year}`. `unknown` because `getAppState` performs no
   * runtime validation and a legacy or hand-edited row can hold any JSON shape.
   */
  confirmedOwnersRecord: unknown;
  /** `owners:{slug}:{year}` CSV text, or a non-string when absent. */
  ownersCsvRecord: unknown;
};

const UNCONFIRMED: ConfirmedRoster = { owners: [], source: 'none', isConfirmed: false };

/**
 * Clean a stored or submitted owner list WITHOUT changing anyone's name.
 *
 * Names are stored and displayed exactly as typed — owner identity is the raw
 * string everywhere downstream (`deriveStandings` keys on `row.owner`; the only
 * comparison in `standings.ts` is `=== NO_CLAIM_OWNER`), so folding case here
 * would merge two people the rest of the app treats as distinct. Only surrounding
 * whitespace is removed, because that is a typo rather than a name.
 *
 * Accepts `unknown`: a non-array row degrades to "no owners" rather than
 * throwing, which on this path would mean a 500 from the create-draft route and
 * a render crash on the setup page.
 */
export function cleanOwnerNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim();
    if (name === '') continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Whether a submitted owner list is usable as a confirmation.
 *
 * Duplicates are REFUSED rather than silently collapsed: two identical entries
 * mean the commissioner made a mistake, and quietly dropping one would confirm a
 * roster they did not type. `NoClaim` is refused for the same reason — it is a
 * byproduct of unselected teams, never a person, so its presence in typed input
 * is an error rather than something to filter.
 */
export function findOwnerListProblem(names: readonly string[]): string | null {
  const trimmed = names.map((n) => (typeof n === 'string' ? n.trim() : '')).filter((n) => n !== '');
  if (trimmed.includes(NO_CLAIM_OWNER)) {
    return `"${NO_CLAIM_OWNER}" is reserved for unclaimed teams and cannot be an owner`;
  }
  const seen = new Set<string>();
  for (const name of trimmed) {
    if (seen.has(name)) return `"${name}" is listed more than once`;
    seen.add(name);
  }
  if (trimmed.length < MIN_CONFIRMED_OWNERS) {
    return `at least ${MIN_CONFIRMED_OWNERS} owners are required`;
  }
  return null;
}

/**
 * Resolve the confirmed roster from the two stored records.
 *
 * `NoClaim` is dropped from the CSV path only — that is where it legitimately
 * appears, as the absorber for teams no owner holds. It is never dropped from
 * typed input; `findOwnerListProblem` refuses it there instead.
 */
export function selectConfirmedRoster(input: ConfirmedRosterInput): ConfirmedRoster {
  const confirmed = cleanOwnerNames(input.confirmedOwnersRecord);
  if (confirmed.length >= MIN_CONFIRMED_OWNERS) {
    return { owners: confirmed, source: 'preseason-owners', isConfirmed: true };
  }

  // Parse rather than count lines: the admin checklist's `split('\n').length > 2`
  // heuristic called a header plus two malformed rows a roster.
  const csvText = typeof input.ownersCsvRecord === 'string' ? input.ownersCsvRecord : '';
  const fromCsv = cleanOwnerNames(
    parseOwnersCsv(csvText)
      .map((row) => row.owner)
      .filter((owner) => owner !== NO_CLAIM_OWNER)
  );
  if (fromCsv.length >= MIN_CONFIRMED_OWNERS) {
    return { owners: fromCsv, source: 'owners-csv', isConfirmed: true };
  }

  return UNCONFIRMED;
}

/**
 * Whether a draft's stored owner list still matches the confirmed roster.
 *
 * Exact names, exact set. Used only to REFUSE starting a stale draft — never to
 * validate a submitted list, because submitted lists are not trusted at all:
 * every write derives owners from the roster instead.
 */
export function draftOwnersMatchRoster(
  draftOwners: readonly string[],
  rosterOwners: readonly string[]
): boolean {
  // Same length plus "every draft name is in the roster" is NOT set equality:
  // `['Alice','Alice']` passes against `['Alice','Bob']` while Bob is missing.
  // Drafts created before this work accepted any two non-empty strings, so a
  // stored duplicate is reachable. Requiring distinct names closes it.
  const draft = new Set(draftOwners);
  if (draft.size !== draftOwners.length) return false;
  if (draft.size !== rosterOwners.length) return false;
  const roster = new Set(rosterOwners);
  if (roster.size !== rosterOwners.length) return false;
  return draftOwners.every((name) => roster.has(name));
}
