import React from 'react';

import type { CombinedOdds } from '../lib/odds';
import { gameStateFromScore, pillClass, statusClasses } from '../lib/gameUi';
import {
  deriveOwnerWeekSlates,
  deriveWeekMatchupSections,
  type OwnerSlateGame,
  type OwnerWeekSlate,
  type WeekMatchupSections,
} from '../lib/matchups';
import type { ScorePack } from '../lib/scores';
import type { AppGame } from '../lib/schedule';
import { getPresentationTimeZone } from '../lib/weekPresentation';

type MatchupsWeekPanelProps = {
  games: AppGame[];
  oddsByKey: Record<string, CombinedOdds>;
  scoresByKey: Record<string, ScorePack>;
  rosterByTeam: Map<string, string>;
  displayTimeZone?: string;
  sections?: WeekMatchupSections;
};

function formatKickoff(date: string | null, timeZone: string): string {
  if (!date) return 'TBD';
  const kickoff = new Date(date);
  if (Number.isNaN(kickoff.getTime())) return 'TBD';
  return kickoff.toLocaleString(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function performanceClasses(tone: 'scheduled' | 'inprogress' | 'final' | 'neutral'): string {
  if (tone === 'final') {
    return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
  }
  if (tone === 'inprogress') {
    return 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  }
  if (tone === 'neutral') {
    return 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200';
  }
  return 'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300';
}

function formatGameStatus(score?: ScorePack): string {
  const state = gameStateFromScore(score);
  if (state === 'final') return 'Final';
  if (state === 'inprogress') return score?.status ?? 'In Progress';
  if (state === 'scheduled') return score?.status ?? 'Scheduled';
  return 'No live data';
}

function formatOwnedScore(
  slateGame: OwnerSlateGame,
  score?: ScorePack
): { summary: string; tone: 'scheduled' | 'inprogress' | 'final' | 'neutral' } {
  const rawState = gameStateFromScore(score);
  const state = rawState === 'unknown' ? 'scheduled' : rawState;
  if (!score) {
    return { summary: 'No score yet', tone: 'scheduled' };
  }

  const ownerScore = slateGame.ownerTeamSide === 'away' ? score.away.score : score.home.score;
  const opponentScore = slateGame.ownerTeamSide === 'away' ? score.home.score : score.away.score;

  if (ownerScore == null || opponentScore == null || state === 'scheduled') {
    return { summary: formatGameStatus(score), tone: state };
  }

  const base = `${ownerScore}-${opponentScore}`;
  if (ownerScore === opponentScore) {
    return { summary: state === 'final' ? `Tied ${base}` : `Tied ${base}`, tone: 'neutral' };
  }

  const verdict = ownerScore > opponentScore ? 'Leading' : 'Trailing';
  const prefix = state === 'final' ? 'Final' : verdict;
  return { summary: `${prefix} ${base}`, tone: state };
}

function compactOddsSummary(odds?: CombinedOdds): string | null {
  if (!odds) return null;
  const parts: string[] = [];
  if (odds.favorite != null && odds.spread != null) {
    parts.push(`${odds.favorite} ${odds.spread}`);
  } else if (odds.favorite != null) {
    parts.push(`Fav ${odds.favorite}`);
  } else if (odds.spread != null) {
    parts.push(`Spread ${odds.spread}`);
  }
  if (odds.total != null) {
    parts.push(`Total ${odds.total}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

function GameRow({
  slateGame,
  scoresByKey,
  oddsByKey,
  displayTimeZone,
}: {
  slateGame: OwnerSlateGame;
  scoresByKey: Record<string, ScorePack>;
  oddsByKey: Record<string, CombinedOdds>;
  displayTimeZone: string;
}): React.ReactElement {
  const score = scoresByKey[slateGame.game.key];
  const odds = oddsByKey[slateGame.game.key];
  const scoreState = formatOwnedScore(slateGame, score);
  const statusText = formatGameStatus(score);
  const oddsText = compactOddsSummary(odds);

  return (
    <li className="rounded border border-gray-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-900 dark:text-zinc-100">
            <span className="font-medium">{slateGame.ownerTeamName}</span>
            <span className="text-gray-500 dark:text-zinc-400">vs</span>
            <span>{slateGame.opponentTeamName}</span>
            {slateGame.isOwnerVsOwner && slateGame.opponentOwner ? (
              <span className={pillClass()}>vs owner {slateGame.opponentOwner}</span>
            ) : slateGame.isOpponentUnownedOrNonLeague ? (
              <span className={pillClass()}>Unowned / Non-league</span>
            ) : null}
            {slateGame.game.label ? (
              <span className={pillClass()}>{slateGame.game.label}</span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-gray-600 dark:text-zinc-400">
            <span>{scoreState.summary}</span>
            <span>•</span>
            <span>{statusText}</span>
            <span>•</span>
            <span>Kickoff: {formatKickoff(slateGame.game.date, displayTimeZone)}</span>
            {oddsText ? (
              <>
                <span>•</span>
                <span>{oddsText}</span>
              </>
            ) : null}
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${performanceClasses(scoreState.tone)}`}
        >
          {scoreState.tone === 'final'
            ? 'Final'
            : scoreState.tone === 'inprogress'
              ? 'Live'
              : scoreState.tone === 'neutral'
                ? 'Tied'
                : 'Scheduled'}
        </span>
      </div>
    </li>
  );
}

function EmptyState(): React.ReactElement {
  return (
    <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-6 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      No owner-relevant games for this week.
    </div>
  );
}

function OwnerCard({
  slate,
  scoresByKey,
  oddsByKey,
  displayTimeZone,
}: {
  slate: OwnerWeekSlate;
  scoresByKey: Record<string, ScorePack>;
  oddsByKey: Record<string, CombinedOdds>;
  displayTimeZone: string;
}): React.ReactElement {
  const detailBits = [
    `${slate.totalGames} game${slate.totalGames === 1 ? '' : 's'}`,
    slate.opponentOwners.length > 0
      ? `Faces ${slate.opponentOwners.join(', ')}`
      : 'No owner-vs-owner opponent this week',
  ];

  if (slate.liveGames > 0) detailBits.push(`${slate.liveGames} live`);
  if (slate.finalGames > 0) detailBits.push(`${slate.finalGames} final`);
  if (slate.scheduledGames > 0) detailBits.push(`${slate.scheduledGames} scheduled`);

  return (
    <article
      className={`${statusClasses(slate.performance.tone === 'neutral' ? 'unknown' : slate.performance.tone, true)} space-y-3 p-4`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-zinc-100">
              {slate.owner}
            </h3>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${performanceClasses(slate.performance.tone)}`}
            >
              {slate.performance.summary}
            </span>
          </div>
          <p className="text-sm text-gray-700 dark:text-zinc-300">{detailBits.join(' · ')}</p>
        </div>
        <div className="text-xs text-gray-500 dark:text-zinc-400">{slate.performance.detail}</div>
      </div>

      <ul className="space-y-2">
        {slate.games.map((slateGame) => (
          <GameRow
            key={`${slate.owner}:${slateGame.game.key}:${slateGame.ownerTeamSide}`}
            slateGame={slateGame}
            scoresByKey={scoresByKey}
            oddsByKey={oddsByKey}
            displayTimeZone={displayTimeZone}
          />
        ))}
      </ul>
    </article>
  );
}

export default function MatchupsWeekPanel({
  games,
  oddsByKey,
  scoresByKey,
  rosterByTeam,
  displayTimeZone = getPresentationTimeZone(),
  sections,
}: MatchupsWeekPanelProps): React.ReactElement {
  const derivedSections = sections ?? deriveWeekMatchupSections(games, rosterByTeam);
  const ownerSlates = deriveOwnerWeekSlates(games, rosterByTeam, scoresByKey);

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
            Owner Weekly Slates
          </h2>
          <p className="text-xs text-gray-600 dark:text-zinc-400">
            One compact card per owner, with weekly summary first and supporting game rows
            underneath.
          </p>
        </div>

        {ownerSlates.length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {ownerSlates.map((slate) => (
              <OwnerCard
                key={slate.owner}
                slate={slate}
                scoresByKey={scoresByKey}
                oddsByKey={oddsByKey}
                displayTimeZone={displayTimeZone}
              />
            ))}
          </div>
        ) : (
          <EmptyState />
        )}
      </section>

      {derivedSections.otherGames.length ? (
        <section className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
              Excluded games
            </h3>
            <p className="text-xs text-gray-600 dark:text-zinc-400">
              Unowned vs unowned games remain outside the owner-centric Matchups tab.
            </p>
          </div>
          <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-xs text-gray-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
            {derivedSections.otherGames.length} excluded game
            {derivedSections.otherGames.length === 1 ? '' : 's'}.
          </div>
        </section>
      ) : null}
    </div>
  );
}
