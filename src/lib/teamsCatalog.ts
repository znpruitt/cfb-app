import type { TeamCatalogItem } from './teamIdentity.ts';

export async function fetchTeamsCatalog(): Promise<TeamCatalogItem[]> {
  // Team catalog is a single canonical file (src/data/teams.json) served by /api/teams.
  const response = await fetch('/api/teams', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`teams catalog ${response.status}`);
  }

  const data = (await response.json()) as { items?: TeamCatalogItem[] };
  return Array.isArray(data.items) ? data.items : [];
}
