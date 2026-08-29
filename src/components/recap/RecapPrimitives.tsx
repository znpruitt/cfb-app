import type { AvailableWeeklyRecapViewModel } from '@/lib/recap/composeWeeklyRecap';
import type {
  WeeklyRecapGameLine,
  WeeklyRecapRecordChangeLine,
  WeeklyRecapTileHighlight,
} from '@/lib/recap/composeWeeklyRecap';

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
  const mobileLastRowStart = Math.floor((ownerLines.length - 1) / 2) * 2;
  const desktopLastRowStart = Math.floor((ownerLines.length - 1) / 4) * 4;

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
        {ownerLines.map((line, index) => {
          const mobileBorder = index >= mobileLastRowStart ? 'border-b-0' : 'border-b-[0.5px]';
          const desktopBorder =
            index >= desktopLastRowStart
              ? 'min-[821px]:border-b-0'
              : 'min-[821px]:border-b-[0.5px]';

          return (
            <li
              key={line.owner}
              className={`${compact ? 'py-[6px]' : 'py-2'} ${mobileBorder} ${desktopBorder} border-zinc-800/80`}
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
          );
        })}
      </ul>
    </section>
  );
}

export function WeekLeadersStrip({
  lines,
}: {
  lines: AvailableWeeklyRecapViewModel['leaderLines'];
}): React.ReactElement | null {
  if (lines.length === 0) return null;

  return (
    <section aria-label="Week leaders" className="mt-10 border-y border-zinc-800 py-6">
      <ul className="grid gap-5 min-[821px]:grid-cols-3 min-[821px]:gap-12">
        {lines.map((line) => (
          <li key={line.id}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">
              {line.label}
            </p>
            <p className="mt-1 text-[26px] font-semibold leading-tight tabular-nums text-zinc-100">
              {line.value}
            </p>
            <p className="mt-1 text-xs text-zinc-400">{line.context}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WeekLeadersList({
  lines,
  headingId,
}: {
  lines: AvailableWeeklyRecapViewModel['tileLeaderLines'];
  headingId: string;
}): React.ReactElement | null {
  if (lines.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400"
      >
        Week leaders
      </h3>
      <ul>
        {lines.map((line) => (
          <li
            key={line.id}
            className="border-b-[0.5px] border-zinc-800/80 py-[6px] last:border-b-0"
          >
            <div className="flex items-baseline justify-between gap-3 text-[13.5px] font-medium text-zinc-100">
              <span className="min-w-0 truncate">{line.label}</span>
              <span
                className={`shrink-0 tabular-nums ${line.tone === 'positive' ? 'text-green-400' : ''}`}
              >
                {line.value}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-zinc-400">{line.context}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function MovementList({
  lines,
  heading,
  headingId,
  compact = false,
}: {
  lines: AvailableWeeklyRecapViewModel['movementLines'];
  heading: string;
  headingId: string;
  compact?: boolean;
}): React.ReactElement | null {
  if (lines.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400"
      >
        {heading}
      </h3>
      <ul>
        {lines.map((line) => (
          <li
            key={line.owner}
            className={`${compact ? 'py-[6px]' : 'py-2'} border-b-[0.5px] border-zinc-800/80 last:border-b-0`}
          >
            <div
              className={`flex items-baseline justify-between gap-3 font-medium text-zinc-100 ${
                compact ? 'text-[13.5px]' : 'text-[14.5px]'
              }`}
            >
              <span className="min-w-0 truncate">{line.owner}</span>
              <span
                aria-label={
                  line.direction === 'up' ? 'Moved up in standings' : 'Dropped in standings'
                }
                className={`shrink-0 tabular-nums ${
                  line.direction === 'up' ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {line.deltaLabel}
              </span>
            </div>
            <p className="mt-0.5 text-xs tabular-nums text-zinc-400">{line.shiftLabel}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecordChangeRow({
  line,
  compact = false,
}: {
  line: WeeklyRecapRecordChangeLine;
  compact?: boolean;
}): React.ReactElement {
  return (
    <div
      className={`${compact ? 'py-[6px]' : 'py-2'} border-b-[0.5px] border-zinc-800/80 last:border-b-0`}
    >
      <div
        className={`flex items-baseline justify-between gap-3 font-medium text-zinc-100 ${
          compact ? 'text-[13.5px]' : 'text-[14.5px]'
        }`}
      >
        <span className="min-w-0 truncate">{line.label}</span>
        <span className="shrink-0 tabular-nums">{line.value}</span>
      </div>
      <p className="mt-0.5 text-xs text-zinc-400">{line.context}</p>
    </div>
  );
}

export function RecordChangeList({
  lines,
  headingId,
  compact = false,
}: {
  lines: WeeklyRecapRecordChangeLine[];
  headingId: string;
  compact?: boolean;
}): React.ReactElement | null {
  if (lines.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400"
      >
        Record changes
      </h3>
      <div>
        {lines.map((line) => (
          <RecordChangeRow key={line.id} line={line} compact={compact} />
        ))}
      </div>
    </section>
  );
}

function GameScoreboard({
  line,
  compact = false,
}: {
  line: WeeklyRecapGameLine;
  compact?: boolean;
}): React.ReactElement {
  const side = (
    entry: WeeklyRecapGameLine['winner'] | WeeklyRecapGameLine['loser'],
    winner: boolean
  ): React.ReactElement => (
    <div
      className={`flex items-baseline justify-between gap-3 py-px ${
        compact ? 'text-[13.5px]' : 'text-sm'
      } ${winner ? 'font-medium text-zinc-100' : 'text-zinc-400'}`}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className={`truncate ${winner ? '' : 'text-zinc-400'}`}>{entry.team}</span>
        {entry.owner ? (
          <span className="shrink-0 text-[12.5px] font-normal text-zinc-400">{entry.owner}</span>
        ) : null}
      </span>
      <span className={`shrink-0 tabular-nums ${winner ? 'font-semibold' : ''}`}>
        {entry.score}
      </span>
    </div>
  );

  return (
    <article className={`${compact ? 'py-2' : 'py-2.5'} border-b-[0.5px] border-zinc-800/80`}>
      <p className="mb-1.5 text-xs text-zinc-400">
        <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-300">
          {line.label}
        </span>
        {line.detail}
      </p>
      {side(line.winner, true)}
      {side(line.loser, false)}
    </article>
  );
}

export function GameScoreboardList({
  lines,
  heading,
  headingId,
  compact = false,
}: {
  lines: WeeklyRecapGameLine[];
  heading: string;
  headingId: string;
  compact?: boolean;
}): React.ReactElement | null {
  if (lines.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400"
      >
        {heading}
      </h3>
      <div className={compact ? '' : 'grid gap-x-12 min-[821px]:grid-cols-2'}>
        {lines.map((line) => (
          <GameScoreboard key={line.id} line={line} compact={compact} />
        ))}
      </div>
    </section>
  );
}

export function TileHighlightsList({
  lines,
  headingId,
}: {
  lines: WeeklyRecapTileHighlight[];
  headingId: string;
}): React.ReactElement | null {
  if (lines.length === 0) return null;

  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400"
      >
        Week highlights
      </h3>
      <div>
        {lines.map((line) =>
          line.kind === 'record-change' ? (
            <RecordChangeRow key={line.id} line={line} compact />
          ) : (
            <GameScoreboard key={line.id} line={line} compact />
          )
        )}
      </div>
    </section>
  );
}
