import React from 'react';
import type { RankedRecord, RecordId } from '@/lib/selectors/leagueRecords';
import { RecordRanking } from './RecordRanking';
import { RecordEventList } from './RecordEventList';

type RecordSectionProps = {
  title: string;
  records: RankedRecord[];
  categoryNote?: string;
  /** Optional per-record qualifier note keyed by id (e.g. "Min. 3 seasons"). */
  qualifierNotesById?: Partial<Record<RecordId, string>>;
  /** Records that should render with the toggle locked on (e.g. career_drought). */
  lockedActiveOnlyIds?: ReadonlySet<RecordId>;
};

export function RecordSection({
  title,
  records,
  categoryNote,
  qualifierNotesById,
  lockedActiveOnlyIds,
}: RecordSectionProps): React.ReactElement {
  return (
    <section>
      <header className="border-b border-gray-200 pb-2 dark:border-zinc-800">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-medium text-gray-900 dark:text-zinc-100">{title}</h2>
          <span className="text-xs text-gray-500 dark:text-zinc-400">
            {records.length} record{records.length === 1 ? '' : 's'}
          </span>
        </div>
        {categoryNote ? (
          <p className="mt-1 text-xs italic text-gray-500 dark:text-zinc-500">{categoryNote}</p>
        ) : null}
      </header>
      <div className="divide-y divide-gray-100 dark:divide-zinc-800">
        {records.map((record) =>
          record.category === 'event' ? (
            <RecordEventList key={record.id} record={record} />
          ) : (
            <RecordRanking
              key={record.id}
              record={record}
              lockedActiveOnly={lockedActiveOnlyIds?.has(record.id) ?? false}
              qualifierNote={qualifierNotesById?.[record.id]}
            />
          )
        )}
      </div>
    </section>
  );
}
