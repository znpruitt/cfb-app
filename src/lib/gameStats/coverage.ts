import type { GameStats, WeeklyGameStats } from './types.ts';

/**
 * Content-based game-stats coverage (PLATFORM-086A 4th-review finding #3).
 *
 * The presence of a `WeeklyGameStats` cache KEY does not prove the week has usable
 * data: both the cron and the manual refresh persist a record with `games: []`
 * when CFBD returns no rows, or when every row is dropped during normalization.
 * Coverage must therefore be judged on the record's actual game CONTENT, resolved
 * through canonical game identity — never on key existence alone. Diagnostics and
 * cron recovery share these helpers so they cannot drift.
 */

/**
 * A normalized game-stats row is usable when it carries a real CFBD provider game
 * id (the canonical identity a schedule game resolves to) and both team rows. A
 * dropped/placeholder row (no positive id) is not usable coverage.
 */
export function isUsableGameStatsRow(game: GameStats): boolean {
  return (
    typeof game.providerGameId === 'number' &&
    Number.isFinite(game.providerGameId) &&
    game.providerGameId > 0 &&
    Boolean(game.home) &&
    Boolean(game.away)
  );
}

/**
 * The set of canonical game ids (as strings, to match `ScheduleItem.id`) that a
 * cached weekly record actually covers. Empty for a missing record, a `games: []`
 * record, or a record whose every row was dropped.
 */
export function usableGameStatsGameIds(record: WeeklyGameStats | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!record) return ids;
  for (const game of record.games ?? []) {
    if (isUsableGameStatsRow(game)) ids.add(String(game.providerGameId));
  }
  return ids;
}

/**
 * Whether a cached weekly record has ANY usable game coverage. `false` for a
 * missing record, an empty `games` array, or an all-dropped record — exactly the
 * cases a bare key-existence check wrongly treated as covered.
 */
export function hasUsableGameStats(record: WeeklyGameStats | null | undefined): boolean {
  return usableGameStatsGameIds(record).size > 0;
}
