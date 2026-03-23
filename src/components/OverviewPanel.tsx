import React from 'react';

import { formatGameMatchupLabel, gameStateFromScore } from '../lib/gameUi';
import type {
  OverviewContext,
  OverviewGameItem,
  OverviewSectionKind,
  OwnerMatchupMatrix,
} from '../lib/overview';
import type { TeamRankingEnrichment } from '../lib/rankings';
import { getGameParticipantTeamId } from '../lib/schedule';
import type { OwnerStandingsRow, StandingsCoverage } from '../lib/standings';
import { getPresentationTimeZone } from '../lib/weekPresentation';
import RankedTeamName from './RankedTeamName';

function formatWinPct(value: number): string {
  return value.toFixed(3);
}

function formatDiff(value: number): string {
  return value > 0 ? `+${value}` : String(value);
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
  item: OverviewGameItem,
  rankingsByTeamId: Map<string, TeamRankingEnrichment>
): React.ReactElement {
  const game = item.bucket.game;
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

function formatScoreLine(item: OverviewGameItem): string {
  const score = item.score;
  if (!score) return 'Awaiting score';

  const awayScore = score.away.score ?? '—';
  const homeScore = score.home.score ?? '—';
  return `${formatGameMatchupLabel(item.bucket.game)} · ${awayScore}-${homeScore}`;
}

function summarizeLeagueAngle(
  item: OverviewGameItem,
  rankingsByTeamId: Map<string, TeamRankingEnrichment>
): React.ReactNode {
  const { awayOwner, homeOwner, game } = item.bucket;
  const awayTeamId = getGameParticipantTeamId(game, 'away') ?? game.canAway;
  const homeTeamId = getGameParticipantTeamId(game, 'home') ?? game.canHome;
  if (awayOwner && homeOwner) {
    return `${awayOwner} vs ${homeOwner}`;
  }

  if (awayOwner) {
    return (
      <>
        {awayOwner}:{' '}
        <RankedTeamName teamName={game.csvAway} ranking={rankingsByTeamId.get(awayTeamId)} />
      </>
    );
  }

  if (homeOwner) {
    return (
      <>
        {homeOwner}:{' '}
        <RankedTeamName teamName={game.csvHome} ranking={rankingsByTeamId.get(homeTeamId)} />
      </>
    );
  }

  return renderMatchupLabel(item, rankingsByTeamId);
}

function summarizePriority(item: OverviewGameItem): string {
  return item.bucket.awayOwner && item.bucket.homeOwner ? 'Head-to-head' : 'Team spotlight';
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
    <section className={`rounded-xl border p-4 shadow-sm sm:p-5 ${toneClasses}`}>
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
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/80 px-4 py-4 text-sm text-gray-600 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-300">
      {message}
    </div>
  );
}

function CondensedStandingsTable({
  rows,
  onOwnerSelect,
}: {
  rows: OwnerStandingsRow[];
  onOwnerSelect?: (owner: string) => void;
}): React.ReactElement {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="min-w-full border-separate border-spacing-0 text-sm sm:text-[0.95rem]">
        <thead>
          <tr className="text-left text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-zinc-500">
            {['Rank', 'Team', 'Record', 'Win %', 'Diff'].map((label) => (
              <th
                key={label}
                className="whitespace-nowrap border-b border-gray-200 px-2 py-2 font-semibold sm:px-3 dark:border-zinc-700"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.owner}
              className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
            >
              <td className="border-b border-gray-100 px-2 py-2 text-base font-semibold tabular-nums text-gray-900 sm:px-3 dark:border-zinc-800 dark:text-zinc-100">
                {index + 1}
              </td>
              <td className="border-b border-gray-100 px-2 py-2 font-semibold text-gray-950 sm:px-3 dark:border-zinc-800 dark:text-zinc-50">
                <div className="min-w-[8.5rem] truncate sm:min-w-0">
                  {onOwnerSelect ? (
                    <button
                      type="button"
                      className="text-left underline decoration-gray-300 underline-offset-2 hover:decoration-gray-500 dark:decoration-zinc-600 dark:hover:decoration-zinc-300"
                      onClick={() => onOwnerSelect(row.owner)}
                    >
                      {row.owner}
                    </button>
                  ) : (
                    row.owner
                  )}
                </div>
              </td>
              <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 font-semibold tabular-nums text-gray-900 sm:px-3 dark:border-zinc-800 dark:text-zinc-100">
                {row.wins}–{row.losses}
              </td>
              <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 tabular-nums text-gray-600 sm:px-3 dark:border-zinc-800 dark:text-zinc-300">
                {formatWinPct(row.winPct)}
              </td>
              <td className="whitespace-nowrap border-b border-gray-100 px-2 py-2 tabular-nums text-gray-500 sm:px-3 dark:border-zinc-800 dark:text-zinc-400">
                {formatDiff(row.pointDifferential)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamMatchupMatrixTable({ matrix }: { matrix: OwnerMatchupMatrix }): React.ReactElement {
  if (matrix.owners.length === 0) {
    return <EmptyState message="Upload surnames to map weekly head-to-head game counts." />;
  }

  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div className="mb-2 text-xs text-gray-500 dark:text-zinc-400 sm:hidden">
        Scroll sideways to compare every surname.
      </div>
      <table className="min-w-max border-separate border-spacing-0 text-center text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-zinc-500">
            <th className="sticky left-0 z-10 whitespace-nowrap border-b border-gray-200 bg-white px-3 py-2 text-left font-semibold dark:border-zinc-700 dark:bg-zinc-900">
              Team
            </th>
            {matrix.owners.map((owner) => (
              <th
                key={owner}
                className="min-w-[4.5rem] whitespace-nowrap border-b border-gray-200 px-3 py-2 font-semibold dark:border-zinc-700"
              >
                {owner}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => (
            <tr
              key={row.owner}
              className="odd:bg-gray-50/70 even:bg-white dark:odd:bg-zinc-950/70 dark:even:bg-zinc-900"
            >
              <th className="sticky left-0 z-10 whitespace-nowrap border-b border-gray-100 bg-inherit px-3 py-2 text-left font-semibold text-gray-950 dark:border-zinc-800 dark:text-zinc-50">
                {row.owner}
              </th>
              {row.cells.map((cell) => {
                const isDiagonal = cell.owner === row.owner;
                const hasGames = cell.gameCount > 0;
                return (
                  <td
                    key={`${row.owner}-${cell.owner}`}
                    className={`border-b border-gray-100 px-3 py-2 align-middle dark:border-zinc-800 ${
                      isDiagonal
                        ? 'bg-gray-100/80 dark:bg-zinc-800/70'
                        : hasGames
                          ? 'bg-blue-50/70 font-semibold text-gray-900 dark:bg-blue-950/20 dark:text-zinc-100'
                          : 'text-gray-400 dark:text-zinc-600'
                    }`}
                  >
                    {hasGames ? (
                      <div className="flex flex-col items-center leading-tight">
                        <span>{cell.gameCount}</span>
                        {cell.record ? (
                          <span className="text-[11px] font-medium text-gray-500 dark:text-zinc-400">
                            {cell.record}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span>{isDiagonal ? '—' : ''}</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GameCardList({
  items,
  emptyMessage,
  timeZone,
  rankingsByTeamId,
}: {
  items: OverviewGameItem[];
  emptyMessage: string;
  timeZone: string;
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
}): React.ReactElement {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-3 sm:space-y-3">
      {items.map((item) => {
        const state = gameStateFromScore(item.score);
        return (
          <article
            key={item.bucket.game.key}
            className="rounded-lg border border-gray-200 bg-white/80 p-3 sm:p-4 dark:border-zinc-800 dark:bg-zinc-950/70"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-950 dark:text-zinc-50">
                  {renderMatchupLabel(item, rankingsByTeamId)}
                </div>
                <div className="text-sm text-gray-600 dark:text-zinc-300">
                  {summarizeLeagueAngle(item, rankingsByTeamId)}
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
  rankingsByTeamId,
}: {
  items: OverviewGameItem[];
  emptyMessage: string;
  timeZone: string;
  rankingsByTeamId: Map<string, TeamRankingEnrichment>;
}): React.ReactElement {
  if (items.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-2.5">
      {items.map((item) => {
        const state = gameStateFromScore(item.score);

        return (
          <article
            key={item.bucket.game.key}
            className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white/80 px-3 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-4 dark:border-zinc-800 dark:bg-zinc-950/70"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-950 dark:text-zinc-50">
                  {renderMatchupLabel(item, rankingsByTeamId)}
                </h3>
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-gray-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                  {summarizePriority(item)}
                </span>
              </div>
              <p className="text-sm text-gray-600 dark:text-zinc-300">
                {summarizeLeagueAngle(item, rankingsByTeamId)}
              </p>
              <p className="text-xs text-gray-500 dark:text-zinc-400">{formatScoreLine(item)}</p>
            </div>
            <div className="space-y-1 text-left sm:text-right">
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
  matchupMatrix: OwnerMatchupMatrix;
  liveItems: OverviewGameItem[];
  keyMatchups: OverviewGameItem[];
  context: OverviewContext;
  displayTimeZone?: string;
  onOwnerSelect?: (owner: string) => void;
  rankingsByTeamId?: Map<string, TeamRankingEnrichment>;
};

export default function OverviewPanel({
  standingsLeaders,
  standingsCoverage,
  matchupMatrix,
  liveItems,
  keyMatchups,
  context,
  displayTimeZone,
  onOwnerSelect,
  rankingsByTeamId = new Map(),
}: OverviewPanelProps): React.ReactElement {
  const timeZone = displayTimeZone ?? getPresentationTimeZone();

  const sections: Record<OverviewSectionKind, React.ReactElement> = {
    standings: (
      <SectionCard
        title="League standings"
        description="Season-long results stay within reach without forcing Overview to feel like a week report."
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
            League-wide results update automatically as final team scores are attached.
          </p>
        )}
        {standingsLeaders.length === 0 ? (
          <EmptyState message="Upload surnames to populate the league overview." />
        ) : (
          <CondensedStandingsTable rows={standingsLeaders} onOwnerSelect={onOwnerSelect} />
        )}
      </SectionCard>
    ),
    matrix: (
      <SectionCard
        title="Head-to-head matchups"
        description="How often each team faces another this week"
        tone="weekly"
      >
        <TeamMatchupMatrixTable matrix={matchupMatrix} />
      </SectionCard>
    ),
    live: (
      <SectionCard title="Live league games" description={context.liveDescription} tone="live">
        <GameCardList
          items={liveItems}
          emptyMessage="No owned-team games are live right now."
          timeZone={timeZone}
          rankingsByTeamId={rankingsByTeamId}
        />
      </SectionCard>
    ),
    highlights: (
      <SectionCard
        title={context.highlightsTitle}
        description={context.highlightsDescription}
        tone="weekly"
      >
        <GameSummaryList
          items={keyMatchups}
          emptyMessage="No league-relevant games are scheduled for this view."
          timeZone={timeZone}
          rankingsByTeamId={rankingsByTeamId}
        />
      </SectionCard>
    ),
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-200 bg-gray-50/80 px-4 py-3 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500 dark:text-zinc-400">
              {context.scopeLabel}
            </p>
            <p className="text-sm text-gray-700 dark:text-zinc-200">
              {context.emphasis === 'live'
                ? 'Overview is prioritizing live league action right now.'
                : context.emphasis === 'upcoming'
                  ? 'Overview is leading with the next actionable slate.'
                  : context.emphasis === 'recent'
                    ? 'Overview is leading with the latest completed league results.'
                    : 'Overview is leaning on season context until the next slate takes shape.'}
            </p>
          </div>
          {context.scopeDetail ? (
            <p className="text-xs text-gray-500 dark:text-zinc-400">{context.scopeDetail}</p>
          ) : null}
        </div>
      </section>

      {context.sectionOrder.map((sectionKey) => (
        <React.Fragment key={sectionKey}>{sections[sectionKey]}</React.Fragment>
      ))}
    </div>
  );
}
