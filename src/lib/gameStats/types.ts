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
   * since PLATFORM-086H3 every production writer emits v2 rows through the
   * durable merge authority. Internal persistence metadata — never on the
   * public wire (`publicProjection.ts`).
   */
  schemaVersion?: 2;
  /**
   * Per-game observation fence (PLATFORM-086H2): when the provider fetch of
   * this row's newest ACCEPTED observation started (canonical UTC ISO).
   * Stamped only by the durable merge service on v2 rows — absent on
   * legacy rows. Every accepted strictly NEWER observation advances the fence
   * durably, including content-identical fence-only refreshes (freshness
   * evidence is itself durable evidence); equal-fence identical observations
   * are no-write idempotent operations. The merge service never lets an
   * observation older than this fence overwrite the row. Internal persistence
   * metadata — never on the public wire (`publicProjection.ts`).
   */
  fetchStartedAt?: string;
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
  /**
   * Durable partition commit revision (PLATFORM-086H3): allocated INSIDE the
   * merge authority's advisory-locked transaction on every accepted write
   * (`(prior ?? 0) + 1`), so it is monotonic per partition and globally
   * comparable across processes, instances, and restarts — the refresh-status
   * ordering authority. Absent on legacy partitions. Internal persistence
   * metadata — never on the public wire (`publicProjection.ts`).
   */
  commitRevision?: number;
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
