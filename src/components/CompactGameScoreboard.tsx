import React from 'react';

import { gameStatusLabelPresentation } from '../lib/gameUi';
import { rankSourceLabel, type RankSource } from '../lib/rankings';

export type CompactScoreboardParticipant = {
  teamName: string;
  owner?: string | null;
  rank?: number | null;
  rankSource?: RankSource | null;
  score: number | null;
};

export type CompactGameScoreboardProps = {
  state: 'live' | 'final';
  clock?: string;
  matchupLabel: string;
  away: CompactScoreboardParticipant;
  home: CompactScoreboardParticipant;
  contextSlot?: React.ReactNode;
};

function leadingSide(
  away: CompactScoreboardParticipant,
  home: CompactScoreboardParticipant
): 'away' | 'home' | null {
  if (away.score === null || home.score === null || away.score === home.score) return null;
  return away.score > home.score ? 'away' : 'home';
}

function participantRowClasses(isLeading: boolean, hasLeader: boolean): string {
  if (isLeading) return 'font-semibold dark:text-zinc-50';
  if (hasLeader) return 'font-normal dark:text-zinc-400';
  return 'font-medium dark:text-zinc-100';
}

export default function CompactGameScoreboard({
  state,
  clock,
  matchupLabel,
  away,
  home,
  contextSlot,
}: CompactGameScoreboardProps): React.ReactElement {
  const leader = leadingSide(away, home);
  const participants = [
    { side: 'away' as const, participant: away },
    { side: 'home' as const, participant: home },
  ];
  const clockLabel = clock?.trim() ?? '';
  const statusLabel = gameStatusLabelPresentation(state);

  return (
    <article
      className="border-b py-3 dark:border-zinc-800/80"
      aria-label={matchupLabel}
      data-game-scoreboard
      data-scoreboard-state={state}
    >
      {contextSlot ? (
        <div className="mb-1.5 min-w-0" data-scoreboard-context-slot>
          {contextSlot}
        </div>
      ) : null}
      <div
        className="mb-1.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs dark:text-zinc-500"
        data-scoreboard-header
      >
        <span className={statusLabel.className}>
          {statusLabel.dotClassName ? (
            <span className={statusLabel.dotClassName} aria-hidden="true" />
          ) : null}
          {state === 'live' ? 'Live' : 'Final'}
        </span>
        {clockLabel ? <span className="min-w-0 truncate tabular-nums">{clockLabel}</span> : null}
      </div>

      {participants.map(({ side, participant }) => {
        const isLeading = leader === side;
        const owner = participant.owner?.trim() || null;
        const rankTitle =
          participant.rank != null && participant.rankSource
            ? `${rankSourceLabel(participant.rankSource)} rank #${participant.rank}`
            : undefined;

        return (
          <div
            key={side}
            className={`flex items-baseline justify-between gap-3 py-0.5 text-sm ${participantRowClasses(
              isLeading,
              leader !== null
            )}`}
            data-scoreboard-side={side}
            data-scoreboard-leading={isLeading}
          >
            {/* Team identity leads the row; a future logo belongs immediately before this group. */}
            <span className="flex min-w-0 items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
              {participant.rank !== null && participant.rank !== undefined ? (
                <span className="shrink-0 text-xs font-normal dark:text-zinc-500" title={rankTitle}>
                  #{participant.rank}
                </span>
              ) : null}
              <span className="min-w-0 truncate">
                <span data-scoreboard-team={side}>{participant.teamName}</span>
                {owner ? (
                  <span
                    className="ml-1.5 text-[12.5px] font-normal dark:text-zinc-500"
                    data-scoreboard-owner={side}
                  >
                    {owner}
                  </span>
                ) : null}
              </span>
            </span>
            <span
              className={`shrink-0 tabular-nums ${isLeading ? 'font-semibold' : 'font-medium'}`}
              data-scoreboard-value={side}
            >
              {participant.score ?? '—'}
            </span>
          </div>
        );
      })}
    </article>
  );
}
