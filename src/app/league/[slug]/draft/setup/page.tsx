import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getLeague } from '@/lib/leagueRegistry';
import { getAppState } from '@/lib/server/appStateStore';
import { getSeasonArchive, listSeasonArchives } from '@/lib/seasonArchive';
import { getConfirmedRoster } from '@/lib/server/confirmedRosterStore';
import { resolveDraftSetupGate } from './draftSetupGate';
import { draftScope, getDraftEligibleTeams, type DraftState } from '@/lib/draft';
import teamsData from '@/data/teams.json';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import DraftSetupShell from '@/components/draft/DraftSetupShell';
import { renderLeagueGateIfBlocked } from '../../leagueGate';
import { canAccessDraftBoard } from '@/lib/server/canAccessDraftBoard';

export const dynamic = 'force-dynamic';

type TeamsJson = { items: TeamCatalogItem[] };

export default async function DraftSetupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const gate = await renderLeagueGateIfBlocked(slug);
  if (gate) return gate;

  const isAdmin = await canAccessDraftBoard(slug);
  if (!isAdmin) redirect(`/league/${slug}/draft/board`);

  const league = await getLeague(slug);
  if (!league) notFound();

  // Derive year from lifecycle status — preseason/season use status.year, offseason falls back to league.year
  const status = league.status;
  const year =
    status?.state === 'preseason' || status?.state === 'season' ? status.year : league.year;

  // Load existing draft state if any
  const draftRecord = await getAppState<DraftState>(draftScope(slug), String(year));
  const draftState = draftRecord?.value ?? null;

  // PLATFORM-092 — the CURRENT confirmed roster, never a prior season's.
  //
  // This used to fall back to the most recent season ARCHIVE when no
  // confirmation existed for the year being drafted, which is how a returning
  // league reached a configured, dated draft while nothing had recorded who owns
  // teams this year. Last season's owners are a fine thing to pre-fill the
  // CONFIRMATION form with (`/admin/[slug]/preseason/owners` does exactly that);
  // they are not a substitute for confirming them.
  //
  // Reading it here is also what reconciles the draft record: this page is the
  // one place a commissioner returns to after changing owners, and the shell
  // sends these names on its next write.
  const roster = await getConfirmedRoster(slug, year);
  const priorOwners = roster.owners;
  let priorChampOrder: string[] | null = null;

  // Build reverse championship order from most recent archive: last place picks first
  const archiveYears = await listSeasonArchives(slug);
  const priorArchiveYears = archiveYears.filter((y) => y < year).sort((a, b) => b - a);
  if (priorArchiveYears.length > 0) {
    const priorArchive = await getSeasonArchive(slug, priorArchiveYears[0]!);
    if (priorArchive) {
      const finalStandings = priorArchive.finalStandings;
      if (finalStandings.length > 0) {
        priorChampOrder = [...finalStandings]
          .reverse()
          .map((r) => r.owner)
          .filter((o) => o !== 'NoClaim');
      }
    }
  }

  // Draft-eligible team count for auto-suggesting rounds (excludes NoClaim)
  const { items } = teamsData as TeamsJson;
  const fbsTeamCount = getDraftEligibleTeams(items).length;

  // PLATFORM-092 — with no confirmed roster there is nothing to seed a draft
  // with and `POST /api/draft/[slug]/[year]` will refuse to create one, so say so
  // here rather than rendering a settings form whose save fails.
  const setupGate = resolveDraftSetupGate({
    isConfirmed: roster.isConfirmed,
    hasDraft: draftState !== null,
    isPreseason: status?.state === 'preseason',
    slug,
    year,
  });
  if (setupGate) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link
          href={`/league/${slug}/`}
          className="mb-6 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
        >
          ← Back to {league.displayName}
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-950 dark:text-zinc-50">
          {league.displayName} — {year} Draft Setup
        </h1>
        <section className="mt-8 rounded-lg border border-gray-200 bg-gray-50 p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="text-base font-semibold text-gray-900 dark:text-zinc-100">
            Confirm your {year} owners first
          </h2>
          <p className="mt-2 text-sm text-gray-600 dark:text-zinc-300">
            A draft needs to know who is in the league this season. Record the {year} owners and
            this page will pick up from there — last season&apos;s owners are offered as a starting
            point.
          </p>
          <Link
            href={setupGate.href}
            className="mt-4 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {setupGate.cta}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href={`/league/${slug}/`}
        className="mb-6 inline-block text-sm text-blue-600 hover:underline dark:text-blue-400"
      >
        ← Back to {league.displayName}
      </Link>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-gray-950 dark:text-zinc-50">
        {league.displayName} — {year} Draft Setup
      </h1>
      <p className="mt-1 text-sm text-gray-500 dark:text-zinc-400">
        Commissioner draft configuration for the {year} season.
      </p>

      <div className="mt-8">
        <DraftSetupShell
          slug={slug}
          year={year}
          draftState={draftState}
          priorOwners={priorOwners}
          priorChampOrder={priorChampOrder}
          fbsTeamCount={fbsTeamCount}
          isAdmin={isAdmin}
        />
      </div>
    </main>
  );
}
