export type SeasonType = 'regular' | 'postseason';
export type CfbdFallbackReason =
  | 'none'
  | 'api-key-missing'
  | 'cfbd-empty'
  // Provider returned an empty Scores payload for a target where trustworthy,
  // target-scoped evidence (populated prior-good durable rows for the SAME
  // canonical target, or started non-disrupted games in the canonical schedule)
  // says score rows should exist. Classified as a refresh FAILURE — prior-good
  // data is retained and no empty result is published — never a valid no-op
  // (PLATFORM-086G1, deferred finding #6). Distinct from 'cfbd-empty', which is
  // a legitimately empty target (e.g. postseason before bowls).
  | 'cfbd-empty-unexpected'
  | 'cfbd-timeout'
  | 'cfbd-aborted'
  | 'cfbd-network'
  | 'cfbd-http'
  | 'cfbd-parse'
  | 'cfbd-unknown-error'
  // Public/anonymous request with no usable cache: CFBD was not contacted to
  // protect provider quota (PLATFORM-075). Distinct from 'cfbd-empty' (which
  // means the provider WAS called and returned no rows).
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
  // 'cfbd' is the sole normal production score source (PLATFORM-086A rereview
  // removed ESPN as an automatic fallback). 'espn' is retained ONLY to read and
  // label durable/in-memory cache entries written before that removal — no code
  // writes it now; entries age out on the next successful CFBD refresh.
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
