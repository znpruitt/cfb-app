import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity';
import type { AliasMap } from './teamNames';

export type RebuildableGame = {
  key: string;
  week: number;
  csvAway: string;
  csvHome: string;
  neutral: boolean;
  canAway: string;
  canHome: string;
};

export function rebuildGamesFromAliasMap<T extends RebuildableGame>(
  games: T[],
  mapObj: Record<string, string>
): T[] {
  return games.map((g) => {
    const canAway = mapObj[g.csvAway] ?? g.csvAway;
    const canHome = mapObj[g.csvHome] ?? g.csvHome;
    const key = g.neutral
      ? `${g.week}-${[canHome, canAway].sort((a, b) => a.localeCompare(b)).join('-')}-N`
      : `${g.week}-${canHome}-${canAway}-H`;
    return { ...g, canAway, canHome, key };
  });
}

export function rebuildGamesFromIdentity<T extends RebuildableGame>(params: {
  games: T[];
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
}): T[] {
  const { games, teams, aliasMap } = params;
  const resolver = createTeamIdentityResolver({ teams, aliasMap });

  return games.map((g) => {
    const home = resolver.resolveName(g.csvHome);
    const away = resolver.resolveName(g.csvAway);

    const canHome = home.canonicalName ?? g.csvHome;
    const canAway = away.canonicalName ?? g.csvAway;
    const key = resolver.buildGameKey({
      week: g.week,
      home: canHome,
      away: canAway,
      neutral: g.neutral,
    });

    return { ...g, canAway, canHome, key };
  });
}
