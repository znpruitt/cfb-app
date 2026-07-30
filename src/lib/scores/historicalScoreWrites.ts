import type { SeasonType } from './types.ts';

/** The two complete historical partitions the repair always targets, in write order. */
export const HISTORICAL_REPAIR_SEASON_TYPES: readonly SeasonType[] = ['regular', 'postseason'];

export type HistoricalScoreWriteClassification = {
  allOk: boolean;
  failedPartitions: SeasonType[];
  /** True when at least one partition durably committed while a sibling failed. */
  partialFailure: boolean;
};

/**
 * PLATFORM-086F2C — classify the two durable score-cache writes (regular,
 * postseason) into the truthful provider-status shape: which partitions
 * failed, and whether the failure is PARTIAL (one sibling durably committed).
 * Pure — exported for direct testing since the store's test seams are
 * scope-level and cannot fail exactly one of two same-scope keys.
 */
export function classifyHistoricalScoreWrites(
  results: readonly [PromiseSettledResult<unknown>, PromiseSettledResult<unknown>]
): HistoricalScoreWriteClassification {
  const failedPartitions = HISTORICAL_REPAIR_SEASON_TYPES.filter(
    (_, i) => results[i]!.status === 'rejected'
  ) as SeasonType[];
  const committed = HISTORICAL_REPAIR_SEASON_TYPES.length - failedPartitions.length;
  return {
    allOk: failedPartitions.length === 0,
    failedPartitions,
    partialFailure: failedPartitions.length > 0 && committed > 0,
  };
}
