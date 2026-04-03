'use client';

import React from 'react';
import type { DraftState } from '@/lib/draft';

type DraftBoardGridProps = {
  draft: DraftState;
};

export default function DraftBoardGrid({ draft }: DraftBoardGridProps): React.ReactElement {
  const { draftOrder, totalRounds } = draft.settings;
  const n = draftOrder.length;

  // Index picks by pick number for quick lookup
  const pickByNumber = new Map<number, { team: string; autoSelected: boolean }>();
  for (const pick of draft.picks) {
    pickByNumber.set(pick.pickNumber, { team: pick.team, autoSelected: pick.autoSelected });
  }

  const currentPickNum = draft.currentPickIndex + 1;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr>
            <th className="w-12 py-1 pr-2 text-right font-medium text-gray-400 dark:text-zinc-500">
              Rd
            </th>
            {draftOrder.map((owner) => (
              <th
                key={owner}
                className="px-1.5 py-1 text-left font-semibold text-gray-700 dark:text-zinc-300"
              >
                {owner}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: totalRounds }, (_, roundIdx) => {
            const isEvenRound = roundIdx % 2 === 0;

            return (
              <tr key={roundIdx} className="border-t border-gray-100 dark:border-zinc-800">
                <td className="py-1 pr-2 text-right font-medium text-gray-400 dark:text-zinc-500">
                  {roundIdx + 1}
                </td>
                {Array.from({ length: n }, (_, colIdx) => {
                  // In snake draft: even rounds owner[0..n-1] picks in order,
                  // odd rounds owner[n-1..0] picks in order.
                  // Column colIdx always represents owner[colIdx].
                  // Position of owner[colIdx] within this round:
                  const posInRound = isEvenRound ? colIdx : n - 1 - colIdx;
                  const globalIdx = roundIdx * n + posInRound;
                  const pickNum = globalIdx + 1;
                  const pick = pickByNumber.get(pickNum);
                  const isCurrent = pickNum === currentPickNum && draft.phase !== 'complete';

                  return (
                    <td
                      key={colIdx}
                      className={`px-1.5 py-1 ${
                        isCurrent ? 'rounded bg-blue-100 dark:bg-blue-900/30' : ''
                      }`}
                    >
                      {pick ? (
                        <span
                          className={`block max-w-[100px] truncate ${
                            pick.autoSelected
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-gray-900 dark:text-zinc-100'
                          }`}
                          title={pick.team + (pick.autoSelected ? ' (auto)' : '')}
                        >
                          {pick.team}
                        </span>
                      ) : isCurrent ? (
                        <span className="text-blue-600 dark:text-blue-400">…</span>
                      ) : (
                        <span className="text-gray-300 dark:text-zinc-600">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
