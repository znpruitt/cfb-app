import { isDisruptedStatusLabel } from '../gameStatus.ts';
import type { GameStats, WeeklyGameStats } from './types.ts';

/**
 * Whether a canonical schedule game is EXPECTED to produce team stats. Disrupted
 * games (canceled/postponed/suspended/delayed, via `gameStatus.ts`) never do — a
 * slate composed only of them is not applicable for game-stats retrieval, so it
 * must not trigger a missing-stats diagnostic or a cron provider retry (5th-review
 * findings #1/#3). Shared by the game-stats cron slate selection AND the coverage
 * diagnostics so both use ONE definition of a stat-producing game (no duplicate
 * status parsing).
 */
export function expectsGameStats(status: string | null | undefined): boolean {
  return !isDisruptedStatusLabel(status);
}

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

/** Whether a normalized team row carries a resolvable identity (nonempty school). */
function hasTeamIdentity(team: GameStats['home'] | GameStats['away'] | null | undefined): boolean {
  return Boolean(team && typeof team.school === 'string' && team.school.trim().length > 0);
}

/**
 * A normalized game-stats row is usable when it carries a real CFBD provider game
 * id (the canonical identity a schedule game resolves to) AND a nonempty team
 * identity on BOTH sides. A dropped/placeholder row (no positive id) or a row whose
 * team-name field CFBD omitted/renamed — leaving `school: ''` — is NOT coverage:
 * downstream owner aggregation (`aggregateOwnerGameStats`) cannot resolve a blank
 * school to an owner, so counting it as covered would wrongly stop cron repair
 * (4th/5th-review finding). Identity *resolution* still happens through the
 * centralized resolver elsewhere — this only validates that the inputs exist.
 */
export function isUsableGameStatsRow(game: GameStats): boolean {
  return (
    typeof game.providerGameId === 'number' &&
    Number.isFinite(game.providerGameId) &&
    game.providerGameId > 0 &&
    hasTeamIdentity(game.home) &&
    hasTeamIdentity(game.away)
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
 *
 * PLATFORM-086H3 note: raw provider payload classification moved to
 * `ingestion.ts` (`validateGameStatsPayload`), which parses through the single
 * strict contract parser instead of the legacy normalizer. This module keeps
 * only the content-based usable-row helpers shared by the cache-availability
 * probe; schedule-relative COVERAGE lives in `partitionCoverage.ts`.
 */
export function hasUsableGameStats(record: WeeklyGameStats | null | undefined): boolean {
  return usableGameStatsGameIds(record).size > 0;
}
