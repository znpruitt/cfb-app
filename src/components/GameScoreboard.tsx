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
  conference?: string | null;
  owner?: string;
};

type VenueDetails = {
  stadium?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
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
  venue?: VenueDetails | string | null;
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

function scoreboardRowClasses(teamScore: number | null, opponentScore: number | null): string {
  const hasScores = teamScore != null && opponentScore != null;
  const isLeading = hasScores && teamScore > opponentScore;

  return [
    'flex items-start justify-between gap-4 border-l-2 py-2 pl-3 first:pt-0 last:pb-0',
    isLeading
      ? 'border-l-emerald-600 text-gray-950 dark:border-l-emerald-400 dark:text-zinc-50'
      : 'border-l-transparent text-gray-800 dark:text-zinc-200',
  ].join(' ');
}

function formatMoneyline(value: number | null): string | null {
  if (value == null) return null;
  return value > 0 ? `+${value}` : `${value}`;
}

function cleanVenuePart(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function formatVenueLabel(venue: VenueDetails | string | null | undefined): string | null {
  if (!venue) return null;
  if (typeof venue === 'string') return cleanVenuePart(venue);

  const stadium = cleanVenuePart(venue.stadium);
  const city = cleanVenuePart(venue.city);
  const state = cleanVenuePart(venue.state);
  const country = cleanVenuePart(venue.country);

  const stateOrCountry = state ?? country;
  const location = city ? [city, stateOrCountry].filter(Boolean).join(', ') : null;

  if (stadium && location) return `${stadium} • ${location}`;
  if (stadium) return stadium;
  return location;
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
  venue,
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
    },
    {
      key: 'home',
      label: homeTeam,
      score: score?.home.score ?? null,
      ranking: homeRanking,
      conference: homeConference,
      owner: homeOwner,
    },
  ];

  const oddsSummary = buildOddsSummary({ odds, awayTeam, homeTeam });
  const venueLabel = formatVenueLabel(venue);
  const statusText = score
    ? formatScoreStatus(score.status)
    : isPlaceholder
      ? 'PENDING MATCHUP'
      : 'NO SCORE';

  return (
    <div className="space-y-2" aria-label="Game scoreboard">
      <div className="flex justify-end">
        <div
          className="shrink-0 text-right text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-zinc-500"
          data-scoreboard-status
        >
          {statusText}
        </div>
      </div>

      <div className="px-1 py-0.5">
        {rows.map((team, index) => {
          const opponentScore = rows[index === 0 ? 1 : 0]?.score ?? null;
          const teamContext = buildTeamContext(team.conference, team.owner);

          return (
            <div
              key={team.key}
              className={`${scoreboardRowClasses(team.score, opponentScore)} ${index === 0 ? 'border-b border-gray-200/60 dark:border-zinc-800/80' : ''}`}
              data-scoreboard-row={team.key}
              data-scoreboard-winner={
                team.score != null && opponentScore != null && team.score > opponentScore
              }
            >
              <div className="min-w-0 flex-1 pr-3">
                <RankedTeamName
                  teamName={getTeamDisplayLabel(team.label, 'scoreboard')}
                  ranking={team.ranking}
                  className="whitespace-normal break-words text-lg leading-snug sm:text-[1.45rem]"
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
                  team.score != null && opponentScore != null && team.score > opponentScore
                    ? 'font-extrabold text-emerald-700 dark:text-emerald-300'
                    : 'font-semibold text-gray-800 dark:text-zinc-200'
                }`}
                data-scoreboard-score={team.key}
              >
                {team.score ?? '—'}
              </span>
            </div>
          );
        })}
      </div>

      {venueLabel && (
        <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-zinc-500">
          <span aria-hidden="true">📍</span>
          <span className="min-w-0 truncate">{venueLabel}</span>
        </div>
      )}

      {oddsSummary && (
        <div className="border-t border-gray-200/60 pt-2 text-sm text-gray-500 dark:border-zinc-800/80 dark:text-zinc-400">
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
