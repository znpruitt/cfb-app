import React from 'react';

import type { CombinedOdds } from '../lib/odds';
import { chipClass, gameStateFromScore, pillClass, statusClasses } from '../lib/gameUi';
import type { ScorePack } from '../lib/scores';

type Game = {
  key: string;
  week: number;
  csvAway: string;
  csvHome: string;
  neutral: boolean;
  canAway: string;
  canHome: string;
  awayConf: string;
  homeConf: string;
};

type GameWeekPanelProps = {
  games: Game[];
  byes: string[];
  oddsByKey: Record<string, CombinedOdds>;
  scoresByKey: Record<string, ScorePack>;
  rosterByTeam: Map<string, string>;
  isDebug: boolean;
};

export default function GameWeekPanel({
  games,
  byes,
  oddsByKey,
  scoresByKey,
  rosterByTeam,
  isDebug,
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
        <span className="px-2 py-0.5 rounded border-l-4 border border-gray-300 border-l-red-600 bg-red-50 text-gray-900 dark:border-zinc-700 dark:border-l-red-400 dark:bg-red-900/25 dark:text-zinc-100">
          Missing scores &amp; odds
        </span>
      </div>

      <div className="grid gap-2">
        {games.map((g) => {
          const score = scoresByKey[g.key];
          const odds = oddsByKey[g.key];
          const state = gameStateFromScore(score);
          const hasAnyInfo = Boolean(score || odds);
          const frameClasses = statusClasses(state, hasAnyInfo);

          const chips: string[] = [];
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
          if (!odds) chips.push('No odds');

          return (
            <details key={g.key} className={frameClasses}>
              <summary className="cursor-pointer px-3 py-2 flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {g.neutral ? (
                      <>
                        {g.csvAway} vs {g.csvHome}
                      </>
                    ) : (
                      <>
                        {g.csvAway} @ {g.csvHome}
                      </>
                    )}
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
                    <strong>Home</strong>: {g.csvHome}{' '}
                    {g.homeConf && <span className={pillClass() + ' ml-1'}>{g.homeConf}</span>}
                  </div>
                  <div>
                    <strong>Away</strong>: {g.csvAway}{' '}
                    {g.awayConf && <span className={pillClass() + ' ml-1'}>{g.awayConf}</span>}
                  </div>
                  <div>
                    <strong>Week</strong>: {g.week}
                  </div>
                  {isDebug && (
                    <div className="text-xs text-gray-600 dark:text-zinc-400 mt-2">
                      Canonical (for data): {g.canAway} @ {g.canHome}
                    </div>
                  )}
                </div>

                <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="font-medium mb-1">Vegas Odds</div>
                  {odds?.source && (
                    <div className="text-xs text-gray-600 dark:text-zinc-400 mb-1">
                      Source: {odds.source}
                    </div>
                  )}
                  {odds ? (
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div>Favorite</div>
                      <div className="text-right">{odds.favorite ?? '—'}</div>
                      <div>Spread</div>
                      <div className="text-right">{odds.spread ?? '—'}</div>
                      <div>Total</div>
                      <div className="text-right">{odds.total ?? '—'}</div>
                      <div>ML Home</div>
                      <div className="text-right">{odds.mlHome ?? '—'}</div>
                      <div>ML Away</div>
                      <div className="text-right">{odds.mlAway ?? '—'}</div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-600 dark:text-zinc-400">No odds loaded.</div>
                  )}
                </div>

                <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="font-medium mb-2">Live / Final</div>
                  {score ? (
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div>
                          {score.away.team} <strong>{score.away.score ?? ''}</strong>
                        </div>
                        <div>
                          {score.home.team} <strong>{score.home.score ?? ''}</strong>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs uppercase tracking-wide">{score.status}</div>
                        {score.time && <div className="text-xs">{score.time}</div>}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-600 dark:text-zinc-400">No score loaded.</div>
                  )}
                </div>
              </div>
            </details>
          );
        })}
      </div>

      {byes.length > 0 && (
        <div className="rounded border border-gray-300 bg-white mt-4 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="p-3 font-medium">Teams on BYE ({byes.length})</div>
          <div className="p-3 flex flex-wrap gap-2">
            {byes.map((t) => (
              <span key={t} className={pillClass()}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
