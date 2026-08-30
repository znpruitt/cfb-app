import type {
  AvailableWeeklyRecapViewModel,
  WeeklyRecapViewModel,
} from '@/lib/recap/composeWeeklyRecap';

import {
  GameScoreboardList,
  MovementList,
  RecapHeader,
  RecordChangeList,
  WeekLeadersStrip,
  WeekRecordsGrid,
} from './RecapPrimitives';

export default function WeeklyRecapSection({
  recap,
}: {
  recap: WeeklyRecapViewModel;
}): React.ReactElement | null {
  if (recap.status === 'inactive' || recap.status === 'absent') return null;

  if (recap.status === 'unavailable') {
    return (
      <section
        aria-labelledby="weekly-recap-heading"
        className="mb-10 border-b border-zinc-800 pb-10"
      >
        <h2
          id="weekly-recap-heading"
          className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400"
        >
          Weekly recap
        </h2>
        <p className="mt-2 text-sm text-zinc-400">
          This week&apos;s recap isn&apos;t available right now. Please check back shortly.
        </p>
      </section>
    );
  }

  const availableRecap: AvailableWeeklyRecapViewModel = recap;
  const hasMovement = availableRecap.movementLines.length > 0;
  const hasRecordChanges = availableRecap.recordChangeLines.length > 0;

  return (
    <section
      aria-labelledby="weekly-recap-heading"
      className="mb-10 border-b border-zinc-800 pb-10"
    >
      <RecapHeader
        headingId="weekly-recap-heading"
        headline={availableRecap.headline}
        weekLabel={availableRecap.weekLabel}
      />

      {availableRecap.ownerLines.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-400">
          No completed results were recorded for this week.
        </p>
      ) : (
        <>
          <WeekLeadersStrip lines={availableRecap.leaderLines} />
          <div className="mt-9">
            <WeekRecordsGrid
              headingId="weekly-recap-records-heading"
              ownerLines={availableRecap.ownerLines}
            />
          </div>
          {hasMovement || hasRecordChanges ? (
            <div
              className={
                hasMovement && hasRecordChanges
                  ? 'mt-11 grid gap-10 min-[821px]:grid-cols-[5fr_7fr] min-[821px]:gap-16'
                  : `mt-11 ${hasMovement ? 'max-w-md' : ''}`
              }
            >
              <MovementList
                heading={`${availableRecap.weekLabel} movement`}
                headingId="weekly-recap-movement-heading"
                lines={availableRecap.movementLines}
              />
              <RecordChangeList
                headingId="weekly-recap-record-changes-heading"
                lines={availableRecap.recordChangeLines}
              />
            </div>
          ) : null}
          {availableRecap.headToHeadLines.length > 0 ? (
            <div className="mt-11">
              <GameScoreboardList
                heading="Head-to-head results"
                headingId="weekly-recap-head-to-head-heading"
                lines={availableRecap.headToHeadLines}
              />
            </div>
          ) : null}
          {availableRecap.notableResultLines.length > 0 ? (
            <div className="mt-11">
              <GameScoreboardList
                heading="Notable results"
                headingId="weekly-recap-notable-results-heading"
                lines={availableRecap.notableResultLines}
              />
            </div>
          ) : null}
          {availableRecap.isIncomplete ? (
            <p className="mt-4 text-sm text-zinc-400">
              This recap reflects the completed results currently available.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
