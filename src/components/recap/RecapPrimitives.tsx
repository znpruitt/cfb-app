import type { AvailableWeeklyRecapViewModel } from '@/lib/recap/composeWeeklyRecap';

type RecapHeaderProps = Pick<AvailableWeeklyRecapViewModel, 'headline' | 'weekLabel'> & {
  headingId: string;
  compact?: boolean;
};

export function RecapHeader({
  headline,
  weekLabel,
  headingId,
  compact = false,
}: RecapHeaderProps): React.ReactElement {
  return (
    <header>
      <div
        className={
          compact ? 'flex items-baseline gap-2' : 'flex items-baseline justify-between gap-4'
        }
      >
        <p
          aria-hidden={headline ? undefined : 'true'}
          className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-400"
        >
          Weekly recap
        </p>
        <p className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-400">
          {weekLabel}
        </p>
      </div>
      <h2
        id={headingId}
        className={
          headline
            ? compact
              ? 'mt-2.5 max-w-2xl text-[21px] font-semibold leading-[1.2] tracking-[-0.01em] text-zinc-50'
              : 'mt-[18px] max-w-2xl text-[28px] font-semibold leading-[1.15] tracking-[-0.015em] text-zinc-50'
            : 'sr-only'
        }
      >
        {headline ?? `Weekly recap · ${weekLabel}`}
      </h2>
    </header>
  );
}

type WeekRecordsGridProps = {
  ownerLines: AvailableWeeklyRecapViewModel['ownerLines'];
  headingId: string;
  compact?: boolean;
};

export function WeekRecordsGrid({
  ownerLines,
  headingId,
  compact = false,
}: WeekRecordsGridProps): React.ReactElement {
  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400"
      >
        Week records
      </h3>
      <ul
        className={`grid grid-cols-2 gap-x-8 min-[821px]:grid-cols-4 ${
          compact ? '' : 'min-[821px]:gap-x-10'
        }`}
      >
        {ownerLines.map((line) => (
          <li
            key={line.owner}
            className={`${compact ? 'py-[6px]' : 'py-2'} border-b border-zinc-800/80 last:border-b-0`}
          >
            <div
              className={`flex items-baseline justify-between gap-3 font-medium text-zinc-100 ${
                compact ? 'text-[13.5px]' : 'text-[14.5px]'
              }`}
            >
              <span className="min-w-0 truncate">{line.owner}</span>
              <span className="shrink-0 tabular-nums">{line.recordLabel}</span>
            </div>
            <p className="mt-0.5 text-xs tabular-nums text-zinc-400">{line.pointsLabel}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
