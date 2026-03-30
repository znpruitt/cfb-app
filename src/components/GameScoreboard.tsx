import React from 'react';

import { deriveScoreOutcomePresentation } from '../lib/gameCardPresentation';
import { gameStateFromScore } from '../lib/gameUi';
import type { CombinedOdds } from '../lib/odds';
import type { TeamRankingEnrichment } from '../lib/rankings';
import type { ScorePack } from '../lib/scores';
import type { ScoreboardTeamColorTreatment } from '../lib/teamColors';
import { getSafeScoreboardTeamColor } from '../lib/teamColors';
import { getTeamDisplayLabel, type TeamDisplayInfo } from '../lib/teamIdentity';
import RankedTeamName from './RankedTeamName';

type TeamRow = {
  key: 'away' | 'home';
  label: TeamDisplayInfo;
  score: number | null;
  ranking?: TeamRankingEnrichment;
  conference?: string | null;
  owner?: string;
  colorTreatment?: ScoreboardTeamColorTreatment;
};

type GameScoreboardProps = {
  score?: ScorePack;
  awayTeam: TeamDisplayInfo;
  homeTeam: TeamDisplayInfo;
  awayRanking?: TeamRankingEnrichment;
  homeRanking?: TeamRankingEnrichment;
  homeConference?: string | null;
  awayConference?: string | null;
  homeOwner?: string;
  awayOwner?: string;
  awayColorTreatment?: ScoreboardTeamColorTreatment;
  homeColorTreatment?: ScoreboardTeamColorTreatment;
  odds?: CombinedOdds;
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

function scoreboardStatusChipClasses(score: ScorePack | undefined, isPlaceholder: boolean): string {
  if (isPlaceholder && !score) {
    return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200';
  }
  if (!score) {
    return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200';
  }

  const trimmed = score.status.trim();
  if (/\b(postponed|canceled|cancelled|suspended|delayed)\b/i.test(trimmed)) {
    return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200';
  }

  const state = gameStateFromScore(score);
  if (state === 'final') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200';
  }
  if (state === 'inprogress') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200';
  }

  return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200';
}

function scoreboardRowClasses(isLeading: boolean): string {
  return [
    'flex items-start justify-between gap-4 py-1.5 pl-3 first:pt-0 last:pb-0',
    isLeading
      ? 'border-l-[3px] text-gray-950 dark:text-zinc-50'
      : 'border-l-2 text-gray-800 dark:text-zinc-200',
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
    segments.push(`Over/Under: ${odds.total}`);
  }

  const awayMoneyline = formatMoneyline(odds.mlAway);
  const homeMoneyline = formatMoneyline(odds.mlHome);
  if (awayMoneyline || homeMoneyline) {
    const moneylineParts = [
      awayMoneyline ? `${getTeamDisplayLabel(awayTeam, 'short')} ${awayMoneyline}` : null,
      homeMoneyline ? `${getTeamDisplayLabel(homeTeam, 'short')} ${homeMoneyline}` : null,
    ].filter(Boolean);

    if (moneylineParts.length) {
      segments.push(`Moneyline: ${moneylineParts.join(' • ')}`);
    }
  }

  return segments.length ? segments.join(' • ') : null;
}

function buildTeamContext(conference?: string | null, owner?: string): string | null {
  const parts = [conference?.trim(), owner?.trim()].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export default function GameScoreboard({
  score,
  awayTeam,
  homeTeam,
  awayRanking,
  homeRanking,
  homeConference,
  awayConference,
  homeOwner,
  awayOwner,
  awayColorTreatment,
  homeColorTreatment,
  odds,
  isPlaceholder = false,
}: GameScoreboardProps): React.ReactElement {
  const rows: TeamRow[] = [
    {
      key: 'away',
      label: awayTeam,
      score: score?.away.score ?? null,
      ranking: awayRanking,
      conference: awayConference,
      owner: awayOwner,
      colorTreatment: awayColorTreatment ?? getSafeScoreboardTeamColor(null),
    },
    {
      key: 'home',
      label: homeTeam,
      score: score?.home.score ?? null,
      ranking: homeRanking,
      conference: homeConference,
      owner: homeOwner,
      colorTreatment: homeColorTreatment ?? getSafeScoreboardTeamColor(null),
    },
  ];

  const oddsSummary = buildOddsSummary({ odds, awayTeam, homeTeam });
  const statusText = score
    ? formatScoreStatus(score.status)
    : isPlaceholder
      ? 'PENDING MATCHUP'
      : 'NO SCORE';
  const statusChipClasses = scoreboardStatusChipClasses(score, isPlaceholder);
  const outcomePresentation = deriveScoreOutcomePresentation(score);

  return (
    <div className="space-y-2" aria-label="Game scoreboard">
      <div className="flex justify-end">
        <div
          className={`shrink-0 rounded-full border px-2 py-1 text-right text-[11px] font-semibold uppercase tracking-[0.18em] ${statusChipClasses}`}
          data-scoreboard-status
        >
          {statusText}
        </div>
      </div>

      <div className="px-1">
        {rows.map((team, index) => {
          const teamContext = buildTeamContext(team.conference, team.owner);
          const isWinner =
            outcomePresentation.shouldEmphasize && outcomePresentation.winner === team.key;
          const rowStyle = {
            borderLeftColor: isWinner
              ? team.colorTreatment?.winnerAccentColor
              : team.colorTreatment?.rowAccentColor,
          } satisfies React.CSSProperties;
          const scoreStyle = isWinner
            ? ({ color: team.colorTreatment?.winnerScoreColor } satisfies React.CSSProperties)
            : undefined;

          return (
            <div
              key={team.key}
              className={`${scoreboardRowClasses(isWinner)} ${index === 0 ? 'border-b border-gray-200/40 dark:border-zinc-800/60' : ''}`}
              style={rowStyle}
              data-scoreboard-row={team.key}
              data-scoreboard-winner={isWinner}
              data-scoreboard-outcome-emphasis={outcomePresentation.shouldEmphasize}
              data-scoreboard-accent-source={team.colorTreatment?.source ?? 'fallback'}
            >
              <div className="min-w-0 flex-1 pr-3">
                <RankedTeamName
                  teamName={getTeamDisplayLabel(team.label, 'scoreboard')}
                  ranking={team.ranking}
                  className="whitespace-normal break-words text-lg leading-tight sm:text-[1.45rem]"
                />
                {teamContext && (
                  <div
                    className="mt-0.5 text-xs leading-snug text-gray-500 dark:text-zinc-400"
                    data-scoreboard-team-context={team.key}
                  >
                    {teamContext}
                  </div>
                )}
              </div>
              <span
                className={`min-w-[3ch] shrink-0 text-right font-mono text-[2.2rem] leading-none tabular-nums sm:text-[2.55rem] ${
                  isWinner ? 'font-extrabold' : 'font-semibold text-gray-800 dark:text-zinc-200'
                }`}
                style={scoreStyle}
                data-scoreboard-score={team.key}
              >
                {team.score ?? '—'}
              </span>
            </div>
          );
        })}
      </div>

      {oddsSummary && (
        <div className="border-t border-gray-200/60 pt-1.5 text-sm text-gray-500 dark:border-zinc-800/80 dark:text-zinc-400">
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
