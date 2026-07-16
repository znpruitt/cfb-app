import type { GameStatsIdentityEvidence } from '../gameStats/coverage.ts';
import { buildPlaceholderParticipant } from '../schedulePostseasonHelpers.ts';
import { createTeamIdentityResolver } from '../teamIdentity.ts';
import { getScopedAliasMap } from './globalAliasStore.ts';
import { getTeamDatabaseItems } from './teamDatabaseStore.ts';

/**
 * Build the canonical identity evidence expected-coverage derivation consumes
 * (PLATFORM-086H review remediation): a catalog + league-agnostic-alias
 * resolver with deliberately NO observedNames seeding (the 086G2
 * identity-uncertainty rule — observed names register arbitrary labels as
 * resolved identities, which would bless placeholder text like "Home Team TBA"
 * as a real team), consulted through the one canonical placeholder classifier
 * the schedule build itself uses (`buildPlaceholderParticipant`). A load
 * failure returns null: callers fall back to the pattern-only participant test,
 * which over-expects rather than falsely completing a week — identity
 * unavailability never suppresses recovery.
 */
export async function loadGameStatsIdentityEvidence(
  season: number
): Promise<GameStatsIdentityEvidence | null> {
  try {
    const [teams, aliasMap] = await Promise.all([
      getTeamDatabaseItems(),
      getScopedAliasMap('', season),
    ]);
    if (teams.length === 0) return null;
    const resolver = createTeamIdentityResolver({ teams, aliasMap });
    return {
      isResolvedTeamName: (label: string) =>
        buildPlaceholderParticipant({
          resolver,
          raw: label,
          // Display-only params, inert for this evidence check.
          slotId: 'game-stats-expected-evidence',
          defaultDisplay: 'TBD',
        }).kind === 'team',
    };
  } catch {
    return null;
  }
}
