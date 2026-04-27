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

/**
 * Cross-cutting suppression rules layered on top of `supportedLifecycles`.
 *
 * `supportedLifecycles` is the static, generator-declared filter ("this generator
 * runs in these lifecycle states"). `shouldSuppressGenerator` is the dynamic,
 * context-aware filter ("but skip in *this* specific situation"). Use it for
 * clean (id, lifecycle, flag)-based skips. Row-content checks (e.g. all rows
 * 0-0) live inside the generator itself, where the data is already in scope.
 *
 * Add a new rule by appending another id-based branch — keep each rule narrow
 * and well-commented so the suppression logic stays auditable.
 */
function shouldSuppressGenerator(g: InsightGenerator, context: InsightContext): boolean {
  // Rookie benchmark identifies first-archive owners as rookies. When the
  // current roster is borrowed from a prior archive (rollover window), every
  // owner read as "current" is actually a returning member, so the rookie
  // detection would mislabel them. Skip until the current-year CSV exists.
  if (g.id === 'career:rookie_benchmark' && context.usingArchivedRoster) {
    return true;
  }
  return false;
}

export type RunInsightsEngineOptions = {
  bypassSuppression?: boolean;
};

export async function runInsightsEngine(
  context: InsightContext,
  options: RunInsightsEngineOptions = {}
): Promise<Insight[]> {
  const { bypassSuppression = false } = options;

  // 1. Load suppression records (non-blocking — empty map on failure).
  const records = bypassSuppression
    ? new Map()
    : await loadSuppressionRecords(context.leagueSlug, context.currentYear).catch(() => new Map());

  // 2. Run all lifecycle-matching generators with try/catch isolation.
  // The cross-cutting suppression filter is gated on bypassSuppression so
  // admin/diagnostic runs (e.g. ?bypassSuppression=1) actually receive every
  // generator's output — without this gate, the new engine-level rule would
  // silently keep filtering even when the caller asked for everything.
  const raw = generators
    .filter((g) => g.supportedLifecycles.includes(context.lifecycleState))
    .filter((g) => bypassSuppression || !shouldSuppressGenerator(g, context))
    .flatMap((g) => {
      try {
        return g.generate(context);
      } catch {
        return [];
      }
    })
    .filter((i) => i.priorityScore > 0);

  // 3. Filter out suppressed insights.
  const surviving = bypassSuppression
    ? raw
    : raw.filter((insight) => !isSuppressed(insight, records));

  // 4. Sort by priorityScore, slice top N.
  const top = surviving.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, MAX_INSIGHTS);

  // 5. Save suppression records for insights that made the cut (non-blocking).
  if (!bypassSuppression) {
    await Promise.all(
      top.map((insight) =>
        saveSuppressionRecord(
          toSuppressionRecord(insight),
          context.leagueSlug,
          context.currentYear
        ).catch(() => undefined)
      )
    );
  }

  // 6. Return insights.
  return top;
}
