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
        'relative flex items-stretch overflow-hidden rounded-lg border bg-white text-sm dark:bg-slate-900',
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
      {/* Left color bar — flush to card edge, full card height */}
      <span
        className="w-1 shrink-0"
        style={{ backgroundColor: barColor }}
      />

      {/* Name + conference */}
      <div className="min-w-0 px-2.5 py-1.5">
        <p className="truncate font-semibold text-slate-900 dark:text-slate-100">{teamName}</p>
        {conference && (
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{conference}</p>
        )}
      </div>
    </div>
  );
}
