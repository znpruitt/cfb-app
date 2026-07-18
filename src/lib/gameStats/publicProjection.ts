import type { GameStats, TeamGameStats, WeeklyGameStats } from './types.ts';

/**
 * PLATFORM-086H3 — public wire projection for game-stats reads (ACTIVE).
 *
 * Internal persistence metadata — `schemaVersion`, `fetchStartedAt`, and the
 * per-side `pointsProvided` evidence flag — must never leak through public
 * game-stats responses. Legacy rows carry none of these properties and pass
 * through by REFERENCE, so public output for equivalent legacy data stays
 * byte-equivalent to pre-activation output (the 086H2 `/verify` result). Only
 * rows that actually carry v2 metadata are shallow-copied with those own
 * properties removed; every other field (including the raw category evidence
 * map, which was always public) is preserved untouched.
 */

function stripTeamMetadata(team: TeamGameStats): TeamGameStats {
  if (!Object.prototype.hasOwnProperty.call(team, 'pointsProvided')) return team;
  const publicTeam = { ...team };
  delete publicTeam.pointsProvided;
  return publicTeam;
}

/** Public view of one game row: v2 persistence metadata removed. */
export function toPublicGameStats(row: GameStats): GameStats {
  const home = stripTeamMetadata(row.home);
  const away = stripTeamMetadata(row.away);
  const hasRowMetadata =
    Object.prototype.hasOwnProperty.call(row, 'schemaVersion') ||
    Object.prototype.hasOwnProperty.call(row, 'fetchStartedAt');
  if (!hasRowMetadata && home === row.home && away === row.away) return row;
  const publicRow = { ...row, home, away };
  delete publicRow.schemaVersion;
  delete publicRow.fetchStartedAt;
  return publicRow;
}

/** Public view of one weekly partition: every row projected. */
export function toPublicWeeklyGameStats(record: WeeklyGameStats): WeeklyGameStats {
  const games = record.games.map(toPublicGameStats);
  if (games.every((game, i) => game === record.games[i])) return record;
  return { ...record, games };
}
