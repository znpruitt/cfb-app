'use client';

import React from 'react';
import type { DraftState } from '@/lib/draft';

type DraftBoardGridProps = {
  draft: DraftState;
  /** Optional map of lowercase teamId → hex color for completed-cell left bar. */
  teamColorMap?: Record<string, string>;
};

export default function DraftBoardGrid({ draft, teamColorMap }: DraftBoardGridProps): React.ReactElement {
  const { draftOrder, totalRounds } = draft.settings;
  const n = draftOrder.length;

  // Index picks by pick number for quick lookup
  const pickByNumber = new Map<number, { team: string; autoSelected: boolean }>();
  for (const pick of draft.picks) {
    pickByNumber.set(pick.pickNumber, { team: pick.team, autoSelected: pick.autoSelected });
  }

  const currentPickNum = draft.currentPickIndex + 1;
  const onDeckPickNum = draft.currentPickIndex + 2;
  const activeRound = Math.floor(draft.currentPickIndex / n); // 0-based
  const isComplete = draft.phase === 'complete';

  /** Column background tint for alternating shading + active round highlight. */
  function colBg(roundIdx: number): React.CSSProperties | undefined {
    if (roundIdx === activeRound && !isComplete) {
      return { backgroundColor: 'rgba(37,99,235,0.06)' };
    }
    // Even-numbered rounds (R2, R4, …) get subtle alternating tint
    if ((roundIdx + 1) % 2 === 0) {
      return { backgroundColor: 'rgba(255,255,255,0.02)' };
    }
    return undefined;
  }

  return (
    <div className="max-w-full overflow-x-auto" style={{ scrollbarGutter: 'stable both-edges' }}>
      <table className="min-w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            {/* Owner column header (empty — names are in body rows) */}
            <th className="sticky left-0 z-10 border-r border-gray-200 bg-white py-1 pr-3 text-left dark:border-zinc-700 dark:bg-zinc-900" />
            {Array.from({ length: totalRounds }, (_, roundIdx) => {
              const isActive = roundIdx === activeRound && !isComplete;
              return (
                <th
                  key={roundIdx}
                  className={`px-1.5 py-1 text-center font-medium ${
                    isActive ? 'text-blue-400' : 'text-gray-400 dark:text-zinc-500'
                  }`}
                  style={colBg(roundIdx)}
                >
                  {isActive && <span className="mr-0.5">▸</span>}R{roundIdx + 1}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {draftOrder.map((owner, ownerIdx) => (
            <tr key={owner} className="border-t border-gray-100 dark:border-zinc-800">
              {/* Sticky owner name cell */}
              <td className="sticky left-0 z-10 border-r border-gray-200 bg-white py-1 pr-3 font-semibold text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                {owner}
              </td>
              {Array.from({ length: totalRounds }, (_, roundIdx) => {
                const isEvenRound = roundIdx % 2 === 0;
                const posInRound = isEvenRound ? ownerIdx : n - 1 - ownerIdx;
                const globalIdx = roundIdx * n + posInRound;
                const pickNum = globalIdx + 1;
                const pick = pickByNumber.get(pickNum);
                const isCurrent = pickNum === currentPickNum && !isComplete;
                const isOnDeck = pickNum === onDeckPickNum && !isComplete;

                const completedColor =
                  pick && teamColorMap ? teamColorMap[pick.team.toLowerCase()] ?? null : null;

                // Build cell style: column tint + optional team color bar
                const cellStyle: React.CSSProperties = {};
                if (!isCurrent && !isOnDeck) {
                  const bg = colBg(roundIdx);
                  if (bg) Object.assign(cellStyle, bg);
                  if (completedColor) {
                    cellStyle.boxShadow = `inset 3px 0 0 0 ${completedColor}`;
                  }
                }

                return (
                  <td
                    key={roundIdx}
                    className={`px-1.5 py-1 ${
                      isCurrent
                        ? 'rounded bg-blue-600'
                        : isOnDeck
                          ? 'rounded bg-blue-100 dark:bg-blue-900/30'
                          : ''
                    }`}
                    style={Object.keys(cellStyle).length > 0 ? cellStyle : undefined}
                  >
                    {pick ? (
                      <span
                        className={`block max-w-[100px] truncate ${
                          isCurrent
                            ? 'text-white'
                            : pick.autoSelected
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-gray-900 dark:text-zinc-100'
                        }`}
                        title={pick.team + (pick.autoSelected ? ' (auto)' : '')}
                      >
                        {pick.team}
                      </span>
                    ) : isCurrent ? (
                      <span className="text-white">…</span>
                    ) : (
                      <span className="text-[10px] text-gray-200 dark:text-zinc-700">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
