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
import type { LifecycleState } from '../insights/types.ts';
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

/** What happened to one insight on its way to the screen. */
export type InsightFate =
  /** In the top slots the Overview actually renders. */
  | 'rendered'
  /** Served by the loader, but below the Overview's cut. */
  | 'served-not-rendered'
  /** Generated, but below the loader's cut — never leaves the server. */
  | 'generated-not-served';

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
   * `null` — it ran and simply had nothing to say.
   */
  skippedBy: 'lifecycle' | 'gated' | null;
};

export type InsightsDiagnostics = {
  slug: string;
  year: number;
  lifecycleState: LifecycleState;
  generatedAt: string;
  counts: {
    generated: number;
    served: number;
    rendered: number;
    servedCap: number;
    renderedCap: number;
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
      renderedIds.has(id)
        ? 'rendered'
        : servedIds.has(id)
          ? 'served-not-rendered'
          : 'generated-not-served',
  };
}

export async function buildInsightsDiagnostics(
  slug: string,
  year: number
): Promise<InsightsDiagnostics> {
  const currentDate = new Date();
  const context = await buildLeagueInsightContext(slug, year, currentDate);

  // Run each generator INDIVIDUALLY rather than through `generateRawInsights`,
  // which flattens them — the attribution is the point of this page.
  const perGenerator = getRegisteredGenerators().map((g) => {
    const runsHere = g.supportedLifecycles.includes(context.lifecycleState);
    if (!runsHere) {
      return { generator: g, produced: [] as Insight[], skippedBy: 'lifecycle' as const };
    }
    if (shouldSuppressGenerator(g, context)) {
      return { generator: g, produced: [] as Insight[], skippedBy: 'gated' as const };
    }
    // A generator that throws must not take the whole page down — the page's job
    // is to explain the feed, and a generator failing IS something to see.
    let produced: Insight[] = [];
    try {
      produced = g.generate(context).filter((i) => i.priorityScore > 0);
    } catch {
      produced = [];
    }
    return { generator: g, produced, skippedBy: null };
  });

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
      rendered: Math.min(served.length, renderedCap),
      servedCap: MAX_SERVED_INSIGHTS,
      renderedCap,
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
