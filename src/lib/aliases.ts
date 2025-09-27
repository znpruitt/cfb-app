// Strict, no "any"
export type AliasEntry = {
  canonical: string;
  aliases: string[];
};

export type AliasFile = {
  entries: AliasEntry[];
};

export type AliasMap = Record<string, string>; // normalized alias -> canonical
export type OverrideMap = Record<string, string>; // raw label -> canonical (user overrides)

const LS_ALIAS_MAP_KEY = 'cfb_alias_map_cached_v1'; // normalized alias map cache
const LS_OVERRIDES_KEY = 'cfb_alias_overrides_v1'; // user overrides (raw -> canonical)

// --- Normalizer (accent-insensitive, punctuation/light stopwords removed)
export function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\./g, '')
    .replace(/\b(university|univ|college|the|of|and|&|state|st)\b/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

// Build a fast lookup: every alias variant (including canonical itself) -> canonical
export function buildAliasMap(file: AliasFile): AliasMap {
  const map: AliasMap = {};
  for (const e of file.entries) {
    const c = e.canonical.trim();
    if (!c) continue;
    const normC = normalizeLabel(c);
    // Canonical should resolve to itself
    map[normC] = c;

    for (const raw of e.aliases) {
      const n = normalizeLabel(raw);
      if (!n) continue;
      map[n] = c;
    }
  }
  return map;
}

// Load user overrides (raw label -> canonical). Raw keys are not normalized on purpose;
// we normalize at resolve-time to keep behavior predictable.
export function loadOverrides(): OverrideMap {
  try {
    const raw =
      typeof window !== 'undefined' ? window.localStorage.getItem(LS_OVERRIDES_KEY) : null;
    return raw ? (JSON.parse(raw) as OverrideMap) : {};
  } catch {
    return {};
  }
}

export function saveOverrides(next: OverrideMap): void {
  try {
    window.localStorage.setItem(LS_OVERRIDES_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

// Resolve a CSV/team label to a canonical using:
// 1) user overrides (exact raw match, then normalized),
// 2) the alias map (normalized),
// 3) fall back to original input.
export function resolveCanonical(
  label: string,
  aliasMap: AliasMap,
  overrides: OverrideMap
): string {
  const raw = (label || '').trim();
  if (!raw) return raw;

  // Exact raw override wins
  if (overrides[raw]) return overrides[raw];

  // Normalized override (in case user saved normalized key)
  const normRaw = normalizeLabel(raw);
  if (overrides[normRaw]) return overrides[normRaw];

  // Alias map
  const hit = aliasMap[normRaw];
  return hit ?? raw;
}

// Load the alias map from LocalStorage cache first, else from public file
export async function loadAliasMap(): Promise<AliasMap> {
  // Try cached map
  try {
    const cached =
      typeof window !== 'undefined' ? window.localStorage.getItem(LS_ALIAS_MAP_KEY) : null;
    if (cached) return JSON.parse(cached) as AliasMap;
  } catch {
    /* ignore */
  }

  // Else fetch static json
  const resp = await fetch('/data/team-aliases.json', { cache: 'force-cache' });
  if (!resp.ok) return {};
  const file = (await resp.json()) as AliasFile;
  const map = buildAliasMap(file);

  // Cache it
  try {
    window.localStorage.setItem(LS_ALIAS_MAP_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
  return map;
}

// Optional: allow replacing the cached alias map at runtime (e.g., after you edit the JSON)
export function setAliasMapCache(map: AliasMap): void {
  try {
    window.localStorage.setItem(LS_ALIAS_MAP_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}
