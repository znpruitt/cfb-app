import { createTeamIdentityResolver, type TeamCatalogItem } from './teamIdentity.ts';
import type { AliasMap } from './teamNames.ts';

export type RebuildableGame = {
  key: string;
  eventId?: string;
  week: number;
  csvAway: string;
  csvHome: string;
  neutral: boolean;
  canAway: string;
  canHome: string;
  participants?: {
    home: { kind: 'team' | 'placeholder' | 'derived' };
    away: { kind: 'team' | 'placeholder' | 'derived' };
  };
};

export function rebuildGamesFromAliasMap<T extends RebuildableGame>(
  games: T[],
  mapObj: Record<string, string>
): T[] {
  return games.map((g) => {
    if (
      g.participants &&
      (g.participants.home.kind !== 'team' || g.participants.away.kind !== 'team')
    ) {
      return { ...g, key: g.eventId ?? g.key };
    }

    const canAway = mapObj[g.csvAway] ?? g.csvAway;
    const canHome = mapObj[g.csvHome] ?? g.csvHome;
    const key =
      g.eventId ??
      (g.neutral
        ? `${g.week}-${[canHome, canAway].sort((a, b) => a.localeCompare(b)).join('-')}-N`
        : `${g.week}-${canHome}-${canAway}-H`);
    return { ...g, canAway, canHome, key };
  });
}

export function rebuildGamesFromIdentity<T extends RebuildableGame>(params: {
  games: T[];
  teams: TeamCatalogItem[];
  aliasMap: AliasMap;
}): T[] {
  const { games, teams, aliasMap } = params;
  const observedNames = Array.from(
    new Set(games.flatMap((g) => [g.csvHome, g.csvAway, g.canHome, g.canAway]))
  );
  const resolver = createTeamIdentityResolver({ teams, aliasMap, observedNames });

  return games.map((g) => {
    if (
      g.participants &&
      (g.participants.home.kind !== 'team' || g.participants.away.kind !== 'team')
    ) {
      return { ...g, key: g.eventId ?? g.key };
    }

    const home = resolver.resolveName(g.csvHome);
    const away = resolver.resolveName(g.csvAway);

    const canHome = home.canonicalName ?? g.csvHome;
    const canAway = away.canonicalName ?? g.csvAway;
    const key =
      g.eventId ??
      resolver.buildGameKey({
        week: g.week,
        home: canHome,
        away: canAway,
        neutral: g.neutral,
      });

    return { ...g, canAway, canHome, key };
  });
}
