import type { Insight } from '../selectors/insights.ts';
import { IN_SEASON_LIFECYCLES, insightKind, insightSignature } from './freshness.ts';
import { observationKey, type InsightObservation } from './observationStore.ts';
import type { LifecycleState } from './types.ts';

/**
 * INSIGHTS-018 — which insights the feed shows, and in what order.
 *
 * **Rewritten. The first two attempts used "least recently shown", and the wrong
 * thing was the basis, not the implementation.** Selection advanced the very
 * timestamp it ordered by, so showing an insight changed the input to the next
 * selection: the served set churned within a bucket and then settled on the same
 * five forever, because whichever group was stamped first carried the bucket\'s
 * earliest timestamp into every bucket after it. Both reviewers reproduced it,
 * twice, against the real modules.
 *
 * Rotation is now **bucket-indexed**: candidates are put in a stable order and a
 * window slides by bucket. Selection reads no state that showing an insight
 * writes, so determinism within a bucket is STRUCTURAL rather than a property the
 * write path has to remember to preserve.
 *
 * The rules, in order:
 *   1. **Changed insights first** — something the league has not been told yet.
 *   2. **Then a rotating window** over the rest, so standing facts come back
 *      around instead of one group winning a sort forever.
 *   3. **Events do not rotate.** They fire, they decay, they are gone.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The weekday a weekly bucket turns over, as `Date.getUTCDay()` — 1 = Monday.
 *
 * CHOSEN, not inherited. Counting weeks from the epoch put the boundary on a
 * Thursday, because 1 January 1970 was one — about ten hours before the Thursday
 * pulse INSIGHTS-026 plans. Monday puts the turnover beside the Look Back pulse
 * rather than colliding with the Forward Look.
 */
const WEEKLY_BUCKET_ROLLS_ON = 1;

/**
 * A monotonically increasing bucket number: days in season, weeks outside it.
 *
 * Daily in season because the data moves weekly and a feed that sat still for
 * seven days would look broken. Weekly outside it because nothing changes for
 * months, so a daily shuffle would be motion without information — and would make
 * it impossible to point someone at a card you saw yesterday.
 */
export function rotationBucketIndex(now: Date, lifecycleState: LifecycleState): number {
  const days = Math.floor(now.getTime() / MS_PER_DAY);
  if (IN_SEASON_LIFECYCLES.has(lifecycleState)) return days;
  const sinceRollover = (now.getUTCDay() - WEEKLY_BUCKET_ROLLS_ON + 7) % 7;
  return Math.floor((days - sinceRollover) / 7);
}

export type RotationInput = {
  insights: readonly Insight[];
  observations: ReadonlyMap<string, InsightObservation>;
  lifecycleState: LifecycleState;
  now: Date;
  limit: number;
  /**
   * Whether an insight differs from its prior observation.
   *
   * Injected so the threshold rules live in ONE place. Selection and the badge
   * implemented this separately once and drifted, which meant an insight could
   * head the feed as "changed" while wearing no label.
   */
  hasChanged: (insight: Insight, prior: InsightObservation) => boolean;
};

export type RotationSelection = {
  selected: Insight[];
  /** Signature per selected insight, keyed as the store keys it. */
  signatures: Map<string, string>;
};

export function selectRotatedInsights(input: RotationInput): RotationSelection {
  const { insights, observations, lifecycleState, now, limit, hasChanged } = input;

  const signatures = new Map<string, string>();
  for (const insight of insights) {
    signatures.set(observationKey(insight.id), insightSignature(insight));
  }

  const changed: Insight[] = [];
  const rotatable: Insight[] = [];
  for (const insight of insights) {
    const prior = observations.get(observationKey(insight.id));
    if (!prior || hasChanged(insight, prior)) {
      changed.push(insight);
      continue;
    }
    // An EVENT the league has already been told is spent: it does not rotate and
    // is not a candidate at all, which is what stops a season-wrap card
    // reappearing months later.
    if (insightKind(insight) === 'event') continue;
    rotatable.push(insight);
  }

  changed.sort((a, b) => b.priorityScore - a.priorityScore);

  // A STABLE order, independent of anything the feed writes. Priority first so a
  // more interesting fact leads its cycle; id breaks ties so the sequence is
  // reproducible rather than dependent on generator registration order.
  rotatable.sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id));

  const slots = Math.max(limit - changed.length, 0);
  const rotated: Insight[] = [];
  if (slots > 0 && rotatable.length > 0) {
    // The window slides one FEED per bucket, so consecutive buckets show disjoint
    // groups and the pool is covered in ceil(n / limit) buckets. Modulo by LENGTH
    // rather than by window count: when the pool is not a whole multiple of the
    // feed the window straddles the wrap, and every insight still gets a turn.
    const bucket = rotationBucketIndex(now, lifecycleState);
    const offset = (((bucket * limit) % rotatable.length) + rotatable.length) % rotatable.length;
    for (let i = 0; i < Math.min(slots, rotatable.length); i++) {
      rotated.push(rotatable[(offset + i) % rotatable.length]!);
    }
  }

  return { selected: [...changed, ...rotated].slice(0, limit), signatures };
}
