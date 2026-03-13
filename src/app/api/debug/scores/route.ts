import { NextResponse } from 'next/server';

import { fetchScoresByGame } from '@/lib/scores';
import type { AppGame } from '@/lib/schedule';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = Number(url.searchParams.get('year') ?? new Date().getFullYear());
  const origin = `${url.protocol}//${url.host}`;

  const [scheduleRes, teamsRes, aliasesRes] = await Promise.all([
    fetch(`${origin}/api/schedule?year=${year}`, { cache: 'no-store' }),
    fetch(`${origin}/api/teams`, { cache: 'no-store' }),
    fetch(`${origin}/api/aliases?year=${year}`, { cache: 'no-store' }),
  ]);

  const scheduleJson = (await scheduleRes.json().catch(() => ({ items: [] }))) as { items?: Array<Record<string, unknown>> };
  const teamsJson = (await teamsRes.json().catch(() => ({ items: [] }))) as { items?: Array<Record<string, unknown>> };
  const aliasesJson = (await aliasesRes.json().catch(() => ({ map: {} }))) as { map?: Record<string, string> };

  const games: AppGame[] = (scheduleJson.items ?? []).slice(0, 50).map((item) => ({
    key: `${item.week}-${item.homeTeam}-${item.awayTeam}`,
    week: Number(item.week ?? 0),
    csvAway: String(item.awayTeam ?? ''),
    csvHome: String(item.homeTeam ?? ''),
    neutral: Boolean(item.neutralSite),
    canAway: String(item.awayTeam ?? ''),
    canHome: String(item.homeTeam ?? ''),
    awayConf: String(item.awayConference ?? ''),
    homeConf: String(item.homeConference ?? ''),
  }));

  const scores = await fetchScoresByGame({
    games,
    aliasMap: aliasesJson.map ?? {},
    season: year,
    teams: (teamsJson.items ?? []) as never[],
  });

  return NextResponse.json({
    scoreCount: Object.keys(scores.scoresByKey).length,
    issues: scores.issues,
    diag: scores.diag.slice(0, 50),
  });
}
