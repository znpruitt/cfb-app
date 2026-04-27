import type { Insight } from '../selectors/insights';

/**
 * Lifecycle-aware copy framing helpers. Generators that fire on archived-roster
 * data (e.g. fresh_offseason rolling over before the current-year CSV exists)
 * use these to disambiguate prior-year content from current-year claims.
 *
 * Two registers, deterministic per generator:
 *
 * - "Last season's …" — title prefix. Documentary register; suits factual /
 *   stats / season-wrap surfaces where the underlying data is the prior season.
 *
 * - "Returning owner …" — description prefix. Narrative register; suits career
 *   trajectory surfaces where we want to acknowledge the owner is a returning
 *   member rather than a new participant.
 *
 * Mixing the two across the generator set adds variety without per-render shuffling.
 */

export function applyLastSeasonFraming(insight: Insight): Insight {
  const trimmedTitle = insight.title.trim();
  if (trimmedTitle.toLowerCase().startsWith("last season's ")) return insight;
  // Lowercase the original title's first letter so "Toilet bowl leader" reads
  // as "Last season's toilet bowl leader" rather than "Last season's Toilet…".
  const lowered = trimmedTitle.charAt(0).toLowerCase() + trimmedTitle.slice(1);
  return {
    ...insight,
    title: `Last season's ${lowered}`,
  };
}

export function applyReturningOwnerFraming(insight: Insight): Insight {
  if (!insight.owner) return insight;
  // Only single-subject insights — multi-owner descriptions (e.g. "X and Y are tied")
  // become awkward when prefixed.
  if ((insight.relatedOwners?.length ?? 0) > 0) return insight;
  if (insight.description.startsWith('Returning owner ')) return insight;
  if (!insight.description.startsWith(insight.owner)) return insight;
  return {
    ...insight,
    description: `Returning owner ${insight.description}`,
  };
}
