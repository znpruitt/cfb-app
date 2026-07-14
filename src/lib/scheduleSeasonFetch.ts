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

/**
 * How to treat a schedule refresh whose applicable partitions all resolved
 * WITHOUT a required-partition failure (a required-partition failure is a
 * separate rejection handled by {@link hasRequiredSeasonTypeFailure} and must be
 * classified BEFORE calling this):
 *   - `not-empty`                    — the refresh mapped ≥1 row: commit as usual.
 *   - `unexpected-empty-replacement` — zero mapped rows OVER a populated
 *     prior-good durable schedule: schema-drift/incomplete upstream. Reject —
 *     retain prior-good, record a failure, do NOT transition off it.
 *   - `valid-noop`                   — zero mapped rows with NO populated
 *     prior-good schedule: genuine absence / not-yet-published. Record a no-op,
 *     write nothing.
 */
export type EmptyScheduleClassification =
  | 'not-empty'
  | 'unexpected-empty-replacement'
  | 'valid-noop';

/**
 * Single source of truth for the schedule empty-response policy, shared by the
 * authorized `/api/schedule` route and the season-transition cron so the two can
 * never drift into separate interpretations of "provider returned zero games"
 * (PLATFORM-086A 6th-review finding #2). There is no legitimate production case
 * for intentionally committing an empty schedule OVER a populated one, so an
 * empty replacement collapses into a rejection rather than an authoritative
 * zero-row commit.
 */
export function classifyEmptyScheduleRefresh(params: {
  mappedRows: number;
  priorDurableRows: number;
}): EmptyScheduleClassification {
  if (params.mappedRows > 0) return 'not-empty';
  return params.priorDurableRows > 0 ? 'unexpected-empty-replacement' : 'valid-noop';
}
