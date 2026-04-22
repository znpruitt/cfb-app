import { notFound, redirect } from 'next/navigation';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { getLeague } from '@/lib/leagueRegistry';
import { getPreseasonOwners } from '@/lib/preseasonOwnerStore';
import { getSeasonArchive, listSeasonArchives } from '@/lib/seasonArchive';
import { parseOwnersCsv } from '@/lib/parseOwnersCsv';
import { getAppState } from '@/lib/server/appStateStore';
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

  // Three-step fallback for initial owner list:
  // 1. Previously confirmed preseason-owners list for this year
  // 2. Most recent season archive ownerRosterSnapshot
  // 3. Live owner CSV for prior season year (covers leagues excluded from rollover, e.g. 'test')
  let initialOwners: string[] = [];

  const saved = await getPreseasonOwners(slug, year);
  if (saved !== null && saved.length > 0) {
    // Step 1: use previously confirmed list
    initialOwners = saved;
  } else {
    try {
      // Step 2: derive from most recent season archive
      const years = await listSeasonArchives(slug);
      const priorYears = years.filter((y) => y < year).sort((a, b) => b - a);
      if (priorYears.length > 0) {
        const priorArchive = await getSeasonArchive(slug, priorYears[0]!);
        if (priorArchive) {
          const rows = parseOwnersCsv(priorArchive.ownerRosterSnapshot);
          const uniqueOwners = Array.from(new Set(rows.map((r) => r.owner).filter(Boolean)));
          initialOwners = uniqueOwners.filter((o) => o !== 'NoClaim');
        }
      }

      // Step 3: fall back to live owner CSV for the prior season year
      // This covers leagues excluded from rollover (e.g. 'test') and any league
      // transitioning into their first preseason before any archive exists.
      if (initialOwners.length === 0) {
        const priorYear = year - 1;
        const csvRecord = await getAppState<string>(`owners:${slug}:${priorYear}`, 'csv');
        const csvText = typeof csvRecord?.value === 'string' ? csvRecord.value : '';
        if (csvText.trim()) {
          const rows = parseOwnersCsv(csvText);
          const uniqueOwners = Array.from(new Set(rows.map((r) => r.owner).filter(Boolean)));
          initialOwners = uniqueOwners.filter((o) => o !== 'NoClaim');
        }
      }
    } catch {
      // Storage unavailable — start with empty list
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-8">
      <div className="space-y-1">
        <Breadcrumbs
          segments={[
            { label: 'Home', href: '/' },
            { label: 'Admin', href: '/admin' },
            { label: league.displayName, href: `/admin/${slug}` },
            { label: 'Preseason', href: `/admin/${slug}/preseason` },
            { label: 'Owners' },
          ]}
        />
        <h1 className="text-2xl font-semibold">Confirm Owners for {year}</h1>
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          Review and update the owner list for the {year} season. Changes here will not affect prior
          seasons.
        </p>
      </div>

      <OwnerConfirmationShell slug={slug} year={year} initialOwners={initialOwners} />
    </main>
  );
}
