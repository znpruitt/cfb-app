import { evaluateGameStatsRow, selectAnalyticsRows, type SeasonRelation } from './contract.ts';
import type { GameStats, WeeklyGameStats } from './types.ts';
import type { GameStatsSlateExpectation } from './ingestion.ts';

/**
 * PLATFORM-086H3 — committed-durable-state partition coverage (ACTIVE).
 *
 * Coverage describes what is actually available in COMMITTED durable storage,
 * judged per canonical-schedule expectation through the PLATFORM-086H1 typed
 * classification — never what a provider request was expected to return, and
 * never bare cache-key existence. Callers derive it only AFTER confirmed
 * durable outcomes (an `indeterminate` or `unavailable` merge result must not
 * reach a coverage claim; the writer reports that uncertainty instead).
 *
 * One coverage model serves the scheduled cron, schedule-relative recovery,
 * and the provider-data diagnostics — there is no second coverage
 * implementation to drift against. The per-game sufficiency bar is
 * ANALYTICS ELIGIBILITY (strict v2-complete or bounded legacy-compatible):
 * legacy-compatible rows are durable evidence that already serves analytics,
 * so they are covered — automatically refetching every legacy week would be a
 * de-facto bulk migration, which stays a separately queued task.
 */

export type ExpectedGameCoverageState =
  /** An analytics-eligible durable row serves this game. */
  | 'satisfied'
  /** Defective/ineligible durable evidence, current season → auto-recoverable. */
  | 'recoverable'
  /** Defective/ineligible durable evidence, historical season → manual only. */
  | 'manual-only'
  /** Unsupported/malformed schema version — never auto-refetched. */
  | 'blocked'
  /** No durable row exists for this expected game. */
  | 'absent';

export type GameStatsPartitionCoverageState = 'complete' | 'partial' | 'absent' | 'not-applicable';

export type GameStatsPartitionCoverage = {
  state: GameStatsPartitionCoverageState;
  /** Every list is sorted ascending; a game id appears in exactly one list. */
  expected: number[];
  satisfied: number[];
  recoverable: number[];
  manualOnly: number[];
  blocked: number[];
  absent: number[];
  /**
   * Durable rows whose provider game id the canonical schedule slate does not
   * expect (stored by pre-activation writers, or a schedule correction). They
   * are retained compatibility data — never coverage, never a recovery target.
   */
  unmatchedStored: number[];
  /** Stat-producing schedule games not yet provider-addressable (placeholders). */
  deferredPlaceholders: number;
  /** Addressable stat-producing games not yet past the completion threshold. */
  pending: number[];
};

function sortIds(ids: Iterable<number>): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * Evaluate one weekly durable partition against its canonical-schedule
 * expectation. Pure: consumes the already-read committed record; a caller
 * whose durable READ failed must report that failure — it must not call this
 * with `null` and describe the result as confirmed absence.
 */
export function evaluateGameStatsPartitionCoverage(
  expectation: GameStatsSlateExpectation,
  record: WeeklyGameStats | null,
  context: { seasonRelation: SeasonRelation }
): GameStatsPartitionCoverage {
  const rowsById = new Map<number, GameStats[]>();
  for (const game of record?.games ?? []) {
    const rows = rowsById.get(game.providerGameId);
    if (rows) rows.push(game);
    else rowsById.set(game.providerGameId, [game]);
  }

  const satisfied: number[] = [];
  const recoverable: number[] = [];
  const manualOnly: number[] = [];
  const blocked: number[] = [];
  const absent: number[] = [];

  for (const id of expectation.expectedIds) {
    const rows = rowsById.get(id);
    if (!rows || rows.length === 0) {
      absent.push(id);
      continue;
    }
    // The canonical duplicate policy decides eligibility: a game is satisfied
    // exactly when analytics can actually serve it (identical duplicates
    // collapse; conflicting projections exclude the game).
    const selection = selectAnalyticsRows(rows);
    if (selection.selected.some((row) => row.providerGameId === id)) {
      satisfied.push(id);
      continue;
    }
    const evaluations = rows.map((row) => evaluateGameStatsRow(row, context));
    if (evaluations.some((e) => e.disposition === 'blocked-unsupported-schema')) {
      blocked.push(id);
      continue;
    }
    if (context.seasonRelation === 'current') recoverable.push(id);
    else manualOnly.push(id);
  }

  const expectedSet = expectation.expectedIds;
  const pendingSet = expectation.pendingIds;
  const unmatchedStored = sortIds(
    [...rowsById.keys()].filter((id) => !expectedSet.has(id) && !pendingSet.has(id))
  );

  const expected = sortIds(expectedSet);
  let state: GameStatsPartitionCoverageState;
  if (expected.length === 0) state = 'not-applicable';
  else if (satisfied.length === expected.length) state = 'complete';
  else if (satisfied.length === 0) state = 'absent';
  else state = 'partial';

  return {
    state,
    expected,
    satisfied: sortIds(satisfied),
    recoverable: sortIds(recoverable),
    manualOnly: sortIds(manualOnly),
    blocked: sortIds(blocked),
    absent: sortIds(absent),
    unmatchedStored,
    deferredPlaceholders: expectation.deferredPlaceholders,
    pending: sortIds(pendingSet),
  };
}

/**
 * Whether committed durable evidence already satisfies the contract for this
 * partition — the recovery stop condition "current durable evidence is already
 * sufficient". Blocked games do NOT block sufficiency (they are never
 * auto-recoverable, so retrying cannot improve them), but they are also never
 * reported as covered.
 */
export function isPartitionRecoverySatisfied(coverage: GameStatsPartitionCoverage): boolean {
  return coverage.recoverable.length === 0 && coverage.absent.length === 0;
}
