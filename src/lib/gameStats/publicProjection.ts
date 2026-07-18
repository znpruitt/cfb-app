import { classifyGameStatsRow } from './contract.ts';
import type { GameStats, TeamGameStats, WeeklyGameStats } from './types.ts';

/**
 * PLATFORM-086H3 — schema-safe public wire projection for game-stats reads
 * (ACTIVE).
 *
 * The public boundary operates ONLY on rows the H1 contract approves for
 * public compatibility, and preserves exact schema authority:
 *
 *   - LEGACY rows (no own `schemaVersion`) pass through BY REFERENCE —
 *     byte-equivalent public output for equivalent legacy data (the 086H2
 *     `/verify` result), including analytics-ineligible legacy evidence
 *     (compatibility data the wire always served);
 *   - VERSION-2 rows (the only version this code writes) are shallow-copied
 *     with the internal persistence metadata (`schemaVersion`,
 *     `fetchStartedAt`, per-side `pointsProvided`) removed;
 *   - rows with any OTHER schema authority (`schemaVersion: 3`, malformed
 *     versions) are WITHHELD — an unsupported authoritative row is never
 *     stripped into a legacy-looking unversioned row (no schema laundering);
 *   - structurally unaddressable rows (not an object / invalid provider game
 *     id) are WITHHELD as malformed.
 *
 * Withheld counts ride the public view so `meta.availability` (which already
 * types blocked evidence via committed coverage) and the served `games` array
 * agree. Identical stored duplicates pass through as stored (each row is
 * individually H1-approved; the coverage layer — not the wire — owns
 * duplicate-conflict semantics for availability).
 */

export type PublicWeeklyGameStatsView = {
  /** The public partition: envelope fields plus only publishable rows. */
  record: WeeklyGameStats;
  /** Rows withheld from the public wire, by typed cause. */
  withheld: {
    /** Unsupported authoritative schema (e.g. `schemaVersion: 3`) or malformed version. */
    unsupportedSchema: number;
    /** Structurally unusable rows (not an object, unaddressable game id). */
    malformed: number;
  };
};

function stripTeamMetadata(team: TeamGameStats): TeamGameStats {
  if (!Object.prototype.hasOwnProperty.call(team, 'pointsProvided')) return team;
  const publicTeam = { ...team };
  delete publicTeam.pointsProvided;
  return publicTeam;
}

/** Public view of one VERSION-2 game row: persistence metadata removed. */
function toPublicV2Row(row: GameStats): GameStats {
  const publicRow = {
    ...row,
    home: stripTeamMetadata(row.home),
    away: stripTeamMetadata(row.away),
  };
  delete publicRow.schemaVersion;
  delete publicRow.fetchStartedAt;
  return publicRow;
}

/**
 * Build the schema-safe public view of one weekly partition. Pure; the
 * envelope fields pass through unchanged (envelope validation happens at the
 * read boundary before this is called).
 */
export function buildPublicWeeklyGameStats(record: WeeklyGameStats): PublicWeeklyGameStatsView {
  const games: GameStats[] = [];
  let unsupportedSchema = 0;
  let malformed = 0;

  for (const row of record.games) {
    const hasVersion =
      typeof row === 'object' &&
      row !== null &&
      Object.prototype.hasOwnProperty.call(row, 'schemaVersion');

    if (!hasVersion) {
      const classification = classifyGameStatsRow(row);
      if (classification.state === 'unaddressable') {
        malformed += 1;
        continue;
      }
      // Legacy compatibility: by reference, byte-equivalent.
      games.push(row);
      continue;
    }

    if ((row as { schemaVersion?: unknown }).schemaVersion === 2) {
      const classification = classifyGameStatsRow(row);
      if (classification.state === 'unaddressable') {
        malformed += 1;
        continue;
      }
      games.push(toPublicV2Row(row));
      continue;
    }

    // Any other schema authority: never laundered into legacy-looking data.
    unsupportedSchema += 1;
  }

  const changed =
    games.length !== record.games.length || games.some((game, i) => game !== record.games[i]);
  return {
    record: changed ? { ...record, games } : record,
    withheld: { unsupportedSchema, malformed },
  };
}
