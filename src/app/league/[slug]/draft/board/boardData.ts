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
  // PLATFORM-813: through the CANONICAL READER, not a direct durable read.
  //
  // This read bypassed the validation boundary entirely and fed raw stored rows into
  // `buildScheduleFromApi`, so a corrupted row rendered a wrong board — on the
  // member-facing spectator board, during a live draft. v2's prompt claimed the boundary
  // covered all consumers; it did not cover this one, and the acceptance sweep that was
  // supposed to prove coverage matched a substring instead of enumerating reads.
  //
  // Two behaviours change, both deliberate: the legacy partition pair is now consulted
  // when the aggregate carries no rows (so a legacy store populates the board rather
  // than showing it empty), and an UNREADABLE season now throws rather than rendering as
  // "no games" — an empty board with no notice asserts something false. A notice is the
  // better surface and is draft-surface UI under DESIGN.md, filed rather than built here.
  const schedItems = await loadCachedScheduleItems(year);
  if (schedItems.length === 0) return [];
  return buildScheduleFromApi({ scheduleItems: schedItems, teams, aliasMap, season: year }).games;
}
