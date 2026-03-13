import type { DiagEntry } from './diagnostics';
import type { AliasMap } from './teamNames';
import { createTeamIdentityResolver } from './teamIdentity';
import { normalizeAliasLookup } from './teamNormalization';
import { fetchTeamsCatalog } from './teamsCatalog';

export async function reconcileNamesWithCatalog(params: {
  csvTeams: string[];
  aliasMap: AliasMap;
  season: number;
  onTeamsCatalogError?: (message: string) => void;
  persistLearnedAliases?: (upserts: AliasMap) => Promise<void>;
  onIdentityDiag?: (entry: DiagEntry) => void;
}): Promise<Record<string, string>> {
  const { csvTeams, aliasMap, onTeamsCatalogError, persistLearnedAliases, onIdentityDiag } = params;

  const out: Record<string, string> = {};
  try {
    const teams = await fetchTeamsCatalog();
    const resolver = createTeamIdentityResolver({ aliasMap, teams, observedNames: csvTeams });

    const upserts: AliasMap = {};
    for (const raw of csvTeams) {
      const resolved = resolver.resolveName(raw);
      const aliasKey = normalizeAliasLookup(raw);
      const existingAliasTarget = aliasMap[aliasKey];

      // Preserve operator-curated aliases even when catalog resolution is ambiguous/unresolved.
      const canonical = resolved.canonicalName ?? existingAliasTarget ?? raw;
      out[raw] = canonical;

      if (resolved.status !== 'resolved') {
        onIdentityDiag?.({
          kind: 'identity_resolution',
          issueClassification: 'identity-unresolved',
          flow: 'schedule',
          rawInput: resolved.rawInput,
          normalizedInput: resolved.normalizedInput,
          resolutionSource: resolved.resolutionSource,
          status: resolved.status,
          notes: resolved.notes,
          candidates: resolved.candidates,
        });
      }

      if (resolved.status === 'resolved' && canonical !== raw && !existingAliasTarget) {
        upserts[aliasKey] = canonical;
      }
    }

    if (Object.keys(upserts).length) {
      await persistLearnedAliases?.(upserts);
    }
  } catch (err) {
    onTeamsCatalogError?.((err as Error).message);
    for (const raw of csvTeams) {
      const aliasKey = normalizeAliasLookup(raw);
      out[raw] = aliasMap[aliasKey] ?? raw;
    }
  }

  return out;
}
