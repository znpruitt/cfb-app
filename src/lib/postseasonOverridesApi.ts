import { requireAdminAuthHeaders } from './adminAuth.ts';
import type { AppGame } from './schedule.ts';

export type PostseasonOverridesMap = Record<string, Partial<AppGame>>;

export type ServerPostseasonOverridesState = {
  map: PostseasonOverridesMap;
  hasStoredValue: boolean;
};

export async function loadServerPostseasonOverrides(
  year: number
): Promise<ServerPostseasonOverridesState> {
  const res = await fetch(`/api/postseason-overrides?year=${year}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`postseason overrides GET ${res.status}`);
  const data = (await res.json()) as {
    year: number;
    map?: PostseasonOverridesMap;
    hasStoredValue?: boolean;
  };
  return {
    map: data.map ?? {},
    hasStoredValue: data.hasStoredValue === true,
  };
}

export async function saveServerPostseasonOverrides(
  year: number,
  map: PostseasonOverridesMap
): Promise<PostseasonOverridesMap> {
  const res = await fetch(`/api/postseason-overrides?year=${year}`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      ...requireAdminAuthHeaders(),
    },
    body: JSON.stringify({ map }),
  });
  if (!res.ok) throw new Error(`postseason overrides PUT ${res.status}`);
  const data = (await res.json()) as { year: number; map?: PostseasonOverridesMap };
  return data.map ?? {};
}
