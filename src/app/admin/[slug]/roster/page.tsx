import { notFound } from 'next/navigation';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import RosterEditorPanel from '@/components/admin/RosterEditorPanel';
import RosterUploadPanel from '@/components/admin/RosterUploadPanel';
import { getLeague } from '@/lib/leagueRegistry';
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

  const year = definedLeague.year;
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
      <h1 className="text-xl font-bold">{definedLeague.displayName} — Roster</h1>

      {/* ---- Upload Roster CSV ---- */}
      <section className="space-y-3">
        <div className="border-b border-gray-200 pb-2 dark:border-zinc-700">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-500">
            Upload Roster CSV
          </h2>
          <p className="mt-1 text-xs text-gray-400 dark:text-zinc-600">
            Validate and bulk-upload a team-owner CSV with fuzzy team name matching.
          </p>
        </div>
        <RosterUploadPanel leagues={[sanitizeLeague(definedLeague)]} />
      </section>

      {/* ---- Edit Roster Directly ---- */}
      <section className="space-y-3">
        <div className="border-b border-gray-200 pb-2 dark:border-zinc-700">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500 dark:text-zinc-500">
            Edit Roster Directly
          </h2>
          <p className="mt-1 text-xs text-gray-400 dark:text-zinc-600">
            Inline editor for team-owner assignments. Use for fixes, mid-season transfers, or
            leagues without a formal draft.
          </p>
        </div>
        <RosterEditorPanel slug={slug} year={year} teams={teams} />
      </section>
    </main>
  );
}
