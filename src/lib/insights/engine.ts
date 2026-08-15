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

/**
 * Pure, deterministic generation half of the engine: run every lifecycle-
 * matching generator (with the cross-cutting `shouldSuppressGenerator` gate,
 * itself skipped under `bypassSuppression`) and keep the positively-scored
 * insights. NO per-insight suppression, NO sort/slice, NO I/O — the result is a
 * function of `context` alone, which is what makes it safe to cache upstream
 * (`loadInsightsForLeague` caches this output and applies `selectServedInsights`
 * per request against the cached set).
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
 * INSIGHTS-029 — the serving selection, replacing `applySuppression`.
 *
 * **The feed was not thin, it was DRAINED.** Suppression is per insight TYPE,
 * and 21 of the 32 types carried a `TYPE_THRESHOLDS` rule — almost all
 * `{ kind: 'unchanged' }`, suppress while the stat value is identical. In
 * preseason no games are played, so no stat value can ever change: each of those
 * fired once and was hidden for the rest of the preseason.
 *
 * Be precise about what survived, because the pool work (INSIGHTS-023/018) sizes
 * itself from this: NOT just the three `NEVER_SUPPRESS_TYPES`. `isSuppressed`
 * returns false for a type with no threshold entry, and 8 types are in neither
 * table (`champion_margin`, `collapse`, `failed_chase`, `movement`, `race`,
 * `surge`, `tight_cluster`, `toilet_bowl`), so they survived as well — except
 * when carrying a `snapshot` newsHook, which is checked before the rule lookup.
 * 11 of 32 types were unaffected; the drain hit the other 21.
 *
 * "Fire once, then fade" only makes sense while something is moving. Out of
 * season nothing is, so the rule degenerated into "show each insight once, ever".
 *
 * Deliberately just a sort and a slice — no store reads, no writes, no
 * per-request state. Repetition across loads is not a problem worth machinery
 * while a league has fewer insights than the feed holds; when INSIGHTS-023
 * widens the pool past the feed, rotation earns its keep and gets built against a
 * real pool (INSIGHTS-018).
 *
 * `suppression.ts` is left in place and simply not consulted here: its records
 * age out under their own TTL and the rollover clear that already exists, so
 * nothing is destructively migrated.
 *
 * Consequence worth stating plainly: `applySuppression` below now has NO
 * production caller. The only remaining `runInsightsEngine` call site passes
 * `bypassSuppression: true` and returns before reaching it. Nothing writes
 * suppression records any more, so the debug endpoint reports pre-029 residue
 * only — it says so in its own response rather than letting an empty tally read
 * as "nothing fired". Both are kept, not deleted, because retiring the store is
 * a separate decision from stopping the drain; INSIGHTS-023 is the point at
 * which the pool question gets settled and the retirement can be made properly.
 */
export function selectServedInsights(rawInsights: Insight[]): Insight[] {
  return [...rawInsights].sort((a, b) => b.priorityScore - a.priorityScore).slice(0, MAX_INSIGHTS);
}

/**
 * INSIGHTS-029 — production reaches this ONLY with `bypassSuppression: true`
 * (the admin/diagnostic path in `loadInsights.ts`); the served path calls
 * `selectServedInsights` directly. The suppression branch below is therefore
 * exercised by tests alone. Kept so the retired behaviour stays observable and
 * pinned rather than deleted piecemeal — see `selectServedInsights`.
 */
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
