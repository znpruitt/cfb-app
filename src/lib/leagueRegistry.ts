import { getAppState, setAppState } from './server/appStateStore.ts';
import type { League } from './league.ts';

const REGISTRY_SCOPE = 'leagues';
const REGISTRY_KEY = 'registry';

/** Slug must be lowercase alphanumeric words separated by single hyphens */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

export async function getLeagues(): Promise<League[]> {
  const record = await getAppState<League[]>(REGISTRY_SCOPE, REGISTRY_KEY);
  const value = record?.value;
  return Array.isArray(value) ? value : [];
}

export async function getLeague(slug: string): Promise<League | null> {
  const leagues = await getLeagues();
  return leagues.find((l) => l.slug === slug) ?? null;
}

export async function addLeague(league: League): Promise<League[]> {
  const leagues = await getLeagues();
  if (leagues.some((l) => l.slug === league.slug)) {
    throw new Error(`League with slug '${league.slug}' already exists`);
  }
  const updated = [...leagues, league];
  await setAppState(REGISTRY_SCOPE, REGISTRY_KEY, updated);
  return updated;
}

export async function updateLeague(
  slug: string,
  updates: Partial<Omit<League, 'slug' | 'createdAt'>>
): Promise<League | null> {
  const leagues = await getLeagues();
  const idx = leagues.findIndex((l) => l.slug === slug);
  if (idx === -1) return null;
  const updated = leagues.map((l, i) => (i === idx ? { ...l, ...updates } : l));
  await setAppState(REGISTRY_SCOPE, REGISTRY_KEY, updated);
  return updated[idx];
}

export async function removeLeague(slug: string): Promise<{ removed: boolean; leagues: League[] }> {
  const leagues = await getLeagues();
  const idx = leagues.findIndex((l) => l.slug === slug);
  if (idx === -1) return { removed: false, leagues };
  const updated = leagues.filter((l) => l.slug !== slug);
  await setAppState(REGISTRY_SCOPE, REGISTRY_KEY, updated);
  return { removed: true, leagues: updated };
}
