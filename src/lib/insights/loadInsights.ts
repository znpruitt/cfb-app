import { unstable_cache } from 'next/cache';
import { cache } from 'react';

import { buildInsightContext } from '@/lib/insights/context';
import { applySuppression, generateRawInsights, runInsightsEngine } from '@/lib/insights/engine';
import '@/lib/insights/generators';
import { getLeague } from '@/lib/leagueRegistry';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import { loadSeasonRankings } from '@/lib/server/rankings';
import { getAppState } from '@/lib/server/appStateStore';
import { getScopedAliasMap, SEED_ALIASES_HASH } from '@/lib/server/globalAliasStore';
import { getTeamDatabaseItems } from '@/lib/server/teamDatabaseStore';
import {
  loadCachedScheduleItems,
  loadPostseasonOverrides,
} from '@/lib/server/canonicalScheduleCache';
import { buildScheduleFromApi, type AppGame } from '@/lib/schedule';
import type { AliasMap } from '@/lib/teamNames';
import {
  ALL_STANDINGS_TAG,
  getCanonicalStandings,
  standingsSlugTag,
  standingsYearTag,
} from '@/lib/selectors/leagueStandings';
import { selectSeasonContext } from '@/lib/selectors/seasonContext';
import type { Insight } from '@/lib/selectors/insights';
import type { InsightContext } from '@/lib/insights/types';
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

/**
 * Cross-request TTL (seconds) for the cached raw-insights compute. The PRIMARY
 * freshness mechanism is tag invalidation: the cached entry carries the canonical
 * standings tags (see `insightsCacheTags`), so every `invalidateStandings` /
 * `invalidateAllLeaguesStandings` call — fired by roster, alias, postseason,
 * draft, schedule, scores, backfill, rollover, preseason, and team-database
 * mutations — refreshes Insights immediately, exactly as it refreshes standings.
 *
 * This TTL is only a backstop for inputs that do NOT flow through standings
 * invalidation and are cross-league / infrequent: season rankings
 * (`loadSeasonRankings`, lazily cached during read — cannot safely
 * `revalidateTag`) and weekly game stats, plus pure wall-clock drift in
 * lifecycle/recency classification (the pinned `currentDate` of the warming
 * request). 5 minutes bounds that staleness while still collapsing the
 * per-page-visit recompute that this prompt targets.
 */
const INSIGHTS_CACHE_TTL_SECONDS = 300;

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
 * Cache-key parts for the raw-insights compute. Scoped by slug + resolved year
 * so distinct leagues/years never share an entry, plus the seed-alias hash (as
 * canonical standings does) so a change to the code-defined static aliases —
 * which feeds team-identity resolution inside the context build — busts the
 * cache even though it fires no runtime invalidation.
 */
export function insightsCacheKeyParts(slug: string, resolvedYear: number): string[] {
  return ['insights', slug, String(resolvedYear), `seeds:${SEED_ALIASES_HASH}`];
}

/**
 * Tags carried by the cached raw-insights entry. Deliberately the canonical
 * standings tags: Insights output is a strict function of canonical standings
 * plus the same upstream inputs, so it must refresh whenever standings do.
 * Piggybacking the standings tags achieves that with zero duplicate wiring —
 * every existing `invalidateStandings(slug, year)` and
 * `invalidateAllLeaguesStandings()` call busts the matching Insights entry too.
 */
export function insightsCacheTags(slug: string, resolvedYear: number): string[] {
  return [ALL_STANDINGS_TAG, standingsSlugTag(slug), standingsYearTag(slug, resolvedYear)];
}

type RawInsightsPayload = {
  rawInsights: Insight[];
  lifecycleState: LifecycleState;
  generatedAt: string;
};

/**
 * Load every Insights input in-process (no HTTP self-fetch; schedule read is
 * cache-only so no upstream provider fetch — PLATFORM-075/077) and build the
 * canonical `InsightContext`. Critical store reads (owners CSV, canonical
 * standings, season archives) are intentionally NOT wrapped in swallow-catches:
 * a genuine store/database failure throws out of this function so it escapes the
 * cached callback and is never persisted as a bogus empty result (PLATFORM-082A
 * lesson). Only genuinely-optional inputs degrade to defaults.
 */
async function buildLeagueInsightContext(
  slug: string,
  resolvedYear: number,
  currentDate: Date
): Promise<InsightContext> {
  const league = await getLeague(slug);
  if (!league) {
    // Caller pre-checks existence; this guards a background revalidate of a
    // league deleted after the entry was warmed — surface it, do not cache empty.
    throw new Error(`League '${slug}' not found`);
  }

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
  const aliasMap: AliasMap = scopedAliasMap;

  // Build canonical games with the SAME inputs the standings selector's
  // liveDeriveStandings uses so Insights sees the identical canonical game model.
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

  // Standings rows/history come from the canonical selector — the single source
  // of truth — rather than an Insights-local re-derivation. A store failure here
  // throws (does not fall back), so it escapes the cache rather than caching empty.
  const canonical = await getCanonicalStandings({ slug, year: resolvedYear, currentDate });
  const standingsHistory = canonical.standingsHistory;
  const weeklyStandings = standingsHistory
    ? standingsHistory.weeks
        .map((w) => standingsHistory.byWeek[w])
        .filter((s): s is NonNullable<typeof s> => Boolean(s))
    : [];
  const seasonContext = selectSeasonContext({ standingsHistory });

  return buildInsightContext(
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
}

/**
 * The expensive, cacheable half of `loadInsightsForLeague`: build context and
 * run the generators to the raw (pre-suppression) insight set. Suppression is
 * NOT applied here — it is stateful and runs per request in
 * `loadInsightsForLeague` so the fire-once-then-fade behavior is preserved.
 */
async function computeRawInsights(
  slug: string,
  resolvedYear: number,
  currentDate: Date
): Promise<RawInsightsPayload> {
  const context = await buildLeagueInsightContext(slug, resolvedYear, currentDate);
  return {
    rawInsights: generateRawInsights(context, { bypassSuppression: false }),
    lifecycleState: context.lifecycleState,
    generatedAt: currentDate.toISOString(),
  };
}

const dataCachedRawInsights = (slug: string, resolvedYear: number, currentDate: Date) =>
  unstable_cache(
    () => computeRawInsights(slug, resolvedYear, currentDate),
    insightsCacheKeyParts(slug, resolvedYear),
    {
      tags: insightsCacheTags(slug, resolvedYear),
      revalidate: INSIGHTS_CACHE_TTL_SECONDS,
    }
  )();

/**
 * `React.cache` (per-request dedup) over `unstable_cache` (cross-request).
 * Outside Next's RSC runtime (`node:test`) `unstable_cache` throws
 * `incrementalCache missing`; fall back to a direct compute so the loader stays
 * testable. A genuine store failure inside the compute propagates (never cached).
 */
const cachedRawInsights = cache(
  async (slug: string, resolvedYear: number, currentDate: Date): Promise<RawInsightsPayload> => {
    try {
      return await dataCachedRawInsights(slug, resolvedYear, currentDate);
    } catch (err) {
      if (err instanceof Error && err.message.includes('incrementalCache missing')) {
        return computeRawInsights(slug, resolvedYear, currentDate);
      }
      throw err;
    }
  }
);

/**
 * Load insights for a league directly from server-side context. Does NOT
 * perform authorization — callers must gate via `isAuthorizedForLeague` (API
 * route) or `renderLeagueGateIfBlocked` (RSC page) before invoking.
 *
 * The expensive context build + generation is cached cross-request; suppression
 * is applied per request against the cached raw set. `bypassSuppression` (admin/
 * diagnostic) runs a different generator set and writes no records, so it is not
 * cached.
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

  // Admin/diagnostic bypass: different generator set, no suppression writes, and
  // rare — compute directly rather than maintaining a second cache key.
  if (options.bypassSuppression === true) {
    try {
      const context = await buildLeagueInsightContext(slug, resolvedYear, currentDate);
      const insights = await runInsightsEngine(context, { bypassSuppression: true });
      return {
        insights,
        lifecycleState: context.lifecycleState,
        generatedAt: currentDate.toISOString(),
      };
    } catch (err) {
      return emptyResponse('offseason', err instanceof Error ? err.message : 'unknown error');
    }
  }

  try {
    const { rawInsights, lifecycleState, generatedAt } = await cachedRawInsights(
      slug,
      resolvedYear,
      currentDate
    );
    // Per-request suppression against the cached raw set. Season matches the
    // engine's historical scoping (league.year, via context.currentYear), so
    // fire/fade behavior is byte-for-byte unchanged by the cache split.
    const insights = await applySuppression(rawInsights, slug, league.year);
    return { insights, lifecycleState, generatedAt };
  } catch (err) {
    // A genuine store/database failure escaped the cached callback (nothing was
    // cached). Degrade gracefully for callers; this empty response is NOT cached.
    return emptyResponse('offseason', err instanceof Error ? err.message : 'unknown error');
  }
}
