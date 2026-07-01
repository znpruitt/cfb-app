import { getGameParticipantTeamId, type AppGame } from './schedule.ts';

// ---------------------------------------------------------------------------
// Shared, resolver-free current-season game ownership resolution.
//
// `AppGame` already carries alias-resolved canonical identity (`canHome`/
// `canAway`, and `participants.*` for team slots) alongside the raw provider
// labels (`csvHome`/`csvAway`). Current-season ownership must be decided from
// those canonical candidates — not raw provider-name equality — so a stored
// team assignment ("Washington State") still matches a provider label
// ("Wash St").
//
// This helper is intentionally resolver-free: the pure selectors that consume
// it receive no team-identity resolver / teams list / alias map, so ownership
// is resolved purely from the identity candidates present on the game.
// `rosterByTeam` keys are stored assigned-team labels; values are owner names.
// Exact-match lookup only (no normalized index) — that remains a deferred
// decision because normalizing stored labels can collide.
// ---------------------------------------------------------------------------

/**
 * Ordered, deduped identity candidates for one side of a game.
 *
 * Priority: participant team id → participant canonical/display/raw names →
 * canonical name (`canHome`/`canAway`) → raw provider label (`csvHome`/
 * `csvAway`, legacy fallback only). Placeholder/derived slots contribute only
 * their canonical/provider labels (no team-identity fields).
 */
export function sideIdentityCandidates(game: AppGame, side: 'away' | 'home'): string[] {
  const participant = game.participants[side];
  const teamId = getGameParticipantTeamId(game, side);
  const csvName = side === 'away' ? game.csvAway : game.csvHome;
  const canonicalName = side === 'away' ? game.canAway : game.canHome;

  const raw = [
    teamId,
    participant.kind === 'team' ? participant.canonicalName : null,
    participant.kind === 'team' ? participant.displayName : null,
    participant.kind === 'team' ? participant.rawName : null,
    canonicalName,
    csvName,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const value of raw) {
    if (seen.has(value)) continue;
    seen.add(value);
    unique.push(value);
  }
  return unique;
}

/**
 * Resolve the owner of one side of a game via the ordered identity candidates.
 * Returns `undefined` when no candidate matches a stored assignment.
 */
export function getOwnerForGameSide(
  game: AppGame,
  side: 'away' | 'home',
  rosterByTeam: Map<string, string>
): string | undefined {
  for (const candidate of sideIdentityCandidates(game, side)) {
    const owner = rosterByTeam.get(candidate);
    if (owner) return owner;
  }
  return undefined;
}

/** Resolve owners for both sides of a game. */
export function getGameOwners(
  game: AppGame,
  rosterByTeam: Map<string, string>
): { awayOwner?: string; homeOwner?: string } {
  return {
    awayOwner: getOwnerForGameSide(game, 'away', rosterByTeam),
    homeOwner: getOwnerForGameSide(game, 'home', rosterByTeam),
  };
}

/**
 * Determine which side of a game a stored assigned team label plays on, using
 * the same canonical candidates. Returns `null` when the team is not in the
 * game — so callers work even when provider names differ from canonical names.
 */
export function getGameSideForTeam(game: AppGame, teamName: string): 'home' | 'away' | null {
  if (!teamName || !teamName.trim()) return null;
  if (sideIdentityCandidates(game, 'away').includes(teamName)) return 'away';
  if (sideIdentityCandidates(game, 'home').includes(teamName)) return 'home';
  return null;
}
