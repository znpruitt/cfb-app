import React from 'react';

import type { CombinedOdds } from '../lib/odds';
import { chipClass, gameStateFromScore, pillClass, statusClasses } from '../lib/gameUi';
import type { ScorePack } from '../lib/scores';
import type { AppGame } from '../lib/schedule';

type Game = AppGame;

type GameWeekPanelProps = {
  games: Game[];
  byes: string[];
  oddsByKey: Record<string, CombinedOdds>;
  scoresByKey: Record<string, ScorePack>;
  rosterByTeam: Map<string, string>;
  isDebug: boolean;
  onSavePostseasonOverride?: (eventId: string, patch: Partial<AppGame>) => void;
  hideByes?: boolean;
};

export default function GameWeekPanel({
  games,
  byes,
  oddsByKey,
  scoresByKey,
  rosterByTeam,
  isDebug,
  onSavePostseasonOverride,
  hideByes = false,
}: GameWeekPanelProps): React.ReactElement {
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
          Postseason Placeholder
        </span>
      </div>

      <div className="grid gap-2">
        {games.map((g) => {
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

          const useNeutralSemantics =
            g.neutralDisplay === 'vs' || (g.stage !== 'regular' && g.neutral);
          const matchupLine = useNeutralSemantics
            ? `${g.csvAway} vs ${g.csvHome}`
            : g.neutral
              ? `${g.csvAway} vs ${g.csvHome}`
              : `${g.csvAway} @ ${g.csvHome}`;
          const matchupRoleLabel = useNeutralSemantics ? 'Team A' : 'Away';
          const matchupHostLabel = useNeutralSemantics ? 'Team B' : 'Home';

          return (
            <details key={g.key} className={frameClasses}>
              <summary className="cursor-pointer px-3 py-2 flex items-center justify-between">
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
                    {matchupLine}
                  </span>
                  {g.homeConf && <span className={pillClass()}>{g.homeConf}</span>}
                  {g.awayConf && <span className={pillClass()}>{g.awayConf}</span>}
                  {rosterByTeam.get(g.csvHome) && (
                    <span className={pillClass()}>Home: {rosterByTeam.get(g.csvHome)}</span>
                  )}
                  {rosterByTeam.get(g.csvAway) && (
                    <span className={pillClass()}>Away: {rosterByTeam.get(g.csvAway)}</span>
                  )}
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
                    <strong>{matchupHostLabel}</strong>: {g.csvHome}
                  </div>
                  <div>
                    <strong>{matchupRoleLabel}</strong>: {g.csvAway}
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
                    <div className="text-sm">
                      Favorite: {odds.favorite ?? '—'} / Spread: {odds.spread ?? '—'} / Total:{' '}
                      {odds.total ?? '—'}
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

      {!hideByes && (
        <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="font-medium mb-2">Byes</div>
          <div className="text-sm">{byes.length ? byes.join(', ') : '—'}</div>
        </div>
      )}
    </>
  );
}
