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
