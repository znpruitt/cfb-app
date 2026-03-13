import { normalizeAliasLookup, normalizeTeamName, stripDiacritics } from './teamNormalization';

export type AliasMap = Record<string, string>;

export const SEED_ALIASES: AliasMap = {
  'app state': 'appalachian state',
  utsa: 'texas san antonio',
  'texas a&m': 'texas am',
  'texas a and m': 'texas am',
  'ole miss': 'mississippi',
  uh: 'houston',
  ucf: 'central florida',
  'ul monroe': 'louisiana monroe',
  umass: 'massachusetts',
  byu: 'brigham young',
  smu: 'southern methodist',
  sjsu: 'san jose state',
  'san jose state': 'san jose state',
  uconn: 'connecticut',
  'colorado st': 'colorado state',
  'wash st': 'washington state',
  'southeastern la': 'se louisiana',
  'louisiana monroe': 'ul monroe',
  albany: 'ualbany',
  unlv: 'nevada-las vegas',
};

export { normalizeTeamName, stripDiacritics };

export function applyAliases(baseLower: string, aliases: AliasMap): string {
  return aliases[baseLower] ?? baseLower;
}

export function normWithAliases(s: string, aliases: AliasMap): string {
  const lookup = normalizeAliasLookup(s);
  return normalizeTeamName(applyAliases(lookup, aliases));
}

export function variants(raw: string, aliases: AliasMap): string[] {
  const base = normWithAliases(raw, aliases);
  if (!base) return [];
  return Array.from(new Set([base]));
}
