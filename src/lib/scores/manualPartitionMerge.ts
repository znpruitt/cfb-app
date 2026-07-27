import { effectiveRowTimestamp, type CacheEntry } from './cache.ts';
import type { ScorePack } from './types.ts';

/**
 * PLATFORM-086B2A — merge an authorized manual `/games` partition refresh onto the
 * prior-good durable entry, to be committed under the SAME advisory-locked
 * transaction the live-score engine (PLATFORM-086B1) uses. Placing both writers
 * on the shared `scores/<year>-<week>-<seasonType>` lock closes the B1-deferred
 * concurrency gap where a plain `setAppState` upsert could clobber (or be
 * clobbered by) a concurrent live merge.
 *
 * Merge policy — the manual `/games` response is AUTHORITATIVE partition
 * replacement; it is NOT converted into the live engine's preserve-missing-rows
 * merge. The single concurrency exception: any prior row whose EFFECTIVE per-row
 * timestamp POST-DATES the manual request's observation/start time is a live
 * update that landed after this manual request began, so it is PRESERVED — a slow
 * manual request never overwrites a later live update. Accepted manual rows are
 * stamped with the observation time; preserved live rows keep their effective
 * timestamp. Pending-final confirmation metadata survives ONLY for a protected
 * newer live row (still awaiting its own confirmation); for every id the
 * authoritative `/games` response covers it is cleared (that response IS the
 * authoritative game state).
 */
export function mergeManualPartition(params: {
  manualItems: ScorePack[];
  prior: CacheEntry | null;
  /** The manual request's observation/start time (ms). */
  now: number;
}): CacheEntry {
  const { manualItems, prior, now } = params;

  type MergedRow = { item: ScorePack; at: number; source: 'manual' | 'live-protected' };
  const byId = new Map<string, MergedRow>();
  const unkeyed: ScorePack[] = [];

  // The manual response is the authoritative base, stamped at the observation time.
  for (const item of manualItems) {
    const id = item.id?.trim();
    if (id) byId.set(id, { item, at: now, source: 'manual' });
    else unkeyed.push(item);
  }

  const priorPending = new Set(
    (prior?.pendingFinalConfirmationIds ?? []).filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    )
  );

  // Protect newer live rows: a prior row whose effective timestamp post-dates the
  // manual observation is a later live update and overrides the manual row.
  if (prior) {
    for (const priorItem of prior.items) {
      const id = priorItem.id?.trim();
      if (!id) continue;
      const priorEffective = effectiveRowTimestamp(prior, priorItem);
      if (priorEffective > now) {
        byId.set(id, { item: priorItem, at: priorEffective, source: 'live-protected' });
      }
    }
  }

  const items: ScorePack[] = [];
  const itemUpdatedAtById: Record<string, number> = {};
  const nextPending = new Set<string>();
  for (const [id, { item, at, source }] of byId) {
    items.push(item);
    itemUpdatedAtById[id] = at;
    // A protected newer live row keeps its pending status; a manual row is
    // authoritatively resolved by the `/games` response, so it is never pending.
    if (source === 'live-protected' && priorPending.has(id)) nextPending.add(id);
  }
  for (const item of unkeyed) items.push(item);

  return {
    // Monotonic entry VERSION (PLATFORM-086B2A). The week-scoped `/api/scores`
    // reader selects between a process-cached and a durable entry SOLELY by `at`,
    // so the enclosing `at` must never move BACKWARD past a prior entry this merge
    // read over. When a live merge committed after the manual request began, the
    // prior durable entry's `at` is newer than the manual observation `now`; using
    // `now` here would let another instance holding that newer live entry keep
    // serving pre-manual values indefinitely (past TTL, the `pickFreshestScoresEntry`
    // comparison would prefer the cached live copy). Bump strictly past the prior
    // entry's `at`. The per-row `itemUpdatedAtById` stamps still drive the season
    // reconciler (accepted manual rows keep their observation time), so this version
    // bump never fabricates row-level freshness; the invariant `entry.at >= every
    // row stamp` (held by both writers) keeps `at` at least as new as its content.
    at: prior ? Math.max(now, prior.at + 1) : now,
    items,
    source: 'cfbd',
    cfbdFallbackReason: 'none',
    itemUpdatedAtById,
    ...(nextPending.size > 0 ? { pendingFinalConfirmationIds: [...nextPending].sort() } : {}),
  };
}
