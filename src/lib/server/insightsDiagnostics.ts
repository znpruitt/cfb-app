import {
  getRegisteredGenerators,
  selectServedInsights,
  shouldSuppressGenerator,
} from '../insights/engine.ts';
import {
  MAX_SERVED_INSIGHTS,
  OVERVIEW_INSIGHT_SLOTS,
  OVERVIEW_INSIGHT_SLOTS_WITH_RECAP,
} from '../insights/limits.ts';
import { buildLeagueInsightContext } from '../insights/loadInsights.ts';
import type { InsightContext, InsightGenerator, LifecycleState } from '../insights/types.ts';
import type { Insight } from '../selectors/insights.ts';

/**
 * INSIGHTS-019 — the Insights funnel, made visible.
 *
 * The feed narrows twice and neither number was observable anywhere: the
 * generators produce some set, the loader keeps the top `MAX_SERVED_INSIGHTS`,
 * and the Overview renders the top `OVERVIEW_INSIGHT_SLOTS` of those. "Why is my
 * feed thin?" could only be answered by reading code.
 *
 * That is also the question the next two slices turn on. INSIGHTS-023 adds
 * content and INSIGHTS-018 rotates through it, and both need to know whether the
 * pool is bigger than the feed yet — rotation does nothing until it is, which is
 * exactly why 018 was stopped once already.
 *
 * Derivation lives here rather than in the page, per AGENTS.md: the server builds
 * a view model and React maps it to markup. Same shape as `systemHealth.ts`.
 */

/**
 * What happened to one insight on its way to a screen.
 *
 * THREE surfaces, not two. The first version of this modelled the funnel as
 * generated → served → Overview and called the middle band "served, not shown",
 * which is false: `/league/[slug]/insights` renders EVERY served insight. Only
 * the Overview cuts at five. Collapsing that surface made the page contradict
 * itself — it printed "rotation has nothing to rotate" directly above rows it
 * had labelled as never reaching a screen.
 */
export type InsightFate =
  /** In the top slots the Overview renders. */
  | 'on-overview'
  /** Below the Overview's cut, but still shown on the All Insights page. */
  | 'all-insights-only'
  /** Below the loader's cut — never leaves the server. */
  | 'not-served';

export type DiagnosticInsight = {
  /** Rank in priority order across the whole generated set, 1-based. */
  rank: number;
  id: string;
  type: string;
  title: string;
  owner: string | null;
  priorityScore: number;
  generatorId: string;
  fate: InsightFate;
};

export type DiagnosticGenerator = {
  id: string;
  category: string;
  /** How many insights it produced for this league right now. */
  produced: number;
  /**
   * Why it produced nothing, when that is a rule rather than a lack of data.
   * `lifecycle` — it does not run in this lifecycle state at all.
   * `gated` — it runs, but a cross-cutting rule skipped it (e.g. a borrowed roster).
   * `error` — it THREW. Reported distinctly because a generator crashing on one
   *   league is a prime cause of a thin feed, and the first version of this
   *   reported it as `produced: 0` — indistinguishable from having nothing to
   *   say, on the page whose whole job is explaining a thin feed.
   * `null` — it ran and simply had nothing to say.
   */
  skippedBy: 'lifecycle' | 'gated' | 'error' | null;
};

export type InsightsDiagnostics = {
  slug: string;
  year: number;
  lifecycleState: LifecycleState;
  generatedAt: string;
  counts: {
    generated: number;
    /** Served by the loader — all of these appear on the All Insights page. */
    served: number;
    /** ENGINE insights in the Overview's slots. See `overviewFillerSlots`. */
    onOverview: number;
    servedCap: number;
    renderedCap: number;
    /**
     * Overview slots the engine could NOT fill, which `OverviewPanel` covers
     * with client-derived filler (`deriveOverviewInsights`).
     *
     * Reported because omitting it made this page under-state the very case it
     * exists for: with 2 engine insights it said "On the Overview: 2" while the
     * Overview rendered 5 cards. The filler is exactly what hides a thin feed
     * from the commissioner, so the page has to name it.
     *
     * Deliberately NOT recomputed here — the filler is derived client-side from
     * standings, and duplicating that derivation server-side would create a
     * second implementation to keep in agreement. The SHORTFALL is the honest,
     * verifiable fact.
     */
    overviewFillerSlots: number;
  };
  generators: DiagnosticGenerator[];
  insights: DiagnosticInsight[];
};

/**
 * The funnel itself, as a pure function: which insights survive each cut, and
 * what happened to the ones that did not.
 *
 * Extracted because the interesting branch cannot be reached through real data.
 * A league with 8 owners and 5 archived seasons generates 9 insights — under the
 * cap of 10 — so "cut before serving" never fires from a fixture. That fact IS
 * the page's headline finding (it is why rotation has nothing to rotate), but it
 * would leave the classification's third branch untested. Here it can be driven
 * directly.
 */
export function classifyInsightFunnel(
  generated: Insight[],
  renderedCap: number
): { served: Insight[]; fateOf: (id: string) => InsightFate } {
  const served = selectServedInsights(generated);
  const servedIds = new Set(served.map((i) => i.id));
  const renderedIds = new Set(served.slice(0, renderedCap).map((i) => i.id));

  return {
    served,
    fateOf: (id: string): InsightFate =>
      renderedIds.has(id) ? 'on-overview' : servedIds.has(id) ? 'all-insights-only' : 'not-served',
  };
}

/**
 * Run ONE generator the way the engine would, reporting why it produced nothing
 * when that is a rule rather than a lack of data.
 *
 * Extracted so the failure path is testable. A throwing generator was previously
 * reported as `produced: 0, skippedBy: null` — indistinguishable from "ran and
 * had nothing to say" — on the page whose entire job is explaining a thin feed.
 * Fixing that without a test would have left the fix unverified: a mutation
 * restoring the old behaviour passed everything.
 *
 * The gate ORDER matches `generateRawInsights` exactly (lifecycle, then the
 * cross-cutting gate, then positive scores), so this page cannot disagree with
 * production about which generators ran.
 */
export function runGeneratorForDiagnostics(
  g: InsightGenerator,
  context: InsightContext
): { produced: Insight[]; skippedBy: DiagnosticGenerator['skippedBy'] } {
  if (!g.supportedLifecycles.includes(context.lifecycleState)) {
    return { produced: [], skippedBy: 'lifecycle' };
  }
  if (shouldSuppressGenerator(g, context)) {
    return { produced: [], skippedBy: 'gated' };
  }
  try {
    return { produced: g.generate(context).filter((i) => i.priorityScore > 0), skippedBy: null };
  } catch {
    // Never take the page down, and never report it as an ordinary zero.
    return { produced: [], skippedBy: 'error' };
  }
}

export async function buildInsightsDiagnostics(
  slug: string,
  year: number
): Promise<InsightsDiagnostics> {
  const currentDate = new Date();
  const context = await buildLeagueInsightContext(slug, year, currentDate);

  // Run each generator INDIVIDUALLY rather than through `generateRawInsights`,
  // which flattens them — the attribution is the point of this page.
  const perGenerator = getRegisteredGenerators().map((g) => ({
    generator: g,
    ...runGeneratorForDiagnostics(g, context),
  }));

  const ownerOf = (i: Insight): string | null => i.owner ?? i.owners?.[0] ?? null;

  const generatorById = new Map<string, string>();
  for (const { generator, produced } of perGenerator) {
    for (const insight of produced) generatorById.set(insight.id, generator.id);
  }

  const allGenerated = perGenerator.flatMap((p) => p.produced);

  const renderedCap =
    context.lifecycleState === 'fresh_offseason'
      ? OVERVIEW_INSIGHT_SLOTS_WITH_RECAP
      : OVERVIEW_INSIGHT_SLOTS;

  // The served set comes from the SAME function the loader uses, so this page
  // cannot disagree with production about which insights survive the cut.
  const { served, fateOf } = classifyInsightFunnel(allGenerated, renderedCap);

  const ranked = [...allGenerated].sort((a, b) => b.priorityScore - a.priorityScore);

  const insights: DiagnosticInsight[] = ranked.map((insight, index) => ({
    rank: index + 1,
    id: insight.id,
    type: insight.type,
    title: insight.title,
    owner: ownerOf(insight),
    priorityScore: insight.priorityScore,
    generatorId: generatorById.get(insight.id) ?? 'unknown',
    fate: fateOf(insight.id),
  }));

  return {
    slug,
    year,
    lifecycleState: context.lifecycleState,
    generatedAt: currentDate.toISOString(),
    counts: {
      generated: allGenerated.length,
      served: served.length,
      onOverview: Math.min(served.length, renderedCap),
      servedCap: MAX_SERVED_INSIGHTS,
      renderedCap,
      overviewFillerSlots: Math.max(0, renderedCap - served.length),
    },
    generators: perGenerator
      .map(({ generator, produced, skippedBy }) => ({
        id: generator.id,
        category: generator.category,
        produced: produced.length,
        skippedBy,
      }))
      // Most productive first — the ones carrying the feed are what you look at.
      .sort((a, b) => b.produced - a.produced || a.id.localeCompare(b.id)),
    insights,
  };
}
