import type { Insight } from '../selectors/insights';
import {
  isSuppressed,
  loadSuppressionRecords,
  saveSuppressionRecord,
  toSuppressionRecord,
} from './suppression';
import { insightSignature, isNewInsight } from './freshness';
import {
  loadObservations,
  nextObservation,
  observationKey,
  saveObservation,
  type InsightObservation,
} from './observationStore';
import { selectRotatedInsights } from './rotation';
import type { InsightContext, InsightGenerator, LifecycleState } from './types';

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

/**
 * Pure, deterministic generation half of the engine: run every lifecycle-
 * matching generator (with the cross-cutting `shouldSuppressGenerator` gate,
 * itself skipped under `bypassSuppression`) and keep the positively-scored
 * insights. NO suppression, NO sort/slice, NO I/O — the result is a function of
 * `context` alone, which is what makes it safe to cache upstream
 * (`loadInsightsForLeague` caches this output; suppression is applied per
 * request against the cached set).
 */
export function generateRawInsights(
  context: InsightContext,
  options: RunInsightsEngineOptions = {}
): Insight[] {
  const { bypassSuppression = false } = options;
  return generators
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

/**
 * INSIGHTS-018 — the serving half, replacing `applySuppression`.
 *
 * Selects the feed by rotation rather than by hiding what has already fired,
 * marks what CHANGED as new, and records the observation. `applySuppression`
 * and its store are left in place but no longer consulted when serving: the
 * records age out under their own TTL and the rollover clear that already
 * exists, so nothing is destructively migrated.
 *
 * Observation writes are best-effort and individually caught, matching the
 * behaviour they replace — a storage failure degrades freshness, it must not
 * stop insights being served.
 */
export async function applyRotation(
  rawInsights: Insight[],
  leagueSlug: string,
  season: number,
  lifecycleState: LifecycleState,
  now: Date = new Date()
): Promise<Insight[]> {
  const observations = await loadObservations(leagueSlug, season, now.getTime()).catch(
    () => new Map<string, InsightObservation>()
  );

  const { selected, signatures } = selectRotatedInsights({
    insights: rawInsights,
    observations,
    lifecycleState,
    now,
    limit: MAX_INSIGHTS,
  });

  const served = selected.map((insight) => {
    const key = observationKey(insight.id, insight.newsHook);
    const prior = observations.get(key);
    const signature = signatures.get(insight.id) ?? insightSignature(insight);
    // NEW is decided against the PRIOR observation, before this one is written —
    // otherwise every insight would compare equal to the record just created and
    // nothing would ever be new.
    const changedAt = prior && prior.signature === signature ? prior.lastChangedAt : null;
    return { ...insight, isNew: isNewInsight(changedAt, lifecycleState, now) };
  });

  await Promise.all(
    selected.map((insight) => {
      const key = observationKey(insight.id, insight.newsHook);
      const signature = signatures.get(insight.id) ?? insightSignature(insight);
      return saveObservation(
        nextObservation(observations.get(key), key, signature, now),
        leagueSlug,
        season
      ).catch(() => undefined);
    })
  );

  return served;
}

export async function runInsightsEngine(
  context: InsightContext,
  options: RunInsightsEngineOptions = {}
): Promise<Insight[]> {
  const { bypassSuppression = false } = options;
  const raw = generateRawInsights(context, options);

  // bypassSuppression (admin/diagnostic): return the raw set sorted/sliced, with
  // no suppression filter and no records written.
  if (bypassSuppression) {
    return raw.sort((a, b) => b.priorityScore - a.priorityScore).slice(0, MAX_INSIGHTS);
  }

  return applySuppression(raw, context.leagueSlug, context.currentYear);
}
