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
import { applyInsightDecay } from '../insights/variants.ts';
import type { MembershipCompleteness } from '../insights/membershipCompleteness.ts';
import type {
  InsightContext,
  InsightGenerator,
  LeagueMembersSource,
  LifecycleState,
} from '../insights/types.ts';
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
 * a view model and React maps it to markup — the `systemHealth.ts` shape.
 *
 * It does NOT inherit systemHealth's "never leak a raw error" contract wholesale,
 * and saying it did was wrong: this page's entire job is diagnosis, so the
 * failure message is the payload. It is redacted instead — see
 * `redactConnectionDetails` — so a `DATABASE_URL` misconfiguration cannot render
 * a host or credentials into the page body.
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
  /**
   * Set when the context could not be built at all — a store failure on owners,
   * standings or archives.
   *
   * `buildLeagueInsightContext` deliberately does NOT swallow those (PLATFORM-082A:
   * failures are never cached), and production's `loadInsightsForLeague` catches
   * them and degrades to an empty feed. This page caught nothing, so the exact
   * scenario it exists for — feed empty, commissioner opens the diagnostic to
   * find out why — hit a generic error boundary instead of the diagnosis. The
   * failure with the most diagnostic value was the one it could not report.
   */
  contextError: string | null;
  counts: {
    generated: number;
    /** Served by the loader — all of these appear on the All Insights page. */
    served: number;
    /** ENGINE insights in the Overview's slots. See `overviewFillerSlots`. */
    onOverview: number;
    servedCap: number;
    renderedCap: number;
    /**
     * Overview slots the engine did not fill. A SHORTFALL, nothing more.
     *
     * Named carefully, because the first version called these "filler slots" and
     * the page then asserted they WERE covered by fallback cards. That claim is
     * false in the state this page exists for: `deriveLeagueInsights` returns
     * nothing when no owner has played — the whole of preseason — so there is
     * zero fallback then, and even in-season `deriveOverviewInsights` caps at 3,
     * so it can never cover five slots. A preseason league with 2 engine
     * insights would have been told 3 slots were covered while the Overview
     * rendered exactly 2.
     *
     * The derivation was always honest; the COPY went beyond it, and the copy
     * had no test. Deliberately still not recomputed: reproducing a client-side
     * derivation on the server would create a second implementation to keep in
     * step, which is a new divergence rather than a fix. The page now states the
     * shortfall and says fallback MAY substitute, without quantifying it.
     */
    overviewSlotsUnfilledByEngine: number;
  };
  /**
   * WHO the engine thinks is in the league, and where that came from.
   *
   * Added because the page could not answer the question it most needed to. When
   * TSC's membership changed for 2026 — two owners left, one joined, one
   * returned — the feed stayed at the same five insights with the same five
   * names, because these generators emit SUPERLATIVES (most volatile, title
   * chaser) rather than one insight per owner. An unchanged feed is therefore
   * the same observation whether the confirmed list reached the engine or the
   * fix silently failed and it fell back to last season's roster.
   *
   * Showing the list and its source settles it by looking instead of inferring.
   */
  membership: {
    owners: string[];
    source: LeagueMembersSource;
    complete: boolean;
    completenessEvidence: MembershipCompleteness['evidence'];
    unlistedRosterOwners: string[];
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
  renderedCap: number,
  lifecycleState: string
): { served: Insight[]; fateOf: (id: string) => InsightFate } {
  // DECAY FIRST, exactly as `loadInsightsForLeague` does. Without it this page
  // reported a draft insight's score as 74 while production ranked it at 26, and
  // — because the sort order differed — could show "On the Overview" for a card
  // production had cut. The docblock above promises this page cannot disagree
  // with production about the funnel; INSIGHTS-031 broke that promise the moment
  // it added a serving-layer pass and wired only one caller.
  const served = selectServedInsights(applyInsightDecay(generated, lifecycleState));
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
/**
 * Strip anything credential-shaped out of an error message before it reaches the
 * page.
 *
 * The message itself is the diagnostic payload — removing it would gut the
 * failure view — but a `pg` connection error carries the host, and sometimes the
 * user, in its text. Admin-gated, so the exposure is bounded; redacting is still
 * cheap and removes the obvious case.
 */
export function redactConnectionDetails(message: string): string {
  return (
    message
      // postgres://user:pass@host:5432/db  → scheme + [redacted]
      .replace(/\b([a-z+]+):\/\/[^\s]*/gi, '$1://[redacted]')
      // bare user:pass@host forms
      .replace(/\b[\w.-]+:[^\s@]+@[\w.-]+/g, '[redacted]')
  );
}

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

  let context;
  try {
    context = await buildLeagueInsightContext(slug, year, currentDate);
  } catch (err) {
    // Report the failure rather than becoming one.
    return {
      slug,
      year,
      lifecycleState: 'offseason',
      generatedAt: currentDate.toISOString(),
      contextError: redactConnectionDetails(err instanceof Error ? err.message : 'unknown error'),
      counts: {
        generated: 0,
        served: 0,
        onOverview: 0,
        servedCap: MAX_SERVED_INSIGHTS,
        renderedCap: OVERVIEW_INSIGHT_SLOTS,
        overviewSlotsUnfilledByEngine: OVERVIEW_INSIGHT_SLOTS,
      },
      membership: {
        owners: [],
        source: 'none',
        complete: false,
        completenessEvidence: 'none',
        unlistedRosterOwners: [],
      },
      generators: [],
      insights: [],
    };
  }

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
  const { served, fateOf } = classifyInsightFunnel(
    allGenerated,
    renderedCap,
    context.lifecycleState
  );

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
    contextError: null,
    counts: {
      generated: allGenerated.length,
      served: served.length,
      onOverview: Math.min(served.length, renderedCap),
      servedCap: MAX_SERVED_INSIGHTS,
      renderedCap,
      overviewSlotsUnfilledByEngine: Math.max(0, renderedCap - served.length),
    },
    membership: {
      owners: [...context.leagueMembers].sort(),
      source: context.leagueMembersSource,
      // `source` says where the list came from; these say whether it is FINISHED,
      // which is what any claim about who is absent depends on. Reported because
      // the completeness gate's silence is otherwise indistinguishable from a
      // generator that simply found nothing to say.
      complete: context.membershipCompleteness.complete,
      completenessEvidence: context.membershipCompleteness.evidence,
      unlistedRosterOwners: context.membershipCompleteness.unlistedRosterOwners,
    },
    generators: perGenerator
      .map(({ generator, produced, skippedBy }) => ({
        id: generator.id,
        category: generator.category,
        produced: produced.length,
        skippedBy,
      }))
      // Crashes FIRST, then most productive. A generator that threw has
      // `produced: 0`, so productivity-only ordering sank the one signal the
      // type comment calls "a prime cause of a thin feed" beneath a dozen quiet
      // lifecycle-skipped rows.
      .sort(
        (a, b) =>
          Number(b.skippedBy === 'error') - Number(a.skippedBy === 'error') ||
          b.produced - a.produced ||
          a.id.localeCompare(b.id)
      ),
    insights,
  };
}
