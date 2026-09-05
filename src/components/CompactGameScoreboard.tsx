import React from 'react';

import type { ProviderClassification } from '../lib/conferenceSubdivision';
import { gameStatusLabelPresentation } from '../lib/gameUi';
import { rankSourceLabel, type RankSource } from '../lib/rankings';
import type { TeamRecordClient } from '../lib/selectors/teamRecordsClient';

export type CompactScoreboardParticipant = {
  teamName: string;
  owner?: string | null;
  rank?: number | null;
  rankSource?: RankSource | null;
  classification?: ProviderClassification;
  record?: TeamRecordClient | null;
  score: number | null;
};

export type CompactGameScoreboardProps = {
  state: 'scheduled' | 'live' | 'final' | 'awaiting';
  clock?: string;
  broadcast?: string | null;
  neutralSite?: boolean;
  scheduleNotice?: string | null;
  matchupLabel: string;
  away: CompactScoreboardParticipant;
  home: CompactScoreboardParticipant;
  contextSlot?: React.ReactNode;
  footerSlot?: React.ReactNode;
  tier2Slot?: React.ReactNode;
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

function recordLabel(record: TeamRecordClient | null | undefined): string | null {
  return record ? `${record.wins}–${record.losses}` : null;
}

function hasRenderableContent(slot: React.ReactNode): boolean {
  if (slot == null || typeof slot === 'boolean' || slot === '') return false;
  if (Array.isArray(slot)) return slot.some(hasRenderableContent);
  // Arrays and fragments expose static children we can inspect without evaluation. Arbitrary
  // components may render null, but evaluating them here would be unsafe and hook-incompatible.
  if (React.isValidElement<{ children?: React.ReactNode }>(slot) && slot.type === React.Fragment) {
    return hasRenderableContent(slot.props.children);
  }
  return true;
}

export default function CompactGameScoreboard({
  state,
  clock,
  broadcast,
  neutralSite = false,
  scheduleNotice,
  matchupLabel,
  away,
  home,
  contextSlot,
  footerSlot,
  tier2Slot,
}: CompactGameScoreboardProps): React.ReactElement {
  const leader = leadingSide(away, home);
  const participants = [
    { side: 'away' as const, participant: away },
    { side: 'home' as const, participant: home },
  ];
  const clockLabel = clock?.trim() ?? '';
  const broadcastLabel = broadcast?.trim() ?? '';
  const scheduleNoticeLabel = scheduleNotice?.trim() ?? '';
  const statusLabel =
    state === 'scheduled'
      ? null
      : gameStatusLabelPresentation(state === 'awaiting' ? 'unknown' : state);
  const statusText = state === 'live' ? 'Live' : state === 'final' ? 'Final' : 'Awaiting score';
  const hasScheduleNotice = state === 'scheduled' && Boolean(scheduleNoticeLabel);
  const hasHeaderLead = Boolean(statusLabel) || hasScheduleNotice || Boolean(clockLabel);
  const showsBroadcast = state !== 'final' && Boolean(broadcastLabel);
  const hasContextSlot = hasRenderableContent(contextSlot);
  const hasTier2Slot = hasRenderableContent(tier2Slot);

  return (
    <article
      className="border-b py-3 dark:border-zinc-800/80"
      aria-label={matchupLabel}
      data-game-scoreboard
      data-scoreboard-state={state}
    >
      {hasContextSlot ? (
        <div className="mb-1.5 min-w-0" data-scoreboard-context-slot>
          {contextSlot}
        </div>
      ) : null}
      <div
        className="mb-1.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs dark:text-zinc-400"
        data-scoreboard-header
      >
        {statusLabel ? (
          <span className={statusLabel.className}>
            {statusLabel.dotClassName ? (
              <span className={statusLabel.dotClassName} aria-hidden="true" />
            ) : null}
            {statusText}
          </span>
        ) : null}
        {hasScheduleNotice ? (
          <span className={gameStatusLabelPresentation('scheduled').className}>
            {scheduleNoticeLabel}
          </span>
        ) : null}
        {clockLabel ? <span className="min-w-0 truncate tabular-nums">{clockLabel}</span> : null}
        {showsBroadcast ? (
          <>
            {hasHeaderLead ? <span aria-hidden="true">•</span> : null}
            <span className="min-w-0 truncate">{broadcastLabel}</span>
          </>
        ) : null}
        {neutralSite ? (
          <>
            {hasHeaderLead || showsBroadcast ? <span aria-hidden="true">•</span> : null}
            <span className="shrink-0" data-scoreboard-neutral-site>
              Neutral site
            </span>
          </>
        ) : null}
      </div>

      {participants.map(({ side, participant }) => {
        const isLeading = leader === side;
        const owner = participant.owner?.trim() || null;
        const teamRecord = recordLabel(participant.record);
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
                <span className="shrink-0 text-xs font-normal dark:text-zinc-400" title={rankTitle}>
                  #{participant.rank}
                </span>
              ) : participant.classification === 'fcs' ? (
                <span
                  className="shrink-0 rounded-[3px] border px-[3px] text-[9.5px] font-semibold leading-[1.4] tracking-[0.06em] dark:border-zinc-800 dark:text-zinc-400"
                  data-scoreboard-classification={side}
                >
                  FCS
                </span>
              ) : null}
              <span className="min-w-0 truncate">
                <span data-scoreboard-team={side}>{participant.teamName}</span>
                {state !== 'scheduled' && teamRecord ? (
                  <span
                    className="ml-1.5 text-[12.5px] font-normal tabular-nums dark:text-zinc-400"
                    data-scoreboard-record={side}
                  >
                    ({teamRecord})
                  </span>
                ) : null}
                {owner ? (
                  <span
                    className="ml-1.5 text-[12.5px] font-normal dark:text-zinc-400"
                    data-scoreboard-owner={side}
                  >
                    {owner}
                  </span>
                ) : null}
              </span>
            </span>
            {state === 'scheduled' ? (
              teamRecord ? (
                <span
                  className="shrink-0 font-medium tabular-nums"
                  data-scoreboard-value-kind="record"
                  data-scoreboard-value={side}
                >
                  {teamRecord}
                </span>
              ) : null
            ) : (
              <span
                className={`shrink-0 tabular-nums ${isLeading ? 'font-semibold' : 'font-medium'}`}
                data-scoreboard-value-kind="score"
                data-scoreboard-value={side}
              >
                {participant.score ?? '—'}
              </span>
            )}
          </div>
        );
      })}
      {state === 'scheduled' ? (
        <div
          className="mt-1.5 min-h-4 overflow-hidden whitespace-nowrap text-xs text-gray-500 dark:text-zinc-400"
          data-scoreboard-odds-footer
        >
          {/* This wrapper always reserves peer-card height. React handles empty footer children;
              a content predicate here would be render-equivalent and therefore unobservable. */}
          {footerSlot}
        </div>
      ) : null}
      {hasTier2Slot ? (
        <div className="mt-1.5 min-w-0 overflow-hidden" data-scoreboard-tier2-slot>
          {tier2Slot}
        </div>
      ) : null}
    </article>
  );
}
