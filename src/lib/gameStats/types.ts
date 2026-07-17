import type { CfbdSeasonType } from '../cfbd.ts';

// === Raw CFBD wire format from GET /games/teams ===

export type RawTeamStatEntry = {
  category: string;
  stat: string;
};

export type RawGameTeamStatsTeam = {
  teamId: number;
  team: string;
  conference: string;
  homeAway: string;
  points: number;
  stats: RawTeamStatEntry[];
};

export type RawGameTeamStats = {
  id: number;
  teams: RawGameTeamStatsTeam[];
};

// === Normalized internal types ===

export type TeamGameStats = {
  school: string;
  schoolId: number;
  conference: string;
  homeAway: 'home' | 'away';
  points: number;
  totalYards: number;
  rushingYards: number;
  passingYards: number;
  rushingAttempts: number;
  passingAttempts: number;
  passingCompletions: number;
  rushingTDs: number;
  passingTDs: number;
  firstDowns: number;
  turnovers: number;
  fumblesLost: number;
  interceptionsThrown: number;
  passesIntercepted: number;
  fumblesRecovered: number;
  thirdDownAttempts: number;
  thirdDownConversions: number;
  thirdDownPct: number;
  fourthDownAttempts: number;
  fourthDownConversions: number;
  penaltyCount: number;
  penaltyYards: number;
  possessionSeconds: number;
  interceptionReturnYards: number;
  interceptionReturnTDs: number;
  kickReturnYards: number;
  kickReturnTDs: number;
  puntReturnYards: number;
  puntReturnTDs: number;
  raw: Record<string, string>;
};

export type GameStats = {
  providerGameId: number;
  week: number;
  seasonType: CfbdSeasonType;
  home: TeamGameStats;
  away: TeamGameStats;
};

export type WeeklyGameStats = {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  /** When the provider response that produced this record was RECEIVED. */
  fetchedAt: string;
  /**
   * When the provider request that produced this record was STARTED (additive,
   * absent on legacy records). Together with `fetchedAt` this bounds the
   * provider-observation window used to fence overlapping same-game
   * replacements — CFBD supplies no observation timestamp of its own.
   */
  fetchStartedAt?: string;
  games: GameStats[];
};

// === Owner aggregation ===

export type OwnerWeekStats = {
  owner: string;
  gamesPlayed: number;
  points: number;
  totalYards: number;
  rushingYards: number;
  passingYards: number;
  turnovers: number;
  turnoverMargin: number;
  thirdDownPct: number;
  possessionSeconds: number;
};
