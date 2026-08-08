import type { Insight } from '../selectors/insights';

/**
 * Lifecycle-aware copy framing. Generators that fire on archived-roster data
 * (e.g. fresh_offseason rolling over before the current-year CSV exists) use
 * this to disambiguate prior-year content from current-year claims.
 *
 * - "Last season's …" — title prefix. Documentary register; suits factual /
 *   stats / season-wrap surfaces where the underlying data is the prior season.
 *
 * INSIGHTS-022 removed a second helper, `applyReturningOwnerFraming`, which
 * prefixed career descriptions with "Returning owner". It was applied whenever
 * the roster was borrowed from an archive — but a borrowed roster only proves
 * someone PLAYED, never that they will play again, so the prefix asserted a
 * future fact the data could not support. Identifying who is actually returning
 * requires comparing a FINALIZED upcoming roster against league history, which
 * is a separate feature. The career generators now keep their neutral
 * descriptions, which describe historical performance and claim nothing else.
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
