import type { Insight } from '../selectors/insights.ts';
import { INSIGHT_KIND, insightSignature } from './freshness.ts';
import { observationKey, type InsightObservation } from './observationStore.ts';
import type { LifecycleState } from './types.ts';

/**
 * INSIGHTS-018 — which insights the feed shows, and in what order.
 *
 * Replaces "drop anything already fired". That rule could not work outside a
 * season: almost every type suppressed on an UNCHANGED stat value, and with no
 * games played no value can change, so a preseason feed drained to whatever sat
 * on the never-suppress list and stayed there.
 *
 * The rules, in order:
 *   1. **Changed insights first.** Something the league has not been told yet.
 *   2. **Then rotation**, oldest-shown first, so standing facts come back around
 *      instead of one set winning the priority sort forever.
 *   3. **Events do not rotate.** They fire, they decay, they are gone. Re-showing
 *      "Ballard won the toilet bowl 7 times in 2025" in March is noise.
 *
 * Ordering is a pure function of (insights, observations, bucket) — no
 * randomness, no wall-clock beyond the bucket. `applySuppression` ran per request
 * while the raw insights were cached, so anything stochastic would reshuffle the
 * feed on every page load; a reader would never be able to find a card twice.
 */

/**
 * The unit of rotation. Everything within one bucket sees the same order.
 *
 * Daily in season, because the underlying data moves weekly and a feed that sat
 * still for seven days would look broken. Weekly outside it, because nothing
 * changes for months and a daily shuffle would be motion without information —
 * and would make it impossible to point someone at a card you saw yesterday.
 */
const IN_SEASON_LIFECYCLES: ReadonlySet<LifecycleState> = new Set<LifecycleState>([
  'early_season',
  'mid_season',
  'late_season',
  'postseason',
]);

export function rotationBucket(now: Date, lifecycleState: LifecycleState): string {
  const days = Math.floor(now.getTime() / (24 * 60 * 60 * 1000));
  return IN_SEASON_LIFECYCLES.has(lifecycleState) ? `d${days}` : `w${Math.floor(days / 7)}`;
}

export type RotationInput = {
  insights: readonly Insight[];
  observations: ReadonlyMap<string, InsightObservation>;
  lifecycleState: LifecycleState;
  now: Date;
  limit: number;
};

export type RotationSelection = {
  /** The chosen feed, in display order. */
  selected: Insight[];
  /** Signature per selected insight, so the caller writes observations without recomputing. */
  signatures: Map<string, string>;
};

/** Insights whose observation shows a different signature, or none at all. */
function hasChanged(
  insight: Insight,
  observations: ReadonlyMap<string, InsightObservation>
): boolean {
  const prior = observations.get(observationKey(insight.id, insight.newsHook));
  if (!prior) return true;
  return prior.signature !== insightSignature(insight);
}

/**
 * Deterministic per-insight offset within a bucket.
 *
 * Rotation cannot simply sort by `lastShownAt`, because everything shown in the
 * same request shares a timestamp to the millisecond — the order would collapse
 * back to whatever the priority sort produced, and the same cards would win every
 * time. Mixing the bucket into a per-id value breaks that tie differently each
 * bucket while staying identical within one.
 *
 * A small string hash is fine HERE, unlike the signature: a collision costs two
 * insights an arbitrary-but-stable relative order, not a wrong freshness answer.
 */
function bucketOffset(insightId: string, bucket: string): number {
  let h = 2166136261;
  const s = `${bucket}:${insightId}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

export function selectRotatedInsights(input: RotationInput): RotationSelection {
  const { insights, observations, lifecycleState, now, limit } = input;
  const bucket = rotationBucket(now, lifecycleState);

  const signatures = new Map<string, string>();
  for (const insight of insights) signatures.set(insight.id, insightSignature(insight));

  const changed: Insight[] = [];
  const rotatable: Insight[] = [];
  for (const insight of insights) {
    if (hasChanged(insight, observations)) {
      changed.push(insight);
      continue;
    }
    // An EVENT the league has already been told is spent. It does not rotate,
    // and it is not a candidate at all — which is what stops a season-wrap card
    // reappearing months later.
    if (INSIGHT_KIND[insight.type] === 'event') continue;
    rotatable.push(insight);
  }

  changed.sort((a, b) => b.priorityScore - a.priorityScore);

  // Oldest-shown first, then a bucket-stable tiebreak. `lastShownAt` missing
  // means produced-but-never-shown (the pulse writes those), which should surface
  // ahead of anything already seen.
  const shownAt = (insight: Insight): number => {
    const prior = observations.get(observationKey(insight.id, insight.newsHook));
    if (!prior?.lastShownAt) return 0;
    const ms = new Date(prior.lastShownAt).getTime();
    return Number.isFinite(ms) ? ms : 0;
  };
  rotatable.sort((a, b) => {
    const diff = shownAt(a) - shownAt(b);
    if (diff !== 0) return diff;
    return bucketOffset(a.id, bucket) - bucketOffset(b.id, bucket);
  });

  return { selected: [...changed, ...rotatable].slice(0, limit), signatures };
}
