export type ScheduleSeasonType = 'regular' | 'postseason';

export function hasRequiredSeasonTypeFailure(
  requestedSeasonType: ScheduleSeasonType | 'all',
  failedSeasonTypes: ScheduleSeasonType[]
): boolean {
  if (failedSeasonTypes.length === 0) {
    return false;
  }

  if (requestedSeasonType === 'all') {
    return true;
  }

  return failedSeasonTypes.includes(requestedSeasonType);
}
