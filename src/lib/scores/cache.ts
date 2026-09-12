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
  /**
   * Optional per-provider-game-id FIRST-OBSERVATION-OF-FINAL timestamps
   * (PLATFORM-692 / #692). The instant at which LIVE POLLING first saw the
   * provider report this game's SCORE as final — written once, never moved.
   *
   * READ THIS BEFORE QUERYING IT; three things it is not.
   *
   * 1. NOT a game end time. CFBD publishes none — `/games` exposes no temporal
   *    field but `startDate`/`startTimeTBD`, and `/scoreboard` nulls `period`
   *    and `clock` the instant a row reads `completed`. What is recorded is the
   *    real whistle PLUS CFBD's publication lag PLUS up to one poll interval
   *    MINUS the run prologue. That last term is a real bias, not a rounding
   *    note: both callers pass `now.getTime()`, and `now` is captured at the
   *    TOP of the cron (`live-scores/route.ts:154`) — before the quota probe,
   *    the canonical-context load, and the provider request, which alone may
   *    run to `CFBD_PEAK_LATENCY_TIMEOUT_MS` (40s) plus retry and pacing. So
   *    the stamp can PREDATE the observation it names, by more than the fetch.
   *    `itemUpdatedAtById` shares that basis exactly, so the two stay
   *    comparable and a tail sized from their DIFFERENCE is unaffected; a tail
   *    sized from `stamp − kickoff` is biased short, and that is the term to
   *    subtract. Net of all of it this is still the right quantity for sizing
   *    the reconciliation tail, which waits on the provider's data settling,
   *    not on the whistle.
   * 2. NOT a confirmed final. A `/scoreboard` `completed` row is displayed as
   *    final immediately and recorded in {@link pendingFinalConfirmationIds}
   *    awaiting `/games`; it is stamped here at that PROVISIONAL observation.
   *    It IS a scored final, though: both opt-in callers require both scores
   *    before a row can reach this map (`scoreboardPayload.ts`'s
   *    `scoreboardStatusLabel` emits `final` only with both points present;
   *    `finalReconciliation.ts` skips a row missing either). Note that
   *    `classifyScorePackStatus` itself does NOT require scores — it tests the
   *    status label alone — so that guarantee lives in the callers, and a new
   *    caller opting in must preserve it or this contract changes.
   * 3. NOT every game. Only the live paths stamp — `mergeScoresIntoPartition`
   *    writes this map only when its caller opts in via
   *    `stampFirstFinalObservation`, which the weekly `finalScoreSweep` does
   *    NOT. `/scoreboard` is pinned to `classification=fbs`, so live polling
   *    covers exactly the FBS population, and the sweep (`/games`, no division
   *    filter) supplies most non-FBS finals at one fixed weekly cron clock —
   *    a number about the cron, not about the game. Stamping both would mix
   *    two measurements silently, so swept games are EXCLUDED and the exclusion
   *    is self-describing: such a row is present in {@link itemUpdatedAtById}
   *    and absent here, so "no stamp" never reads as "no data".
   *
   *    An absent stamp means we NEVER OBSERVED THE TRANSITION on a live path —
   *    not that we observed one we cannot date. `scoreMerge` withholds a stamp
   *    whenever the child row is ALREADY final, so once the weekly sweep (or a
   *    pre-692 write) has finalled a row, no later live re-observation can
   *    stamp it. That is what makes the exclusion hold permanently per row
   *    rather than only until the next poll, and it is why an unstamped row is
   *    safe to drop from the distribution rather than treat as a late final.
   *
   * Paired with {@link itemUpdatedAtById}, which is the LAST-material-change
   * stamp, the two bracket both halves of what the tail exists for: `stamp −
   * kickoff` is how long until the provider first reported final, and
   * `itemUpdatedAtById − stamp` is how long corrections kept arriving after
   * that (the straggler path). Neither half is a history — the second says when
   * the last correction landed, not how many there were.
   *
   * Write-once, permanently: every rebuilder carries an existing value forward
   * by RAW lookup and never re-stamps, because the question is when we FIRST
   * believed a game was final. No fallback to `at`: unlike
   * {@link effectiveRowTimestamp}, an absent stamp means ABSENT, never the
   * entry version. Nothing reads this map in the application — the consumer is
   * a durable-store query. Backward compatible: absent on every pre-692 entry,
   * and omitted entirely when empty.
   */
  firstFinalObservedAtById?: Record<string, number>;
};

/**
 * One carried-forward first-final stamp, or undefined when the entry holds none
 * for this id. The single place the RAW (no-fallback) read is expressed, so
 * every rebuilder carries the map identically and none reaches for
 * {@link effectiveRowTimestamp}, whose `at` fallback would synthesize a stamp
 * for a row never observed final. A non-finite stored value is ignored —
 * durable JSON is untrusted at rest.
 */
export function priorFirstFinalObservedAt(
  entry: CacheEntry | null | undefined,
  id: string
): number | undefined {
  const stamped = entry?.firstFinalObservedAtById?.[id];
  return typeof stamped === 'number' && Number.isFinite(stamped) ? stamped : undefined;
}

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

/**
 * The newest EFFECTIVE row timestamp in a single entry, or null when it holds no
 * rows (PLATFORM-086B2B). This is the correct served-freshness signal for a
 * week-scoped `/api/scores` read: the enclosing `at` is a monotonic VERSION (a
 * B2A metadata-only rewrite or version bump advances it without changing any
 * row), so reporting `at` as `generatedAt` would fabricate freshness. The season
 * reconciler already exposes the equivalent `newestEffectiveAt`.
 */
export function newestEffectiveRowTimestamp(entry: CacheEntry): number | null {
  let newest: number | null = null;
  for (const item of entry.items) {
    const ts = effectiveRowTimestamp(entry, item);
    if (newest === null || ts > newest) newest = ts;
  }
  return newest;
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
