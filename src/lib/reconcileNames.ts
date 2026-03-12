import type { DiagEntry } from './diagnostics';
import type { AliasMap } from './teamNames';
import { createTeamIdentityResolver, stripDiacritics } from './teamIdentity';
import { fetchTeamsCatalog } from './teamsCatalog';

export async function reconcileNamesWithCatalog(params: {
  csvTeams: string[];
  aliasMap: AliasMap;
  season: number;
  onTeamsCatalogError?: (message: string) => void;
  persistLearnedAliases?: (upserts: AliasMap) => Promise<void>;
  onIdentityDiag?: (entry: DiagEntry) => void;
}): Promise<Record<string, string>> {
  const { csvTeams, aliasMap, season, onTeamsCatalogError, persistLearnedAliases, onIdentityDiag } = params;

  const out: Record<string, string> = {};
  try {
    const teams = await fetchTeamsCatalog(season);
    const resolver = createTeamIdentityResolver({ aliasMap, teams });

    const upserts: AliasMap = {};
    for (const raw of csvTeams) {
      const resolved = resolver.resolveName(raw);
      const canonical = resolved.canonicalName ?? raw;
      out[raw] = canonical;

      if (resolved.status !== 'resolved') {
        onIdentityDiag?.({
          kind: 'identity_resolution',
          flow: 'schedule',
          rawInput: resolved.rawInput,
          normalizedInput: resolved.normalizedInput,
          resolutionSource: resolved.resolutionSource,
          status: resolved.status,
          notes: resolved.notes,
          candidates: resolved.candidates,
        });
      }

      const aliasKey = stripDiacritics(raw).toLowerCase().trim();
      if (resolved.status === 'resolved' && canonical !== raw && !aliasMap[aliasKey]) {
        upserts[aliasKey] = canonical;
      }
    }

    if (Object.keys(upserts).length) {
      await persistLearnedAliases?.(upserts);
    }
  } catch (err) {
    onTeamsCatalogError?.((err as Error).message);
    for (const raw of csvTeams) out[raw] = raw;
  }

  return out;
}
