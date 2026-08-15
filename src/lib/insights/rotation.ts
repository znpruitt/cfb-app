import type { Insight } from '../selectors/insights.ts';
import { INSIGHT_KIND, insightSignature, statMovedEnough } from './freshness.ts';
import { observationKey, type InsightObservation } from './observationStore.ts';
import { IN_SEASON_LIFECYCLES } from './freshness.ts';
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
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The weekday a weekly bucket turns over, as `Date.getUTCDay()` — 1 = Monday.
 *
 * CHOSEN, not inherited. `floor(days / 7)` counts weeks from 1 January 1970,
 * which was a Thursday, so the boundary silently landed on Thursday 00:00 UTC —
 * about ten hours before the Thursday pulse INSIGHTS-026 plans. Two unrelated
 * mechanisms moving the feed within half a day of each other, neither of them
 * deliberately.
 *
 * Monday puts the turnover at the start of the week, next to the Look Back pulse
 * rather than colliding with the Forward Look.
 */
const WEEKLY_BUCKET_ROLLS_ON = 1;

export function rotationBucket(now: Date, lifecycleState: LifecycleState): string {
  const days = Math.floor(now.getTime() / MS_PER_DAY);
  if (IN_SEASON_LIFECYCLES.has(lifecycleState)) return `d${days}`;

  // Days since the most recent turnover weekday, so the bucket changes ON that
  // day rather than on an epoch-derived offset. `+ 7` keeps the modulo positive
  // for every weekday.
  const sinceRollover = (now.getUTCDay() - WEEKLY_BUCKET_ROLLS_ON + 7) % 7;
  return `w${days - sinceRollover}`;
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
  const prior = observations.get(observationKey(insight.id));
  if (!prior) return true;
  // The SAME tolerance the badge uses. If selection said "changed" on a one-unit
  // move while the badge said "unchanged", an insight would head the feed wearing
  // no label — the two decisions must not be able to disagree.
  if (INSIGHT_KIND[insight.type] === 'standing-moving') {
    return statMovedEnough(insight.type, prior.statValue, insight.statValue);
  }
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

  // Keyed by `observationKey`, matching the store. Keying by raw id meant two
  // insights sharing an id under different hooks silently overwrote one another's
  // signature, making the NEW decision and the persisted record wrong for one.
  const signatures = new Map<string, string>();
  for (const insight of insights)
    signatures.set(observationKey(insight.id), insightSignature(insight));

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
    const prior = observations.get(observationKey(insight.id));
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
