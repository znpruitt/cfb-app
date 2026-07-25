import type { GameStats, WeeklyGameStats } from './types.ts';

/**
 * Content-based game-stats PRESENCE helpers (PLATFORM-086A, narrowed by
 * PLATFORM-086H3E3).
 *
 * The presence of a `WeeklyGameStats` cache KEY does not prove the week has
 * usable data: legacy records can carry `games: []` or rows whose every field
 * was dropped during normalization. These helpers answer only "does any usable
 * stored row exist" for the admin cache-state PRESENCE probe
 * (`providerCacheState.ts`). They are NOT coverage authority: canonical
 * coverage is the evidence-based `evaluatePartitionCoverage` (participant-
 * verified, per the shared evidence authority), which diagnostics and every
 * analytics surface consume. The legacy payload classifier and cron slate
 * helpers (`classifyGameStatsPayload`, `expectsGameStats`,
 * `hasUsableGameStats`) were retired with the legacy writer: ingestion policy
 * lives solely in H1 parsing + H2 merge behind `ingestGameStatsPartitionResponse`.
 */

/** Whether a normalized team row carries a resolvable identity (nonempty school). */
function hasTeamIdentity(team: GameStats['home'] | GameStats['away'] | null | undefined): boolean {
  return Boolean(team && typeof team.school === 'string' && team.school.trim().length > 0);
}

/**
 * A stored game-stats row is usable-for-presence when it carries a real CFBD
 * provider game id AND a nonempty team identity on BOTH sides. Presence only —
 * no completeness, participant, or evidence judgment.
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
 * The set of provider game ids (as strings, to match `ScheduleItem.id`) that a
 * stored weekly record actually carries. Empty for a missing record, a
 * `games: []` record, or a record whose every row was dropped.
 */
export function usableGameStatsGameIds(record: WeeklyGameStats | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!record) return ids;
  for (const game of record.games ?? []) {
    if (isUsableGameStatsRow(game)) ids.add(String(game.providerGameId));
  }
  return ids;
}
