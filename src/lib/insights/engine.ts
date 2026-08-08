import type { Insight } from '../selectors/insights';
import {
  isSuppressed,
  loadSuppressionRecords,
  saveSuppressionRecord,
  toSuppressionRecord,
} from './suppression';
import type { InsightContext, InsightGenerator } from './types';

const MAX_INSIGHTS = 10;

const generators: InsightGenerator[] = [];

export function registerGenerator(g: InsightGenerator): void {
  generators.push(g);
}

export function clearGenerators(): void {
  generators.length = 0;
}

export function getRegisteredGenerators(): readonly InsightGenerator[] {
  return generators;
}

/*
 * INSIGHTS-022 — the cross-cutting `shouldSuppressGenerator` filter was REMOVED.
 *
 * It carried exactly one rule: skip `career:rookie_benchmark` whenever the
 * roster was borrowed from an archive, on the grounds that borrowed "current"
 * owners are really returning members and rookie detection would mislabel them.
 * That case cannot occur. `isRookie` is `firstSeason === context.currentYear`,
 * and `currentYear` is `league.year`, which stays on the COMPLETED season
 * through offseason — the same season the borrowed roster comes from. So the
 * roster and the rookie test are keyed to the same year and agree, and the card
 * says which year out loud ("finished 4th as a rookie in 2025"). Once the league
 * advances to the next year, no prior-season debutant satisfies `isRookie` at
 * all, so the generator produces nothing on its own.
 *
 * Removing the rule left the filter with no rules, and an always-false gate is
 * untestable machinery rather than a policy, so it went with it. Generator-level
 * skips that depend on context belong inside the generator, where the data is in
 * scope; `supportedLifecycles` remains the static declaration of when a
 * generator runs. `bypassSuppression` on `runInsightsEngine` is unaffected — it
 * still governs the durable suppression records, which is its substantive job.
 */

export type RunInsightsEngineOptions = {
  bypassSuppression?: boolean;
};

/**
 * Pure, deterministic generation half of the engine: run every lifecycle-
 * matching generator and keep the positively-scored insights. NO suppression, NO sort/slice, NO I/O — the result is a function of
 * `context` alone, which is what makes it safe to cache upstream
 * (`loadInsightsForLeague` caches this output; suppression is applied per
 * request against the cached set).
 */
export function generateRawInsights(context: InsightContext): Insight[] {
  return generators
    .filter((g) => g.supportedLifecycles.includes(context.lifecycleState))
    .flatMap((g) => {
      try {
        return g.generate(context);
      } catch {
        return [];
      }
    })
    .filter((i) => i.priorityScore > 0);
}

/**
 * Stateful suppression half of the engine: load prior fire records, drop
 * suppressed insights, sort, take top N, and record the survivors. This reads
 * AND writes the suppression store, and its output depends on how many times it
 * has run — so it MUST run per request and must never be cached. Keeping it out
 * of the cache preserves the "fire once, then fade" behavior even when the
 * expensive `generateRawInsights` output is served from cache.
 *
 * `season` matches the engine's historical use of `context.currentYear`
 * (== `league.year`), so suppression scoping is unchanged.
 */
export async function applySuppression(
  rawInsights: Insight[],
  leagueSlug: string,
  season: number
): Promise<Insight[]> {
  const records = await loadSuppressionRecords(leagueSlug, season).catch(
    () => new Map<string, ReturnType<typeof toSuppressionRecord>>()
  );

  const surviving = rawInsights.filter((insight) => !isSuppressed(insight, records));
  const top = surviving.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, MAX_INSIGHTS);

  await Promise.all(
    top.map((insight) =>
      saveSuppressionRecord(toSuppressionRecord(insight), leagueSlug, season).catch(() => undefined)
    )
  );

  return top;
}

export async function runInsightsEngine(
  context: InsightContext,
  options: RunInsightsEngineOptions = {}
): Promise<Insight[]> {
  const { bypassSuppression = false } = options;
  const raw = generateRawInsights(context);

  // bypassSuppression (admin/diagnostic): return the raw set sorted/sliced, with
  // no suppression filter and no records written.
  if (bypassSuppression) {
    return raw.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, MAX_INSIGHTS);
  }

  return applySuppression(raw, context.leagueSlug, context.currentYear);
}
