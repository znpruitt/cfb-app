import type { Insight } from '../selectors/insights';
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

export function runInsightsEngine(context: InsightContext): Insight[] {
  return generators
    .filter((g) => g.supportedLifecycles.includes(context.lifecycleState))
    .flatMap((g) => {
      try {
        return g.generate(context);
      } catch {
        return [];
      }
    })
    .filter((i) => i.priorityScore > 0)
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, MAX_INSIGHTS);
}
