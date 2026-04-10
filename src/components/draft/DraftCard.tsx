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
  const dotColor = teamColor ?? '#94a3b8'; // slate-400 fallback

  return (
    <div
      className={[
        'relative flex items-center gap-2.5 rounded-lg border bg-white px-3 py-2 text-sm dark:bg-slate-900',
        isDrafted
          ? 'border-slate-200 opacity-40 dark:border-slate-700'
          : 'border-slate-200 dark:border-slate-700',
        isClickable
          ? 'cursor-pointer transition-shadow hover:ring-2 hover:ring-slate-400 dark:hover:ring-slate-500'
          : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={isClickable ? onSelect : undefined}
    >
      {/* Team color dot */}
      <span
        className="h-3 w-3 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
      />

      {/* Name + conference */}
      <div className="min-w-0">
        <p className="truncate font-semibold text-slate-900 dark:text-slate-100">{teamName}</p>
        {conference && (
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{conference}</p>
        )}
      </div>
    </div>
  );
}
