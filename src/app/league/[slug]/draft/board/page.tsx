import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLeague } from '@/lib/leagueRegistry';
import { getAppState } from '@/lib/server/appStateStore';
import { draftScope, type DraftState } from '@/lib/draft';
import { loadAliasMap } from '@/lib/aliases';
import { loadSeasonRankings } from '@/lib/server/rankings';
import { buildScheduleFromApi, type ScheduleWireItem } from '@/lib/schedule';
import { selectDraftTeamInsights } from '@/lib/selectors/draftTeamInsights';
import type { SpRatingEntry, WinTotalEntry, ApPollEntry } from '@/lib/selectors/draftTeamInsights';
import { getTeamDatabaseItems } from '@/lib/server/teamDatabaseStore';
import SpectatorBoardClient from '@/components/draft/SpectatorBoardClient';

export const dynamic = 'force-dynamic';

export default async function SpectatorBoardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;

  const league = await getLeague(slug);
  if (!league) notFound();

  const status = league.status;
  const year =
    status?.state === 'preseason' || status?.state === 'season'
      ? status.year
      : league.year;

  // Load draft state — show waiting state if not started
  const draftRecord = await getAppState<DraftState>(draftScope(slug), String(year));
  const draft = draftRecord?.value ?? null;

  if (!draft || draft.phase === 'setup' || draft.phase === 'settings') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <Link
          href={`/league/${slug}/`}
          className="mb-6 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← {league.displayName}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-950 dark:text-zinc-50">
          {league.displayName} — {year} Draft
        </h1>
        <p className="mt-4 text-gray-500 dark:text-zinc-400">
          The draft has not started yet. Check back when the commissioner starts the draft.
        </p>
      </main>
    );
  }

  // Load team catalog (enriched with color data when admin team sync has been run)
  const teams = await getTeamDatabaseItems();

  // Load SP+ ratings
  let spRatings: SpRatingEntry[] | null = null;
  try {
    const spRecord = await getAppState<{ ratings: SpRatingEntry[]; cachedAt: string }>(
      'sp-ratings',
      String(year)
    );
    spRatings = spRecord?.value?.ratings ?? null;
  } catch {
    // no SP+ cached
  }

  // Load win totals
  let winTotals: WinTotalEntry[] | null = null;
  try {
    const wtRecord = await getAppState<WinTotalEntry[]>('win-totals', String(year));
    winTotals = wtRecord?.value ?? null;
  } catch {
    // no win totals cached
  }

  // Load schedule
  let games: ReturnType<typeof buildScheduleFromApi>['games'] = [];
  try {
    const schedRecord = await getAppState<{ items: unknown[] }>('schedule', `${year}-all-all`);
    const schedItems = (schedRecord?.value?.items ?? []) as ScheduleWireItem[];
    if (schedItems.length > 0) {
      const aliasMap = await loadAliasMap();
      const built = buildScheduleFromApi({ scheduleItems: schedItems, teams, aliasMap, season: year });
      games = built.games;
    }
  } catch {
    // schedule not cached
  }

  // Load AP poll
  let apPoll: ApPollEntry[] | null = null;
  try {
    const rankings = await loadSeasonRankings(year);
    const latestWeek = rankings.latestWeek;
    if (latestWeek?.teams) {
      apPoll = latestWeek.teams
        .filter((t) => t.primaryRank != null)
        .map((t) => ({ teamName: t.teamName, rank: t.primaryRank! }));
    }
  } catch {
    // rankings not cached
  }

  // Derive team insights, sorted by SP+ desc
  const teamInsights = selectDraftTeamInsights({
    teams,
    spRatings,
    winTotals,
    schedule: games,
    apPoll,
    year,
  });

  teamInsights.sort((a, b) => {
    if (a.spRating !== null && b.spRating !== null) return b.spRating - a.spRating;
    if (a.spRating !== null) return -1;
    if (b.spRating !== null) return 1;
    return a.teamName.localeCompare(b.teamName);
  });

  return (
    <main className="mx-auto px-4 py-8">
      <div className="mb-6">
        <Link
          href={`/league/${slug}/`}
          className="text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← {league.displayName}
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-950 dark:text-zinc-50">
          {league.displayName} — {year} Draft
        </h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          Spectator view
        </p>
      </div>

      <SpectatorBoardClient
        slug={slug}
        year={year}
        initialDraft={draft}
        teamInsights={teamInsights}
      />
    </main>
  );
}
