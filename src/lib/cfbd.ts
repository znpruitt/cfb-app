export type CfbdSeasonType = 'regular' | 'postseason';

export function buildCfbdGamesUrl(params: {
  year: number;
  seasonType: CfbdSeasonType;
  week?: number | null;
  division?: 'fbs' | 'fcs';
}): URL {
  const url = new URL('https://api.collegefootballdata.com/games');
  url.searchParams.set('year', String(params.year));
  url.searchParams.set('seasonType', params.seasonType);
  if (typeof params.week === 'number') {
    url.searchParams.set('week', String(params.week));
  }
  if (params.division) {
    url.searchParams.set('division', params.division);
  }
  return url;
}

export function buildCfbdConferencesUrl(): URL {
  return new URL('https://api.collegefootballdata.com/conferences');
}

/**
 * CFBD `GET /scoreboard` (PLATFORM-086B1 live-score polling). The audited
 * contract: it accepts ONLY optional `classification` and `conference` filters —
 * it does NOT accept `year`, `week`, or `seasonType`, so the response is the
 * live/near-live slate for the provider's current context. Canonical year,
 * provider week, canonical week, season type, participants, and ownership are
 * derived EXCLUSIVELY from the schedule, never from this endpoint. Live polling
 * always requests `classification=fbs`.
 */
export function buildCfbdScoreboardUrl(params?: {
  classification?: 'fbs' | 'fcs';
  conference?: string;
}): URL {
  const url = new URL('https://api.collegefootballdata.com/scoreboard');
  if (params?.classification) {
    url.searchParams.set('classification', params.classification);
  }
  if (params?.conference) {
    url.searchParams.set('conference', params.conference);
  }
  return url;
}

export function buildCfbdRankingsUrl(params: {
  year: number;
  week?: number | null;
  seasonType?: 'regular' | 'postseason';
}): URL {
  const url = new URL('https://api.collegefootballdata.com/rankings');
  url.searchParams.set('year', String(params.year));
  if (typeof params.week === 'number') url.searchParams.set('week', String(params.week));
  if (params.seasonType) url.searchParams.set('seasonType', params.seasonType);
  return url;
}

export function buildCfbdTeamsUrl(): URL {
  return new URL('https://api.collegefootballdata.com/teams/fbs');
}

export function buildCfbdSpRatingsUrl(params: { year: number }): URL {
  const url = new URL('https://api.collegefootballdata.com/ratings/sp');
  url.searchParams.set('year', String(params.year));
  return url;
}

export function buildCfbdGameTeamStatsUrl(params: {
  year: number;
  week?: number | null;
  seasonType?: CfbdSeasonType;
}): URL {
  const url = new URL('https://api.collegefootballdata.com/games/teams');
  url.searchParams.set('year', String(params.year));
  if (typeof params.week === 'number') {
    url.searchParams.set('week', String(params.week));
  }
  if (params.seasonType) {
    url.searchParams.set('seasonType', params.seasonType);
  }
  return url;
}
