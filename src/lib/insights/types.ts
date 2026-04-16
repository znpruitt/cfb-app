import type { Insight } from '../selectors/insights';
import type { SeasonContext } from '../selectors/seasonContext';
import type { RankingsResponse } from '../rankings';
import type { AppGame } from '../schedule';
import type { SeasonArchive } from '../seasonArchive';
import type { OwnerStandingsRow } from '../standings';
import type { StandingsHistoryWeekSnapshot } from '../standingsHistory';

// Lifecycle states — derived from LeagueStatus + SeasonContext + calendar.
export type LifecycleState =
  | 'preseason'
  | 'early_season'
  | 'mid_season'
  | 'late_season'
  | 'postseason'
  | 'fresh_offseason'
  | 'offseason';

// Insight categories — maps to generator groups.
export type InsightCategory =
  | 'trajectory'
  | 'championship_race'
  | 'historical'
  | 'season_wrap'
  | 'rivalry'
  | 'draft_patterns'
  | 'stats_outliers'
  | 'season_performance'
  | 'narrative';

// OwnerSeasonStats — accumulated from OwnerWeekStats across all weeks.
export type OwnerSeasonStats = {
  owner: string;
  season: number;
  gamesPlayed: number;
  points: number;
  totalYards: number;
  rushingYards: number;
  passingYards: number;
  turnovers: number;
  turnoversForced: number;
  turnoverMargin: number;
  thirdDownConversions: number;
  thirdDownAttempts: number;
  thirdDownPct: number;
  possessionSeconds: number;
};

// InsightContext — assembled once, passed to all generators.
// Fields marked optional are not available in all lifecycle states.
export type InsightContext = {
  leagueSlug: string;
  currentYear: number;
  lifecycleState: LifecycleState;
  seasonContext: SeasonContext;
  currentWeek: number | null;
  currentStandings: OwnerStandingsRow[];
  weeklyStandings: StandingsHistoryWeekSnapshot[];
  games: AppGame[];
  ownerGameStats: OwnerSeasonStats[] | null;
  archives: SeasonArchive[];
  historicalRosters: Record<number, Map<string, string>>;
  rankings: RankingsResponse | null;
  currentRoster: Map<string, string>;
};

// Generator interface — all generators must conform to this.
export type InsightGenerator = {
  id: string;
  category: InsightCategory;
  supportedLifecycles: LifecycleState[];
  generate: (context: InsightContext) => Insight[];
};
