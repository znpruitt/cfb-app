import React from 'react';

import { deriveDisplayEventName } from '../lib/gameEventName';
import type { CombinedOdds } from '../lib/odds';
import { formatGameMatchupLabel, usesNeutralSiteSemantics } from '../lib/gameUi';
import { LEAGUE_TAG_LABELS } from '../lib/leagueInsights';
import { deriveGameWeekPanelViewModel } from '../lib/selectors/gameWeek';
import { getPresentationTimeZone } from '../lib/weekPresentation';
import type { TeamRankingEnrichment } from '../lib/rankings';
import type { ScorePack } from '../lib/scores';
import { getSafeScoreboardTeamColorById } from '../lib/teamColors';
import type { TeamCatalogItem, TeamDisplayInfo } from '../lib/teamIdentity';
import type { AppGame } from '../lib/schedule';
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

function renderMatchupLabel(
  game: AppGame,
  rankingsByTeamId: Map<string, TeamRankingEnrichment>,
  homeAwaySeparator: '@' | 'vs',
  awayTeamId: string,
  homeTeamId: string
): React.ReactElement {
  const plainLabel = formatGameMatchupLabel(game, { homeAwaySeparator });
  const separator = plainLabel.slice(game.csvAway.length, plainLabel.length - game.csvHome.length);

  return (
    <>
      <RankedTeamName teamName={game.csvAway} ranking={rankingsByTeamId.get(awayTeamId)} />
      {separator}
      <RankedTeamName teamName={game.csvHome} ranking={rankingsByTeamId.get(homeTeamId)} />
    </>
  );
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
  const viewModel = deriveGameWeekPanelViewModel({
    games,
    oddsByKey,
    scoresByKey,
    rosterByTeam,
    rankingsByTeamId,
    displayTimeZone,
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200">
          Final
        </span>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold uppercase tracking-[0.16em] text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
          In Progress
        </span>
        <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 font-semibold uppercase tracking-[0.16em] text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200">
          Scheduled
        </span>
        <span className="ml-0.5 text-[11px] text-gray-500 dark:text-zinc-400">
          Tags: Swing &gt; Upset alert &gt; Even spread
        </span>
      </div>
      {viewModel.hasNoGames ? (
        <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          No games match the current filters.
        </div>
      ) : null}
      {!viewModel.hasNoGames ? (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-600 dark:text-zinc-400">
          {viewModel.scoresAvailableCount < viewModel.totalGames ? (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 dark:border-zinc-700 dark:bg-zinc-900">
              Scores: {viewModel.scoresAvailableCount}/{viewModel.totalGames}
            </span>
          ) : null}
          {viewModel.oddsAvailableCount === 0 ? (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 dark:border-zinc-700 dark:bg-zinc-900">
              Odds unavailable
            </span>
          ) : viewModel.oddsAvailableCount < viewModel.totalGames ? (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 dark:border-zinc-700 dark:bg-zinc-900">
              Odds: {viewModel.oddsAvailableCount}/{viewModel.totalGames}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4">
        {viewModel.groupedGames.map((group) => (
          <section key={group.dateKey} className="space-y-1.5">
            <div
              className="text-sm font-semibold text-gray-700 dark:text-zinc-300"
              data-date-header={group.dateKey}
            >
              {group.label}
            </div>

            <div className="grid gap-1.5">
              {group.games.map((card) => {
                const g = card.game;

                const useNeutralSemantics = usesNeutralSiteSemantics(g);
                const matchupLabel = formatGameMatchupLabel(g, {
                  homeAwaySeparator: useNeutralSemantics ? 'vs' : '@',
                });
                const eventName = deriveDisplayEventName(g.label, g.notes, matchupLabel);
                const awayColorTreatment = getSafeScoreboardTeamColorById(
                  card.awayTeamId,
                  teamCatalogById
                );
                const homeColorTreatment = getSafeScoreboardTeamColorById(
                  card.homeTeamId,
                  teamCatalogById
                );

                return (
                  <details
                    key={g.key}
                    className={`group overflow-hidden rounded border border-gray-200 bg-white text-gray-900 transition-colors hover:border-gray-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-700 ${card.liveCardAccentClassName} ${card.emphasisClassName}`}
                    style={{
                      boxShadow: `inset 0 2px 0 ${awayColorTreatment.borderAccent}, inset 0 -2px 0 ${homeColorTreatment.borderAccent}`,
                    }}
                    data-card-team-accent-top="away"
                    data-card-team-accent-bottom="home"
                    data-primary-tag={card.tagPrimary ?? ''}
                    data-ranked-game={card.hasRankedTeam ? 'true' : 'false'}
                  >
                    <summary className="cursor-pointer list-none px-2.5 py-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex flex-col gap-1">
                          {card.showOwnerMatchup && (
                            <div className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                              {card.awayOwner} vs {card.homeOwner}
                            </div>
                          )}
                          {card.showCollapsedCanonicalLabel && (
                            <div className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                              {g.label}
                            </div>
                          )}
                          <div
                            className={`font-medium ${card.isPlaceholder ? 'text-gray-500 dark:text-zinc-400' : 'text-gray-900 dark:text-zinc-100'}`}
                          >
                            {renderMatchupLabel(
                              g,
                              rankingsByTeamId,
                              useNeutralSemantics ? 'vs' : '@',
                              card.awayTeamId,
                              card.homeTeamId
                            )}
                          </div>
                          {card.tagPrimary ? (
                            <div className="mt-0.5 inline-flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-wide">
                              <span className="rounded-full border border-blue-300 bg-blue-100 px-1.5 py-0.5 font-semibold text-blue-800 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                                {LEAGUE_TAG_LABELS[card.tagPrimary]}
                              </span>
                              {card.tagSecondary.map((tag) => (
                                <span
                                  key={`${g.key}:${tag}`}
                                  className="rounded-full border border-gray-200 bg-gray-50 px-1.5 py-0.5 font-medium text-gray-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                                >
                                  {LEAGUE_TAG_LABELS[tag]}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                        <div
                          className={`shrink-0 rounded-full border px-2 py-1 text-right text-[10px] font-semibold uppercase tracking-[0.18em] group-open:hidden ${card.summaryChipClassName}`}
                          data-summary-state
                        >
                          {card.summaryState}
                        </div>
                      </div>
                    </summary>

                    <div className="space-y-1.5 px-2.5 py-2.5">
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
                        score={card.score}
                        awayTeam={participantDisplayInfo(g, 'away')}
                        homeTeam={participantDisplayInfo(g, 'home')}
                        awayRanking={rankingsByTeamId.get(card.awayTeamId)}
                        homeRanking={rankingsByTeamId.get(card.homeTeamId)}
                        awayConference={g.awayConf}
                        homeConference={g.homeConf}
                        awayOwner={card.awayOwner}
                        homeOwner={card.homeOwner}
                        awayColorTreatment={awayColorTreatment}
                        homeColorTreatment={homeColorTreatment}
                        venue={g.venue}
                        odds={card.odds}
                        isPlaceholder={card.isPlaceholder}
                      />

                      {card.isPlaceholder && onSavePostseasonOverride && (
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
