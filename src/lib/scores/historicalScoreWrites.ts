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
 * PLATFORM-086F2C — classify the ATTEMPTED durable score-cache writes into the
 * truthful provider-status shape: which partitions failed, and whether the
 * failure is PARTIAL (a sibling durably committed). `attempted` lists the
 * partitions actually written this run (a valid-absence empty partition is
 * never written, so it is never attempted). Pure — exported for direct testing
 * since the store's test seams are scope-level and cannot fail exactly one of
 * two same-scope keys.
 */
export function classifyHistoricalScoreWrites(
  attempted: readonly SeasonType[],
  results: readonly PromiseSettledResult<unknown>[]
): HistoricalScoreWriteClassification {
  const failedPartitions = attempted.filter((_, i) => results[i]?.status === 'rejected');
  const committed = attempted.length - failedPartitions.length;
  return {
    allOk: failedPartitions.length === 0,
    failedPartitions: [...failedPartitions],
    partialFailure: failedPartitions.length > 0 && committed > 0,
  };
}
