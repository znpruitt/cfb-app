import type { AliasMap } from './teamNames.ts';
import { normalizeAliasLookup, normalizeTeamName } from './teamNormalization.ts';

/**
 * Deterministic FNV-1a hash of an alias set's contents (order-independent).
 * Used to version caches whose output depends on the seed set (canonical
 * standings cache identity; the client's effective-alias cache) so a change to
 * the seeds invalidates them with no manual write. Pure and client-safe.
 */
export function hashSeedAliases(seeds: AliasMap): string {
  const serialized = Object.entries(seeds)
    .map(([k, v]) => `${normalizeAliasLookup(k)}=${typeof v === 'string' ? v.trim() : ''}`)
    .sort()
    .join(';');
  let h = 0x811c9dc5;
  for (let i = 0; i < serialized.length; i++) {
    h ^= serialized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/**
 * Merge alias layers, highest precedence FIRST. Cross-layer conflicts are
 * resolved by the resolver's canonical identity (`normalizeTeamName`), but every
 * distinct lookup spelling is preserved: a spelling in a lower layer whose
 * identity is already owned by a higher layer is KEPT and remapped to the
 * winning target (so exact-key consumers still resolve it to the right team).
 * Same-layer siblings don't shadow each other — identities are registered only
 * after a whole layer is processed.
 *
 * This is the single source of truth for effective-alias precedence, shared by
 * the server resolver (`getScopedAliasMap`) and the client's degraded bootstrap
 * fallback, so both agree on `stored > seeds` (and general layer) ordering.
 *
 * Pure and client-safe: reads only the given maps (no appState, no I/O).
 */
export function mergeAliasLayers(layers: ReadonlyArray<AliasMap>): AliasMap {
  const result: AliasMap = {};
  const identityWinner = new Map<string, string>();
  for (const layer of layers) {
    const firstSeen: Array<[string, string]> = [];
    for (const [key, target] of Object.entries(layer)) {
      if (typeof target !== 'string') continue;
      const identity = normalizeTeamName(key);
      // Keys that normalize to nothing can never be matched by the resolver.
      if (!identity) continue;
      const winner = identityWinner.get(identity);
      if (winner !== undefined) {
        result[key] = winner;
      } else {
        result[key] = target;
        firstSeen.push([identity, target]);
      }
    }
    for (const [identity, target] of firstSeen) {
      if (!identityWinner.has(identity)) identityWinner.set(identity, target);
    }
  }
  return result;
}
