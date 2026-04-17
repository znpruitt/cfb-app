import { NextResponse } from 'next/server';

import { buildInsightContext } from '@/lib/insights/context';
import { runInsightsEngine } from '@/lib/insights/engine';
import '@/lib/insights/generators';
import { getLeague } from '@/lib/leagueRegistry';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import { loadSeasonRankings } from '@/lib/server/rankings';
import { getAppState } from '@/lib/server/appStateStore';
import { getGlobalAliases } from '@/lib/server/globalAliasStore';
import { buildScheduleFromApi, type AppGame, type ScheduleWireItem } from '@/lib/schedule';
import { fetchScoresByGame, type ScorePack } from '@/lib/scores';
import type { AliasMap } from '@/lib/teamNames';
import { deriveStandings } from '@/lib/standings';
import { deriveStandingsHistory } from '@/lib/standingsHistory';
import { selectSeasonContext } from '@/lib/selectors/seasonContext';
import type { Insight } from '@/lib/selectors/insights';
import type { LifecycleState } from '@/lib/insights/types';

export const dynamic = 'force-dynamic';

type InsightsResponse = {
  insights: Insight[];
  lifecycleState: LifecycleState;
  generatedAt: string;
  error?: string;
};

function parseYear(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 2000 ? n : fallback;
}

async function loadOwnersCsv(slug: string, year: number): Promise<string | null> {
  const record = await getAppState<string>(`owners:${slug}:${year}`, 'csv');
  return typeof record?.value === 'string' ? record.value : null;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function emptyResponse(
  lifecycleState: LifecycleState = 'offseason',
  error?: string
): InsightsResponse {
  return {
    insights: [],
    lifecycleState,
    generatedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
): Promise<Response> {
  const { slug } = await params;
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;

  const league = await getLeague(slug);
  if (!league) {
    return NextResponse.json({ error: `League '${slug}' not found` }, { status: 404 });
  }

  const year = parseYear(url.searchParams.get('year'), league.year);

  try {
    const [csvText, scheduleRes, teamsRes, globalAliases, leagueAliasRecord, rankings] =
      await Promise.all([
        loadOwnersCsv(slug, year),
        fetchJson<{ items?: ScheduleWireItem[] }>(`${origin}/api/schedule?year=${year}`),
        fetchJson<{ items?: Array<Record<string, unknown>> }>(`${origin}/api/teams`),
        getGlobalAliases().catch(() => ({}) as AliasMap),
        getAppState<AliasMap>(`aliases:${slug}:${year}`, 'map').catch(() => null),
        loadSeasonRankings(year).catch(() => null),
      ]);

    const roster = parseOwnersCsv(csvText ?? '');
    const currentRoster = new Map(roster.map((r) => [r.team, r.owner]));
    const scheduleItems = scheduleRes?.items ?? [];
    const teams = (teamsRes?.items ?? []) as never[];
    const leagueAliasMap = leagueAliasRecord?.value;
    // Merge league-scoped aliases with global aliases; global takes precedence
    // to stay consistent with the pattern used in /api/owners routes.
    const aliasMap: AliasMap = {
      ...(leagueAliasMap && typeof leagueAliasMap === 'object' && !Array.isArray(leagueAliasMap)
        ? (leagueAliasMap as AliasMap)
        : {}),
      ...globalAliases,
    };

    let games: AppGame[] = [];
    try {
      const built = buildScheduleFromApi({ scheduleItems, teams, aliasMap, season: year });
      games = built.games;
    } catch {
      games = [];
    }

    let scoresByKey: Record<string, ScorePack> = {};
    if (games.length > 0) {
      try {
        const result = await fetchScoresByGame({
          games,
          aliasMap,
          season: year,
          teams,
          apiBaseUrl: origin,
        });
        scoresByKey = result.scoresByKey;
      } catch {
        scoresByKey = {};
      }
    }

    const standingsSnapshot = deriveStandings(games, currentRoster, scoresByKey);
    const standingsHistory = deriveStandingsHistory({
      games,
      rosterByTeam: currentRoster,
      scoresByKey,
    });
    const weeklyStandings = standingsHistory.weeks
      .map((w) => standingsHistory.byWeek[w])
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    const seasonContext = selectSeasonContext({ standingsHistory });

    const context = await buildInsightContext(
      slug,
      league,
      standingsSnapshot.rows,
      weeklyStandings,
      games,
      seasonContext,
      rankings,
      currentRoster
    );

    const insights = runInsightsEngine(context);

    return NextResponse.json<InsightsResponse>({
      insights,
      lifecycleState: context.lifecycleState,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return NextResponse.json<InsightsResponse>(emptyResponse('offseason', message));
  }
}
