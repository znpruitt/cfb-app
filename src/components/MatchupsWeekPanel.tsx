import React from 'react';

import type { CombinedOdds } from '../lib/odds';
import { chipClass, gameStateFromScore, pillClass, statusClasses } from '../lib/gameUi';
import {
  buildMatchupCardViewModel,
  deriveWeekMatchupSections,
  type MatchupBucket,
  type WeekMatchupSections,
} from '../lib/matchups';
import type { ScorePack } from '../lib/scores';
import type { AppGame } from '../lib/schedule';
import { getPresentationTimeZone } from '../lib/weekPresentation';

type MatchupsWeekPanelProps = {
  games: AppGame[];
  oddsByKey: Record<string, CombinedOdds>;
  scoresByKey: Record<string, ScorePack>;
  rosterByTeam: Map<string, string>;
  displayTimeZone?: string;
  sections?: WeekMatchupSections;
};

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

function cardTitle(game: AppGame): string {
  const useNeutralSemantics =
    game.neutralDisplay === 'vs' || (game.stage !== 'regular' && game.neutral);
  return useNeutralSemantics
    ? `${game.csvAway} vs ${game.csvHome}`
    : `${game.csvAway} @ ${game.csvHome}`;
}

function performanceClasses(tone: 'scheduled' | 'inprogress' | 'final' | 'neutral'): string {
  if (tone === 'final') {
    return 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
  }
  if (tone === 'inprogress') {
    return 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  }
  if (tone === 'neutral') {
    return 'bg-slate-100 text-slate-700 dark:bg-zinc-800 dark:text-zinc-200';
  }
  return 'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300';
}

function Section({
  title,
  subtitle,
  emptyLabel,
  games,
  oddsByKey,
  scoresByKey,
  displayTimeZone,
}: {
  title: string;
  subtitle: string;
  emptyLabel: string;
  games: MatchupBucket[];
  oddsByKey: Record<string, CombinedOdds>;
  scoresByKey: Record<string, ScorePack>;
  displayTimeZone: string;
}): React.ReactElement {
  if (!games.length) {
    return (
      <section className="space-y-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{title}</h3>
          <p className="text-xs text-gray-600 dark:text-zinc-400">{subtitle}</p>
        </div>
        <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          {emptyLabel}
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">{title}</h3>
        <p className="text-xs text-gray-600 dark:text-zinc-400">{subtitle}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {games.map((bucket) => {
          const { game } = bucket;
          const score = scoresByKey[game.key];
          const odds = oddsByKey[game.key];
          const state = gameStateFromScore(score);
          const hasAnyInfo = Boolean(score || odds);
          const card = buildMatchupCardViewModel(bucket, scoresByKey, oddsByKey);

          return (
            <article key={game.key} className={`${statusClasses(state, hasAnyInfo)} space-y-4 p-4`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div>
                    <div className="text-lg font-semibold text-gray-900 dark:text-zinc-100">
                      {card.title}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      <span
                        className={`rounded-full px-2.5 py-1 font-semibold ${performanceClasses(card.performance.tone)}`}
                      >
                        {card.performance.summary}
                      </span>
                      <span className={pillClass()}>
                        Kickoff: {formatKickoff(game.date, displayTimeZone)}
                      </span>
                      {game.label ? <span className={pillClass()}>{game.label}</span> : null}
                      {game.neutralDisplay === 'vs' ||
                      (game.stage !== 'regular' && game.neutral) ? (
                        <span className={pillClass()}>Neutral Site</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-sm text-gray-700 dark:text-zinc-300">
                    {card.performance.detail}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  <span className={chipClass()}>
                    {state === 'final'
                      ? 'Final'
                      : state === 'inprogress'
                        ? 'In Progress'
                        : state === 'scheduled'
                          ? 'Scheduled'
                          : 'No live data'}
                  </span>
                  {odds ? <span className={chipClass()}>Odds</span> : null}
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
                <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                    Teams in this matchup
                  </div>
                  <div className="mt-3 space-y-3 text-sm">
                    <div className="rounded border border-gray-200 px-3 py-2 dark:border-zinc-700">
                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                        Away side
                      </div>
                      <div className="font-medium text-gray-900 dark:text-zinc-100">
                        {bucket.awayOwner ?? 'Unowned / Non-league'}
                      </div>
                      <div className="text-gray-700 dark:text-zinc-300">
                        {card.supporting.awayTeam}
                      </div>
                    </div>
                    <div className="rounded border border-gray-200 px-3 py-2 dark:border-zinc-700">
                      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                        Home side
                      </div>
                      <div className="font-medium text-gray-900 dark:text-zinc-100">
                        {bucket.homeOwner ?? 'Unowned / Non-league'}
                      </div>
                      <div className="text-gray-700 dark:text-zinc-300">
                        {card.supporting.homeTeam}
                      </div>
                    </div>
                    <div className="text-xs text-gray-600 dark:text-zinc-400">
                      Game: {cardTitle(game)}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                      Underlying game score
                    </div>
                    <div className="mt-2 text-sm text-gray-900 dark:text-zinc-100">
                      {card.supporting.scoreSummary}
                    </div>
                  </div>

                  <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                      Odds context
                    </div>
                    <div className="mt-2 text-sm text-gray-900 dark:text-zinc-100">
                      {card.supporting.oddsSummary}
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function OtherGamesFallback({
  games,
  displayTimeZone,
}: {
  games: MatchupBucket[];
  displayTimeZone: string;
}): React.ReactElement | null {
  if (!games.length) return null;

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Other Week Games</h3>
        <p className="text-xs text-gray-600 dark:text-zinc-400">
          These games matched the current filters but are intentionally excluded from owner-focused
          matchup cards.
        </p>
      </div>
      <div className="rounded border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        <div className="mb-2">
          {games.length} game{games.length === 1 ? '' : 's'} omitted from owner matchup cards.
        </div>
        <ul className="space-y-1 text-xs text-gray-600 dark:text-zinc-400">
          {games.map(({ game }) => (
            <li key={game.key}>
              {cardTitle(game)} · Kickoff: {formatKickoff(game.date, displayTimeZone)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function MatchupsWeekPanel({
  games,
  oddsByKey,
  scoresByKey,
  rosterByTeam,
  displayTimeZone = getPresentationTimeZone(),
  sections,
}: MatchupsWeekPanelProps): React.ReactElement {
  const derivedSections = sections ?? deriveWeekMatchupSections(games, rosterByTeam);

  return (
    <div className="space-y-6">
      <Section
        title="Owner vs Owner"
        subtitle="Owner-first weekly cards showing who is leading, tied, awaiting kickoff, or final."
        emptyLabel="No owner-vs-owner matchups for this week."
        games={derivedSections.ownerMatchups}
        oddsByKey={oddsByKey}
        scoresByKey={scoresByKey}
        displayTimeZone={displayTimeZone}
      />

      <Section
        title="Secondary League Context"
        subtitle="Owned teams without a true owner-vs-owner matchup stay separate from the primary matchup cards."
        emptyLabel="No additional owned-team secondary context for this week."
        games={derivedSections.secondaryGames}
        oddsByKey={oddsByKey}
        scoresByKey={scoresByKey}
        displayTimeZone={displayTimeZone}
      />

      <OtherGamesFallback games={derivedSections.otherGames} displayTimeZone={displayTimeZone} />
    </div>
  );
}
