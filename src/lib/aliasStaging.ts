import type { AliasStaging } from './diagnostics.ts';
import { normalizeAliasLookup } from './teamNormalization.ts';

export function stageAliasFromMiss(
  providerName: string,
  csvName: string,
  prev: AliasStaging
): AliasStaging {
  const a = normalizeAliasLookup(providerName);
  const c = csvName.trim();
  if (!a || !c) return prev;
  return { upserts: { ...prev.upserts, [a]: c }, deletes: prev.deletes.filter((d) => d !== a) };
}
