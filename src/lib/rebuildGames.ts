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
