import { classifyScorePackStatus } from '../gameStatus.ts';
import { effectiveRowTimestamp, type CacheEntry } from './cache.ts';
import type { ScorePack } from './types.ts';

/** A complete, terminal final: classified `final` with BOTH scores present. */
function isCompleteFinal(pack: ScorePack): boolean {
  return (
    classifyScorePackStatus(pack) === 'final' &&
    pack.home.score !== null &&
    pack.away.score !== null
  );
}

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
 * merge. The concurrency exception: a prior row whose EFFECTIVE per-row timestamp
 * POST-DATES the manual request's observation/start time is a live update that
 * landed after this manual request began, so it is PRESERVED — a slow manual
 * request never overwrites a later live update. The exception to THAT exception is
 * a terminal authority: a game cannot progress past a confirmed final, so when the
 * authoritative `/games` response returns a COMPLETE FINAL for a game whose newer
 * live row is NOT yet final, the manual final overrides the live row (otherwise the
 * game would read as falsely still-in-progress). Accepted manual rows are stamped
 * with the observation time (a final override is stamped at least as fresh as the
 * live row it supersedes); preserved live rows keep their effective timestamp.
 * Pending-final confirmation metadata survives for a protected newer live row ONLY
 * while it is still unconfirmed — a manual `/games` complete final for that game IS
 * its authoritative confirmation and clears it (spec point 7); every id the manual
 * response resolves directly is likewise never pending.
 */
export function mergeManualPartition(params: {
  manualItems: ScorePack[];
  prior: CacheEntry | null;
  /** The manual request's observation/start time (ms). */
  now: number;
}): CacheEntry {
  const { manualItems, prior, now } = params;

  type MergedRow = { item: ScorePack; at: number; source: 'manual' | 'live-protected' };
  const manualById = new Map<string, ScorePack>();
  const byId = new Map<string, MergedRow>();

  // The manual response is the authoritative base, stamped at the observation time.
  // A row without a provider game id is UNUSABLE for this id-keyed locked merge: it
  // cannot dedup against or protect a keyed live row, and (having no per-row stamp)
  // would fall back to the bumped entry `at` and outrank a protected live row in
  // reconciliation. Such rows are rejected upstream in the manual normalization, and
  // dropped defensively here.
  for (const item of manualItems) {
    const id = item.id?.trim();
    if (!id) continue;
    manualById.set(id, item);
    byId.set(id, { item, at: now, source: 'manual' });
  }

  const priorPending = new Set(
    (prior?.pendingFinalConfirmationIds ?? []).filter(
      (value): value is string => typeof value === 'string' && value.trim().length > 0
    )
  );

  // Protect newer live rows: a prior row whose effective timestamp post-dates the
  // manual observation is a later live update and overrides the manual row —
  // UNLESS the authoritative `/games` response reports a complete final for a live
  // row that has not itself reached final (a terminal state a live poll cannot
  // supersede), in which case the manual final wins.
  if (prior) {
    for (const priorItem of prior.items) {
      const id = priorItem.id?.trim();
      if (!id) continue;
      const priorEffective = effectiveRowTimestamp(prior, priorItem);
      // Protect a live row at least as new as the manual observation. The `>=`
      // (not `>`) is deliberate: the advisory lock serializes commits but not
      // same-millisecond observation timestamps, so on a tie the live row (which
      // committed first) is preserved rather than letting a stale manual snapshot
      // regress it (e.g. in-progress → scheduled).
      if (priorEffective < now) continue; // strictly older → manual is authoritative
      const manualItem = manualById.get(id);
      const liveIsFinal = classifyScorePackStatus(priorItem) === 'final';
      if (manualItem && !liveIsFinal && isCompleteFinal(manualItem)) {
        // Terminal-final override — stamp at least as fresh as the live row it
        // supersedes so the reconciler serves the authoritative final.
        byId.set(id, { item: manualItem, at: Math.max(now, priorEffective), source: 'manual' });
      } else {
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
    // A preserved live row keeps its pending status ONLY while still unconfirmed:
    // a manual `/games` complete final for that game IS its authoritative
    // confirmation and clears it. Manual rows (including terminal-final overrides)
    // are authoritatively resolved by the response, so they are never pending.
    if (source === 'live-protected' && priorPending.has(id)) {
      const manualItem = manualById.get(id);
      if (!(manualItem && isCompleteFinal(manualItem))) nextPending.add(id);
    }
  }

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
