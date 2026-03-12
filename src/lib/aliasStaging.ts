import type { AliasStaging } from './diagnostics';
import { stripDiacritics } from './teamNames';

export function stageAliasFromMiss(
  providerName: string,
  csvName: string,
  prev: AliasStaging
): AliasStaging {
  const a = stripDiacritics(providerName).toLowerCase().trim();
  const c = csvName.trim();
  if (!a || !c) return prev;
  return { upserts: { ...prev.upserts, [a]: c }, deletes: prev.deletes.filter((d) => d !== a) };
}
