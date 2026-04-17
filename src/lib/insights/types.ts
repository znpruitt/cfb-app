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

// Time windows — generators may consume "season" or "career" data. Recent-window
// variants are reserved for future weekly-pulse generators.
export type InsightWindow = 'last_3_weeks' | 'last_4_weeks' | 'season' | 'career';

// OwnerSeasonStats — accumulated from OwnerWeekStats across all weeks.
export type OwnerSeasonStats = {
  owner: string;
  season: number;
  gamesPlayed: number;
  points: number;
  pointsAgainst: number;
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

// OwnerCareerStats — accumulated across all archived seasons, scoped to owners
// present in the current roster (including rookies who haven't appeared in any archive).
export type OwnerCareerStats = {
  owner: string;
  seasons: number;
  totalWins: number;
  totalLosses: number;
  totalPoints: number;
  totalPointsAgainst: number;
  totalYards: number;
  totalTurnovers: number;
  totalTurnoversForced: number;
  totalTurnoverMargin: number;
  titles: number;
  titleYears: number[];
  finishHistory: { year: number; rank: number }[];
  firstSeason: number;
  isRookie: boolean;
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
  ownerCareerStats: OwnerCareerStats[];
  archives: SeasonArchive[];
  historicalRosters: Record<number, Map<string, string>>;
  rankings: RankingsResponse | null;
  currentRoster: Map<string, string>;
};

// Generator interface — all generators must conform to this.
// `tone` declares the narrative register used in generator copy (optional for
// generators that don't need to distinguish).
export type InsightGenerator = {
  id: string;
  category: InsightCategory;
  supportedLifecycles: LifecycleState[];
  tone?: 'factual' | 'playful';
  generate: (context: InsightContext) => Insight[];
};
