import type { SeasonArchive } from '../seasonArchive.ts';
import type { OwnedFinalParticipation } from '../standings.ts';
import {
  IN_SEASON_RECORD_IDS,
  projectHistoricalInSeasonRecordEvidence,
  projectLiveInSeasonRecordEvidence,
  selectInSeasonRecordProjection,
  type InSeasonRecordId,
  type RecordEntry,
} from './leagueRecords.ts';

export type WeeklyRecordChange = {
  id: InSeasonRecordId;
  previous: RecordEntry | null;
  current: RecordEntry | null;
  /** Previous record hidden only by the broad-tie display policy, if any. */
  suppressedPrevious: RecordEntry | null;
  /** Current record hidden only by the broad-tie display policy, if any. */
  suppressedCurrent: RecordEntry | null;
};

function sameHolders(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((holder, index) => holder === right[index]);
}

function sameRecord(left: RecordEntry | null, right: RecordEntry | null): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.id === right.id &&
    left.value === right.value &&
    sameHolders(left.holders, right.holders) &&
    sameHolders(left.constituentKeys ?? [], right.constituentKeys ?? []) &&
    left.formattedValue === right.formattedValue &&
    (left.contextString ?? null) === (right.contextString ?? null)
  );
}

/**
 * Diff the active-season-safe record projection immediately before and through
 * one explicit canonical week. Live evidence is already canonical owned-final
 * participation data; completed archives remain on their historical authority.
 */
export function selectWeeklyRecordChanges(args: {
  archives: SeasonArchive[];
  historicalRosters: Record<number, Map<string, string>>;
  seasonYear: number;
  targetWeek: number;
  participations: OwnedFinalParticipation[];
}): WeeklyRecordChange[] {
  const historicalArchives = args.archives.filter((archive) => archive.year < args.seasonYear);
  const historicalEvidence = projectHistoricalInSeasonRecordEvidence({
    archives: historicalArchives,
    historicalRosters: args.historicalRosters,
  });
  const beforeEvidence = projectLiveInSeasonRecordEvidence({
    seasonYear: args.seasonYear,
    participations: args.participations.filter(
      (participation) => participation.game.canonicalWeek < args.targetWeek
    ),
  });
  const currentEvidence = projectLiveInSeasonRecordEvidence({
    seasonYear: args.seasonYear,
    participations: args.participations.filter(
      (participation) => participation.game.canonicalWeek <= args.targetWeek
    ),
  });
  const previous = selectInSeasonRecordProjection([historicalEvidence, beforeEvidence], {
    tiedContext: 'latest',
  });
  const previousIncludingBroadTies = selectInSeasonRecordProjection(
    [historicalEvidence, beforeEvidence],
    {
      tiedContext: 'latest',
      includeBroadTies: true,
    }
  );
  const current = selectInSeasonRecordProjection([historicalEvidence, currentEvidence], {
    tiedContext: 'latest',
  });
  const currentIncludingBroadTies = selectInSeasonRecordProjection(
    [historicalEvidence, currentEvidence],
    {
      tiedContext: 'latest',
      includeBroadTies: true,
    }
  );

  return IN_SEASON_RECORD_IDS.flatMap((id): WeeklyRecordChange[] => {
    const previousRecord = previous[id];
    const currentRecord = current[id];
    const suppressedPrevious = previousRecord === null ? previousIncludingBroadTies[id] : null;
    const suppressedCurrent = currentRecord === null ? currentIncludingBroadTies[id] : null;
    return sameRecord(previousRecord, currentRecord)
      ? []
      : [
          {
            id,
            previous: previousRecord,
            current: currentRecord,
            suppressedPrevious,
            suppressedCurrent,
          },
        ];
  });
}
