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

type OpponentSummaryEntry = {
  label: string;
  count: number;
};

type GameOutcomeTone =
  | 'scheduled'
  | 'inprogress'
  | 'finalWin'
  | 'finalLoss'
  | 'finalSelf'
  | 'neutral';

const DEFAULT_VISIBLE_OPPONENTS = 3;

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
  return 'Scheduled';
}

function isFcsConference(conference: string | null | undefined): boolean {
  return /\bfcs\b/i.test(conference ?? '');
}

function getOpponentDescriptor(slateGame: OwnerSlateGame): string {
  if (slateGame.opponentOwner) {
    return slateGame.opponentOwner === slateGame.owner ? 'Self' : `vs ${slateGame.opponentOwner}`;
  }

  const opponentConference =
    slateGame.ownerTeamSide === 'away' ? slateGame.game.homeConf : slateGame.game.awayConf;
  const opponentParticipant =
    slateGame.ownerTeamSide === 'away'
      ? slateGame.game.participants.home
      : slateGame.game.participants.away;

  if (opponentParticipant.kind === 'placeholder' || opponentParticipant.kind === 'derived') {
    return opponentParticipant.displayName;
  }

  if (opponentParticipant.kind !== 'team' || isFcsConference(opponentConference)) {
    return 'FCS';
  }

  return 'NoClaim (FBS)';
}

function getSummaryOpponentLabel(slateGame: OwnerSlateGame): string {
  const descriptor = getOpponentDescriptor(slateGame);
  if (descriptor.startsWith('vs ')) return descriptor.slice(3);
  return descriptor;
}

function getOpponentBadgeClasses(descriptor: string): string {
  if (descriptor === 'Self') {
    return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300';
  }
  if (descriptor === 'FCS') {
    return 'border-gray-100 bg-gray-50/70 text-gray-500 dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-500';
  }
  if (descriptor === 'NoClaim (FBS)') {
    return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-300';
  }
  return 'border-gray-200 bg-gray-50 text-gray-600 dark:border-zinc-700 dark:bg-zinc-800/70 dark:text-zinc-300';
}

function summarizeOpponents(slate: OwnerWeekSlate): OpponentSummaryEntry[] {
  const counts = new Map<string, number>();
  const order: string[] = [];

  for (const game of slate.games) {
    const label = getSummaryOpponentLabel(game);
    if (!counts.has(label)) order.push(label);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return order.map((label) => ({ label, count: counts.get(label) ?? 0 }));
}

function formatOpponentSummaryEntry(entry: OpponentSummaryEntry): string {
  return entry.count > 1 ? `${entry.label} (x${entry.count})` : entry.label;
}

function formatSlateSummaryText(
  entries: OpponentSummaryEntry[],
  totalGames: number,
  expanded: boolean
): string {
  const visibleEntries = expanded ? entries : entries.slice(0, DEFAULT_VISIBLE_OPPONENTS);
  const hiddenCount = Math.max(entries.length - visibleEntries.length, 0);
  const baseSummary = visibleEntries.length
    ? visibleEntries.map(formatOpponentSummaryEntry).join(', ')
    : '—';
  const suffix = hiddenCount > 0 && !expanded ? ` +${hiddenCount}` : '';
  return `${totalGames} game${totalGames === 1 ? '' : 's'} · vs ${baseSummary}${suffix}`;
}

function isSelfGame(slateGame: OwnerSlateGame): boolean {
  return slateGame.opponentOwner === slateGame.owner;
}

function formatOwnedScore(
  slateGame: OwnerSlateGame,
  score?: ScorePack
): { summary: string; tone: GameOutcomeTone; detail?: string } {
  const rawState = gameStateFromScore(score);
  const state = rawState === 'unknown' ? 'scheduled' : rawState;
  if (!score) {
    return { summary: 'Scheduled', tone: 'scheduled' };
  }

  const ownerScore = slateGame.ownerTeamSide === 'away' ? score.away.score : score.home.score;
  const opponentScore = slateGame.ownerTeamSide === 'away' ? score.home.score : score.away.score;
  const selfGame = isSelfGame(slateGame);

  if (ownerScore == null || opponentScore == null || state === 'scheduled') {
    return {
      summary: formatGameStatus(score),
      tone: state === 'final' ? 'neutral' : state,
    };
  }

  if (selfGame) {
    const symmetricSummary = `${slateGame.ownerTeamName} ${ownerScore} • ${slateGame.opponentTeamName} ${opponentScore}`;
    return {
      summary: symmetricSummary,
      tone: state === 'final' ? 'finalSelf' : state,
      detail: state === 'final' ? 'Counts as 1W / 1L' : undefined,
    };
  }

  const base = `${ownerScore}-${opponentScore}`;
  if (ownerScore === opponentScore) {
    return { summary: state === 'final' ? `${base} (final)` : `Tied ${base}`, tone: 'neutral' };
  }

  if (state === 'final') {
    return {
      summary: `${base} (final)`,
      tone: ownerScore > opponentScore ? 'finalWin' : 'finalLoss',
    };
  }

  const verdict = ownerScore > opponentScore ? 'Leading' : 'Trailing';
  return { summary: `${verdict} ${base}`, tone: state };
}

function ownerOutcomeRowClasses(tone: GameOutcomeTone): string {
  switch (tone) {
    case 'inprogress':
      return 'border-l-2 border-l-amber-400/80 bg-amber-50/40 pl-2 dark:border-l-amber-500/70 dark:bg-amber-950/10';
    case 'finalWin':
      return 'border-l-2 border-l-emerald-400/80 bg-emerald-50/40 pl-2 dark:border-l-emerald-500/70 dark:bg-emerald-950/10';
    case 'finalLoss':
      return 'border-l-2 border-l-rose-400/80 bg-rose-50/40 pl-2 dark:border-l-rose-500/70 dark:bg-rose-950/10';
    case 'finalSelf':
      return 'border-l-2 border-l-violet-400/80 bg-violet-50/40 pl-2 dark:border-l-violet-500/70 dark:bg-violet-950/10';
    default:
      return 'border-l-2 border-l-transparent pl-2';
  }
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

  if (odds.lineSourceStatus === 'closing') {
    parts.push('Closing');
  } else if (odds.lineSourceStatus === 'fallback-latest-for-completed') {
    parts.push('Stored latest');
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
  const rawStatusTone = gameStateFromScore(score);
  const statusTone = rawStatusTone === 'unknown' ? 'scheduled' : rawStatusTone;
  const opponentDescriptor = getOpponentDescriptor(slateGame);
  const rowClasses = ownerOutcomeRowClasses(scoreState.tone);

  return (
    <li className={`rounded-sm py-2 transition-colors ${rowClasses}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-900 dark:text-zinc-100">
            {slateGame.game.label ? (
              <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                {slateGame.game.label}
              </span>
            ) : null}
            <span className="font-medium">{slateGame.ownerTeamName}</span>
            <span className="text-gray-400 dark:text-zinc-500">vs</span>
            <span>{slateGame.opponentTeamName}</span>
            <span className={`${pillClass()} ${getOpponentBadgeClasses(opponentDescriptor)}`}>
              {opponentDescriptor}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 dark:text-zinc-400">
            <span>{scoreState.summary}</span>
            {scoreState.detail ? (
              <>
                <span>•</span>
                <span>{scoreState.detail}</span>
              </>
            ) : null}
            <span>•</span>
            <span>{statusText}</span>
            <span>•</span>
            <span>Kickoff {formatKickoff(slateGame.game.date, displayTimeZone)}</span>
            {oddsText ? (
              <>
                <span>•</span>
                <span>{oddsText}</span>
              </>
            ) : null}
          </div>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${performanceClasses(statusTone)}`}
        >
          {statusTone === 'final' ? 'Final' : statusTone === 'inprogress' ? 'Live' : 'Scheduled'}
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
  const [isExpanded, setIsExpanded] = React.useState(false);
  const opponentSummaryEntries = React.useMemo(() => summarizeOpponents(slate), [slate]);
  const hasHiddenOpponents = opponentSummaryEntries.length > DEFAULT_VISIBLE_OPPONENTS;

  return (
    <article
      className={`${statusClasses(slate.performance.tone === 'neutral' ? 'unknown' : slate.performance.tone, true)} space-y-3 p-4`}
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-zinc-100">
            {slate.owner}
          </h3>
          <span className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            {slate.performance.summary}
          </span>
        </div>
        <p className="text-sm leading-6 text-gray-600 dark:text-zinc-400">
          <span>
            {formatSlateSummaryText(opponentSummaryEntries, slate.totalGames, isExpanded)}
          </span>
          {hasHiddenOpponents ? (
            <>
              <span className="mx-1 text-gray-300 dark:text-zinc-600">•</span>
              <button
                type="button"
                className="text-xs font-medium text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
                onClick={() => setIsExpanded((current) => !current)}
              >
                {isExpanded ? 'Show less' : 'Show all'}
              </button>
            </>
          ) : null}
        </p>
      </div>

      <ul className="divide-y divide-gray-200 dark:divide-zinc-800">
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
            Compact owner-first weekly cards with matchup context, status, kickoff, and odds.
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

      <section className="rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-3 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Excluded games</h2>
        <p className="mt-1 text-xs text-gray-600 dark:text-zinc-400">
          {derivedSections.otherGames.length === 0
            ? 'All games this week appear on an owner card.'
            : `${derivedSections.otherGames.length} excluded game${derivedSections.otherGames.length === 1 ? '' : 's'} do not involve owned teams.`}
        </p>
      </section>
    </div>
  );
}
