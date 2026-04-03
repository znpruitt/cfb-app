import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLeague } from '@/lib/leagueRegistry';
import { getAppState } from '@/lib/server/appStateStore';
import { getSeasonArchive, listSeasonArchives } from '@/lib/seasonArchive';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import { draftScope, type DraftState } from '@/lib/draft';
import teamsData from '@/data/teams.json';
import type { TeamCatalogItem } from '@/lib/teamIdentity';
import DraftSetupShell from '@/components/draft/DraftSetupShell';

type TeamsJson = { items: TeamCatalogItem[] };

export default async function DraftSetupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;

  const league = await getLeague(slug);
  if (!league) notFound();

  const year = league.year;

  // Load existing draft state if any
  const draftRecord = await getAppState<DraftState>(draftScope(slug), String(year));
  const draftState = draftRecord?.value ?? null;

  // Auto-populate prior year owners from most recent archive
  let priorOwners: string[] = [];
  let priorChampOrder: string[] | null = null;

  const years = await listSeasonArchives(slug);
  const priorYears = years.filter((y) => y < year).sort((a, b) => b - a);
  if (priorYears.length > 0) {
    const priorArchive = await getSeasonArchive(slug, priorYears[0]!);
    if (priorArchive) {
      const rows = parseOwnersCsv(priorArchive.ownerRosterSnapshot);
      const uniqueOwners = Array.from(new Set(rows.map((r) => r.owner).filter(Boolean)));
      priorOwners = uniqueOwners.filter((o) => o !== 'NoClaim');

      // Build reverse championship order: last place picks first in round 1
      const finalStandings = priorArchive.finalStandings;
      if (finalStandings.length > 0) {
        priorChampOrder = [...finalStandings]
          .reverse()
          .map((r) => r.owner)
          .filter((o) => o !== 'NoClaim');
      }
    }
  }

  // FBS team count for auto-suggesting rounds (exclude NoClaim)
  const { items } = teamsData as TeamsJson;
  const fbsTeamCount = items.filter((t) => t.school !== 'NoClaim').length;

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
        />
      </div>
    </main>
  );
}
