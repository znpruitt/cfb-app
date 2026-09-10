import React from 'react';
import Image from 'next/image';

import type { ProviderClassification } from '../lib/conferenceSubdivision';
import { gameStatusLabelPresentation, type GameStatusLabelOptions } from '../lib/gameUi';
import { rankSourceLabel, type RankSource } from '../lib/rankings';
import type { GameScoreboardState } from '../lib/selectors/gameScoreboardState';
import type { TeamRecordClient } from '../lib/selectors/teamRecordsClient';
import { SCOREBOARD_TEAM_LOGO_DISPLAY_SIZE, type ScoreboardTeamLogo } from '../lib/teamLogos';

export type CompactScoreboardParticipant = {
  teamName: string;
  teamLogo?: ScoreboardTeamLogo | null;
  owner?: string | null;
  isCardOwnerTeam?: boolean;
  rank?: number | null;
  rankSource?: RankSource | null;
  classification?: ProviderClassification;
  record?: TeamRecordClient | null;
  score: number | null;
};

export type CompactGameScoreboardProps = {
  state: GameScoreboardState;
  /** Optional caller copy for the otherwise unlabeled scheduled state. */
  statusLabel?: string;
  liveHue?: GameStatusLabelOptions['liveHue'];
  liveDot?: GameStatusLabelOptions['liveDot'];
  clock?: string;
  broadcast?: string | null;
  neutralSite?: boolean;
  scheduleNotice?: string | null;
  matchupLabel: string;
  away: CompactScoreboardParticipant;
  home: CompactScoreboardParticipant;
  contextSlot?: React.ReactNode;
  tagSlot?: React.ReactNode;
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

// `isCardOwnerTeam` is Matchups-only. Its zinc-800 card and optional zinc-950/10
// outcome row become #333336 (scheduled) or #303033 (outcome) under 5.5% white.
// The current zinc-400 token (about #9f9fa9) remains at least 4.8:1 over them,
// clearing the 4.5:1 normal-text floor carried by record and owner suffixes.
// `isolate` contains the negative-z tint in this row's stacking context; without that
// boundary it can descend behind an intervening painted card surface. The participant
// row is the containing block for both the tint and the absolutely positioned logo.
const CARD_OWNER_ROW_CLASSES =
  "isolate after:pointer-events-none after:absolute after:inset-[0_-8px] after:z-[-1] dark:after:bg-[rgba(255,255,255,0.055)] after:content-['']";

function cardOwnerRowCornerClasses(
  side: 'away' | 'home',
  bothParticipantsBelongToCardOwner: boolean
): string {
  if (!bothParticipantsBelongToCardOwner) return 'after:rounded-[4px]';
  return side === 'away' ? 'after:rounded-t-[4px]' : 'after:rounded-b-[4px]';
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
  statusLabel,
  liveHue,
  liveDot,
  clock,
  broadcast,
  neutralSite = false,
  scheduleNotice,
  matchupLabel,
  away,
  home,
  contextSlot,
  tagSlot,
  footerSlot,
  tier2Slot,
}: CompactGameScoreboardProps): React.ReactElement {
  const leader = leadingSide(away, home);
  const participants = [
    { side: 'away' as const, participant: away },
    { side: 'home' as const, participant: home },
  ];
  const bothParticipantsBelongToCardOwner =
    away.isCardOwnerTeam === true && home.isCardOwnerTeam === true;
  const clockLabel = clock?.trim() ?? '';
  const broadcastLabel = broadcast?.trim() ?? '';
  const scheduleNoticeLabel = scheduleNotice?.trim() ?? '';
  const statusTextByState: Record<GameScoreboardState, string | null> = {
    scheduled: statusLabel?.trim() || null,
    live: 'Live',
    awaiting: 'Awaiting score',
    final: 'Final',
  };
  const statusToneByState: Record<GameScoreboardState, 'scheduled' | 'live' | 'unknown' | 'final'> =
    {
      scheduled: 'scheduled',
      live: 'live',
      awaiting: 'unknown',
      final: 'final',
    };
  const statusText = statusTextByState[state];
  const statusPresentation = statusText
    ? gameStatusLabelPresentation(statusToneByState[state], { liveHue, liveDot })
    : null;
  const hasScheduleNotice = state === 'scheduled' && Boolean(scheduleNoticeLabel);
  const hasHeaderLead = Boolean(statusPresentation) || hasScheduleNotice || Boolean(clockLabel);
  const showsBroadcast = state !== 'final' && Boolean(broadcastLabel);
  const hasContextSlot = hasRenderableContent(contextSlot);
  const hasTagSlot = hasRenderableContent(tagSlot);
  const hasFooterSlot = hasRenderableContent(footerSlot);
  const hasTier2Slot = hasRenderableContent(tier2Slot);
  const showsInlineRecord = state === 'live' || state === 'final' || state === 'awaiting';
  const headerContent = (
    <>
      {statusPresentation ? (
        <span className={statusPresentation.className}>
          {statusPresentation.dotClassName ? (
            <span className={statusPresentation.dotClassName} aria-hidden="true" />
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
    </>
  );

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
        className={`mb-1.5 flex items-center gap-2 overflow-hidden whitespace-nowrap text-xs dark:text-zinc-400${
          hasTagSlot && state === 'scheduled' ? ' max-sm:flex-wrap max-sm:gap-y-1' : ''
        }`}
        data-scoreboard-header
      >
        {hasTagSlot ? (
          <>
            <span
              className={`flex min-w-0 flex-auto items-center gap-2 overflow-clip whitespace-nowrap${
                state === 'scheduled' ? ' max-sm:w-full max-sm:flex-none' : ''
              }`}
              data-scoreboard-header-metadata
            >
              {headerContent}
            </span>
            <span
              className={`flex h-4 flex-none items-center justify-end gap-1 leading-none${
                state === 'scheduled' ? ' max-sm:w-full' : ''
              }`}
              data-scoreboard-tag-slot
            >
              {tagSlot}
            </span>
          </>
        ) : (
          headerContent
        )}
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
            className={`relative flex min-h-8 items-baseline justify-between gap-3 py-1.5 pl-8 text-sm ${participantRowClasses(
              isLeading,
              leader !== null
            )}${
              participant.isCardOwnerTeam
                ? ` ${CARD_OWNER_ROW_CLASSES} ${cardOwnerRowCornerClasses(
                    side,
                    bothParticipantsBelongToCardOwner
                  )}`
                : ''
            }`}
            data-scoreboard-side={side}
            data-scoreboard-leading={isLeading}
          >
            {participant.teamLogo ? (
              <Image
                key={participant.teamLogo.url}
                className="absolute left-0 top-1/2 block h-7 w-7 -translate-y-1/2 object-contain"
                src={participant.teamLogo.url}
                alt=""
                width={SCOREBOARD_TEAM_LOGO_DISPLAY_SIZE}
                height={SCOREBOARD_TEAM_LOGO_DISPLAY_SIZE}
                unoptimized
                aria-hidden="true"
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
                data-scoreboard-team-logo={side}
              />
            ) : null}
            {/* The slot remains reserved when artwork is unavailable so both rows stay aligned. */}
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
                {showsInlineRecord && teamRecord ? (
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
                {participant.score ?? '–'}
              </span>
            )}
          </div>
        );
      })}
      {hasFooterSlot ? (
        <div
          className="mt-1.5 min-h-4 overflow-hidden whitespace-nowrap text-xs text-gray-500 dark:text-zinc-400"
          data-scoreboard-odds-footer
        >
          {/* Rendering this band is an explicit caller request. A caller may pass a component that
              resolves to null when peer-card alignment still requires the reserved height. */}
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
