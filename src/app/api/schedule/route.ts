import { NextResponse } from 'next/server';

import { fetchUpstreamJson, UpstreamFetchError } from '@/lib/api/fetchUpstream';

export const dynamic = 'force-dynamic';
export const revalidate = 120;

type SeasonType = 'regular' | 'postseason';

type CfbdScheduleGame = {
  id?: number;
  week?: number;
  start_date?: string | null;
  neutral_site?: boolean;
  conference_game?: boolean;
  home_team?: string;
  away_team?: string;
  home_conference?: string | null;
  away_conference?: string | null;
  status?: string | null;
};

type ScheduleItem = {
  id: string;
  week: number;
  startDate: string | null;
  neutralSite: boolean;
  conferenceGame: boolean;
  homeTeam: string;
  awayTeam: string;
  homeConference: string;
  awayConference: string;
  status: string;
};

interface ScheduleMeta {
  source: 'cfbd';
  cache: 'hit' | 'miss';
  fallbackUsed: false;
  generatedAt: string;
}

interface ScheduleResponse {
  items: ScheduleItem[];
  meta: ScheduleMeta;
}

const CACHE_TTL_MS = 60 * 1000;
const CACHE: Record<string, { at: number; items: ScheduleItem[] }> = {};

function parseNonNegativeInt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  return Number.parseInt(raw, 10);
}

function seasonYearForToday(now = new Date()): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 7 ? year : year - 1;
}

function toScheduleItem(game: CfbdScheduleGame): ScheduleItem | null {
  const week = typeof game.week === 'number' ? game.week : null;
  const homeTeam = (game.home_team ?? '').trim();
  const awayTeam = (game.away_team ?? '').trim();
  if (week === null || !homeTeam || !awayTeam) return null;

  return {
    id: String(game.id ?? `${week}-${homeTeam}-${awayTeam}`),
    week,
    startDate: game.start_date ?? null,
    neutralSite: Boolean(game.neutral_site),
    conferenceGame: Boolean(game.conference_game),
    homeTeam,
    awayTeam,
    homeConference: (game.home_conference ?? '').trim(),
    awayConference: (game.away_conference ?? '').trim(),
    status: (game.status ?? 'scheduled').trim() || 'scheduled',
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const yearParam = url.searchParams.get('year');
  const weekParam = url.searchParams.get('week');
  const seasonTypeParam = url.searchParams.get('seasonType');

  const year = parseNonNegativeInt(yearParam) ?? seasonYearForToday();
  const week = weekParam == null ? null : parseNonNegativeInt(weekParam);
  if (weekParam != null && week === null) {
    return NextResponse.json({ error: 'week must be a non-negative integer', field: 'week' }, { status: 400 });
  }

  const seasonType: SeasonType = seasonTypeParam === 'postseason' ? 'postseason' : 'regular';
  const cacheKey = `${year}-${week ?? 'all'}-${seasonType}`;

  const hit = CACHE[cacheKey];
  const now = Date.now();
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return NextResponse.json<ScheduleResponse>({
      items: hit.items,
      meta: { source: 'cfbd', cache: 'hit', fallbackUsed: false, generatedAt: new Date(hit.at).toISOString() },
    });
  }

  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  if (!cfbdApiKey) {
    return NextResponse.json({ error: 'CFBD_API_KEY missing' }, { status: 503 });
  }

  try {
    const cfbdUrl = new URL('https://api.collegefootballdata.com/games');
    cfbdUrl.searchParams.set('year', String(year));
    cfbdUrl.searchParams.set('division', 'fbs');
    cfbdUrl.searchParams.set('seasonType', seasonType);
    if (week != null) cfbdUrl.searchParams.set('week', String(week));

    const upstream = await fetchUpstreamJson<CfbdScheduleGame[]>(cfbdUrl.toString(), {
      cache: 'no-store',
      timeoutMs: 12_000,
      headers: { Authorization: `Bearer ${cfbdApiKey}` },
    });

    const items = upstream.map(toScheduleItem).filter((v): v is ScheduleItem => Boolean(v));
    CACHE[cacheKey] = { at: now, items };

    return NextResponse.json<ScheduleResponse>({
      items,
      meta: { source: 'cfbd', cache: 'miss', fallbackUsed: false, generatedAt: new Date(now).toISOString() },
    });
  } catch (error) {
    if (error instanceof UpstreamFetchError) {
      return NextResponse.json({ error: 'upstream error', detail: error.details }, { status: error.details.status ?? 502 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'unknown error' },
      { status: 502 }
    );
  }
}
