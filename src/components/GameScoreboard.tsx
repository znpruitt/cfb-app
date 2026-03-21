import React from 'react';

import { gameStateFromScore } from '../lib/gameUi';
import type { TeamRankingEnrichment } from '../lib/rankings';
import type { ScorePack } from '../lib/scores';
import RankedTeamName from './RankedTeamName';

type TeamRow = {
  key: 'away' | 'home';
  label: string;
  score: number | null;
  ranking?: TeamRankingEnrichment;
};

type GameScoreboardProps = {
  score: ScorePack;
  awayRanking?: TeamRankingEnrichment;
  homeRanking?: TeamRankingEnrichment;
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
    'flex items-start justify-between gap-3 rounded-md px-3 py-1.5',
    isLeading
      ? 'border border-gray-200/80 font-semibold text-gray-950 dark:border-zinc-700 dark:text-zinc-50'
      : 'border border-transparent text-gray-800 dark:text-zinc-200',
  ].join(' ');
}

export default function GameScoreboard({
  score,
  awayRanking,
  homeRanking,
}: GameScoreboardProps): React.ReactElement {
  const rows: TeamRow[] = [
    { key: 'away', label: score.away.team, score: score.away.score, ranking: awayRanking },
    { key: 'home', label: score.home.team, score: score.home.score, ranking: homeRanking },
  ];

  return (
    <div className="space-y-3" aria-label="Game scoreboard">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-zinc-400">
        {formatScoreStatus(score.status)}
      </div>
      <div className="space-y-1">
        {rows.map((team, index) => {
          const opponentScore = rows[index === 0 ? 1 : 0]?.score ?? null;

          return (
            <div
              key={team.key}
              className={scoreboardRowClasses(team.score, opponentScore)}
              data-scoreboard-row={team.key}
            >
              <RankedTeamName
                teamName={team.label}
                ranking={team.ranking}
                className="min-w-0 flex-1 whitespace-normal break-words pr-3 leading-snug"
              />
              <span
                className="min-w-[3ch] shrink-0 pt-0.5 text-right font-mono text-xl font-semibold tabular-nums"
                data-scoreboard-score={team.key}
              >
                {team.score ?? '—'}
              </span>
            </div>
          );
        })}
      </div>
      <span className="sr-only">
        {score.away.team} {score.away.score ?? '—'} at {score.home.team} {score.home.score ?? '—'} (
        {score.status})
      </span>
    </div>
  );
}
