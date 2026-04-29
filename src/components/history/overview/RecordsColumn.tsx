import React from 'react';
import type { RecordEntry } from '@/lib/selectors/leagueRecords';
import { STROKE_COLORS } from '../RecordBadge';
import SectionHead from './SectionHead';

type Props = {
  records: RecordEntry[];
  slug: string;
};

const CATEGORY_LABEL: Record<RecordEntry['category'], string> = {
  career: 'Career',
  season: 'Season',
  rivalry: 'Rivalry',
  event: 'Event',
};

function holdersDisplay(entry: RecordEntry): string {
  if (entry.holders.length === 0) return '';
  if (entry.holders.length === 1) return entry.holders[0]!;
  if (entry.holders.length === 2) return `${entry.holders[0]} & ${entry.holders[1]}`;
  return `${entry.holders[0]} (and ${entry.holders.length - 1} others)`;
}

export default function RecordsColumn({ records, slug }: Props): React.ReactElement {
  return (
    <div>
      <SectionHead
        title="Records"
        delegationHref={`/league/${slug}/history/stats`}
        delegationLabel="All records →"
      />
      {records.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-zinc-400">No records yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {records.map((entry) => {
            const eyebrowColor = STROKE_COLORS[entry.category];
            return (
              <li key={entry.id} className="grid grid-cols-[1fr_16px] items-center gap-3 py-2">
                <div>
                  <p
                    className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em]"
                    style={{ color: eyebrowColor }}
                  >
                    {CATEGORY_LABEL[entry.category]}
                  </p>
                  <p className="mb-0.5 text-sm font-medium text-gray-900 dark:text-zinc-100">
                    {entry.label}
                  </p>
                  <p className="text-[13px] text-gray-500 tabular-nums dark:text-zinc-400">
                    {holdersDisplay(entry)} · {entry.formattedValue}
                  </p>
                </div>
                <span aria-hidden className="text-base text-gray-400 dark:text-zinc-500">
                  →
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
