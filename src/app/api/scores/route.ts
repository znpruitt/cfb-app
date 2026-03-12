import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

type SeasonType = 'regular' | 'postseason';

interface ScorePack {
  status: string;
  home: { team: string; score: number | null };
  away: { team: string; score: number | null };
  time: string | null;
}

/** CFBD game (we accept multiple key variants) */
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

  // possible variants seen in some shapes/libraries
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
  const m = now.getUTCMonth(); // 0..11
  const y = now.getUTCFullYear();
  return m >= 7 ? y : y - 1; // season “starts” in August
}

function firstStr(fields: Array<string | undefined | null>): string | undefined {
  for (const f of fields) {
    const v = typeof f === 'string' ? f.trim() : undefined;
    if (v) return v;
  }
  return undefined;
}

function firstNum(fields: Array<number | undefined | null>): number | null {
  for (const f of fields) {
    if (typeof f === 'number' && Number.isFinite(f)) return f;
  }
  return null;
}

function toStatus(status?: string | null, completed?: boolean | null): string {
  const s = (status ?? '').toLowerCase();
  if (s.includes('final')) return 'final';
  if (s.includes('progress') || s.includes('half') || s.includes('q')) return 'in progress';
  if (completed) return 'final';
  if (s.includes('sched')) return 'scheduled';
  return s ? status! : 'scheduled';
}

function toScorePackFromCfbd(g: CfbdGameLoose): ScorePack | null {
  const homeTeam = firstStr([g.home_team, g.homeTeam, g.home, g.home_name]);
  const awayTeam = firstStr([g.away_team, g.awayTeam, g.away, g.away_name]);
  if (!homeTeam || !awayTeam) return null;

  const homeScore = firstNum([g.home_points ?? null, g.homePoints ?? null, g.home_score ?? null]);
  const awayScore = firstNum([g.away_points ?? null, g.awayPoints ?? null, g.away_score ?? null]);

  return {
    status: toStatus(g.status, g.completed ?? null),
    time: g.start_date ?? null,
    home: { team: homeTeam, score: homeScore },
    away: { team: awayTeam, score: awayScore },
  };
}

function toScorePackFromEspn(ev: EspnEvent): ScorePack | null {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const t = comp.status?.type;
  const name = (t?.name ?? '').toLowerCase();
  const desc = (t?.description ?? '').toLowerCase();

  let status = 'scheduled';
  if (name.includes('final') || desc.includes('final')) status = 'final';
  else if (
    name.includes('progress') ||
    desc.includes('progress') ||
    desc.includes('half') ||
    desc.includes('q')
  )
    status = 'in progress';

  const homeRef = comp.competitors.find((c) => c.homeAway === 'home');
  const awayRef = comp.competitors.find((c) => c.homeAway === 'away');
  if (!homeRef || !awayRef) return null;

  const h = Number.parseInt(homeRef.score ?? '', 10);
  const a = Number.parseInt(awayRef.score ?? '', 10);

  return {
    status,
    time: t?.shortDetail ?? null,
    home: { team: homeRef.team.displayName, score: Number.isFinite(h) ? h : null },
    away: { team: awayRef.team.displayName, score: Number.isFinite(a) ? a : null },
  };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`upstream ${res.status}: ${body || res.statusText}`);
  }
  return (await res.json()) as T;
}

/* -------- cache -------- */

type CacheKey = `${number}-${number}-${SeasonType}`;
const SCORES_CACHE: Record<CacheKey, { at: number; items: ScorePack[] }> = {};
const CACHE_TTL_MS = 60 * 1000;

export async function GET(req: Request) {
  const u = new URL(req.url);
  const weekParam = u.searchParams.get('week');
  const yearParam = u.searchParams.get('year');
  const seasonParam = u.searchParams.get('seasonType');

  if (!weekParam || !/^\d+$/.test(weekParam)) {
    return NextResponse.json({ error: 'week required (integer)' }, { status: 400 });
  }
  const week = Number.parseInt(weekParam, 10);
  const year = yearParam ? Number.parseInt(yearParam, 10) : seasonYearForToday();
  const seasonType: SeasonType = seasonParam === 'postseason' ? 'postseason' : 'regular';

  const cacheKey: CacheKey = `${year}-${week}-${seasonType}`;
  const now = Date.now();
  const hit = SCORES_CACHE[cacheKey];
  if (hit && now - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.items, { status: 200 });
  }

  // 1) CFBD (preferred)
  const cfbdApiKey = process.env.CFBD_API_KEY?.trim() ?? '';
  const cfbdApiKeyMissing = cfbdApiKey.length === 0;

  try {
    if (cfbdApiKey) {
      // https://api.collegefootballdata.com/games?year=2025&week=1&seasonType=regular&division=fbs
      const cfbdUrl = new URL('https://api.collegefootballdata.com/games');
      cfbdUrl.searchParams.set('year', String(year));
      cfbdUrl.searchParams.set('week', String(week));
      cfbdUrl.searchParams.set('seasonType', seasonType);
      cfbdUrl.searchParams.set('division', 'fbs');

      const raw = await fetchJson<CfbdGameLoose[]>(cfbdUrl.toString(), {
        headers: { Authorization: `Bearer ${cfbdApiKey}` },
        cache: 'no-store',
      });

      // Map robustly & drop nameless rows
      const items: ScorePack[] = [];
      for (const g of raw) {
        const pack = toScorePackFromCfbd(g);
        if (pack) items.push(pack);
      }

      if (items.length > 0) {
        SCORES_CACHE[cacheKey] = { at: now, items };
        return NextResponse.json(items, { status: 200 });
      }
    }
  } catch {
    // swallow and try ESPN
  }

  // 2) ESPN fallback
  try {
    // seasontype: ESPN uses 2=regular, 3=postseason
    const espnSeason = seasonType === 'regular' ? '2' : '3';
    const espnUrl = new URL(
      'https://site.web.api.espn.com/apis/v2/sports/football/college-football/scoreboard'
    );
    espnUrl.searchParams.set('week', String(week));
    espnUrl.searchParams.set('year', String(year));
    espnUrl.searchParams.set('seasontype', espnSeason);

    const board = await fetchJson<EspnScoreboard>(espnUrl.toString(), { cache: 'no-store' });
    const items: ScorePack[] = [];
    for (const ev of board.events ?? []) {
      const pack = toScorePackFromEspn(ev);
      if (pack) items.push(pack);
    }

    SCORES_CACHE[cacheKey] = { at: now, items };
    return NextResponse.json(items, { status: 200 });
  } catch (err) {
    const msg = (err as Error).message || 'unknown error';
    return NextResponse.json(
      {
        error: 'all sources failed',
        detail: msg,
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
