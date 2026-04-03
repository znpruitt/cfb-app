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
