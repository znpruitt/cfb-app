import type {
  AvailableWeeklyRecapViewModel,
  WeeklyRecapViewModel,
} from '@/lib/recap/composeWeeklyRecap';

import { RecapHeader, WeekRecordsGrid } from './RecapPrimitives';

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
        <p className="mt-2 text-sm text-zinc-400">Weekly recap data is unavailable right now.</p>
      </section>
    );
  }

  const availableRecap: AvailableWeeklyRecapViewModel = recap;

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
        <div className="mt-11">
          <WeekRecordsGrid
            headingId="weekly-recap-records-heading"
            ownerLines={availableRecap.ownerLines}
          />
          {availableRecap.isIncomplete ? (
            <p className="mt-4 text-sm text-zinc-400">
              This recap reflects the completed results currently available.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
