'use client';

import React from 'react';

type InterestingFactsPanelProps = {
  facts: string[];
};

export default function InterestingFactsPanel({
  facts,
}: InterestingFactsPanelProps): React.ReactElement | null {
  if (facts.length === 0) return null;

  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-[0.15em] text-gray-500 dark:text-zinc-400">
        Interesting Facts
      </h2>
      <ul className="space-y-2">
        {facts.map((fact, i) => (
          <li
            key={i}
            className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            {fact}
          </li>
        ))}
      </ul>
    </section>
  );
}
