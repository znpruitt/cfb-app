import { hashSeedAliases } from './aliasLayers.ts';
import type { AliasMap } from './teamNames.ts';

// The client caches the effective (resolver) alias map so a degraded/offline
// bootstrap can still resolve identities. The cache is versioned by the seed
// set's hash: if the shipped SEED_ALIASES change (deploy), an old cache built
// from prior seeds is discarded rather than resurrecting stale identities.
type EffectiveAliasCacheEnvelope = { v: string; map: AliasMap };

export function serializeEffectiveAliasCache(map: AliasMap, seeds: AliasMap): string {
  const envelope: EffectiveAliasCacheEnvelope = { v: hashSeedAliases(seeds), map };
  return JSON.stringify(envelope);
}

/**
 * Parse a cached effective-alias envelope, returning the map ONLY if its seed
 * version matches the current seeds. Returns null on absent/invalid/stale cache
 * (including legacy bare-map caches with no version), so callers reconcile from
 * fresh data instead of trusting an obsolete flattened map.
 */
export function readEffectiveAliasCache(raw: string | null, seeds: AliasMap): AliasMap | null {
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<EffectiveAliasCacheEnvelope> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v !== hashSeedAliases(seeds)) return null;
    const map = parsed.map;
    return map && typeof map === 'object' && !Array.isArray(map) ? (map as AliasMap) : null;
  } catch {
    return null;
  }
}
