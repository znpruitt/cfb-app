import { getGlobalAliases } from '../server/globalAliasStore.ts';
import { getTeamDatabaseItems } from '../server/teamDatabaseStore.ts';
import { createTeamIdentityResolver, type TeamIdentityResolver } from '../teamIdentity.ts';

/**
 * PLATFORM-086H3 — league-agnostic identity context for the game-stats
 * lifecycle.
 *
 * Canonical-schedule attachment validates provider participants through the
 * ONE centralized resolver (`teamIdentity.ts`). Game-stats ingestion is not
 * league-scoped, so its resolver is built from the durable team database plus
 * the EFFECTIVE GLOBAL alias layer (stored global aliases over the code seed
 * defaults) — the same global-first precedence canonical standings resolution
 * uses. Both inputs are cache-only durable reads: loading this context never
 * contacts a provider, and callers treat a read failure as unavailable
 * context (fail before spending provider quota), never as an empty registry.
 */
export async function loadGameStatsIdentityResolver(): Promise<TeamIdentityResolver> {
  const [teams, aliasMap] = await Promise.all([getTeamDatabaseItems(), getGlobalAliases()]);
  return createTeamIdentityResolver({ teams, aliasMap });
}
