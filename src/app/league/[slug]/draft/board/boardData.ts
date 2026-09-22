import { getScopedAliasMap } from '@/lib/server/globalAliasStore';
import { buildScheduleFromApi, type AppGame } from '@/lib/schedule';
import { loadCachedScheduleItems } from '@/lib/server/canonicalScheduleCache';
import type { TeamCatalogItem } from '@/lib/teamIdentity';

/**
 * Loads the cached schedule for the spectator draft board and derives canonical
 * games using server-safe scoped alias resolution.
 *
 * Alias resolution goes through `getScopedAliasMap` (precedence:
 * stored global > year > SEED_ALIASES), never the browser-era loader in
 * `src/lib/aliases.ts` — so it works during server render and schedule-derived
 * draft insights populate instead of silently emptying out. Returns `[]` when
 * no schedule is cached for the season.
 */
export async function loadSpectatorBoardSchedule(params: {
  slug: string;
  year: number;
  teams: TeamCatalogItem[];
}): Promise<AppGame[]> {
  const { slug, year, teams } = params;
  const aliasMap = await getScopedAliasMap(slug, year);
  // PLATFORM-813: through the CANONICAL READER, not a direct durable read. This fed raw
  // stored rows into `buildScheduleFromApi`, so a malformed row surfaced as an
  // unattributable `TypeError` deep in the build. Through the reader it throws
  // `ScheduleRowNonConformanceError` naming the key, row and field instead.
  //
  // The legacy partition pair is now consulted when the aggregate carries no rows, so a
  // legacy store populates the board rather than showing it empty.
  //
  // A member still sees an empty board either way: the only caller
  // (`draft/board/page.tsx:61-65`) wraps this in a bare `catch` that leaves `games = []`.
  // That catch predates #813 (`336050f99`, 2026-04-03) and swallowed `main`'s `TypeError`
  // the same way; whether the page shows a notice instead is #844. Pinned by
  // `scheduleReadEnumeration.test.ts`, which fails if this reads the key directly again.
  const schedItems = await loadCachedScheduleItems(year);
  if (schedItems.length === 0) return [];
  return buildScheduleFromApi({ scheduleItems: schedItems, teams, aliasMap, season: year }).games;
}
