import { buildInsightContext } from '@/lib/insights/context';
import { runInsightsEngine } from '@/lib/insights/engine';
import '@/lib/insights/generators';
import { getLeague } from '@/lib/leagueRegistry';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import { loadSeasonRankings } from '@/lib/server/rankings';
import { getAppState } from '@/lib/server/appStateStore';
import { getScopedAliasMap } from '@/lib/server/globalAliasStore';
import { getTeamDatabaseItems } from '@/lib/server/teamDatabaseStore';
import {
  loadCachedScheduleItems,
  loadPostseasonOverrides,
} from '@/lib/server/canonicalScheduleCache';
import { buildScheduleFromApi, type AppGame } from '@/lib/schedule';
import type { AliasMap } from '@/lib/teamNames';
import { getCanonicalStandings } from '@/lib/selectors/leagueStandings';
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
  const currentDate = new Date();
  const league = await getLeague(slug);
  if (!league) {
    return emptyResponse('offseason', `League '${slug}' not found`);
  }

  const resolvedYear =
    typeof year === 'number' && Number.isFinite(year) && year >= 2000 ? year : league.year;

  try {
    // Everything is read in-process from the same canonical sources production
    // uses — no HTTP self-fetch of /api/schedule or /api/teams (PLATFORM-077).
    // The schedule read is cache-only, so Insights never triggers an upstream
    // provider fetch (PLATFORM-075).
    const [csvText, scheduleItems, teams, scopedAliasMap, manualOverrides, rankings] =
      await Promise.all([
        loadOwnersCsv(slug, resolvedYear),
        loadCachedScheduleItems(resolvedYear).catch(() => []),
        getTeamDatabaseItems().catch(() => [] as Awaited<ReturnType<typeof getTeamDatabaseItems>>),
        getScopedAliasMap(slug, resolvedYear).catch(() => ({}) as AliasMap),
        loadPostseasonOverrides(slug, resolvedYear).catch(() => ({})),
        loadSeasonRankings(resolvedYear).catch(() => null),
      ]);

    const roster = parseOwnersCsv(csvText ?? '');
    const currentRoster = new Map(roster.map((r) => [r.team, r.owner]));
    // Effective precedence (stored global > year > seed defaults). Using
    // getScopedAliasMap instead of spreading
    // getGlobalAliases() after the scoped map keeps seed defaults from
    // overriding a scoped repair.
    const aliasMap: AliasMap = scopedAliasMap;

    // Build canonical games with the SAME inputs the standings selector's
    // liveDeriveStandings uses (schedule items + team catalog + effective
    // aliases + postseason overrides), so Insights sees the identical canonical
    // game model — no Insights-private schedule/game reconstruction.
    let games: AppGame[] = [];
    try {
      const built = buildScheduleFromApi({
        scheduleItems,
        teams,
        aliasMap,
        season: resolvedYear,
        manualOverrides,
      });
      games = built.games;
    } catch {
      games = [];
    }

    // Standings rows/history come from the canonical selector — the single
    // source of truth — rather than an Insights-local re-derivation. Canonical
    // is authoritative even when empty/null; we never fall back to locally
    // derived standings. (This also drops the redundant score fetch that only
    // fed the old local derivation; `games` is still loaded for non-standings
    // generator inputs.)
    const canonical = await getCanonicalStandings({ slug, year: resolvedYear, currentDate });
    const standingsHistory = canonical.standingsHistory;
    const weeklyStandings = standingsHistory
      ? standingsHistory.weeks
          .map((w) => standingsHistory.byWeek[w])
          .filter((s): s is NonNullable<typeof s> => Boolean(s))
      : [];
    const seasonContext = selectSeasonContext({ standingsHistory });

    const context = await buildInsightContext(
      slug,
      league,
      canonical.rows,
      weeklyStandings,
      games,
      seasonContext,
      rankings,
      currentRoster,
      currentDate
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
