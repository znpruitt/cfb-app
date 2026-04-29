import React from 'react';
import type { LeagueRecords, RecordEntry } from '@/lib/selectors/leagueRecords';
import RecordBadge from './RecordBadge';

type Props = {
  records: LeagueRecords;
};

const CATEGORY_LABELS: Record<keyof LeagueRecords, string> = {
  career: 'Career',
  season: 'Season',
  rivalry: 'Rivalry',
  event: 'Event',
};

const CATEGORIES: (keyof LeagueRecords)[] = ['career', 'season', 'rivalry', 'event'];

function holdersDisplay(entry: RecordEntry): string {
  if (entry.holders.length === 1) return entry.holders[0]!;
  if (entry.holders.length === 2) return `${entry.holders[0]} & ${entry.holders[1]}`;
  return `${entry.holders[0]} (and ${entry.holders.length - 1} others)`;
}

function RecordCard({ entry }: { entry: RecordEntry }): React.ReactElement {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/60">
      <div className="mb-1 flex items-center gap-1.5">
        <RecordBadge category={entry.category} size={11} />
        <p className="text-[10px] font-semibold uppercase leading-none tracking-wide text-gray-500 dark:text-zinc-400">
          {entry.label}
        </p>
      </div>
      <p className="truncate text-sm font-semibold text-gray-900 dark:text-zinc-50">
        {holdersDisplay(entry)}
      </p>
      <p className="text-xs text-gray-500 dark:text-zinc-400">{entry.formattedValue}</p>
    </div>
  );
}

export default function RecordLeadersGrid({ records }: Props): React.ReactElement {
  const hasAny = CATEGORIES.some((cat) => records[cat].length > 0);

  if (!hasAny) {
    return (
      <section className="space-y-3">
        <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">Record Book</h2>
        <p className="text-sm text-gray-500 dark:text-zinc-400">No records yet.</p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <h2 className="text-[15px] font-medium text-gray-900 dark:text-zinc-100">Record Book</h2>
      {CATEGORIES.map((cat) => {
        const entries = records[cat];
        if (entries.length === 0) return null;
        return (
          <div key={cat} className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-zinc-500">
              {CATEGORY_LABELS[cat]}
            </h3>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {entries.map((entry) => (
                <RecordCard key={entry.id} entry={entry} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
