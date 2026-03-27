import React from 'react';

import { deriveDisplayEventName } from '../lib/gameEventName';
import type { CombinedOdds } from '../lib/odds';
import { formatGameMatchupLabel, usesNeutralSiteSemantics } from '../lib/gameUi';
import { LEAGUE_TAG_LABELS } from '../lib/leagueInsights';
import { deriveGameWeekPanelViewModel } from '../lib/selectors/gameWeek';
import { deriveOddsAvailabilitySummary } from '../lib/selectors/matchups';
import { getPresentationTimeZone } from '../lib/weekPresentation';
import type { TeamRankingEnrichment } from '../lib/rankings';
import type { ScorePack } from '../lib/scores';
import { getSafeScoreboardTeamColorById } from '../lib/teamColors';
import type { TeamCatalogItem, TeamDisplayInfo } from '../lib/teamIdentity';
import type { AppGame } from '../lib/schedule';
import GameScoreboard from './GameScoreboard';
import RankedTeamName from './RankedTeamName';

type Game = AppGame;

function summaryChipClasses(
  tone: 'final' | 'live' | 'disrupted' | 'placeholder' | 'scheduled'
): string {
  if (tone === 'final') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200';
  }
  if (tone === 'live') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200';
  }
  if (tone === 'disrupted') {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/15 dark:text-rose-200';
  }
  if (tone === 'placeholder') {
    return 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-200';
  }
  return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/15 dark:text-sky-200';
}

function cardEmphasisClasses(tone: 'swing' | 'upset' | 'even' | 'ranked' | 'none'): string {
  if (tone === 'swing') {
    return 'border-indigo-300/80 bg-indigo-50/35 dark:border-indigo-900/70 dark:bg-indigo-950/20';
  }
  if (tone === 'upset') {
    return 'border-amber-300/80 bg-amber-50/35 dark:border-amber-900/70 dark:bg-amber-950/20';
  }
  if (tone === 'even') {
    return 'border-sky-300/80 bg-sky-50/30 dark:border-sky-900/70 dark:bg-sky-950/20';
  }
  if (tone === 'ranked') {
    return 'border-blue-300/70 bg-blue-50/20 dark:border-blue-900/70 dark:bg-blue-950/15';
  }
  return '';
}

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
  focusedGameId?: string | null;
};

type FocusableElement = {
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

export function scrollFocusedGameIntoView(params: {
  gameId: string | null;
  refsByGameId: Map<string, FocusableElement>;
}): boolean {
  const { gameId, refsByGameId } = params;
  if (!gameId) return false;
  const element = refsByGameId.get(gameId);
  if (!element) return false;
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

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
  focusedGameId = null,
}: GameWeekPanelProps): React.ReactElement {
  const gameCardRefs = React.useRef<Map<string, HTMLDetailsElement>>(new Map());
  const viewModel = deriveGameWeekPanelViewModel({
    games,
    oddsByKey,
    scoresByKey,
    rosterByTeam,
    rankingsByTeamId,
    displayTimeZone,
  });
  const oddsSummary = deriveOddsAvailabilitySummary({
    gamesCount: viewModel.totalGames,
    oddsAvailableCount: viewModel.oddsAvailableCount,
  });

  React.useEffect(() => {
    scrollFocusedGameIntoView({ gameId: focusedGameId, refsByGameId: gameCardRefs.current });
  }, [focusedGameId]);

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
          {oddsSummary ? (
            <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 dark:border-zinc-700 dark:bg-zinc-900">
              {oddsSummary}
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
                    ref={(element) => {
                      if (!element) {
                        gameCardRefs.current.delete(g.key);
                        return;
                      }
                      gameCardRefs.current.set(g.key, element);
                    }}
                    className={`group overflow-hidden rounded border border-gray-200 bg-white text-gray-900 transition-colors hover:border-gray-300 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-zinc-700 ${
                      card.isLiveState ? 'ring-1 ring-amber-300/70 dark:ring-amber-800/60' : ''
                    } ${cardEmphasisClasses(card.emphasisTone)} ${
                      focusedGameId === g.key ? 'ring-1 ring-blue-500 dark:ring-blue-500' : ''
                    }`}
                    style={{
                      boxShadow: `inset 0 2px 0 ${awayColorTreatment.borderAccent}, inset 0 -2px 0 ${homeColorTreatment.borderAccent}`,
                    }}
                    data-card-team-accent-top="away"
                    data-card-team-accent-bottom="home"
                    data-primary-tag={card.tagPrimary ?? ''}
                    data-ranked-game={card.hasRankedTeam ? 'true' : 'false'}
                    data-focused-game={focusedGameId === g.key ? 'true' : 'false'}
                    data-game-card-id={g.key}
                    open={focusedGameId === g.key ? true : undefined}
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
                          className={`shrink-0 rounded-full border px-2 py-1 text-right text-[10px] font-semibold uppercase tracking-[0.18em] group-open:hidden ${summaryChipClasses(card.summaryStateTone)}`}
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
