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
  /**
   * Structural points evidence (PLATFORM-086H1): true ONLY when the provider
   * wire carried valid points for this side. Absent on legacy rows — the
   * legacy normalizer's `points` fallback zero is NOT evidence, so legacy
   * points trust is bounded by the contract module instead of this flag.
   */
  pointsProvided?: boolean;
  raw: Record<string, string>;
};

export type GameStats = {
  /**
   * Per-game-row schema version (PLATFORM-086H1). Absent → legacy row; exactly
   * `2` → strict-contract row. Interpretation of malformed/future values lives
   * in `contract.ts` (`classifyGameStatsRow`). Reads never stamp legacy rows;
   * no production writer emits v2 rows yet (dormant until PR 2/3).
   */
  schemaVersion?: 2;
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
  fetchedAt: string;
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
