import type { CfbdSeasonType } from '@/lib/cfbd';
import { classifyScorePackStatus, type GameStatusBucket } from '@/lib/gameStatus';
import { effectiveRowTimestamp, type CacheEntry } from '@/lib/scores/cache';
import type { ScorePack } from '@/lib/scores/types';
import { withAppStateKeyTransaction } from '@/lib/server/appStateStore';

/**
 * PLATFORM-086B1 — durable per-partition score merge.
 *
 * Writes ONLY the exact child cache key `scores/<year>-<providerWeek>-
 * <seasonType>` (never a season-wide aggregate), under a per-key durable
 * transaction so concurrent instances cannot clobber each other. Within the
 * transaction it preserves unrelated prior-good rows, replaces only confidently
 * matched provider-id rows, and applies monotonic state protection so a stale
 * observation can never regress a fresher one:
 *
 *   scheduled  ↛ in-progress / final
 *   in-progress ↛ final
 *   final       may replace in-progress
 *   same-state score corrections are allowed
 *
 * Per-row freshness (the required fix): a live merge stamps ONLY inserted or
 * materially changed rows with `now`; preserved rows keep their prior effective
 * timestamp, and a metadata-only (confirmation) change keeps the entry `at`
 * itself, so a preserved row can never out-rank a genuinely newer copy elsewhere
 * and freshness is never fabricated. Nothing is written when neither a score nor
 * the confirmation metadata changed, and an empty replacement is never published.
 */

export type ScoreUpdate = {
  pack: ScorePack;
  /** True when this update asserts a scoreboard final awaiting `/games` confirmation. */
  provisionalFinal: boolean;
};

export type PartitionMergeResult = {
  /** Whether a durable write occurred (score change and/or confirmation metadata). */
  wrote: boolean;
  /** Confirmed durable score/status changes (0 on a no-op or metadata-only write). */
  committed: number;
};

/**
 * Monotonic state order. Disrupted (canceled/postponed) is terminal, so a live
 * or scheduled observation can never regress it; a final may still correct it
 * (same order).
 */
function stateOrder(bucket: GameStatusBucket): number {
  switch (bucket) {
    case 'scheduled':
      return 0;
    case 'inprogress':
      return 1;
    case 'final':
      return 2;
    case 'disrupted':
      return 2;
  }
}

/** Score/status equality — the definition of a durable "change" (labels excluded). */
function scoreStatusUnchanged(a: ScorePack, b: ScorePack): boolean {
  return a.status === b.status && a.home.score === b.home.score && a.away.score === b.away.score;
}

type MergeRowResult = { rejected: true } | { rejected: false; changed: boolean; row: ScorePack };

/**
 * Merge one incoming row over its prior-good counterpart. Rejects a monotonic
 * regression (preserving prior); otherwise preserves a present prior score
 * against a transient null and reports whether score/status materially changed.
 */
export function mergeScoreRow(prior: ScorePack | undefined, next: ScorePack): MergeRowResult {
  const nextOrder = stateOrder(classifyScorePackStatus(next));
  if (prior) {
    const priorOrder = stateOrder(classifyScorePackStatus(prior));
    if (nextOrder < priorOrder) return { rejected: true };
  }
  const row: ScorePack = {
    ...next,
    home: { team: next.home.team, score: next.home.score ?? prior?.home.score ?? null },
    away: { team: next.away.team, score: next.away.score ?? prior?.away.score ?? null },
  };
  const changed = !prior || !scoreStatusUnchanged(prior, row);
  return { rejected: false, changed, row };
}

function toPendingSet(entry: CacheEntry | null): Set<string> {
  const set = new Set<string>();
  for (const id of entry?.pendingFinalConfirmationIds ?? []) {
    if (typeof id === 'string' && id.trim().length > 0) set.add(id.trim());
  }
  return set;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

/**
 * Durably merge a set of score updates (and/or confirmation clears) into one
 * exact week partition. `updates` are matched provider-id rows; `confirmFinalIds`
 * are provider ids whose scoreboard-final was confirmed by `/games` and must be
 * cleared from the pending set. Throws only if the durable transaction itself
 * fails (caller records a truthful failure and preserves prior-good state).
 */
export async function mergeScoresIntoPartition(params: {
  year: number;
  week: number;
  seasonType: CfbdSeasonType;
  updates: ScoreUpdate[];
  confirmFinalIds?: string[];
  now: number;
}): Promise<PartitionMergeResult> {
  const { year, week, seasonType, updates, confirmFinalIds = [], now } = params;
  const key = `${year}-${week}-${seasonType}`;

  return withAppStateKeyTransaction<PartitionMergeResult>('scores', key, async (txn) => {
    const prior = (await txn.read<CacheEntry>())?.value ?? null;

    // Seed the merged set from prior rows (untouched). Rows without a provider id
    // are preserved verbatim (a live-written row always has one).
    const mergedById = new Map<string, { item: ScorePack; touched: boolean }>();
    const unkeyedPrior: ScorePack[] = [];
    for (const item of prior?.items ?? []) {
      const id = item.id?.trim();
      if (id) mergedById.set(id, { item, touched: false });
      else unkeyedPrior.push(item);
    }

    let committed = 0;
    for (const update of updates) {
      const id = update.pack.id?.trim();
      if (!id) continue;
      const result = mergeScoreRow(mergedById.get(id)?.item, update.pack);
      if (result.rejected) continue; // monotonic regression — preserve prior
      if (result.changed) {
        mergedById.set(id, { item: result.row, touched: true });
        committed += 1;
      }
    }

    // Confirmation metadata: add newly-committed scoreboard finals; clear ids
    // confirmed by `/games`.
    const priorPending = toPendingSet(prior);
    const nextPending = new Set(priorPending);
    for (const update of updates) {
      const id = update.pack.id?.trim();
      if (id && update.provisionalFinal && mergedById.get(id)?.touched) nextPending.add(id);
    }
    for (const id of confirmFinalIds) nextPending.delete(id);
    const pendingChanged = !setsEqual(priorPending, nextPending);

    if (committed === 0 && !pendingChanged) {
      return { wrote: false, committed: 0 };
    }

    // Rebuild the entry with per-row effective timestamps: touched rows stamp
    // `now`; preserved rows carry their prior effective timestamp forward.
    const items: ScorePack[] = [];
    const itemUpdatedAtById: Record<string, number> = {};
    for (const [id, { item, touched }] of mergedById) {
      items.push(item);
      itemUpdatedAtById[id] = touched ? now : prior ? effectiveRowTimestamp(prior, item) : now;
    }
    for (const item of unkeyedPrior) items.push(item);

    // Never publish an empty replacement.
    if (items.length === 0) return { wrote: false, committed };

    const nextEntry: CacheEntry = {
      // A score change advances the entry timestamp; a metadata-only change keeps
      // the prior `at` so no served-score freshness is fabricated. A brand-new
      // entry uses `now`.
      at: committed > 0 ? now : (prior?.at ?? now),
      items,
      source: 'cfbd',
      cfbdFallbackReason: 'none',
      itemUpdatedAtById,
      ...(nextPending.size > 0 ? { pendingFinalConfirmationIds: [...nextPending].sort() } : {}),
    };
    await txn.write(nextEntry);
    return { wrote: true, committed };
  });
}
