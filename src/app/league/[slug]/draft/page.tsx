import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getLeague } from '@/lib/leagueRegistry';
import { getAppState } from '@/lib/server/appStateStore';
import { draftScope, type DraftState } from '@/lib/draft';
import { loadAliasMap } from '@/lib/aliases';
import { loadSeasonRankings } from '@/lib/server/rankings';
import { buildScheduleFromApi, type ScheduleWireItem } from '@/lib/schedule';
import { selectDraftTeamInsights } from '@/lib/selectors/draftTeamInsights';
import type { SpRatingEntry, WinTotalEntry, ApPollEntry } from '@/lib/selectors/draftTeamInsights';
import teamsData from '@/data/teams.json';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import DraftBoardClient from '@/components/draft/DraftBoardClient';

type TeamsJson = { items: TeamCatalogItem[] };

export const dynamic = 'force-dynamic';

export default async function DraftBoardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;

  const league = await getLeague(slug);
  if (!league) notFound();

  const year = league.year;

  // Load draft state
  const draftRecord = await getAppState<DraftState>(draftScope(slug), String(year));
  const draft = draftRecord?.value ?? null;

  // If no draft or still in setup/settings phase, redirect to setup
  if (!draft || draft.phase === 'setup' || draft.phase === 'settings') {
    redirect(`/league/${slug}/draft/setup`);
  }

  // draft is non-null past this point (redirect() throws)
  const liveDraft = draft as DraftState;

  // Load team catalog
  const { items: teams } = teamsData as TeamsJson;

  // Load SP+ ratings
  let spRatings: SpRatingEntry[] | null = null;
  try {
    const spRecord = await getAppState<{ ratings: SpRatingEntry[]; cachedAt: string }>(
      'sp-ratings',
      String(year)
    );
    spRatings = spRecord?.value?.ratings ?? null;
  } catch {
    // no SP+ cached — insights will show awaitingRatings: true
  }

  // Load win totals
  let winTotals: WinTotalEntry[] | null = null;
  try {
    const wtRecord = await getAppState<WinTotalEntry[]>('win-totals', String(year));
    winTotals = wtRecord?.value ?? null;
  } catch {
    // no win totals cached
  }

  // Load schedule for home/away/neutral counts and ranked opponent detection
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
    // schedule not cached — insights will have 0 home/away/neutral counts
  }

  // Load AP poll for preseason ranks and ranked opponent detection
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

  // Derive team insights
  const teamInsights = selectDraftTeamInsights({
    teams,
    spRatings,
    winTotals,
    schedule: games,
    apPoll,
    year,
  });

  // Sort by SP+ rating desc, then alphabetically
  teamInsights.sort((a, b) => {
    if (a.spRating !== null && b.spRating !== null) return b.spRating - a.spRating;
    if (a.spRating !== null) return -1;
    if (b.spRating !== null) return 1;
    return a.teamName.localeCompare(b.teamName);
  });

  return (
    <main className="mx-auto max-w-screen-xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
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
            Commissioner board ·{' '}
            <Link
              href={`/league/${slug}/draft/board`}
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Spectator view →
            </Link>
          </p>
        </div>
        <Link
          href={`/league/${slug}/draft/setup`}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          Setup
        </Link>
      </div>

      <DraftBoardClient
        slug={slug}
        year={year}
        initialDraft={liveDraft}
        teamInsights={teamInsights}
      />
    </main>
  );
}
