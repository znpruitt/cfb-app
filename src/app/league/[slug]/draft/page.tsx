import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getLeague } from '@/lib/leagueRegistry';
import { getAppState } from '@/lib/server/appStateStore';
import { draftScope, type DraftState } from '@/lib/draft';
import { SEED_ALIASES, type AliasMap } from '@/lib/teamNames';
import { loadSeasonRankings } from '@/lib/server/rankings';
import { buildScheduleFromApi, type ScheduleWireItem } from '@/lib/schedule';
import { selectDraftTeamInsights } from '@/lib/selectors/draftTeamInsights';
import type { SpRatingEntry, WinTotalEntry, ApPollEntry } from '@/lib/selectors/draftTeamInsights';
import {
  buildScheduleIndex,
  attachScoresToSchedule,
  type NormalizedScoreRow,
  type SeasonPhase,
} from '@/lib/scoreAttachment';
import { createTeamIdentityResolver } from '@/lib/teamIdentity';
import type { AppGame } from '@/lib/schedule';
import type { ScorePack } from '@/lib/scores';
import { getTeamDatabaseItems } from '@/lib/server/teamDatabaseStore';
import DraftBoardClient from '@/components/draft/DraftBoardClient';

export const dynamic = 'force-dynamic';

export default async function DraftBoardPage({
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

  // Load draft state
  const draftRecord = await getAppState<DraftState>(draftScope(slug), String(year));
  const draft = draftRecord?.value ?? null;

  // If no draft or phase is not yet live/paused/complete, redirect to setup
  if (
    !draft ||
    draft.phase === 'setup' ||
    draft.phase === 'settings' ||
    draft.phase === 'preview'
  ) {
    redirect(`/league/${slug}/draft/setup`);
  }

  // draft is non-null past this point (redirect() throws)
  const liveDraft = draft as DraftState;

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
      const [globalAliasRec, leagueAliasRec] = await Promise.all([
        getAppState<AliasMap>(`aliases:${year}`, 'map'),
        getAppState<AliasMap>(`aliases:${slug}:${year}`, 'map'),
      ]);
      const aliasMap: AliasMap = {
        ...SEED_ALIASES,
        ...(globalAliasRec?.value && typeof globalAliasRec.value === 'object' && !Array.isArray(globalAliasRec.value) ? globalAliasRec.value : {}),
        ...(leagueAliasRec?.value && typeof leagueAliasRec.value === 'object' && !Array.isArray(leagueAliasRec.value) ? leagueAliasRec.value : {}),
      };
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

  // Load prior year (year-1) schedule + scores for lastSeasonRecord derivation
  let priorYearGames: AppGame[] | undefined;
  let priorYearScoresByKey: Record<string, ScorePack> | undefined;
  try {
    const priorYear = year - 1;
    const priorSchedRecord = await getAppState<{ items: unknown[] }>(
      'schedule',
      `${priorYear}-all-all`
    );
    const priorSchedItems = (priorSchedRecord?.value?.items ?? []) as ScheduleWireItem[];
    if (priorSchedItems.length > 0) {
      const [priorGlobalAliasRec, priorLeagueAliasRec] = await Promise.all([
        getAppState<AliasMap>(`aliases:${priorYear}`, 'map'),
        getAppState<AliasMap>(`aliases:${slug}:${priorYear}`, 'map'),
      ]);
      const priorAliasMap: AliasMap = {
        ...SEED_ALIASES,
        ...(priorGlobalAliasRec?.value && typeof priorGlobalAliasRec.value === 'object' && !Array.isArray(priorGlobalAliasRec.value) ? priorGlobalAliasRec.value : {}),
        ...(priorLeagueAliasRec?.value && typeof priorLeagueAliasRec.value === 'object' && !Array.isArray(priorLeagueAliasRec.value) ? priorLeagueAliasRec.value : {}),
      };
      const priorBuilt = buildScheduleFromApi({
        scheduleItems: priorSchedItems,
        teams,
        aliasMap: priorAliasMap,
        season: priorYear,
      });
      priorYearGames = priorBuilt.games;

      const [regularCache, postseasonCache] = await Promise.all([
        getAppState<{ items: unknown[] }>('scores', `${priorYear}-all-regular`),
        getAppState<{ items: unknown[] }>('scores', `${priorYear}-all-postseason`),
      ]);

      type RawScoreItem = {
        id?: string | null;
        seasonType?: string | null;
        startDate?: string | null;
        week: number | null;
        status: string;
        home: { team: string; score: number | null };
        away: { team: string; score: number | null };
        time: string | null;
      };

      const toRow = (item: unknown, defaultType: SeasonPhase): NormalizedScoreRow => {
        const s = item as RawScoreItem;
        const st: SeasonPhase =
          s.seasonType === 'regular' || s.seasonType === 'postseason'
            ? (s.seasonType as SeasonPhase)
            : defaultType;
        return {
          week: s.week,
          seasonType: st,
          providerEventId: s.id ?? null,
          status: s.status,
          time: s.time,
          date: s.startDate ?? null,
          home: s.home,
          away: s.away,
        };
      };

      const priorRows: NormalizedScoreRow[] = [
        ...(regularCache?.value?.items ?? []).map((i) => toRow(i, 'regular')),
        ...(postseasonCache?.value?.items ?? []).map((i) => toRow(i, 'postseason')),
      ];

      const priorResolver = createTeamIdentityResolver({
        teams,
        aliasMap: priorAliasMap,
      });
      const priorIndex = buildScheduleIndex(priorYearGames, priorResolver);
      const attached = attachScoresToSchedule({
        rows: priorRows,
        scheduleIndex: priorIndex,
        resolver: priorResolver,
      });
      priorYearScoresByKey = attached.scoresByKey as Record<string, ScorePack>;
    }
  } catch {
    // prior year historical data unavailable — lastSeasonRecord will be null
  }

  // Derive team insights
  const teamInsights = selectDraftTeamInsights({
    teams,
    spRatings,
    winTotals,
    schedule: games,
    apPoll,
    year,
    priorYearGames,
    priorYearScoresByKey,
  });

  // Sort by SP+ rating desc, then alphabetically
  teamInsights.sort((a, b) => {
    if (a.spRating !== null && b.spRating !== null) return b.spRating - a.spRating;
    if (a.spRating !== null) return -1;
    if (b.spRating !== null) return 1;
    return a.teamName.localeCompare(b.teamName);
  });

  return (
    <main className="mx-auto px-4 py-8">
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
            {liveDraft.phase === 'complete' && (
              <>
                {' · '}
                <Link
                  href={`/league/${slug}/draft/summary`}
                  className="text-blue-600 hover:underline dark:text-blue-400"
                >
                  Draft Summary →
                </Link>
              </>
            )}
          </p>
        </div>
        <Link
          href={`/league/${slug}/draft/setup`}
          className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
        >
          Settings
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
