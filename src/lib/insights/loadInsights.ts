import { unstable_cache } from 'next/cache';
import { cache } from 'react';

import { buildInsightContext } from '@/lib/insights/context';
import {
  generateRawInsights,
  runInsightsEngine,
  selectServedInsights,
} from '@/lib/insights/engine';
import '@/lib/insights/generators';
import { getLeague } from '@/lib/leagueRegistry';
import { readConfirmedRosterInputs } from '@/lib/server/confirmedRosterStore';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import { loadSeasonRankings } from '@/lib/server/rankings';
import { getScopedAliasMap, SEED_ALIASES_HASH } from '@/lib/server/globalAliasStore';
import { ALIAS_OVERRIDES_HASH } from '@/lib/teamDatabase';
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
/**
 * Analytics-projection policy version (PLATFORM-086H3E3). Owner game-stat
 * values inside cached insights now come from the final-and-complete,
 * participant-verified canonical projection over paired provenance instead of
 * raw partition aggregation — a POLICY change with no runtime invalidation
 * signal, so it must be part of the cache identity: warm `revalidate`-bounded
 * entries computed under the old policy die with the deploy, not a TTL.
 */
const ANALYTICS_PROJECTION_VERSION = 'h3e3-final-complete-v1';

/**
 * Insight-copy policy version.
 *
 * Bumped whenever generator COPY changes without any underlying data changing.
 * Nothing else in the cache key moves for a wording change — no standings tag
 * fires, no input differs — so a warm entry keeps serving the old sentences
 * until the 300s TTL lapses, and deployment fires neither.
 *
 * History (the value names the most recent change):
 *  - INSIGHTS-022 removed the returning-owner prefix and narrowed the rookie
 *    lifecycle.
 *  - INSIGHTS-030 rewrote every league-record claim at four sites and added the
 *    unknown-membership register.
 *
 * The docblock is versioned with the constant deliberately: it opened
 * "INSIGHTS-022" while the value already read `insights030`, which is the same
 * class of drift the constant exists to prevent.
 */
const INSIGHT_COPY_POLICY_VERSION = 'insights030-league-record-population-v1';

/**
 * Membership policy version (INSIGHTS-023a). Same shape and same reason as the
 * two above: generator output changed with no runtime invalidation signal.
 *
 * Membership now comes from the league's roster/confirmed list rather than being
 * reconstructed from the team→owner map, so a warm entry computed under the old
 * rule keeps serving cards naming DEPARTED owners — the exact thing the slice
 * fixes — until the 300s TTL lapses or a standings tag fires. Deployment fires
 * neither. This file's other two constants exist for precisely this class of
 * change and say so; this one qualifies.
 */
const INSIGHT_MEMBERSHIP_POLICY_VERSION = 'insights023a-league-membership-v1';

export function insightsCacheKeyParts(slug: string, resolvedYear: number): string[] {
  // `alias-overrides:` mirrors canonical standings: the curated catalog-alias
  // policy is applied at read time and feeds identity resolution here, so it is
  // part of the cache identity (see canonicalStandingsCacheKeyParts).
  return [
    'insights',
    slug,
    String(resolvedYear),
    `seeds:${SEED_ALIASES_HASH}`,
    `alias-overrides:${ALIAS_OVERRIDES_HASH}`,
    `analytics:${ANALYTICS_PROJECTION_VERSION}`,
    `copy:${INSIGHT_COPY_POLICY_VERSION}`,
    `membership:${INSIGHT_MEMBERSHIP_POLICY_VERSION}`,
  ];
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
/**
 * INSIGHTS-019 — exported for the admin diagnostic page, which needs the CONTEXT
 * (not just the served feed) to report what each generator produced.
 *
 * Deliberately uncached, like the rest of this function: the page exists to show
 * live truth, and an admin opening it occasionally is not the hot path. Do not
 * reach for this from a public surface — that is precisely what PLATFORM-101 is
 * about.
 */
export async function buildLeagueInsightContext(
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

  const [scheduleItems, teams, scopedAliasMap, manualOverrides, rankings, confirmedRoster] =
    await Promise.all([
      loadCachedScheduleItems(resolvedYear).catch(() => []),
      getTeamDatabaseItems().catch(() => [] as Awaited<ReturnType<typeof getTeamDatabaseItems>>),
      getScopedAliasMap(slug, resolvedYear).catch(() => ({}) as AliasMap),
      loadPostseasonOverrides(slug, resolvedYear).catch(() => ({})),
      loadSeasonRankings(resolvedYear).catch(() => null),
      // A store failure here must NOT degrade membership to "nobody" — that
      // would silently empty every member-filtered insight and look identical
      // to a league with no confirmed owners. Let it propagate, like the other
      // authoritative reads (PLATFORM-084A: failures are never cached).
      // ONE read of `owners:{slug}:{year}`, serving BOTH the confirmed roster and
      // the team→owner map below. They were separate concurrent reads of the same
      // row, so a roster write landing between them gave the two different
      // generations of one CSV.
      readConfirmedRosterInputs(slug, resolvedYear),
    ]);

  const roster = parseOwnersCsv(confirmedRoster.ownersCsv ?? '');
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
    currentDate,
    // INSIGHTS-023a — the league's MEMBERSHIP, which is a different question
    // from who owns which team. Read here rather than in `context.ts` so that
    // module keeps doing no store access of its own.
    confirmedRoster.roster.owners,
    confirmedRoster.roster.source
  );
}

/**
 * The expensive, cacheable half of `loadInsightsForLeague`: build context and
 * run the generators to the raw insight set. Selection (sort + cap) is NOT
 * applied here; `loadInsightsForLeague` does that per request via
 * `selectServedInsights`, which is pure, so the cached raw set stays reusable.
 *
 * INSIGHTS-029 retired per-request suppression from this path entirely — see
 * the seam in `loadInsightsForLeague`.
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
 * The expensive context build + generation is cached cross-request; selection
 * (sort by priority, cap at MAX_INSIGHTS) runs per request against the cached
 * raw set. Since INSIGHTS-029 the served path applies NO suppression, so a
 * league sees the same feed on every load. `bypassSuppression` (admin/
 * diagnostic) still runs a different GENERATOR set — the generator-level gate,
 * not the retired per-insight one — and is not cached.
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
    // INSIGHTS-029 — no suppression. Out of season nothing moves, so "fire once,
    // then fade" degenerated into "show each insight once, ever" and drained a
    // live league's feed to the three types on the never-suppress list.
    //
    // Pure, so unlike `applySuppression` it needs no per-request escape from the
    // cache: the output is a function of the raw set alone.
    const insights = selectServedInsights(rawInsights);
    return { insights, lifecycleState, generatedAt };
  } catch (err) {
    // A genuine store/database failure escaped the cached callback (nothing was
    // cached). Degrade gracefully for callers; this empty response is NOT cached.
    return emptyResponse('offseason', err instanceof Error ? err.message : 'unknown error');
  }
}
