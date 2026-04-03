'use client';

import React from 'react';

import type { DraftTeamInsights, SpTier, SosTier } from '@/lib/selectors/draftTeamInsights';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DraftCardProps = {
  insights: DraftTeamInsights;
  isDrafted: boolean;
  onSelect?: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SpTierBadge({ tier }: { tier: SpTier }) {
  const labels: Record<SpTier, string> = {
    Elite: 'Elite',
    Strong: 'Strong',
    Average: 'Average',
    Weak: 'Weak',
  };
  return (
    <span className="inline-block rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
      {labels[tier]}
    </span>
  );
}

function SosBadge({ tier }: { tier: SosTier }) {
  const labels: Record<SosTier, string> = {
    Hard: 'Hard SOS',
    Medium: 'Medium SOS',
    Easy: 'Easy SOS',
  };
  return (
    <span className="inline-block rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
      {labels[tier]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DraftCard({ insights, isDrafted, onSelect }: DraftCardProps) {
  const {
    teamName,
    conference,
    spRating,
    spTier,
    winTotalLow,
    winTotalHigh,
    lastSeasonRecord,
    preseasonRank,
    sosTier,
    homeGames,
    awayGames,
    rankedOpponentCount,
    awaitingRatings,
  } = insights;

  const isClickable = !!onSelect && !isDrafted;

  return (
    <div
      className={[
        'relative rounded-lg border bg-white p-3 text-sm dark:bg-slate-900',
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
      {/* Drafted overlay */}
      {isDrafted && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg">
          <span className="rounded bg-slate-800/80 px-2 py-1 text-xs font-semibold text-white dark:bg-slate-200/80 dark:text-slate-900">
            Drafted
          </span>
        </div>
      )}

      {/* Header row: name + SP+ tier or awaiting */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900 dark:text-slate-100">{teamName}</p>
          {conference && (
            <p className="truncate text-xs text-slate-500 dark:text-slate-400">{conference}</p>
          )}
        </div>
        <div className="shrink-0">
          {awaitingRatings ? (
            <span className="text-xs text-slate-400 dark:text-slate-500">Ratings pending</span>
          ) : spTier ? (
            <SpTierBadge tier={spTier} />
          ) : null}
        </div>
      </div>

      {/* Divider */}
      <div className="my-2 border-t border-slate-100 dark:border-slate-800" />

      {/* Data rows */}
      <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-xs">
        {/* SP+ rating */}
        {spRating !== null && (
          <div>
            <span className="text-slate-500 dark:text-slate-400">SP+</span>
            <span className="ml-1 font-medium text-slate-800 dark:text-slate-200">
              {spRating.toFixed(1)}
            </span>
          </div>
        )}

        {/* Preseason rank */}
        {preseasonRank !== null && (
          <div>
            <span className="text-slate-500 dark:text-slate-400">Rank</span>
            <span className="ml-1 font-medium text-slate-800 dark:text-slate-200">
              #{preseasonRank}
            </span>
          </div>
        )}

        {/* Win total */}
        {winTotalLow !== null && winTotalHigh !== null && (
          <div>
            <span className="text-slate-500 dark:text-slate-400">O/U</span>
            <span className="ml-1 font-medium text-slate-800 dark:text-slate-200">
              {winTotalLow}–{winTotalHigh}
            </span>
          </div>
        )}

        {/* Last season record */}
        {lastSeasonRecord !== null && (
          <div>
            <span className="text-slate-500 dark:text-slate-400">Last</span>
            <span className="ml-1 font-medium text-slate-800 dark:text-slate-200">
              {lastSeasonRecord.wins}–{lastSeasonRecord.losses}
            </span>
          </div>
        )}

        {/* SOS tier */}
        {sosTier !== null && (
          <div className="col-span-1">
            <SosBadge tier={sosTier} />
          </div>
        )}

        {/* Home/Away split */}
        {(homeGames > 0 || awayGames > 0) && (
          <div>
            <span className="text-slate-500 dark:text-slate-400">H/A</span>
            <span className="ml-1 font-medium text-slate-800 dark:text-slate-200">
              {homeGames}/{awayGames}
            </span>
          </div>
        )}

        {/* Ranked opponents */}
        {rankedOpponentCount > 0 && (
          <div>
            <span className="text-slate-500 dark:text-slate-400">Ranked opp</span>
            <span className="ml-1 font-medium text-slate-800 dark:text-slate-200">
              {rankedOpponentCount}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
