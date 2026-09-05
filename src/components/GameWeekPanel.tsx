import React from 'react';

import { deriveDisplayEventName } from '../lib/gameEventName';
import { displayOwner } from '../lib/gameOwnership';
import type { CombinedOdds } from '../lib/odds';
import { formatGameMatchupLabel, usesNeutralSiteSemantics } from '../lib/gameUi';
import { LEAGUE_TAG_LABELS } from '../lib/gameTags';
import { deriveGameWeekPanelViewModel } from '../lib/selectors/gameWeek';
import type { TeamRecordsByProviderGameId } from '../lib/selectors/teamRecordsClient';
import { getPresentationTimeZone } from '../lib/weekPresentation';
import type { TeamRankingEnrichment } from '../lib/rankings';
import type { ScorePack } from '../lib/scores';
import type { TeamCatalogItem, TeamDisplayInfo } from '../lib/teamIdentity';
import type { AppGame } from '../lib/schedule';
import CompactGameScoreboard from './CompactGameScoreboard';

type Game = AppGame;

const EMPTY_TEAM_RECORDS: TeamRecordsByProviderGameId = {};
const EYEBROW_TAG_CLASSES =
  'inline-flex shrink-0 rounded-full border border-[#c9a66b]/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#dbc190]';

function participantDisplayInfo(game: AppGame, side: 'home' | 'away'): TeamDisplayInfo {
  const participant = game.participants[side];
  if (participant.kind === 'team' && participant.labels) {
    return participant.labels;
  }

  const fallbackName =
    participant.kind === 'team'
      ? participant.rawName.trim() || participant.displayName
      : participant.displayName;

  return {
    displayName: fallbackName,
    shortDisplayName: fallbackName,
    scoreboardName: fallbackName,
  };
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
  teamRecordsByProviderGameId?: TeamRecordsByProviderGameId;
  onSavePostseasonOverride?: (eventId: string, patch: Partial<AppGame>) => void;
  hideByes?: boolean;
  displayTimeZone?: string;
  currentDateMs?: number | null;
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
  teamRecordsByProviderGameId = EMPTY_TEAM_RECORDS,
  onSavePostseasonOverride,
  hideByes = false,
  displayTimeZone = getPresentationTimeZone(),
  currentDateMs = null,
  focusedGameId = null,
}: GameWeekPanelProps): React.ReactElement {
  const gameCardRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const viewModel = deriveGameWeekPanelViewModel({
    games,
    oddsByKey,
    scoresByKey,
    rosterByTeam,
    rankingsByTeamId,
    teamRecordsByProviderGameId,
    displayTimeZone,
    currentDateMs,
  });
  React.useEffect(() => {
    scrollFocusedGameIntoView({ gameId: focusedGameId, refsByGameId: gameCardRefs.current });
  }, [focusedGameId]);

  return (
    <>
      {viewModel.hasNoGames ? (
        <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-3 text-sm text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          No games match the current filters.
        </div>
      ) : null}
      <div className="@container grid gap-4">
        {viewModel.groupedGames.map((group) => (
          <section key={group.dateKey} className="space-y-1.5">
            <div
              className="text-sm font-semibold text-gray-700 dark:text-zinc-300"
              data-date-header={group.dateKey}
            >
              {group.label}
            </div>

            <div
              className="grid grid-cols-2 gap-x-10 @max-[760.01px]:grid-cols-1"
              data-schedule-scoreboard-grid
            >
              {group.games.map((card) => {
                const g = card.game;
                const awayDisplayOwner = displayOwner(card.awayOwner);
                const homeDisplayOwner = displayOwner(card.homeOwner);
                const useNeutralSemantics = usesNeutralSiteSemantics(g);
                const matchupLabel = formatGameMatchupLabel(g, {
                  homeAwaySeparator: useNeutralSemantics ? 'vs' : '@',
                });
                const eventName = deriveDisplayEventName(g.label, g.notes, matchupLabel);
                const contextEventName =
                  eventName ?? (card.showCanonicalEventLabel ? g.label : null);
                const primaryTag = card.tagPrimary;
                const secondaryTags = card.tagSecondary;
                const tags = primaryTag ? [primaryTag, ...secondaryTags] : secondaryTags;
                const awayDisplay = participantDisplayInfo(g, 'away');
                const homeDisplay = participantDisplayInfo(g, 'home');
                const awayRanking = rankingsByTeamId.get(card.awayTeamId);
                const homeRanking = rankingsByTeamId.get(card.homeTeamId);
                const hasTier2Content = Boolean(
                  card.venueLabel ||
                    card.oddsSummary ||
                    card.conferenceSummary ||
                    (card.isPlaceholder && onSavePostseasonOverride)
                );

                return (
                  <div
                    key={g.key}
                    ref={(element) => {
                      if (!element) {
                        gameCardRefs.current.delete(g.key);
                        return;
                      }
                      gameCardRefs.current.set(g.key, element);
                    }}
                    className={
                      focusedGameId === g.key ? 'ring-1 ring-blue-500 dark:ring-blue-500' : ''
                    }
                    data-primary-tag={primaryTag ?? ''}
                    data-ranked-game={card.hasRankedTeam ? 'true' : 'false'}
                    data-focused-game={focusedGameId === g.key ? 'true' : 'false'}
                    data-game-card-id={g.key}
                  >
                    <CompactGameScoreboard
                      state={card.scoreboardState}
                      clock={card.kickoffLabel ?? undefined}
                      broadcast={card.broadcastLabel}
                      neutralSite={useNeutralSemantics}
                      scheduleNotice={card.scheduleNotice}
                      matchupLabel={matchupLabel}
                      contextSlot={
                        contextEventName || tags.length > 0 ? (
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            {contextEventName ? (
                              <span
                                className="min-w-0 truncate text-xs dark:text-zinc-400"
                                data-expanded-event-name
                              >
                                {contextEventName}
                              </span>
                            ) : null}
                            {tags.map((tag) => (
                              <span key={`${g.key}:${tag}`} className={EYEBROW_TAG_CLASSES}>
                                {LEAGUE_TAG_LABELS[tag]}
                              </span>
                            ))}
                          </div>
                        ) : undefined
                      }
                      away={{
                        teamName: awayDisplay.scoreboardName,
                        owner: awayDisplayOwner,
                        rank: awayRanking?.rank,
                        rankSource: awayRanking?.rankSource,
                        classification: g.awayClassification,
                        record: card.teamRecords?.away,
                        score: card.score?.away.score ?? null,
                      }}
                      home={{
                        teamName: homeDisplay.scoreboardName,
                        owner: homeDisplayOwner,
                        rank: homeRanking?.rank,
                        rankSource: homeRanking?.rankSource,
                        classification: g.homeClassification,
                        record: card.teamRecords?.home,
                        score: card.score?.home.score ?? null,
                      }}
                      tier2Slot={
                        hasTier2Content ? (
                          <details
                            className="group/tier2 text-xs dark:text-zinc-400"
                            open={focusedGameId === g.key ? true : undefined}
                          >
                            <summary
                              className="w-fit cursor-pointer list-none select-none py-0.5"
                              aria-label={`More details for ${matchupLabel}`}
                            >
                              <span className="group-open/tier2:hidden">More ↓</span>
                              <span className="hidden group-open/tier2:inline">Less ↑</span>
                            </summary>
                            <div className="mt-1 space-y-1 pb-1">
                              {card.venueLabel ? (
                                <div data-schedule-tier2-venue>{card.venueLabel}</div>
                              ) : null}
                              {card.oddsSummary ? (
                                <div data-schedule-tier2-odds>{card.oddsSummary}</div>
                              ) : null}
                              {card.conferenceSummary ? (
                                <div data-schedule-tier2-conference>{card.conferenceSummary}</div>
                              ) : null}
                              {card.isPlaceholder && onSavePostseasonOverride ? (
                                <button
                                  className="rounded border px-2 py-1 text-xs"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    const nextLabel =
                                      window.prompt('Override event label', g.label ?? '') ?? '';
                                    if (!nextLabel.trim()) return;
                                    onSavePostseasonOverride(g.eventId, {
                                      label: nextLabel.trim(),
                                    });
                                  }}
                                >
                                  Save label override
                                </button>
                              ) : null}
                            </div>
                          </details>
                        ) : undefined
                      }
                    />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {!hideByes && (
        <div className="rounded border border-gray-300 bg-gray-50 p-3 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="font-medium mb-2">Byes</div>
          <div className="text-sm">{byes.length ? byes.join(', ') : '—'}</div>
        </div>
      )}
    </>
  );
}
