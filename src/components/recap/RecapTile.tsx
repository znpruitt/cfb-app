'use client';

import { useId, useState } from 'react';

import type { AvailableWeeklyRecapViewModel } from '@/lib/recap/composeWeeklyRecap';

import {
  MovementList,
  RecapHeader,
  TileHighlightsList,
  WeekLeadersList,
  WeekRecordsGrid,
} from './RecapPrimitives';

export default function RecapTile({
  recap,
}: {
  recap: AvailableWeeklyRecapViewModel;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const headingId = useId();
  const panelId = useId();
  const hasResults = recap.ownerLines.length > 0;
  const hasLeaders = recap.tileLeaderLines.length > 0;
  const hasMovement = recap.movementLines.length > 0;
  const hasHighlights = recap.tileHighlights.length > 0;

  return (
    <section aria-labelledby={headingId} className="rounded-lg bg-zinc-900 px-6 py-6 sm:px-7">
      <RecapHeader
        headingId={headingId}
        headline={recap.headline}
        weekLabel={recap.weekLabel}
        compact
      />

      {!hasResults ? (
        <p className="mt-2 text-[13px] text-zinc-400">
          No completed results were recorded for this week.
        </p>
      ) : (
        <>
          <div id={panelId} className="mt-5 border-t border-zinc-800 pt-5" hidden={!expanded}>
            <div
              className={
                hasLeaders
                  ? 'grid gap-9 min-[821px]:grid-cols-[7fr_5fr] min-[821px]:gap-12'
                  : undefined
              }
            >
              <WeekRecordsGrid
                headingId={`${panelId}-week-records-heading`}
                ownerLines={recap.ownerLines}
                compact
              />
              <WeekLeadersList
                headingId={`${panelId}-week-leaders-heading`}
                lines={recap.tileLeaderLines}
              />
            </div>
            {hasMovement || hasHighlights ? (
              <div
                className={
                  hasMovement && hasHighlights
                    ? 'mt-9 grid gap-9 min-[821px]:grid-cols-[5fr_7fr] min-[821px]:gap-12'
                    : `mt-9 ${hasMovement ? 'max-w-md' : ''}`
                }
              >
                <MovementList
                  heading={`${recap.weekLabel} movement`}
                  headingId={`${panelId}-movement-heading`}
                  lines={recap.movementLines}
                  compact
                />
                <TileHighlightsList
                  headingId={`${panelId}-week-highlights-heading`}
                  lines={recap.tileHighlights}
                />
              </div>
            ) : null}
            {recap.isIncomplete ? (
              <p className="mt-4 text-[13px] text-zinc-400">
                This recap reflects the completed results currently available.
              </p>
            ) : null}
          </div>
          <div className="mt-4">
            <button
              type="button"
              aria-controls={panelId}
              aria-expanded={expanded}
              className="text-[13px] text-blue-400 hover:underline"
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? 'Collapse' : 'View full recap'}{' '}
              <span aria-hidden="true">{expanded ? '↑' : '→'}</span>
            </button>
          </div>
        </>
      )}
    </section>
  );
}
