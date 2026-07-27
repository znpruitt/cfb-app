import type { CanonicalGame } from '@/lib/gameStats/canonicalSlate';
import type { ScorePack } from '@/lib/scores/types';
import { resolveTeamIdentityKey, type TeamIdentityResolver } from '@/lib/teamIdentity';

import type { LiveScoreGame } from './canonicalContext';
import {
  isScoreboardFinal,
  scoreboardStatusLabel,
  type NormalizedScoreboardRow,
} from './scoreboardPayload';

/**
 * PLATFORM-086B1 — match normalized scoreboard rows to the run's targeted
 * canonical schedule games.
 *
 * Identity is the SCHEDULE's: a row is associated ONLY by its CFBD provider game
 * id, and the resulting ScorePack is always built in schedule orientation with
 * canonical participant labels — a scoreboard row can never mint a game absent
 * from the schedule. Participant validation is numeric-first: when both the
 * schedule game and the row carry numeric CFBD team ids they must match
 * side-for-side; otherwise (legacy schedule rows, or a row missing numeric ids)
 * the centralized team-identity resolver validates the labels side-exactly.
 * Ambiguous (duplicate provider id), swapped, mismatched, or unresolvable rows
 * are REJECTED (never positionally swapped in). Iteration is over TARGETS, so
 * the many non-targeted games in a global scoreboard response are simply ignored.
 */

export type ScoreboardMatch = {
  game: LiveScoreGame;
  /** Schedule-oriented ScorePack for the durable merge. */
  pack: ScorePack;
  /** True when the row asserts a confirmed final (needs `/games` confirmation). */
  provisionalFinal: boolean;
};

/**
 * Numeric-first, then centralized-identity side-exact validation. Returns true
 * only for a direct (non-swapped) side match.
 */
function validateScoreboardParticipants(
  canonical: CanonicalGame,
  row: NormalizedScoreboardRow,
  resolver: TeamIdentityResolver
): boolean {
  const hasCanonicalIds = canonical.homeId !== null && canonical.awayId !== null;
  const hasRowIds = row.homeId !== null && row.awayId !== null;
  if (hasCanonicalIds && hasRowIds) {
    return row.homeId === canonical.homeId && row.awayId === canonical.awayId;
  }
  const canonicalHomeKey = canonical.home?.identityKey ?? null;
  const canonicalAwayKey = canonical.away?.identityKey ?? null;
  if (!canonicalHomeKey || !canonicalAwayKey) return false;
  const homeKey = resolveTeamIdentityKey(resolver, row.homeTeam);
  const awayKey = resolveTeamIdentityKey(resolver, row.awayTeam);
  if (!homeKey || !awayKey) return false;
  return homeKey === canonicalHomeKey && awayKey === canonicalAwayKey;
}

/** Build the schedule-oriented ScorePack for an accepted scoreboard match. */
function buildScoreboardScorePack(
  canonical: CanonicalGame,
  row: NormalizedScoreboardRow
): ScorePack {
  return {
    id: String(canonical.providerGameId),
    seasonType: canonical.seasonType,
    startDate: canonical.kickoff,
    week: canonical.providerWeek,
    status: scoreboardStatusLabel(row),
    home: { team: canonical.home?.canonicalName ?? '', score: row.homePoints },
    away: { team: canonical.away?.canonicalName ?? '', score: row.awayPoints },
    time: canonical.kickoff,
  };
}

export type ScoreboardMatchResult = {
  matched: ScoreboardMatch[];
  /** Targeted games that received exactly one row that PASSED validation. */
  matchedCount: number;
  /** Targeted games (expected in the response). */
  expectedCount: number;
};

/**
 * Match usable scoreboard rows to the targeted games. Only a targeted game with
 * EXACTLY ONE row for its provider id that passes participant validation is
 * matched — zero rows (target absent) and multiple rows (ambiguous) both leave
 * the target unmatched, and a validation failure rejects the row.
 */
export function matchScoreboardRows(
  targets: LiveScoreGame[],
  rows: NormalizedScoreboardRow[],
  resolver: TeamIdentityResolver
): ScoreboardMatchResult {
  const rowsByProviderId = new Map<number, NormalizedScoreboardRow[]>();
  for (const row of rows) {
    const bucket = rowsByProviderId.get(row.providerGameId);
    if (bucket) bucket.push(row);
    else rowsByProviderId.set(row.providerGameId, [row]);
  }

  const matched: ScoreboardMatch[] = [];
  for (const target of targets) {
    const candidates = rowsByProviderId.get(target.canonical.providerGameId) ?? [];
    if (candidates.length !== 1) continue; // 0 = absent, >1 = ambiguous
    const row = candidates[0]!;
    if (!validateScoreboardParticipants(target.canonical, row, resolver)) continue;
    matched.push({
      game: target,
      pack: buildScoreboardScorePack(target.canonical, row),
      provisionalFinal: isScoreboardFinal(row),
    });
  }

  return { matched, matchedCount: matched.length, expectedCount: targets.length };
}
