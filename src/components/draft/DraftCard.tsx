'use client';

import React from 'react';

import type { DraftTeamInsights } from '@/lib/selectors/draftTeamInsights';

type DraftCardProps = {
  insights: DraftTeamInsights;
  isDrafted: boolean;
  onSelect?: () => void;
};

export default function DraftCard({ insights, isDrafted, onSelect }: DraftCardProps) {
  const { teamName, conference, teamColor } = insights;
  const isClickable = !!onSelect && !isDrafted;
  const barColor = teamColor ?? '#94a3b8'; // slate-400 fallback

  return (
    <div
      className={[
        'relative flex items-stretch overflow-hidden rounded-lg border bg-white text-sm dark:bg-zinc-800',
        isDrafted
          ? 'border-gray-200 opacity-40 dark:border-zinc-700'
          : 'border-gray-200 dark:border-zinc-700',
        isClickable
          ? 'cursor-pointer transition-shadow hover:ring-2 hover:ring-gray-400 dark:hover:ring-zinc-500'
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={isClickable ? onSelect : undefined}
    >
      {/* Left color bar — flush to card edge, full card height */}
      <span
        className="w-1 shrink-0"
        style={{ backgroundColor: barColor }}
      />

      {/* Name + conference */}
      <div className="min-w-0 px-2.5 py-1.5">
        <p className="truncate font-semibold text-gray-900 dark:text-zinc-100">{teamName}</p>
        {conference && (
          <p className="truncate text-xs text-gray-500 dark:text-zinc-400">{conference}</p>
        )}
      </div>
    </div>
  );
}
