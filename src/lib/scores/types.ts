export type SeasonType = 'regular' | 'postseason';
export type CfbdFallbackReason =
  | 'none'
  | 'api-key-missing'
  | 'cfbd-empty'
  | 'cfbd-timeout'
  | 'cfbd-aborted'
  | 'cfbd-network'
  | 'cfbd-http'
  | 'cfbd-parse'
  | 'cfbd-unknown-error'
  // Public/anonymous request with no usable cache: upstream CFBD/ESPN was not
  // contacted to protect provider quota (PLATFORM-075). Distinct from
  // 'cfbd-empty' (which means the provider WAS called and returned no rows).
  | 'upstream-suppressed';

export interface ScorePack {
  id?: string | null;
  seasonType?: SeasonType | null;
  startDate?: string | null;
  week: number | null;
  status: string;
  home: { team: string; score: number | null };
  away: { team: string; score: number | null };
  time: string | null;
}

export interface ScoresMeta {
  source: 'cfbd' | 'espn';
  // 'hit'  — served a fresh cache entry (within TTL)
  // 'miss' — fetched fresh from upstream (authorized refresh only)
  // 'stale' — public/anonymous best-effort read: served cached data that may be
  //           past TTL, or an empty response when nothing is cached, WITHOUT any
  //           upstream call (PLATFORM-075).
  cache: 'hit' | 'miss' | 'stale';
  fallbackUsed: boolean;
  generatedAt: string;
  cfbdFallbackReason: CfbdFallbackReason;
}

export interface ScoresResponse {
  items: ScorePack[];
  meta: ScoresMeta;
}

export type CfbdGameLoose = {
  id?: number | string;
  season?: number;
  week?: number | string;
  season_type?: string;
  seasonType?: string;
  start_date?: string | null;
  startDate?: string | null;

  home_team?: string;
  away_team?: string;
  home_points?: number | null;
  away_points?: number | null;
  status?: string | null;

  homeTeam?: string;
  awayTeam?: string;
  home?: string;
  away?: string;
  home_name?: string;
  away_name?: string;

  homePoints?: number | null;
  awayPoints?: number | null;
  home_score?: number | null;
  away_score?: number | null;

  completed?: boolean | null;
};

export interface EspnTeamRef {
  team: { displayName: string };
  score?: string;
  homeAway?: 'home' | 'away';
}

export interface EspnCompetition {
  status: { type: { name: string; description: string; shortDetail?: string } };
  competitors: EspnTeamRef[];
  date?: string | null;
}

export interface EspnEvent {
  competitions: EspnCompetition[];
  date?: string | null;
}

export interface EspnScoreboard {
  events: EspnEvent[];
}
