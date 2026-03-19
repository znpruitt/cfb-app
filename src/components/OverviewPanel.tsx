import React from 'react';

import { gameStateFromScore } from '../lib/gameUi';
import type { OverviewGameItem } from '../lib/overview';
import type { OwnerStandingsRow, StandingsCoverage } from '../lib/standings';
import { getPresentationTimeZone } from '../lib/weekPresentation';

function formatWinPct(value: number): string {
  return value.toFixed(3);
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

function formatScoreLine(item: OverviewGameItem): string {
  const score = item.score;
  if (!score) return 'Awaiting score';

  const awayScore = score.away.score ?? '—';
  const homeScore = score.home.score ?? '—';
  return `${item.bucket.game.csvAway} ${awayScore} at ${item.bucket.game.csvHome} ${homeScore}`;
}

function summarizeLeagueAngle(item: OverviewGameItem): string {
  const { awayOwner, homeOwner, game } = item.bucket;
  if (awayOwner && homeOwner) {
    return `${awayOwner} vs ${homeOwner}`;
  }

  if (awayOwner) {
    return `${awayOwner}: ${game.csvAway}`;
  }

  if (homeOwner) {
    return `${homeOwner}: ${game.csvHome}`;
  }

  return `${game.csvAway} at ${game.csvHome}`;
}

function summarizePriority(item: OverviewGameItem): string {
  return item.bucket.awayOwner && item.bucket.homeOwner ? 'Owner vs owner' : 'Owned team spotlight';
}

function stateBadgeClasses(state: 'final' | 'inprogress' | 'scheduled' | 'unknown'): string {
  if (state === 'inprogress') {
    return 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300';
  }
  if (state === 'final') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300';
  }
  return 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300';
}

function SectionCard({
  title,
  description,
  children,
  tone = 'default',
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  tone?: 'default' | 'live' | 'weekly';
}): React.ReactElement {
  const toneClasses =
    tone === 'live'
      ? 'border-amber-200/70 bg-gradient-to-br from-amber-50/80 to-white dark:border-amber-900/60 dark:from-amber-950/20 dark:to-zinc-900'
      : tone === 'weekly'
        ? 'border-blue-200/70 bg-gradient-to-br from-blue-50/70 to-white dark:border-blue-900/60 dark:from-blue-950/20 dark:to-zinc-900'
        : 'border-gray-300 bg-white dark:border-zinc-700 dark:bg-zinc-900';

  return (
    <section className={`rounded border p-4 shadow-sm ${toneClasses}`}>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-gray-950 dark:text-zinc-50">
          {title}
        </h2>
        <p className="text-sm text-gray-600 dark:text-zinc-300">{description}</p>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyState({ message }: { message: string }): React.ReactElement {
  return (
    <div className="rounded border border-dashed border-gray-300 bg-gray-50/80 px-4 py-4 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-300">
      {message}
    </div>
  );
}

function GameCardList({
  items,
  emptyMessage,
  timeZone,
}: {
  items: OverviewGameItem[];
  emptyMessage: string;
  timeZone: string;
}): React.ReactElement {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const state = gameStateFromScore(item.score);
        return (
          <article
            key={item.bucket.game.key}
            className="rounded border border-gray-200 bg-white/80 p-3 dark:border-zinc-800 dark:bg-zinc-950/70"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-gray-950 dark:text-zinc-50">
                  {item.bucket.game.csvAway} at {item.bucket.game.csvHome}
                </div>
                <div className="text-sm text-gray-600 dark:text-zinc-300">
                  {summarizeLeagueAngle(item)}
                </div>
              </div>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${stateBadgeClasses(state)}`}
              >
                {item.score?.status ?? 'Scheduled'}
              </span>
            </div>
            <div className="mt-2 text-sm font-medium text-gray-800 dark:text-zinc-100">
              {formatScoreLine(item)}
            </div>
            <div className="mt-1 text-xs text-gray-500 dark:text-zinc-400">
              {formatKickoff(item.bucket.game.date, timeZone)}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function GameSummaryList({
  items,
  emptyMessage,
  timeZone,
}: {
  items: OverviewGameItem[];
  emptyMessage: string;
  timeZone: string;
}): React.ReactElement {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        const state = gameStateFromScore(item.score);

        return (
          <article
            key={item.bucket.game.key}
            className="flex flex-wrap items-start justify-between gap-3 rounded border border-gray-200 bg-white/80 px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950/70"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-950 dark:text-zinc-50">
                  {item.bucket.game.csvAway} at {item.bucket.game.csvHome}
                </h3>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {summarizePriority(item)}
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-zinc-300">
                {summarizeLeagueAngle(item)}
              </p>
              <p className="text-xs text-gray-500 dark:text-zinc-400">{formatScoreLine(item)}</p>
            </div>
            <div className="space-y-1 text-right">
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${stateBadgeClasses(state)}`}
              >
                {item.score?.status ?? 'Scheduled'}
              </span>
              <div className="text-xs text-gray-500 dark:text-zinc-400">
                {formatKickoff(item.bucket.game.date, timeZone)}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

type OverviewPanelProps = {
  standingsLeaders: OwnerStandingsRow[];
  standingsCoverage: StandingsCoverage;
  liveItems: OverviewGameItem[];
  keyMatchups: OverviewGameItem[];
  selectedWeekLabel: string;
  displayTimeZone?: string;
};

export default function OverviewPanel({
  standingsLeaders,
  standingsCoverage,
  liveItems,
  keyMatchups,
  selectedWeekLabel,
  displayTimeZone,
}: OverviewPanelProps): React.ReactElement {
  const timeZone = displayTimeZone ?? getPresentationTimeZone();

  return (
    <div className="space-y-4">
      <SectionCard
        title="Standings snapshot"
        description="Top of the league right now, using the same shared standings derivation as the full standings view."
      >
        {standingsCoverage.message ? (
          <p
            className={`mb-3 text-sm ${
              standingsCoverage.state === 'error'
                ? 'text-amber-700 dark:text-amber-300'
                : 'text-gray-600 dark:text-zinc-300'
            }`}
          >
            {standingsCoverage.message}
          </p>
        ) : (
          <p className="mb-3 text-sm text-gray-600 dark:text-zinc-300">
            League leaders update automatically as owned-team final scores are attached.
          </p>
        )}
        {standingsLeaders.length === 0 ? (
          <EmptyState message="Upload owners to populate the league overview." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-zinc-500">
                  {['Rank', 'Owner', 'Record', 'Win %'].map((label) => (
                    <th
                      key={label}
                      className="border-b border-gray-200 px-3 py-2 font-semibold dark:border-zinc-700"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {standingsLeaders.map((row, index) => (
                  <tr
                    key={row.owner}
                    className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
                  >
                    <td className="border-b border-gray-100 px-3 py-2 font-semibold tabular-nums text-gray-900 dark:border-zinc-800 dark:text-zinc-100">
                      {index + 1}
                    </td>
                    <td className="border-b border-gray-100 px-3 py-2 font-semibold text-gray-950 dark:border-zinc-800 dark:text-zinc-50">
                      {row.owner}
                    </td>
                    <td className="border-b border-gray-100 px-3 py-2 font-medium tabular-nums text-gray-900 dark:border-zinc-800 dark:text-zinc-100">
                      {row.wins}–{row.losses}
                    </td>
                    <td className="border-b border-gray-100 px-3 py-2 tabular-nums text-gray-600 dark:border-zinc-800 dark:text-zinc-300">
                      {formatWinPct(row.winPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <SectionCard
          title="Live league-relevant games"
          description="Owned-team games in progress right now, with owner-versus-owner contests surfaced first."
          tone="live"
        >
          <GameCardList
            items={liveItems}
            emptyMessage="No owned-team games are live right now."
            timeZone={timeZone}
          />
        </SectionCard>

        <SectionCard
          title="This week’s key matchups"
          description={`A quick-read summary for ${selectedWeekLabel}, not the full matchup board.`}
          tone="weekly"
        >
          <GameSummaryList
            items={keyMatchups}
            emptyMessage="No league-relevant games are queued for this view yet."
            timeZone={timeZone}
          />
        </SectionCard>
      </div>
    </div>
  );
}
