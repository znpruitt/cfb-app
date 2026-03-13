import type { TeamCatalogItem } from './teamIdentity';

export async function fetchTeamsCatalog(season: number): Promise<TeamCatalogItem[]> {
  const response = await fetch(`/api/teams?year=${season}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`teams catalog ${response.status}`);
  }

  const data = (await response.json()) as { items?: TeamCatalogItem[] };
  return Array.isArray(data.items) ? data.items : [];
}
