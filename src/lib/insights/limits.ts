/**
 * INSIGHTS-019 — the two caps the Insights funnel passes through, in one place.
 *
 * The feed narrows twice: the loader keeps the top `MAX_SERVED_INSIGHTS`, and
 * the Overview panel renders the top `OVERVIEW_INSIGHT_SLOTS` of those. Both
 * numbers were previously literals in the modules that applied them, which meant
 * the diagnostic page would have had to MIRROR them — and a mirrored constant is
 * a divergence waiting to happen. The page reports what the code actually uses
 * because it imports the same values.
 */

/** The loader serves at most this many insights, ranked by priority. */
export const MAX_SERVED_INSIGHTS = 10;

/** The Overview panel renders at most this many of the served set. */
export const OVERVIEW_INSIGHT_SLOTS = 5;

/**
 * In `fresh_offseason` the Overview gives its first slot to the season recap
 * row, leaving one fewer for insights.
 *
 * DERIVED, not a second literal. This module exists because a mirrored constant
 * drifts — and a hardcoded `4` here was exactly that: widening the slot count
 * for INSIGHTS-023 would have left this at 4, silently misreporting one
 * insight's fate in `fresh_offseason`. The invariant is "the recap row takes one
 * slot", so express that.
 */
export const OVERVIEW_INSIGHT_SLOTS_WITH_RECAP = OVERVIEW_INSIGHT_SLOTS - 1;
