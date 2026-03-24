import type { CfbdConferenceRecord } from '@/lib/conferenceSubdivision';

export type ConferencesRouteCacheEntry = {
  at: number;
  items: CfbdConferenceRecord[];
};

let cache: ConferencesRouteCacheEntry | null = null;

export function getConferencesRouteCache(): ConferencesRouteCacheEntry | null {
  return cache;
}

export function setConferencesRouteCache(next: ConferencesRouteCacheEntry | null): void {
  cache = next;
}

export function __resetConferencesRouteCacheForTests(): void {
  cache = null;
}
