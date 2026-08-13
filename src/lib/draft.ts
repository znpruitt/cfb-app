import type { TeamCatalogItem } from '@/lib/teamIdentity';
import { parseOwnersCsv, type OwnerRow } from '@/lib/parseOwnersCsv';

export type DraftPhase = 'setup' | 'settings' | 'preview' | 'live' | 'paused' | 'complete';

export type DraftSettings = {
  style: 'snake';
  draftOrder: string[];
  pickTimerSeconds: number | null;
  timerExpiryBehavior: 'pause-and-prompt' | 'auto-pick';
  totalRounds: number;
  scheduledAt: string | null;
};

export type DraftPick = {
  pickNumber: number;
  round: number;
  roundPick: number;
  owner: string;
  team: string;
  pickedAt: string;
  autoSelected: boolean;
};

export type DraftState = {
  leagueSlug: string;
  year: number;
  phase: DraftPhase;
  owners: string[];
  settings: DraftSettings;
  picks: DraftPick[];
  currentPickIndex: number;
  timerState: 'running' | 'paused' | 'expired' | 'off';
  timerExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * The canonical signature of the PICKS this draft published to the league as its official
   * owner assignment, or `null`/absent if it never published.
   *
   * PLATFORM-094 — `phase` cannot answer "was this published". The final pick
   * sets `phase: 'complete'` the instant the last selection is taken, which says
   * every pick has been made and nothing more; the roster is written separately,
   * when the commissioner reviews the results and confirms. Conflating them left
   * a draft that was complete, unpublished, and had no button anywhere in the app
   * that could publish it — the summary page hid Confirm at `complete`.
   *
   * **It records WHAT was published, not merely THAT something was.** A boolean
   * has to be cleared by hand on every path that changes the picks it described,
   * and `phase: 'complete'` is not a resting state: Undo last pick, Reset, and
   * the pick-timer control are all live on a completed draft. A flag survived all
   * three, so resetting a published draft and running it again restored
   * `complete` beside a marker pointing at the PREVIOUS draft's roster.
   *
   * Deriving it from the picks makes retraction automatic — reset and unpick
   * change the picks, so the signature stops matching and nobody has to
   * remember — while a timer change leaves the picks alone and keeps the
   * publication valid. A timestamp would have failed both halves: it retracts on
   * metadata edits it should ignore, and two writes in the same millisecond
   * compare equal.
   *
   * Written and read ONLY through `src/lib/selectors/draftPublication.ts`
   * (`draftPicksSignature` / `isDraftPublished`) — the derivation belongs to the
   * selector layer per AGENTS.md invariant 9, and this module holds the stored
   * shape alone.
   *
   * It deliberately does NOT track the roster's own contents. Post-publication
   * roster repairs through `PUT /api/owners` are a roster edit, not a draft edit,
   * and must not demand a re-draft or a re-confirm.
   */
  publishedPicks?: string | null;
};

export function defaultDraftSettings(owners: string[] = []): DraftSettings {
  return {
    style: 'snake',
    draftOrder: owners,
    pickTimerSeconds: 60,
    timerExpiryBehavior: 'pause-and-prompt',
    totalRounds: 1,
    scheduledAt: null,
  };
}

export function draftScope(leagueSlug: string): string {
  return `draft:${leagueSlug}`;
}

/**
 * Schools in the team catalog that exist only as schedule-side placeholders and
 * can never be assigned to an owner. `NoClaim` absorbs games that belong to no
 * owner and must be excluded from every draft-eligibility computation.
 */
export const NON_DRAFTABLE_SCHOOLS: ReadonlySet<string> = new Set(['NoClaim']);

/** Whether a single catalog team is eligible to be drafted by an owner. */
export function isDraftEligibleTeam(team: Pick<TeamCatalogItem, 'school'>): boolean {
  return !NON_DRAFTABLE_SCHOOLS.has(team.school);
}

/**
 * Single source of truth for "which catalog teams count toward a draft."
 *
 * Setup/update round limits, auto-pick candidate pools, and confirmation expected
 * counts must all derive from this helper so they can never diverge. Eligibility is
 * defined by excluding the `NoClaim` placeholder — NOT by a `classification` field,
 * which is absent from the current `teams.json` shape and would yield zero eligible
 * teams if relied upon.
 */
export function getDraftEligibleTeams<T extends Pick<TeamCatalogItem, 'school'>>(items: T[]): T[] {
  return items.filter(isDraftEligibleTeam);
}

/** Placeholder owner for a team that belongs to no one. */
const NO_CLAIM_OWNER = 'NoClaim';

/** RFC 4180 CSV field serialization. */
function csvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialize owner rows to the canonical `owners` CSV (header + one row each). */
function serializeOwnerRows(rows: readonly OwnerRow[]): string {
  const lines = ['team,owner'];
  for (const row of rows) {
    lines.push(`${csvField(row.team)},${csvField(row.owner)}`);
  }
  return lines.join('\n');
}

/**
 * Build the confirmed owner-assignment CSV from a draft's picks — the canonical
 * `owners:${slug}:${year}` / `'csv'` payload the schedule/ownership pipeline
 * (`parseOwnersCsv` → `gameOwnership`) consumes: header `team,owner`, one row per
 * pick, then `NoClaim` for every undrafted eligible team.
 *
 * The authoritative full-roster write, used by the draft confirm route. Returns
 * `rowCount` (data rows, header excluded) as a structural count taken before
 * serialization so callers can validate it without re-splitting the CSV string —
 * a split on `\n` miscounts any quoted field that itself contains a newline.
 * Pure — callers are responsible for validation (pick counts, duplicates,
 * eligibility).
 */
export function buildConfirmedOwnersCsv(
  picks: readonly DraftPick[],
  eligibleTeams: readonly Pick<TeamCatalogItem, 'school'>[]
): { csv: string; rowCount: number } {
  const rows: OwnerRow[] = picks.map((pick) => ({ team: pick.team, owner: pick.owner }));
  const draftedTeamsLower = new Set(picks.map((p) => p.team.toLowerCase()));
  for (const team of eligibleTeams) {
    if (!draftedTeamsLower.has(team.school.toLowerCase())) {
      rows.push({ team: team.school, owner: NO_CLAIM_OWNER });
    }
  }
  return { csv: serializeOwnerRows(rows), rowCount: rows.length };
}

/**
 * Apply a single confirmed-draft pick edit (its team changed `oldTeam → newTeam`)
 * to the ALREADY-PERSISTED owners CSV by MOVING that pick's roster claim from the
 * old team to the new one, preserving every other row.
 *
 * A post-confirm pick edit must keep the persisted ownership in sync, but the
 * `owners:${slug}:${year}` store is shared with `PUT /api/owners` — the admin
 * repair/override path — and an override leaves the draft phase `complete`.
 * Rebuilding the whole CSV from the draft picks would silently discard unrelated
 * manual reassignments, so this touches only the two affected teams.
 *
 * The owner carried to `newTeam` is the owner the PERSISTED roster currently
 * credits for `oldTeam`, NOT the draft pick's owner field — `oldTeam` was this
 * pick's only team (each team appears in at most one pick), so its row IS this
 * pick's slot, and honoring the persisted value carries an `/api/owners`
 * owner-name correction instead of resurrecting the stale draft name. `oldTeam`
 * is then released to `NoClaim`. `fallbackOwner` (the draft pick's owner) is used
 * when `oldTeam` is absent from the roster OR currently unclaimed (`NoClaim`),
 * so a prior repair can't leave the new team unclaimed. Row order and all other
 * rows are preserved.
 *
 * Persisted labels are matched through `resolveTeam` (the canonical team-identity
 * resolver) rather than by raw string, so a validated alias/alternate label
 * stored by `/api/owners` still resolves to the same slot as the canonical
 * `oldTeam`/`newTeam` — preventing a stale alias row from surviving alongside a
 * duplicate canonical row. `resolveTeam` must return a stable canonical label for
 * a resolvable name and (by convention) the input for an unresolvable one.
 */
export function patchConfirmedOwnersCsv(
  currentCsv: string,
  edit: {
    oldTeam: string;
    newTeam: string;
    fallbackOwner: string;
    resolveTeam: (label: string) => string;
  }
): string {
  const { oldTeam, newTeam, fallbackOwner, resolveTeam } = edit;
  const rows = parseOwnersCsv(currentCsv);

  const oldCanon = resolveTeam(oldTeam).toLowerCase();
  const newCanon = resolveTeam(newTeam).toLowerCase();

  const oldRow = rows.find((r) => resolveTeam(r.team).toLowerCase() === oldCanon);
  const effectiveOwner = oldRow && oldRow.owner !== NO_CLAIM_OWNER ? oldRow.owner : fallbackOwner;

  let sawNewTeam = false;
  for (const row of rows) {
    const canon = resolveTeam(row.team).toLowerCase();
    if (canon === newCanon) {
      row.owner = effectiveOwner;
      sawNewTeam = true;
    } else if (canon === oldCanon) {
      row.owner = NO_CLAIM_OWNER;
    }
  }
  if (!sawNewTeam) {
    rows.push({ team: newTeam, owner: effectiveOwner });
  }
  return serializeOwnerRows(rows);
}
