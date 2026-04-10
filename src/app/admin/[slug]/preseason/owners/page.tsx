import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { getLeague } from '@/lib/leagueRegistry';
import { getPreseasonOwners } from '@/lib/preseasonOwnerStore';
import { getSeasonArchive, listSeasonArchives } from '@/lib/seasonArchive';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import OwnerConfirmationShell from './OwnerConfirmationShell';

export const dynamic = 'force-dynamic';

export default async function PreseasonOwnersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const league = await getLeague(slug);

  if (!league) notFound();

  // Gate: only accessible while league is in preseason
  if (!league.status || league.status.state !== 'preseason') {
    redirect(`/admin/${slug}`);
  }

  const year = league.status.year;

  // Load confirmed preseason owners if already saved, otherwise derive from most recent archive
  let initialOwners: string[] = [];

  const saved = await getPreseasonOwners(slug, year);
  if (saved !== null) {
    initialOwners = saved;
  } else {
    // Derive from most recent completed season archive
    try {
      const years = await listSeasonArchives(slug);
      const priorYears = years.filter((y) => y < year).sort((a, b) => b - a);
      if (priorYears.length > 0) {
        const priorArchive = await getSeasonArchive(slug, priorYears[0]!);
        if (priorArchive) {
          const rows = parseOwnersCsv(priorArchive.ownerRosterSnapshot);
          const uniqueOwners = Array.from(
            new Set(rows.map((r) => r.owner).filter(Boolean))
          );
          initialOwners = uniqueOwners.filter((o) => o !== 'NoClaim');
        }
      }
    } catch {
      // No archive available — start with empty list
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-8">
      <div className="space-y-1">
        <Link
          href={`/admin/${slug}/preseason`}
          className="text-sm text-blue-600 hover:text-blue-500 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← Pre-Season Setup
        </Link>
        <h1 className="text-2xl font-semibold">Confirm Owners for {year}</h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          Review and update the owner list for the {year} season. Changes here will not affect
          prior seasons.
        </p>
      </div>

      <OwnerConfirmationShell slug={slug} year={year} initialOwners={initialOwners} />
    </main>
  );
}
