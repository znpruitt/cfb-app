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

export function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function applyAliases(baseLower: string, aliases: AliasMap): string {
  return aliases[baseLower] ?? baseLower;
}

export function normWithAliases(s: string, aliases: AliasMap): string {
  let t = stripDiacritics(s).toLowerCase().trim();
  t = applyAliases(t, aliases);
  t = t.replace(/\b(university|univ|the|of|and|&)\b/g, ' ');
  t = t.replace(/[^a-z0-9]+/g, '');
  return t;
}

export function variants(raw: string, aliases: AliasMap): string[] {
  const base = normWithAliases(raw, aliases);
  if (!base) return [];
  const out = new Set<string>([base]);
  const tokens = base.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length >= 2) out.add(tokens[0] + tokens[1]);
  if (tokens.length >= 1) out.add(tokens[0]);
  return Array.from(out);
}
