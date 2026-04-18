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
    : await loadSuppressionRecords().catch(() => new Map());

  // 2. Run all lifecycle-matching generators with try/catch isolation.
  const raw = generators
    .filter((g) => g.supportedLifecycles.includes(context.lifecycleState))
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
        saveSuppressionRecord(toSuppressionRecord(insight)).catch(() => undefined)
      )
    );
  }

  // 6. Return insights.
  return top;
}
