import type { Insight } from '../selectors/insights';

/**
 * INSIGHTS-031 — choosing which wording of an insight a reader sees.
 *
 * ## Why this is not in the generator
 *
 * Generators run inside `unstable_cache`. AGENTS.md invariant 3 is explicit that
 * time-dependent classification belongs in consumers, because a `Date.now()`
 * inside a tagged cache closure produces stale classification that persists
 * until someone manually invalidates the tag. A generator that picked "this
 * week's variant" would bake one week's choice into the cached entry and it
 * would stay there.
 *
 * So the generator emits every wording and this runs at request time. The cached
 * value is a fact plus its wordings — time-invariant, which is what the
 * invariant asks for.
 *
 * ## Why it is not random
 *
 * The same fact must read the same way for as long as it is meant to. A random
 * pick re-words itself on every cache recompute, so a reader who refreshes sees
 * the joke change — which reads as a bug, not as variety.
 *
 * ## Cadence
 *
 * A knob, not a constant buried in a hash. Weekly is the floor; with a deep
 * enough pool the cadence can tighten for freshness or loosen so a good line
 * gets time to land. Changing it invalidates nothing, because nothing about the
 * cadence reaches the cache.
 */

/** Days a given wording holds before the pool advances. */
export const VARIANT_ROTATION_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/**
 * Which rotation bucket a moment falls in.
 *
 * Counted from the epoch rather than from a season or league start, so every
 * league advances on the same boundary and no league needs a stored anchor.
 *
 * Epoch day 0 is a THURSDAY, so with a 7-day cadence the boundary lands Thursday
 * 00:00 UTC — Wednesday evening in the US. That happens to be a good place for
 * it, mid-week and clear of the weekend when people are actually reading, but it
 * is a CONSEQUENCE of the epoch anchor rather than a choice. An earlier version
 * of this comment asserted a Tuesday boundary and reasoned from it; the intent
 * survived, the stated fact did not. Changing `VARIANT_ROTATION_DAYS` moves this
 * boundary, so re-derive it rather than trusting this paragraph.
 */
export function rotationBucket(now: Date, rotationDays = VARIANT_ROTATION_DAYS): number {
  const days = Math.floor(now.getTime() / MS_PER_DAY);
  return Math.floor(days / Math.max(1, rotationDays));
}

/**
 * A small stable hash of the insight's identity.
 *
 * Seeded with the id so two insights in the same feed do not move in lockstep —
 * without it every line would switch to "variant 2" on the same day, which reads
 * as the app being rewritten rather than as one item refreshing.
 */
function hashId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Pick one wording for this reading.
 *
 * Returns `description` unchanged when there is nothing to rotate, so an insight
 * without variants is unaffected and no generator has to opt out.
 */
export function selectInsightVariant(insight: Insight, now: Date): string {
  const pool = insight.descriptionVariants;
  if (!pool || pool.length <= 1) return insight.description;
  const index = (hashId(insight.id) + rotationBucket(now)) % pool.length;
  return pool[index] ?? insight.description;
}

/**
 * Apply the rotation across a served feed.
 *
 * Takes ONE `now` for the whole feed so two insights in the same response cannot
 * land in different buckets across a midnight boundary.
 */
export function applyInsightVariants(insights: readonly Insight[], now: Date): Insight[] {
  return insights.map((insight) => {
    const description = selectInsightVariant(insight, now);
    return description === insight.description ? insight : { ...insight, description };
  });
}

// ---------------------------------------------------------------------------
// Priority decay — the second thing that is allowed to depend on the clock.
// ---------------------------------------------------------------------------

/**
 * INSIGHTS-031 — a draft fact is news in August and wallpaper by November.
 *
 * Nothing about "you drafted 8 games against yourself" changes during the
 * season; what changes is how far away the draft is. So the score has to fall
 * with time, and — like variant selection — that CANNOT happen in the generator.
 * A decayed score computed inside `unstable_cache` freezes at whatever the
 * lifecycle was when the entry was warmed (AGENTS.md invariant 3).
 *
 * Decays to a FLOOR rather than to zero, deliberately. The pool is small; a
 * draft insight that vanishes in November removes content from exactly the weeks
 * that have the least of it. At the floor it stops competing for the top slot
 * but can still surface on a quiet week.
 *
 * Owner ruling (2026-08-16): the draft fact earns a second life as a season
 * recap — "drafted 8 games against himself, finished 9th" — but that is a
 * separate insight with the final standings in hand, not a decay curve that
 * bends back up.
 */
export type InsightDecay = 'draft';

/**
 * Multipliers by lifecycle rather than by week number, because the lifecycle is
 * already carried on the served response and a week number is not. Coarse on
 * purpose: the curve only needs to answer "how stale is the draft".
 */
const DRAFT_DECAY: Record<string, number> = {
  preseason: 1,
  early_season: 1,
  mid_season: 0.5,
  late_season: 0.35,
  postseason: 0.35,
  fresh_offseason: 0.35,
  offseason: 0.35,
};

/** The floor any decaying insight keeps, so it never disappears outright. */
export const DECAY_FLOOR = 0.35;

export function decayFactor(decay: InsightDecay | undefined, lifecycleState: string): number {
  if (decay !== 'draft') return 1;
  return DRAFT_DECAY[lifecycleState] ?? DECAY_FLOOR;
}

/**
 * Apply decay to a served feed.
 *
 * Rewrites `priorityScore` so every downstream ranker — `selectServedInsights`,
 * `deriveOverviewInsights`, the standings panel — sees the decayed value without
 * needing to know decay exists.
 */
export function applyInsightDecay(insights: readonly Insight[], lifecycleState: string): Insight[] {
  return insights.map((insight) => {
    const factor = decayFactor(insight.decay, lifecycleState);
    if (factor === 1) return insight;
    return { ...insight, priorityScore: Math.round(insight.priorityScore * factor) };
  });
}
