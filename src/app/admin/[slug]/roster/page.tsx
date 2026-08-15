import { notFound } from 'next/navigation';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import RosterEditorPanel from '@/components/admin/RosterEditorPanel';
import RosterUploadPanel from '@/components/admin/RosterUploadPanel';
import { getLeague } from '@/lib/leagueRegistry';
import { resolveLeagueOperatingYear } from '@/lib/selectors/leagueLifecycle';
import { sanitizeLeague } from '@/lib/leagueSanitize';
import teamsData from '@/data/teams.json';

export const dynamic = 'force-dynamic';

export default async function AdminLeagueRosterPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const league = await getLeague(slug);

  if (!league) notFound();
  // notFound() throws — league is non-null below this point
  const definedLeague = league!;

  // PLATFORM-099 — resolve the season the way every lifecycle-aware surface does.
  // This page keyed off the top-level `year`. `applyLifecycleStatus` projects one
  // from the other for every non-offseason state, so they agree for anything
  // written through the lifecycle authority — but `leagueRegistry` explicitly
  // contemplates a desynchronized top-level year on legacy records, and this page
  // displayed no year at all, which is what would let the mismatch hide.
  const year = resolveLeagueOperatingYear(definedLeague);
  const teams = (teamsData.items as { school: string; conference: string }[]).map((t) => ({
    school: t.school,
    conference: t.conference,
  }));

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
      <Breadcrumbs
        segments={[
          { label: 'Home', href: '/' },
          { label: 'Admin', href: '/admin' },
          { label: definedLeague.displayName, href: `/admin/${slug}` },
          { label: 'Roster' },
        ]}
      />
      <h1 className="text-xl font-bold">
        {definedLeague.displayName} — {year} Roster
      </h1>

      {/* ---- Upload Roster CSV ---- */}
      <section className="space-y-3">
        <div className="border-b border-gray-200 pb-2 dark:border-zinc-700">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-500">
            Historical / repair roster CSV import
          </h2>
          <p className="mt-1 text-xs text-gray-400 dark:text-zinc-600">
            Bulk import for a past season, or repair from a file, with fuzzy team name matching. To
            change who owns a team this season, use the editor below.
          </p>
        </div>
        {/* The resolved year reaches the import panel too. Passing the league
            untouched left its year selector defaulting to the top-level `year`,
            so on precisely the desynchronized record this resolution handles the
            page would show one season in the heading and pre-select another in
            the importer beneath it. */}
        <RosterUploadPanel leagues={[{ ...sanitizeLeague(definedLeague), year }]} />
      </section>

      {/* ---- Edit Roster Directly ---- */}
      <section className="space-y-3">
        <div className="border-b border-gray-200 pb-2 dark:border-zinc-700">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-500">
            Edit Roster Directly
          </h2>
          <p className="mt-1 text-xs text-gray-400 dark:text-zinc-600">
            Who owns each team this season. Use it for fixes, mid-season transfers, or leagues
            without a formal draft — standings follow it immediately.
          </p>
        </div>
        <RosterEditorPanel slug={slug} year={year} teams={teams} />
      </section>
    </main>
  );
}
