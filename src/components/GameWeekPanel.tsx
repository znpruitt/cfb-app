import React from 'react';

import { deriveDisplayEventName } from '../lib/gameEventName';
import type { CombinedOdds } from '../lib/odds';
import {
  formatGameMatchupLabel,
  gameStateFromScore,
  statusClasses,
  usesNeutralSiteSemantics,
} from '../lib/gameUi';
import { getPresentationTimeZone, groupGamesByDisplayDate } from '../lib/weekPresentation';
import type { TeamRankingEnrichment } from '../lib/rankings';
import type { ScorePack } from '../lib/scores';
import type { TeamDisplayInfo } from '../lib/teamIdentity';
import { getGameParticipantTeamId, type AppGame } from '../lib/schedule';
import GameScoreboard from './GameScoreboard';
import RankedTeamName from './RankedTeamName';

type Game = AppGame;

function participantDisplayInfo(game: AppGame, side: 'home' | 'away'): TeamDisplayInfo {
  const participant = game.participants[side];
  if (participant.kind === 'team' && participant.labels) {
    return participant.labels;
  }

  return {
    displayName: participant.displayName,
    shortDisplayName: participant.displayName,
    scoreboardName: participant.displayName,
  };
}

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

function summaryStateLabel(score: ScorePack | undefined): string | null {
  if (!score) return null;
  const trimmed = score.status.trim();
  if (/\b(postponed|canceled|cancelled|suspended|delayed)\b/i.test(trimmed)) return trimmed;
  const state = gameStateFromScore(score);
  if (state === 'final') return 'FINAL';
  if (state === 'inprogress') return trimmed.toUpperCase();
  return trimmed;
}

function scheduleStateLabel(
  status: string | null | undefined,
  isPlaceholder: boolean
): string | null {
  const trimmed = status?.trim();
  if (!trimmed) return isPlaceholder ? 'Placeholder' : null;
  if (trimmed === 'scheduled') return isPlaceholder ? 'Placeholder' : 'Scheduled';
  if (trimmed === 'final') return 'FINAL';
  if (trimmed === 'in_progress') return 'IN PROGRESS';
  if (trimmed === 'matchup_set') return 'MATCHUP SET';
  return trimmed.replace(/_/g, ' ');
}

function resolveSummaryStateLabel(
  game: AppGame,
  score: ScorePack | undefined,
  isPlaceholder: boolean
): string {
  return summaryStateLabel(score) ?? scheduleStateLabel(game.status, isPlaceholder) ?? 'Scheduled';
}

function shouldShowCollapsedCanonicalLabel(game: AppGame, isPlaceholder: boolean): boolean {
  if (!isPlaceholder || !game.label?.trim()) return false;

  const matchupParticipants = [game.csvAway, game.csvHome].map((value) =>
    value.trim().toLowerCase()
  );
  const hasTemplateParticipant = matchupParticipants.some(
    (value) => value === 'team tbd' || value === 'tbd' || value.includes('winner')
  );

  return hasTemplateParticipant || game.stage !== 'regular';
}

function renderMatchupLabel(
  game: AppGame,
  rankingsByTeamId: Map<string, TeamRankingEnrichment>,
  homeAwaySeparator: '@' | 'vs'
): React.ReactElement {
  const plainLabel = formatGameMatchupLabel(game, { homeAwaySeparator });
  const separator = plainLabel.slice(game.csvAway.length, plainLabel.length - game.csvHome.length);
  const awayTeamId = getGameParticipantTeamId(game, 'away') ?? game.canAway;
  const homeTeamId = getGameParticipantTeamId(game, 'home') ?? game.canHome;

  return (
    <>
      <RankedTeamName teamName={game.csvAway} ranking={rankingsByTeamId.get(awayTeamId)} />
      {separator}
      <RankedTeamName teamName={game.csvHome} ranking={rankingsByTeamId.get(homeTeamId)} />
    </>
  );
}

function isFcsConference(conference: string | null | undefined): boolean {
  return /\bfcs\b/i.test(conference ?? '');
}

type GameWeekPanelProps = {
  games: Game[];
  byes: string[];
  oddsByKey: Record<string, CombinedOdds>;
  scoresByKey: Record<string, ScorePack>;
  rosterByTeam: Map<string, string>;
  isDebug: boolean;
  rankingsByTeamId?: Map<string, TeamRankingEnrichment>;
  onSavePostseasonOverride?: (eventId: string, patch: Partial<AppGame>) => void;
  hideByes?: boolean;
  displayTimeZone?: string;
};

export default function GameWeekPanel({
  games,
  byes,
  oddsByKey,
  scoresByKey,
  rosterByTeam,
  rankingsByTeamId = new Map(),
  onSavePostseasonOverride,
  hideByes = false,
  displayTimeZone = getPresentationTimeZone(),
}: GameWeekPanelProps): React.ReactElement {
  const groupedGames = groupGamesByDisplayDate(games, displayTimeZone);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-0.5 rounded border-l-4 border border-gray-300 border-l-emerald-600 bg-emerald-50 text-gray-900 dark:border-zinc-700 dark:border-l-emerald-400 dark:bg-emerald-900/25 dark:text-zinc-100">
          Final
        </span>
        <span className="px-2 py-0.5 rounded border-l-4 border border-gray-300 border-l-amber-600 bg-amber-50 text-gray-900 dark:border-zinc-700 dark:border-l-amber-400 dark:bg-amber-900/25 dark:text-zinc-100">
          In Progress
        </span>
        <span className="px-2 py-0.5 rounded border-l-4 border border-gray-300 border-l-blue-600 bg-blue-50 text-gray-900 dark:border-zinc-700 dark:border-l-blue-400 dark:bg-blue-900/25 dark:text-zinc-100">
          Scheduled
        </span>
        <span className="px-2 py-0.5 rounded border-l-4 border border-gray-300 border-l-violet-600 bg-violet-50 text-gray-900 dark:border-zinc-700 dark:border-l-violet-400 dark:bg-violet-900/25 dark:text-zinc-100">
          Postseason (TBD)
        </span>
      </div>

      <div className="grid gap-4">
        {groupedGames.map((group) => (
          <section key={group.dateKey} className="space-y-2">
            <div
              className="text-sm font-semibold text-gray-700 dark:text-zinc-300"
              data-date-header={group.dateKey}
            >
              {group.label}
            </div>

            <div className="grid gap-2">
              {group.games.map((g) => {
                const score = scoresByKey[g.key];
                const odds = oddsByKey[g.key];
                const state = gameStateFromScore(score);
                const hasAnyInfo = Boolean(score || odds);
                const frameClasses = statusClasses(state, hasAnyInfo);
                const isPlaceholder =
                  g.status === 'placeholder' ||
                  g.isPlaceholder ||
                  g.participants?.home?.kind !== 'team' ||
                  g.participants?.away?.kind !== 'team';

                const useNeutralSemantics = usesNeutralSiteSemantics(g);
                const matchupLabel = formatGameMatchupLabel(g, {
                  homeAwaySeparator: useNeutralSemantics ? 'vs' : '@',
                });
                const eventName = deriveDisplayEventName(g.label, g.notes, matchupLabel);
                const homeIsLeagueTeam =
                  g.participants.home.kind === 'team' && !isFcsConference(g.homeConf);
                const awayIsLeagueTeam =
                  g.participants.away.kind === 'team' && !isFcsConference(g.awayConf);
                const homeOwner = homeIsLeagueTeam ? rosterByTeam.get(g.csvHome) : undefined;
                const awayOwner = awayIsLeagueTeam ? rosterByTeam.get(g.csvAway) : undefined;
                const showOwnerMatchup =
                  homeIsLeagueTeam && awayIsLeagueTeam && Boolean(homeOwner) && Boolean(awayOwner);
                const homeTeamId = getGameParticipantTeamId(g, 'home') ?? g.canHome;
                const awayTeamId = getGameParticipantTeamId(g, 'away') ?? g.canAway;

                return (
                  <details key={g.key} className={frameClasses}>
                    <summary className="cursor-pointer px-3 py-2 flex items-start justify-between gap-3">
                      <div className="min-w-0 flex flex-col gap-1">
                        {showOwnerMatchup && (
                          <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                            {awayOwner} vs {homeOwner}
                          </div>
                        )}
                        {shouldShowCollapsedCanonicalLabel(g, isPlaceholder) && (
                          <div className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                            {g.label}
                          </div>
                        )}
                        <div
                          className={`font-medium ${isPlaceholder ? 'text-gray-500 dark:text-zinc-400' : 'text-gray-900 dark:text-zinc-100'}`}
                        >
                          {renderMatchupLabel(
                            g,
                            rankingsByTeamId,
                            useNeutralSemantics ? 'vs' : '@'
                          )}
                        </div>
                      </div>
                      <div
                        className="shrink-0 text-right text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-600 dark:text-zinc-400"
                        data-summary-state
                      >
                        {resolveSummaryStateLabel(g, score, isPlaceholder)}
                      </div>
                    </summary>

                    <div className="space-y-3 p-3">
                      <div className="space-y-1">
                        {eventName && (
                          <div
                            className="text-sm leading-snug text-gray-400 dark:text-zinc-500"
                            data-expanded-event-name
                          >
                            {eventName}
                          </div>
                        )}
                        <div
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400 dark:text-zinc-500"
                          data-expanded-metadata
                        >
                          <span>{formatKickoff(g.date, displayTimeZone)}</span>
                          {useNeutralSemantics && <span>Neutral Site</span>}
                        </div>
                      </div>

                      <GameScoreboard
                        score={score}
                        awayTeam={participantDisplayInfo(g, 'away')}
                        homeTeam={participantDisplayInfo(g, 'home')}
                        awayRanking={rankingsByTeamId.get(awayTeamId)}
                        homeRanking={rankingsByTeamId.get(homeTeamId)}
                        awayConference={g.awayConf}
                        homeConference={g.homeConf}
                        awayOwner={awayOwner}
                        homeOwner={homeOwner}
                        venue={g.venue}
                        odds={odds}
                        isPlaceholder={isPlaceholder}
                      />

                      {isPlaceholder && onSavePostseasonOverride && (
                        <button
                          className="px-2 py-1 rounded border text-xs"
                          onClick={(e) => {
                            e.preventDefault();
                            const nextLabel =
                              window.prompt('Override event label', g.label ?? '') ?? '';
                            if (!nextLabel.trim()) return;
                            onSavePostseasonOverride(g.eventId, { label: nextLabel.trim() });
                          }}
                        >
                          Save label override
                        </button>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {!hideByes && (
        <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="font-medium mb-2">Byes</div>
          <div className="text-sm">{byes.length ? byes.join(', ') : '—'}</div>
        </div>
      )}
    </>
  );
}
