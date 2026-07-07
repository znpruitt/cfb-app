import type { TeamCatalogItem } from '@/lib/teamIdentity';
import { parseOwnersCsv, type OwnerRow } from '@/lib/parseOwnersCsv';

export type DraftPhase = 'setup' | 'settings' | 'preview' | 'live' | 'paused' | 'complete';

export type DraftSettings = {
  style: 'snake';
  draftOrder: string[];
  pickTimerSeconds: number | null;
  timerExpiryBehavior: 'pause-and-prompt' | 'auto-pick';
  autoPickMetric: 'sp-plus' | 'preseason-rank' | null;
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
};

export function defaultDraftSettings(owners: string[] = []): DraftSettings {
  return {
    style: 'snake',
    draftOrder: owners,
    pickTimerSeconds: 60,
    timerExpiryBehavior: 'pause-and-prompt',
    autoPickMetric: null,
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
