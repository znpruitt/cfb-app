'use client';

import React from 'react';
import type { DraftState } from '@/lib/draft';

type DraftBoardGridProps = {
  draft: DraftState;
  /** Optional map of lowercase teamId → hex color for completed-cell left bar. */
  teamColorMap?: Record<string, string>;
  /** Optional map of lowercase teamId → abbreviated display name. */
  teamShortNameMap?: Record<string, string>;
};

const ROUND_COL_WIDTH = 90;

export default function DraftBoardGrid({ draft, teamColorMap, teamShortNameMap }: DraftBoardGridProps): React.ReactElement {
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
  function colBg(roundIdx: number): string | undefined {
    if (roundIdx === activeRound && !isComplete) return 'rgba(37,99,235,0.06)';
    // Even-numbered rounds (R2, R4, …) get subtle alternating tint
    if ((roundIdx + 1) % 2 === 0) return 'rgba(255,255,255,0.02)';
    return undefined;
  }

  // Shared sticky styles for the owner column (header + body cells)
  const stickyBase: React.CSSProperties = {
    position: 'sticky',
    left: 0,
    zIndex: 10,
    borderRight: '0.5px solid #374151',
    whiteSpace: 'nowrap',
    padding: '4px 8px 4px 0',
  };

  return (
    <div style={{ minWidth: 0 }}>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {/* Owner column header — empty, auto-sized to longest name */}
            <th className="bg-white dark:bg-zinc-900" style={stickyBase} />
            {Array.from({ length: totalRounds }, (_, roundIdx) => {
              const isActive = roundIdx === activeRound && !isComplete;
              const bg = colBg(roundIdx);
              return (
                <th
                  key={roundIdx}
                  style={{
                    width: ROUND_COL_WIDTH,
                    minWidth: ROUND_COL_WIDTH,
                    maxWidth: ROUND_COL_WIDTH,
                    fontSize: 10,
                    textAlign: 'center',
                    color: isActive ? '#60a5fa' : '#6b7280',
                    padding: '4px 6px',
                    backgroundColor: bg,
                  }}
                >
                  {isActive ? '▸ ' : ''}R{roundIdx + 1}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {draftOrder.map((owner, ownerIdx) => (
            <tr key={owner} style={{ borderBottom: '0.5px solid #1a2233' }}>
              {/* Sticky owner name cell — column auto-sizes to longest name */}
              <td
                className="bg-white dark:bg-zinc-900"
                style={{
                  ...stickyBase,
                  fontSize: 11,
                  fontWeight: 500,
                  color: '#9ca3af',
                }}
              >
                <div
                  style={{ maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={owner}
                >
                  {owner}
                </div>
              </td>
              {Array.from({ length: totalRounds }, (_, roundIdx) => {
                const isEvenRound = roundIdx % 2 === 0;
                const posInRound = isEvenRound ? ownerIdx : n - 1 - ownerIdx;
                const globalIdx = roundIdx * n + posInRound;
                const pickNum = globalIdx + 1;
                const pick = pickByNumber.get(pickNum);
                const isCurrent = pickNum === currentPickNum && !isComplete;
                const isOnDeck = pickNum === onDeckPickNum && !isComplete;

                const teamLower = pick?.team.toLowerCase() ?? '';
                const completedColor =
                  pick && teamColorMap ? teamColorMap[teamLower] ?? null : null;
                const displayName =
                  pick && teamShortNameMap ? teamShortNameMap[teamLower] ?? pick.team : pick?.team ?? '';

                // Build cell style: fixed column width + state-dependent bg
                const bg = colBg(roundIdx);
                const cellStyle: React.CSSProperties = {
                  width: ROUND_COL_WIDTH,
                  minWidth: ROUND_COL_WIDTH,
                  maxWidth: ROUND_COL_WIDTH,
                  padding: '4px 6px',
                  fontSize: 11,
                };

                if (isCurrent) {
                  cellStyle.backgroundColor = '#2563eb';
                  cellStyle.borderRadius = 4;
                } else if (isOnDeck) {
                  cellStyle.backgroundColor = 'rgba(37,99,235,0.25)';
                  cellStyle.borderRadius = 4;
                } else {
                  if (bg) cellStyle.backgroundColor = bg;
                  if (completedColor) {
                    cellStyle.boxShadow = `inset 3px 0 0 0 ${completedColor}`;
                  }
                }

                return (
                  <td key={roundIdx} style={cellStyle}>
                    {pick ? (
                      <span
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: isCurrent
                            ? '#ffffff'
                            : isOnDeck
                              ? '#93c5fd'
                              : pick.autoSelected
                                ? '#fbbf24'
                                : '#e5e7eb',
                        }}
                        title={pick.team + (pick.autoSelected ? ' (auto)' : '')}
                      >
                        {displayName}
                      </span>
                    ) : isCurrent ? (
                      <span style={{ color: '#ffffff' }}>…</span>
                    ) : (
                      <span style={{ color: '#1f2937' }}>—</span>
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
