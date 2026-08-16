import type { Insight } from '../selectors/insights';
import type { SeasonContext } from '../selectors/seasonContext';
import type { LeagueRecords } from '../selectors/leagueRecords';
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

// News hook — the reason an insight is firing this time. Every insight must
// carry one; suppression compares current hook against the last-fired hook.
export type NewsHook =
  | 'extending_lead' // leader's advantage is growing
  | 'narrowing_gap' // challenger closing in
  | 'milestone_crossed' // round-number achieved
  | 'streak_extended' // existing streak got longer
  | 'streak_started' // new streak beginning (3+ consecutive)
  | 'new_leader' // different owner leads vs last season
  | 'returning_leader' // previous leader reclaims top spot
  | 'never_won' // owner has zero titles
  | 'new_record' // all-time best performance
  | 'challenger_emerging' // someone closing within striking distance
  | 'snapshot'; // current-state catch-all; aggressively suppressed after first fire

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
/**
 * Where a league's membership came from.
 * `confirmed` — the confirmed owner list, once a new roster has been named.
 * `previous-roster` — no new roster yet, so last season's owners are still the
 *   league (owner framing: nobody has left until preseason names a new roster).
 * `none` — neither exists.
 */
/**
 * Where membership came from. FIVE values, not four: `official-roster` and
 * `partial-roster` were one value (`current-roster`) and had to be split,
 * because they carry different amounts of trust and the page printed the same
 * caption for both.
 *
 * `official-roster` and `partial-roster` read the SAME durable record —
 * `owners:{slug}:{year}`, the season's team→owner roster. They differ only in
 * whether it cleared `MIN_CONFIRMED_OWNERS`: at two or more distinct owners
 * `selectConfirmedRoster` accepts it as the confirmed roster, below that it
 * refuses and membership falls through to the parsed map. So `partial-roster`
 * means "this league's roster names exactly one person" — real, but not a
 * league, and an insight naming its sole member is almost certainly wrong.
 */
export type LeagueMembersSource =
  /** The confirmed preseason owner list — the documented single answer, and it wins. */
  | 'confirmed'
  /**
   * No confirmation record, but the season's roster names enough owners that
   * `selectConfirmedRoster` accepted it in place of one.
   */
  | 'official-roster'
  /**
   * A roster exists but is below the confirmation threshold — one named owner.
   * Distinguished from `official-roster` so a one-owner league cannot read as a
   * confirmed one.
   */
  | 'partial-roster'
  /** No new roster named, so last season's owners are still the league. */
  | 'previous-roster'
  /** Neither exists. */
  | 'none';

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
  /**
   * INSIGHTS-023a — who is IN the league this season, from the confirmed owner
   * list. The answer to "should we speak about this owner at all".
   *
   * Distinct from `currentRoster`, which answers "who owns which team" and only
   * exists after a draft. Five generators used to reconstruct membership from
   * that map — `new Set(currentRoster.values())` copied into four files plus one
   * inline — which meant that before a draft they were filtering against LAST
   * season's owners, since `currentRoster` falls back to the most recent archive
   * when the current-year CSV is absent.
   *
   * Empty when the league has neither a confirmed owner list nor an owners CSV.
   * Member-filtered generators then produce nothing, which is the owner's ruling
   * (2026-08-16): fewer insights and right, rather than guessing from stale data.
   */
  leagueMembers: ReadonlySet<string>;
  /**
   * WHICH source supplied `leagueMembers`. Carried so the diagnostic page can
   * SHOW it rather than have anyone infer it — an unchanged feed is the same
   * observation whether membership came from the confirmed list or fell back to
   * last season's roster, and telling those apart by looking at insight counts
   * is exactly the guessing this page exists to end.
   */
  leagueMembersSource: LeagueMembersSource;
  // true when currentRoster was borrowed from the most recent season archive
  // because the current-year owners CSV is empty (fresh_offseason rollover window).
  usingArchivedRoster: boolean;
  /**
   * Atemporal record holders for every tracked record category.
   * Computed once per request by selectAllRecords() and available to all
   * generators. Generators may read this instead of re-deriving records inline.
   * In Phase 1 no generator consumes this field; existing generators continue
   * to re-derive their own records as before.
   */
  records: LeagueRecords;
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
