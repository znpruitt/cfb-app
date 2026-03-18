import React from 'react';

import type { CombinedOdds } from '../lib/odds';
import { chipClass, gameStateFromScore, pillClass, statusClasses } from '../lib/gameUi';
import {
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

function renderScoreSummary(score?: ScorePack): string {
  if (!score) return 'No score yet';
  return `${score.away.team} ${score.away.score ?? '—'} at ${score.home.team} ${score.home.score ?? '—'} (${score.status})`;
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
        {games.map(({ game, awayOwner, homeOwner, awayIsLeagueTeam, homeIsLeagueTeam }) => {
          const score = scoresByKey[game.key];
          const odds = oddsByKey[game.key];
          const state = gameStateFromScore(score);
          const hasAnyInfo = Boolean(score || odds);

          return (
            <article key={game.key} className={`${statusClasses(state, hasAnyInfo)} space-y-3 p-4`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-gray-900 dark:text-zinc-100">
                    {cardTitle(game)}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className={pillClass()}>
                      Kickoff: {formatKickoff(game.date, displayTimeZone)}
                    </span>
                    {game.label ? <span className={pillClass()}>{game.label}</span> : null}
                    {game.neutralDisplay === 'vs' || (game.stage !== 'regular' && game.neutral) ? (
                      <span className={pillClass()}>Neutral Site</span>
                    ) : null}
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

              <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr]">
                <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                    League framing
                  </div>
                  <div className="mt-2 space-y-2 text-sm">
                    <div>
                      <div className="font-medium text-gray-900 dark:text-zinc-100">Away</div>
                      <div>{game.csvAway}</div>
                      <div className="text-xs text-gray-600 dark:text-zinc-400">
                        {awayOwner
                          ? `Owner: ${awayOwner}`
                          : awayIsLeagueTeam
                            ? 'League team: unowned'
                            : 'Non-league / FCS opponent'}
                      </div>
                    </div>
                    <div>
                      <div className="font-medium text-gray-900 dark:text-zinc-100">Home</div>
                      <div>{game.csvHome}</div>
                      <div className="text-xs text-gray-600 dark:text-zinc-400">
                        {homeOwner
                          ? `Owner: ${homeOwner}`
                          : homeIsLeagueTeam
                            ? 'League team: unowned'
                            : 'Non-league / FCS opponent'}
                      </div>
                    </div>
                    {awayOwner && homeOwner ? (
                      <div className="rounded bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
                        Owner Matchup: {awayOwner} vs {homeOwner}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                    Score
                  </div>
                  <div className="mt-2 text-sm text-gray-900 dark:text-zinc-100">
                    {renderScoreSummary(score)}
                  </div>
                </div>

                <div className="rounded border border-gray-300 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-zinc-400">
                    Odds
                  </div>
                  <div className="mt-2 text-sm text-gray-900 dark:text-zinc-100">
                    {odds ? (
                      <>
                        <div>Favorite: {odds.favorite ?? '—'}</div>
                        <div>Spread: {odds.spread ?? '—'}</div>
                        <div>Total: {odds.total ?? '—'}</div>
                      </>
                    ) : (
                      'No odds available'
                    )}
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
          These games matched the current filters but do not have owner-focused card context yet.
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
        subtitle="Primary league matchups for the selected week."
        emptyLabel="No owner-vs-owner matchups for this week."
        games={derivedSections.ownerMatchups}
        oddsByKey={oddsByKey}
        scoresByKey={scoresByKey}
        displayTimeZone={displayTimeZone}
      />

      <Section
        title="Secondary League Context"
        subtitle="Lower-priority games involving one owned team against an unowned or non-league/FCS opponent."
        emptyLabel="No additional owned-vs-unowned or owned-vs-FCS games for this week."
        games={derivedSections.secondaryGames}
        oddsByKey={oddsByKey}
        scoresByKey={scoresByKey}
        displayTimeZone={displayTimeZone}
      />

      <OtherGamesFallback games={derivedSections.otherGames} displayTimeZone={displayTimeZone} />
    </div>
  );
}
