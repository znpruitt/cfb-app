import type { TeamRecordItem } from './teamRecordsCache.ts';

export type TeamRecordClient = Pick<TeamRecordItem['total'], 'wins' | 'losses'>;

export type GameTeamRecordsClient = {
  away: TeamRecordClient | null;
  home: TeamRecordClient | null;
};

export type TeamRecordsByProviderGameId = Record<string, GameTeamRecordsClient>;

export const EMPTY_TEAM_RECORDS_BY_PROVIDER_GAME_ID: TeamRecordsByProviderGameId = {};

export type TeamRecordsClientProps = {
  teamRecordsByProviderGameId: TeamRecordsByProviderGameId;
};
