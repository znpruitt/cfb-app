import type { ScheduleWireItem } from '../schedule';
import type { TeamRecordItem, TeamRecordsCacheRead } from '../teamRecords/teamRecordsCache';

export type TeamRecordClient = Pick<TeamRecordItem['total'], 'wins' | 'losses'>;

export type GameTeamRecordsClient = {
  away: TeamRecordClient | null;
  home: TeamRecordClient | null;
};

export type TeamRecordsByProviderGameId = Record<string, GameTeamRecordsClient>;

export type TeamRecordsClientProps = {
  teamRecordsByProviderGameId: TeamRecordsByProviderGameId;
};

function recordForParticipant(
  teamId: number | null | undefined,
  recordsByTeamId: ReadonlyMap<number, TeamRecordItem>,
  withheldTeamIds: ReadonlySet<number>
): TeamRecordClient | null {
  if (teamId == null || withheldTeamIds.has(teamId)) return null;
  const record = recordsByTeamId.get(teamId);
  return record ? { wins: record.total.wins, losses: record.total.losses } : null;
}

/**
 * Project current team records across the server/client boundary by provider ID.
 *
 * Both schedule participant IDs and record team IDs come from CFBD, so the join
 * is exact and covers non-FBS opponents without granting them app-catalog
 * identity. `AppGame.providerGameId` links the client game back to this wire-row
 * projection; names are never a fallback. Historical schedule rows from 2018
 * predate participant-ID persistence, but this projection serves the current
 * Overview season and simply omits a side whose provider ID is absent.
 */
export function teamRecordsClientProps(
  scheduleItems: ReadonlyArray<ScheduleWireItem>,
  recordCache: TeamRecordsCacheRead | null | undefined
): TeamRecordsClientProps {
  if (!recordCache) return { teamRecordsByProviderGameId: {} };

  const recordsByTeamId = new Map(recordCache.items.map((item) => [item.teamId, item]));
  const withheldTeamIds = new Set(recordCache.uncreditableTeamIds);
  const teamRecordsByProviderGameId: TeamRecordsByProviderGameId = {};

  for (const item of scheduleItems) {
    const providerGameId = item.id.trim();
    if (!providerGameId) continue;
    const away = recordForParticipant(item.awayId, recordsByTeamId, withheldTeamIds);
    const home = recordForParticipant(item.homeId, recordsByTeamId, withheldTeamIds);
    if (away === null && home === null) continue;
    teamRecordsByProviderGameId[providerGameId] = { away, home };
  }

  return { teamRecordsByProviderGameId };
}
