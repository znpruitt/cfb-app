import type { ScheduleWireItem } from '../schedule';
import {
  EMPTY_TEAM_RECORDS_BY_PROVIDER_GAME_ID,
  type TeamRecordClient,
  type TeamRecordsByProviderGameId,
  type TeamRecordsClientProps,
} from '../teamRecords/clientProjection.ts';
import type { TeamRecordsCacheRead, TeamRecordTotal } from '../teamRecords/teamRecordsCache';

export type {
  GameTeamRecordsClient,
  TeamRecordClient,
  TeamRecordsByProviderGameId,
  TeamRecordsClientProps,
} from '../teamRecords/clientProjection.ts';

function recordForParticipant(
  teamId: number | null | undefined,
  recordsByTeamId: ReadonlyMap<number, TeamRecordTotal>,
  withheldTeamIds: ReadonlySet<number>
): TeamRecordClient | null {
  if (teamId == null || withheldTeamIds.has(teamId)) return null;
  const record = recordsByTeamId.get(teamId);
  return record ? { wins: record.wins, losses: record.losses } : null;
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
  recordCache: TeamRecordsCacheRead | null | undefined,
  reconciledTotalsByTeamId?: ReadonlyMap<number, TeamRecordTotal>
): TeamRecordsClientProps {
  if (!recordCache) {
    return {
      teamRecordsByProviderGameId: EMPTY_TEAM_RECORDS_BY_PROVIDER_GAME_ID,
    };
  }

  const recordsByTeamId =
    reconciledTotalsByTeamId ??
    new Map(recordCache.items.map((item) => [item.teamId, item.total] as const));
  const withheldTeamIds = new Set(recordCache.uncreditableTeamIds);
  const teamRecordsByProviderGameId: TeamRecordsByProviderGameId = {};

  for (const item of scheduleItems) {
    if (!item || typeof item !== 'object') continue;
    const providerGameId = typeof item.id === 'string' ? item.id.trim() : '';
    if (!providerGameId) continue;
    const away = recordForParticipant(item.awayId, recordsByTeamId, withheldTeamIds);
    const home = recordForParticipant(item.homeId, recordsByTeamId, withheldTeamIds);
    if (away === null && home === null) continue;
    teamRecordsByProviderGameId[providerGameId] = { away, home };
  }

  return { teamRecordsByProviderGameId };
}
