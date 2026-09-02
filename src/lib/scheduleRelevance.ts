import { normalizeProviderClassification } from './conferenceSubdivision.ts';

export type ScheduleClassificationRow = {
  homeClassification?: unknown;
  awayClassification?: unknown;
};

export type ScheduleBuildRelevanceRow = ScheduleClassificationRow & {
  seasonType?: unknown;
};

/**
 * Whether a schedule row can be relevant to an FBS-derived canonical build.
 * Drop only rows whose two classifications are both known and both non-FBS.
 * Missing or unrecognized classifications fail open for legacy durable rows.
 */
export function isFbsRelevantScheduleRow(row: ScheduleClassificationRow): boolean {
  const homeClassification = normalizeProviderClassification(row.homeClassification);
  const awayClassification = normalizeProviderClassification(row.awayClassification);

  return (
    homeClassification === undefined ||
    awayClassification === undefined ||
    homeClassification === 'fbs' ||
    awayClassification === 'fbs'
  );
}

/**
 * Whether a row belongs in an FBS-focused canonical build. Postseason rows are
 * always retained because the shared schedule builder intentionally applies no
 * subdivision eligibility check to postseason placeholders and matchups.
 */
export function isFbsRelevantScheduleBuildRow(row: ScheduleBuildRelevanceRow): boolean {
  return row.seasonType === 'postseason' || isFbsRelevantScheduleRow(row);
}
