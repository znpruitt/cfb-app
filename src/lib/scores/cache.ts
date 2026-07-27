import type { CfbdFallbackReason, ScorePack, SeasonType } from './types.ts';

export type CacheWeek = number | 'all';
export type CacheKey = `${number}-${CacheWeek}-${SeasonType}`;

export type CacheEntry = {
  at: number;
  items: ScorePack[];
  // 'cfbd' is the sole normal production score source (PLATFORM-086A rereview
  // removed ESPN as an automatic fallback). 'espn' is retained ONLY so a durable
  // entry written before that removal can still be read/labeled; no code writes
  // it now and such entries are replaced on the next successful CFBD refresh.
  source: 'cfbd' | 'espn';
  cfbdFallbackReason: CfbdFallbackReason;
  /**
   * Optional per-provider-game-id last-updated timestamps (PLATFORM-086B1). The
   * enclosing `at` timestamps the WHOLE entry, but a live merge that rewrites an
   * entry to preserve untouched prior-good rows must NOT re-stamp those rows: a
   * preserved row would then falsely out-rank a genuinely newer copy of the same
   * game in another cache entry. When present, a row's EFFECTIVE timestamp is
   * `itemUpdatedAtById[providerGameId]` (its true last-changed instant); a live
   * merge stamps only inserted or materially changed rows and copies preserved
   * rows' prior effective timestamps forward. Rows without an id, and every
   * legacy entry that lacks this map entirely, fall back to `at` — so pre-B1
   * entries reconcile exactly as before.
   */
  itemUpdatedAtById?: Record<string, number>;
  /**
   * Optional provider game ids whose scoreboard-derived FINAL still awaits one
   * authoritative CFBD `/games` confirmation (PLATFORM-086B1). A scoreboard
   * `completed` row is displayed as final immediately but recorded here as
   * pending; the final-reconciliation pass clears an id only once `/games`
   * reports that game completed with both scores. Backward compatible: absent on
   * every pre-B1 entry (nothing pending) and never required by any reader.
   */
  pendingFinalConfirmationIds?: string[];
};

/**
 * The EFFECTIVE last-updated timestamp of one cached row: its per-row timestamp
 * when the entry carries one for this provider game id, else the enclosing
 * entry's `at`. The single place the per-row-vs-entry timestamp fallback is
 * decided, so every reader (reconciler, merge) agrees. A non-finite stored value
 * is ignored (falls back to `at`) — durable JSON is untrusted at rest.
 */
export function effectiveRowTimestamp(entry: CacheEntry, item: Pick<ScorePack, 'id'>): number {
  const id = item.id?.trim();
  if (id && entry.itemUpdatedAtById) {
    const stamped = entry.itemUpdatedAtById[id];
    if (typeof stamped === 'number' && Number.isFinite(stamped)) return stamped;
  }
  return entry.at;
}

export function pruneScoresCache(
  cache: Record<CacheKey, CacheEntry>,
  maxEntries: number,
  onPrune?: (evictedCount: number, cacheSize: number) => void
): void {
  const entries = Object.entries(cache) as Array<[CacheKey, CacheEntry]>;
  if (entries.length <= maxEntries) return;

  const toDelete = entries
    .sort((a, b) => a[1].at - b[1].at)
    .slice(0, entries.length - maxEntries)
    .map(([key]) => key);

  for (const key of toDelete) {
    delete cache[key];
  }

  onPrune?.(toDelete.length, entries.length);
}
