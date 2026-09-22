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
  // The legacy partition pair is now consulted when the aggregate carries no rows, so a
  // legacy store populates the board rather than showing it empty.
  //
  // An UNREADABLE season throws out of THIS loader — and a member still sees an empty
  // board, because the only caller (`draft/board/page.tsx:61-65`) wraps the call in a bare
  // `catch` that leaves `games = []`. That catch predates this slice (`336050f99`,
  // 2026-04-03), so on `main` a corrupted schedule already rendered as an empty board;
  // #813 did not regress it and did not fix it. v3 round 1 caught this comment claiming
  // the throw reached the page. Whether the page shows a notice instead is #844.
  const schedItems = await loadCachedScheduleItems(year);
  if (schedItems.length === 0) return [];
  return buildScheduleFromApi({ scheduleItems: schedItems, teams, aliasMap, season: year }).games;
}
