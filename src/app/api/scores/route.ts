import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 120;

type SeasonType = 'regular' | 'postseason';

interface ScorePack {
  week: number | null;
  status: string;
  home: { team: string; score: number | null };
  away: { team: string; score: number | null };
  time: string | null;
}

interface ScoresMeta {
  source: 'cfbd' | 'espn';
  cache: 'hit' | 'miss';
  fallbackUsed: boolean;
  generatedAt: string;
}

interface ScoresResponse {
  items: ScorePack[];
  meta: ScoresMeta;
}

type CfbdGameLoose = {
  season?: number;
  week?: number;
  season_type?: string;
  start_date?: string | null;

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

interface EspnTeamRef {
  team: { displayName: string };
  score?: string;
  homeAway?: 'home' | 'away';
}

interface EspnCompetition {
  status: { type: { name: string; description: string; shortDetail?: string } };
  competitors: EspnTeamRef[];
}

interface EspnEvent {
  competitions: EspnCompetition[];
}

interface EspnScoreboard {
  events: EspnEvent[];
}

function seasonYearForToday(now = new Date()): number {
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 7 ? year : year - 1;
}

function firstStr(fields: Array<string | undefined | null>): string | undefined {
  for (const field of fields) {
    const value = typeof field === 'string' ? field.trim() : undefined;
    if (value) return value;
  }
  return undefined;
}

function firstNum(fields: Array<number | undefined | null>): number | null {
  for (const field of fields) {
    if (typeof field === 'number' && Number.isFinite(field)) return field;
  }
  return null;
}

function toStatus(status?: string | null, completed?: boolean | null): string {
  const normalized = (status ?? '').toLowerCase();
  if (normalized.includes('final')) return 'final';
  if (normalized.includes('progress') || normalized.includes('half') || normalized.includes('q')) {
    return 'in progress';
  }
  if (completed) return 'final';
  if (normalized.includes('sched')) return 'scheduled';
  return normalized ? status! : 'scheduled';
}

function toScorePackFromCfbd(game: CfbdGameLoose): ScorePack | null {
  const homeTeam = firstStr([game.home_team, game.homeTeam, game.home, game.home_name]);
  const awayTeam = firstStr([game.away_team, game.awayTeam, game.away, game.away_name]);
  if (!homeTeam || !awayTeam) return null;

  const homeScore = firstNum([
    game.home_points ?? null,
    game.homePoints ?? null,
    game.home_score ?? null,
  ]);
  const awayScore = firstNum([
    game.away_points ?? null,
    game.awayPoints ?? null,
    game.away_score ?? null,
  ]);

  return {
    week: typeof game.week === 'number' ? game.week : null,
    status: toStatus(game.status, game.completed ?? null),
    time: game.start_date ?? null,
    home: { team: homeTeam, score: homeScore },
    away: { team: awayTeam, score: awayScore },
  };
}

function toScorePackFromEspn(event: EspnEvent, week: number | null): ScorePack | null {
  const competition = event.competitions?.[0];
  if (!competition) return null;

  const statusType = competition.status?.type;
  const name = (statusType?.name ?? '').toLowerCase();
  const description = (statusType?.description ?? '').toLowerCase();

  let status = 'scheduled';
  if (name.includes('final') || description.includes('final')) status = 'final';
  else if (
    name.includes('progress') ||
    description.includes('progress') ||
    description.includes('half') ||
    description.includes('q')
  ) {
    status = 'in progress';
  }

  const homeRef = competition.competitors.find((competitor) => competitor.homeAway === 'home');
  const awayRef = competition.competitors.find((competitor) => competitor.homeAway === 'away');
  if (!homeRef || !awayRef) return null;

  const homeScore = Number.parseInt(homeRef.score ?? '', 10);
  const awayScore = Number.parseInt(awayRef.score ?? '', 10);

  return {
    week,
    status,
    time: statusType?.shortDetail ?? null,
    home: {
      team: homeRef.team.displayName,
      score: Number.isFinite(homeScore) ? homeScore : null,
    },
    away: {
      team: awayRef.team.displayName,
      score: Number.isFinite(awayScore) ? awayScore : null,
    },
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`upstream ${response.status}: ${body || response.statusText}`);
  }
  return (await response.json()) as T;
}

type CacheWeek = number | 'all';
type CacheKey = `${number}-${CacheWeek}-${SeasonType}`;

// Primary cache strategy: serve hot responses from in-memory TTL first.
// Provider fetches remain `no-store` so repeated refreshes can retrieve live
// score updates instead of pinning stale provider responses in Next's data cache.
const SCORES_CACHE: Record<CacheKey, { at: number; items: ScorePack[]; source: 'cfbd' | 'espn' }> =
  {};
const CACHE_TTL_MS = 60 * 1000;

function responseFrom(items: ScorePack[], meta: ScoresMeta, status = 200) {
  return NextResponse.json<ScoresResponse>({ items, meta }, { status });
}

function badRequest(field: string, value: string | null, error: string) {
  return NextResponse.json({ error, field, value }, { status: 400 });
}

function parseNonNegativeInt(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number.parseInt(raw, 10);
  return parsed >= 0 ? parsed : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const weekParam = url.searchParams.get('week');
  const yearParam = url.searchParams.get('year');
  const seasonParam = url.searchParams.get('seasonType');

  let week: number | null = null;
  if (weekParam !== null) {
    const parsedWeek = parseNonNegativeInt(weekParam);
    if (parsedWeek === null) {
      return badRequest('week', weekParam, 'week must be a non-negative integer when provided');
    }
    week = parsedWeek;
  }

  const currentYear = new Date().getUTCFullYear();
  const minYear = 2000;
  const maxYear = currentYear + 1;
  let year = seasonYearForToday();
  if (yearParam !== null) {
    const parsedYear = parseNonNegativeInt(yearParam);
    if (parsedYear === null || parsedYear < minYear || parsedYear > maxYear) {
      return badRequest(
        'year',
        yearParam,
        `year must be an integer between ${minYear} and ${maxYear}`
      );
    }
    year = parsedYear;
  }

  let seasonType: SeasonType = 'regular';
  if (seasonParam !== null) {
    if (seasonParam === 'regular' || seasonParam === 'postseason') {
      seasonType = seasonParam;
    } else {
      return badRequest('seasonType', seasonParam, 'seasonType must be "regular" or "postseason"');
    }
  }

  const cacheKey: CacheKey = `${year}-${week ?? 'all'}-${seasonType}`;
  const now = Date.now();
  const hit = SCORES_CACHE[cacheKey];
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return responseFrom(hit.items, {
      source: hit.source,
      cache: 'hit',
      fallbackUsed: hit.source === 'espn',
      generatedAt: new Date(hit.at).toISOString(),
    });
  }

  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  const cfbdApiKeyMissing = cfbdApiKey.length === 0;

  try {
    if (cfbdApiKey) {
      const cfbdUrl = new URL('https://api.collegefootballdata.com/games');
      cfbdUrl.searchParams.set('year', String(year));
      if (week != null) cfbdUrl.searchParams.set('week', String(week));
      cfbdUrl.searchParams.set('seasonType', seasonType);
      cfbdUrl.searchParams.set('division', 'fbs');

      const rawGames = await fetchJson<CfbdGameLoose[]>(cfbdUrl.toString(), {
        headers: { Authorization: `Bearer ${cfbdApiKey}` },
        cache: 'no-store',
      });

      const items: ScorePack[] = [];
      for (const game of rawGames) {
        const pack = toScorePackFromCfbd(game);
        if (pack) items.push(pack);
      }

      if (items.length > 0) {
        SCORES_CACHE[cacheKey] = { at: now, items, source: 'cfbd' };
        return responseFrom(items, {
          source: 'cfbd',
          cache: 'miss',
          fallbackUsed: false,
          generatedAt: new Date(now).toISOString(),
        });
      }
    }
  } catch {
    // swallow CFBD failure and try ESPN fallback
  }

  try {
    if (week == null) {
      return NextResponse.json(
        { error: 'season-wide fallback unavailable without CFBD API key' },
        { status: 502 }
      );
    }

    const espnSeason = seasonType === 'regular' ? '2' : '3';
    const espnUrl = new URL(
      'https://site.web.api.espn.com/apis/v2/sports/football/college-football/scoreboard'
    );
    espnUrl.searchParams.set('week', String(week));
    espnUrl.searchParams.set('year', String(year));
    espnUrl.searchParams.set('seasontype', espnSeason);

    const scoreboard = await fetchJson<EspnScoreboard>(espnUrl.toString(), { cache: 'no-store' });
    const items: ScorePack[] = [];
    for (const event of scoreboard.events ?? []) {
      const pack = toScorePackFromEspn(event, week);
      if (pack) items.push(pack);
    }

    SCORES_CACHE[cacheKey] = { at: now, items, source: 'espn' };
    return responseFrom(items, {
      source: 'espn',
      cache: 'miss',
      fallbackUsed: true,
      generatedAt: new Date(now).toISOString(),
    });
  } catch (error) {
    const detail = (error as Error).message || 'unknown error';
    return NextResponse.json(
      {
        error: 'all sources failed',
        detail,
        metadata: cfbdApiKeyMissing
          ? {
              cfbdApiKeyMissing: true,
              seasonWideEspnFallbackPossible: false,
            }
          : undefined,
      },
      { status: 502 }
    );
  }
}
