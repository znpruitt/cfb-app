import React from 'react';

import type { CombinedOdds } from '../lib/odds';
import {
  chipClass,
  formatGameMatchupLabel,
  gameStateFromScore,
  pillClass,
  statusClasses,
  usesNeutralSiteSemantics,
} from '../lib/gameUi';
import { getPresentationTimeZone, groupGamesByDisplayDate } from '../lib/weekPresentation';
import type { TeamRankingEnrichment } from '../lib/rankings';
import type { ScorePack } from '../lib/scores';
import { getGameParticipantTeamId, type AppGame } from '../lib/schedule';
import RankedTeamName from './RankedTeamName';

type Game = AppGame;

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

function renderMatchupLabel(
  game: AppGame,
  rankingsByTeamId: Map<string, TeamRankingEnrichment>
): React.ReactElement {
  const plainLabel = formatGameMatchupLabel(game, { homeAwaySeparator: '@' });
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
  isDebug,
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

                const chips: string[] = [];
                if (isPlaceholder) chips.push('Placeholder');
                if (!score && !odds) chips.push('No scores/odds');
                if (score) {
                  chips.push(
                    state === 'final'
                      ? 'Final'
                      : state === 'inprogress'
                        ? 'In Progress'
                        : state === 'scheduled'
                          ? 'Scheduled'
                          : '—'
                  );
                }
                if (!odds && !isPlaceholder) chips.push('No odds');

                const useNeutralSemantics = usesNeutralSiteSemantics(g);
                const matchupRoleLabel = useNeutralSemantics ? 'Team A' : 'Away';
                const matchupHostLabel = useNeutralSemantics ? 'Team B' : 'Home';
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
                    <summary className="cursor-pointer px-3 py-2 flex items-center justify-between">
                      <div className="flex flex-col gap-1">
                        {showOwnerMatchup && (
                          <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                            {awayOwner} vs {homeOwner}
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          {g.label && (
                            <span className="font-semibold text-sm text-violet-700 dark:text-violet-300">
                              {g.label}
                            </span>
                          )}
                          {useNeutralSemantics && <span className={pillClass()}>Neutral Site</span>}
                          <span
                            className={`font-medium ${isPlaceholder ? 'text-gray-500 dark:text-zinc-400' : ''}`}
                          >
                            {renderMatchupLabel(g, rankingsByTeamId)}
                          </span>
                          <span className={pillClass()}>
                            Kickoff: {formatKickoff(g.date, displayTimeZone)}
                          </span>
                          {g.homeConf && <span className={pillClass()}>{g.homeConf}</span>}
                          {g.awayConf && <span className={pillClass()}>{g.awayConf}</span>}
                          {homeOwner && (
                            <span className={pillClass()}>Home owner: {homeOwner}</span>
                          )}
                          {awayOwner && (
                            <span className={pillClass()}>Away owner: {awayOwner}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {chips.map((c) => (
                          <span key={c} className={chipClass()}>
                            {c}
                          </span>
                        ))}
                      </div>
                    </summary>

                    <div className="grid md:grid-cols-3 gap-3 p-3">
                      <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                        <div className="font-medium mb-2">Matchup</div>
                        <div>
                          <strong>{matchupHostLabel}</strong>:{' '}
                          <RankedTeamName
                            teamName={g.csvHome}
                            ranking={rankingsByTeamId.get(homeTeamId)}
                          />
                        </div>
                        <div>
                          <strong>{matchupRoleLabel}</strong>:{' '}
                          <RankedTeamName
                            teamName={g.csvAway}
                            ranking={rankingsByTeamId.get(awayTeamId)}
                          />
                        </div>
                        <div>
                          <strong>Week</strong>: {g.week}
                        </div>
                        {g.venue && (
                          <div>
                            <strong>Venue</strong>: {g.venue}
                          </div>
                        )}
                        {isPlaceholder && onSavePostseasonOverride && (
                          <button
                            className="mt-2 px-2 py-1 rounded border text-xs"
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
                        {isDebug && (
                          <div className="text-xs text-gray-600 dark:text-zinc-400 mt-2">
                            Canonical: {g.canAway} @ {g.canHome}
                          </div>
                        )}
                      </div>

                      <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                        <div className="font-medium mb-1">Vegas Odds</div>
                        {odds ? (
                          <div className="space-y-1 text-sm">
                            <div>
                              Favorite: {odds.favorite ?? '—'} / Spread: {odds.spread ?? '—'} /
                              Total: {odds.total ?? '—'}
                            </div>
                            <div className="text-xs text-gray-600 dark:text-zinc-400">
                              Line source:{' '}
                              {odds.lineSourceStatus === 'latest'
                                ? 'Latest pre-kickoff'
                                : odds.lineSourceStatus === 'closing'
                                  ? 'Frozen closing line'
                                  : 'Fallback latest for completed game'}
                              {odds.source ? ` · ${odds.source}` : ''}
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-gray-600 dark:text-zinc-400">
                            {isPlaceholder ? 'Pending matchup' : 'No odds'}
                          </div>
                        )}
                      </div>

                      <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                        <div className="font-medium mb-1">Score</div>
                        {score ? (
                          <div className="text-sm">
                            {score.away.team} {score.away.score ?? '—'} at {score.home.team}{' '}
                            {score.home.score ?? '—'} ({score.status})
                          </div>
                        ) : (
                          <div className="text-sm text-gray-600 dark:text-zinc-400">
                            {isPlaceholder ? 'Pending matchup' : 'No score'}
                          </div>
                        )}
                      </div>
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
