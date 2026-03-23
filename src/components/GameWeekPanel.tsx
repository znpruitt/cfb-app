import React from 'react';

import { deriveDisplayEventName } from '../lib/gameEventName';
import type { CombinedOdds } from '../lib/odds';
import {
  formatGameMatchupLabel,
  gameStateFromScore,
  usesNeutralSiteSemantics,
} from '../lib/gameUi';
import { getPresentationTimeZone, groupGamesByDisplayDate } from '../lib/weekPresentation';
import type { TeamRankingEnrichment } from '../lib/rankings';
import type { ScorePack } from '../lib/scores';
import { getSafeScoreboardTeamColorById } from '../lib/teamColors';
import type { TeamCatalogItem, TeamDisplayInfo } from '../lib/teamIdentity';
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

function isDisruptedSummaryState(summaryState: string): boolean {
  return /\b(postponed|canceled|cancelled|suspended|delayed)\b/i.test(summaryState);
}

function summaryStateChipBucket(
  summaryState: string
): 'final' | 'live' | 'disrupted' | 'postseason' | 'scheduled' {
  const trimmed = summaryState.trim();
  const normalized = trimmed.toUpperCase();

  if (normalized === 'FINAL') return 'final';
  if (isDisruptedSummaryState(trimmed)) return 'disrupted';

  const inferredState = gameStateFromScore({
    status: trimmed,
    away: { team: '', score: null },
    home: { team: '', score: null },
    time: null,
  });
  if (inferredState === 'inprogress') return 'live';

  if (normalized === 'MATCHUP SET') return 'postseason';
  return 'scheduled';
}

function summaryChipClasses(summaryState: string, isPlaceholder: boolean): string {
  const bucket = summaryStateChipBucket(summaryState);

  if (bucket === 'final') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200';
  }

  if (bucket === 'live') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200';
  }

  if (bucket === 'disrupted') {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200';
  }

  if (bucket === 'postseason' || isPlaceholder) {
    return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200';
  }

  return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200';
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
  teamCatalogById?: Map<string, TeamCatalogItem>;
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
  teamCatalogById = new Map(),
  onSavePostseasonOverride,
  hideByes = false,
  displayTimeZone = getPresentationTimeZone(),
}: GameWeekPanelProps): React.ReactElement {
  const groupedGames = groupGamesByDisplayDate(games, displayTimeZone);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200">
          Final
        </span>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold uppercase tracking-[0.16em] text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
          In Progress
        </span>
        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold uppercase tracking-[0.16em] text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200">
          Scheduled
        </span>
        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 font-semibold uppercase tracking-[0.16em] text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200">
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
                const isPlaceholder =
                  g.status === 'placeholder' ||
                  g.isPlaceholder ||
                  g.participants?.home?.kind !== 'team' ||
                  g.participants?.away?.kind !== 'team';
                const resolvedSummaryState = resolveSummaryStateLabel(g, score, isPlaceholder);

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
                const awayColorTreatment = getSafeScoreboardTeamColorById(
                  awayTeamId,
                  teamCatalogById
                );
                const homeColorTreatment = getSafeScoreboardTeamColorById(
                  homeTeamId,
                  teamCatalogById
                );

                return (
                  <details
                    key={g.key}
                    className="group overflow-hidden rounded border border-gray-200 bg-white text-gray-900 transition-colors hover:border-gray-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-700"
                    style={{
                      boxShadow: `inset 0 2px 0 ${awayColorTreatment.borderAccent}, inset 0 -2px 0 ${homeColorTreatment.borderAccent}`,
                    }}
                    data-card-team-accent-top="away"
                    data-card-team-accent-bottom="home"
                  >
                    <summary className="cursor-pointer list-none px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
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
                          className={`shrink-0 rounded-full border px-2 py-1 text-right text-[10px] font-semibold uppercase tracking-[0.18em] ${summaryChipClasses(resolvedSummaryState, isPlaceholder)}`}
                          data-summary-state
                        >
                          {resolvedSummaryState}
                        </div>
                      </div>
                    </summary>

                    <div className="space-y-2.5 px-3 py-3">
                      <div className="space-y-0.5">
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
                        awayColorTreatment={awayColorTreatment}
                        homeColorTreatment={homeColorTreatment}
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
