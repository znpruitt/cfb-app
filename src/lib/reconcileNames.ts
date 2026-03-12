import { normWithAliases, stripDiacritics, type AliasMap, variants } from './teamNames';

export async function reconcileNamesWithCatalog(params: {
  csvTeams: string[];
  aliasMap: AliasMap;
  season: number;
  onTeamsCatalogError?: (message: string) => void;
  persistLearnedAliases?: (upserts: AliasMap) => Promise<void>;
}): Promise<Record<string, string>> {
  const { csvTeams, aliasMap, season, onTeamsCatalogError, persistLearnedAliases } = params;

  const out: Record<string, string> = {};
  let missing: string[] = [];

  for (const raw of csvTeams) {
    const base = stripDiacritics(raw).toLowerCase().trim();
    const aliased = aliasMap[base];
    if (aliased) {
      out[raw] = aliased;
    } else {
      out[raw] = raw;
      missing.push(raw);
    }
  }

  if (!missing.length) return out;

  try {
    const resp = await fetch(`/api/teams?year=${season}`, { cache: 'no-store' });
    if (!resp.ok) return out;

    const data = (await resp.json()) as {
      items: Array<{ school: string; mascot?: string | null }>;
    };

    const index = new Map<string, string>();
    for (const item of data.items) {
      const school = item.school;
      const vs = new Set<string>(variants(school, aliasMap));
      if (item.mascot) vs.add(normWithAliases(`${school} ${item.mascot}`, aliasMap));
      vs.forEach((v) => index.set(v, school));
    }

    const upserts: AliasMap = {};
    const newlyResolved: string[] = [];
    for (const raw of missing) {
      const keys = variants(raw, aliasMap);
      let hit: string | undefined;
      for (const k of keys) {
        if (index.has(k)) {
          hit = index.get(k);
          break;
        }
      }
      if (!hit) {
        const nk = normWithAliases(raw, aliasMap);
        for (const [k, school] of index.entries()) {
          if (k.startsWith(nk) || nk.startsWith(k)) {
            hit = school;
            break;
          }
        }
      }
      if (hit) {
        out[raw] = hit;
        upserts[stripDiacritics(raw).toLowerCase().trim()] = hit;
        newlyResolved.push(raw);
      }
    }

    if (Object.keys(upserts).length) {
      await persistLearnedAliases?.(upserts);
    }

    missing = missing.filter((m) => !newlyResolved.includes(m));
  } catch (err) {
    onTeamsCatalogError?.((err as Error).message);
  }

  return out;
}
