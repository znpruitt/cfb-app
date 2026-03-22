import React from 'react';

import { gameStateFromScore } from '../lib/gameUi';
import type { CombinedOdds } from '../lib/odds';
import type { TeamRankingEnrichment } from '../lib/rankings';
import type { ScorePack } from '../lib/scores';
import { getTeamDisplayLabel, type TeamDisplayInfo } from '../lib/teamIdentity';
import RankedTeamName from './RankedTeamName';

type TeamRow = {
  key: 'away' | 'home';
  label: TeamDisplayInfo;
  score: number | null;
  ranking?: TeamRankingEnrichment;
};

type GameScoreboardProps = {
  score?: ScorePack;
  awayTeam: TeamDisplayInfo;
  homeTeam: TeamDisplayInfo;
  awayRanking?: TeamRankingEnrichment;
  homeRanking?: TeamRankingEnrichment;
  kickoffLabel: string;
  matchupLabel: string;
  homeConference?: string | null;
  awayConference?: string | null;
  homeOwner?: string;
  awayOwner?: string;
  venue?: string | null;
  odds?: CombinedOdds;
  neutralSite?: boolean;
  isPlaceholder?: boolean;
};

function formatScoreStatus(status: string): string {
  const trimmed = status.trim();
  if (!trimmed) return 'STATUS UNKNOWN';
  if (/\b(postponed|canceled|cancelled|suspended|delayed)\b/i.test(trimmed)) return trimmed;
  const state = gameStateFromScore({
    status: trimmed,
    away: { team: '', score: null },
    home: { team: '', score: null },
    time: null,
  });
  if (state === 'final') return 'FINAL';
  if (state === 'scheduled') return trimmed;
  return trimmed.toUpperCase();
}

function scoreboardRowClasses(teamScore: number | null, opponentScore: number | null): string {
  const hasScores = teamScore != null && opponentScore != null;
  const isLeading = hasScores && teamScore > opponentScore;

  return [
    'flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0',
    isLeading
      ? 'font-semibold text-gray-950 dark:text-zinc-50'
      : 'text-gray-800 dark:text-zinc-200',
  ].join(' ');
}

function formatMoneyline(value: number | null): string | null {
  if (value == null) return null;
  return value > 0 ? `+${value}` : `${value}`;
}

function buildOddsSummary(params: {
  odds?: CombinedOdds;
  awayTeam: TeamDisplayInfo;
  homeTeam: TeamDisplayInfo;
}): string | null {
  const { odds, awayTeam, homeTeam } = params;
  if (!odds) return null;

  const segments: string[] = [];

  if (odds.favorite && odds.spread != null) {
    segments.push(`Spread: ${odds.favorite} ${odds.spread}`);
  } else if (odds.spread != null) {
    segments.push(`Spread: ${odds.spread}`);
  }

  if (odds.total != null) {
    segments.push(`O/U: ${odds.total}`);
  }

  const awayMoneyline = formatMoneyline(odds.mlAway);
  const homeMoneyline = formatMoneyline(odds.mlHome);
  if (awayMoneyline || homeMoneyline) {
    const moneylineParts = [
      awayMoneyline ? `${getTeamDisplayLabel(awayTeam, 'short')} ${awayMoneyline}` : null,
      homeMoneyline ? `${getTeamDisplayLabel(homeTeam, 'short')} ${homeMoneyline}` : null,
    ].filter(Boolean);

    if (moneylineParts.length) {
      segments.push(`ML: ${moneylineParts.join(' • ')}`);
    }
  }

  return segments.length ? segments.join(' • ') : null;
}

export default function GameScoreboard({
  score,
  awayTeam,
  homeTeam,
  awayRanking,
  homeRanking,
  kickoffLabel,
  matchupLabel,
  homeConference,
  awayConference,
  homeOwner,
  awayOwner,
  venue,
  odds,
  neutralSite = false,
  isPlaceholder = false,
}: GameScoreboardProps): React.ReactElement {
  const rows: TeamRow[] = [
    { key: 'away', label: awayTeam, score: score?.away.score ?? null, ranking: awayRanking },
    { key: 'home', label: homeTeam, score: score?.home.score ?? null, ranking: homeRanking },
  ];

  const metadataPills = [
    neutralSite ? 'Neutral Site' : null,
    awayConference || null,
    homeConference || null,
    awayOwner ? `${awayOwner}` : null,
    homeOwner ? `${homeOwner}` : null,
  ].filter(Boolean) as string[];

  const oddsSummary = buildOddsSummary({ odds, awayTeam, homeTeam });
  const statusText = score
    ? formatScoreStatus(score.status)
    : isPlaceholder
      ? 'PENDING MATCHUP'
      : 'NO SCORE';

  return (
    <div className="space-y-2.5" aria-label="Game scoreboard">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="text-base font-semibold leading-tight text-gray-950 dark:text-zinc-50 sm:text-lg">
            {matchupLabel}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 dark:text-zinc-500">
            <span>{kickoffLabel}</span>
            {metadataPills.map((pill) => (
              <span
                key={pill}
                className="rounded-full border border-gray-300/50 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:border-zinc-700/70 dark:text-zinc-400"
              >
                {pill}
              </span>
            ))}
          </div>
        </div>
        <div className="shrink-0 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-zinc-500">
          {statusText}
        </div>
      </div>

      <div className="px-1 py-0.5">
        {rows.map((team, index) => {
          const opponentScore = rows[index === 0 ? 1 : 0]?.score ?? null;

          return (
            <div
              key={team.key}
              className={`${scoreboardRowClasses(team.score, opponentScore)} ${index === 0 ? 'border-b border-gray-200/60 dark:border-zinc-800/80' : ''}`}
              data-scoreboard-row={team.key}
            >
              <RankedTeamName
                teamName={getTeamDisplayLabel(team.label, 'scoreboard')}
                ranking={team.ranking}
                className="min-w-0 flex-1 whitespace-normal break-words pr-3 text-lg leading-snug sm:text-[1.45rem]"
              />
              <span
                className="min-w-[3ch] shrink-0 text-right font-mono text-[2.2rem] font-semibold leading-none tabular-nums sm:text-[2.55rem]"
                data-scoreboard-score={team.key}
              >
                {team.score ?? '—'}
              </span>
            </div>
          );
        })}
      </div>

      {venue && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-zinc-500">
          <span aria-hidden="true">📍</span>
          <span className="truncate">{venue}</span>
        </div>
      )}

      {oddsSummary && (
        <div className="border-t border-gray-200/60 pt-2 text-sm text-gray-600 dark:border-zinc-800/80 dark:text-zinc-400">
          {oddsSummary}
        </div>
      )}

      <span className="sr-only">
        {getTeamDisplayLabel(awayTeam)} {score?.away.score ?? '—'} at{' '}
        {getTeamDisplayLabel(homeTeam)} {score?.home.score ?? '—'} ({score?.status ?? statusText})
      </span>
    </div>
  );
}
