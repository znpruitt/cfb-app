import { headers } from 'next/headers';

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

export type InsightsResponse = {
  insights: Insight[];
  lifecycleState: LifecycleState;
  generatedAt: string;
  error?: string;
};

export type LoadInsightsOptions = {
  bypassSuppression?: boolean;
};

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

async function deriveOrigin(): Promise<string | null> {
  try {
    const hdrs = await headers();
    const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host');
    if (!host) return null;
    const protocol =
      hdrs.get('x-forwarded-proto') ?? (process.env.NODE_ENV === 'development' ? 'http' : 'https');
    return `${protocol}://${host}`;
  } catch {
    return null;
  }
}

/**
 * Load insights for a league directly from server-side context. Does NOT
 * perform authorization — callers must gate via `isAuthorizedForLeague` (API
 * route) or `renderLeagueGateIfBlocked` (RSC page) before invoking.
 */
export async function loadInsightsForLeague(
  slug: string,
  year?: number,
  options: LoadInsightsOptions = {}
): Promise<InsightsResponse> {
  const league = await getLeague(slug);
  if (!league) {
    return emptyResponse('offseason', `League '${slug}' not found`);
  }

  const resolvedYear =
    typeof year === 'number' && Number.isFinite(year) && year >= 2000 ? year : league.year;

  const origin = await deriveOrigin();

  try {
    const [csvText, scheduleRes, teamsRes, globalAliases, leagueAliasRecord, rankings] =
      await Promise.all([
        loadOwnersCsv(slug, resolvedYear),
        origin
          ? fetchJson<{ items?: ScheduleWireItem[] }>(`${origin}/api/schedule?year=${resolvedYear}`)
          : Promise.resolve(null),
        origin
          ? fetchJson<{ items?: Array<Record<string, unknown>> }>(`${origin}/api/teams`)
          : Promise.resolve(null),
        getGlobalAliases().catch(() => ({}) as AliasMap),
        getAppState<AliasMap>(`aliases:${slug}:${resolvedYear}`, 'map').catch(() => null),
        loadSeasonRankings(resolvedYear).catch(() => null),
      ]);

    const roster = parseOwnersCsv(csvText ?? '');
    const currentRoster = new Map(roster.map((r) => [r.team, r.owner]));
    const scheduleItems = scheduleRes?.items ?? [];
    const teams = (teamsRes?.items ?? []) as never[];
    const leagueAliasMap = leagueAliasRecord?.value;
    const aliasMap: AliasMap = {
      ...(leagueAliasMap && typeof leagueAliasMap === 'object' && !Array.isArray(leagueAliasMap)
        ? (leagueAliasMap as AliasMap)
        : {}),
      ...globalAliases,
    };

    let games: AppGame[] = [];
    try {
      const built = buildScheduleFromApi({ scheduleItems, teams, aliasMap, season: resolvedYear });
      games = built.games;
    } catch {
      games = [];
    }

    let scoresByKey: Record<string, ScorePack> = {};
    if (games.length > 0 && origin) {
      try {
        const result = await fetchScoresByGame({
          games,
          aliasMap,
          season: resolvedYear,
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

    const insights = await runInsightsEngine(context, {
      bypassSuppression: options.bypassSuppression === true,
    });

    return {
      insights,
      lifecycleState: context.lifecycleState,
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return emptyResponse('offseason', message);
  }
}
