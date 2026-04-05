import { notFound } from 'next/navigation';

import RosterEditorPanel from '@/components/admin/RosterEditorPanel';
import RosterUploadPanel from '@/components/admin/RosterUploadPanel';
import { getLeague } from '@/lib/leagueRegistry';
import { seasonYearForToday } from '@/lib/scores/normalizers';
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

  const year = seasonYearForToday();
  const teams = (teamsData.items as { school: string; conference: string }[]).map((t) => ({
    school: t.school,
    conference: t.conference,
  }));

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-8">
      <h1 className="text-xl font-bold text-zinc-100">{definedLeague.displayName} — Roster</h1>

      {/* ---- Upload Roster CSV ---- */}
      <section className="space-y-3">
        <div className="border-b border-zinc-700 pb-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
            Upload Roster CSV
          </h2>
          <p className="mt-1 text-xs text-zinc-600">
            Validate and bulk-upload a team-owner CSV with fuzzy team name matching.
          </p>
        </div>
        <RosterUploadPanel leagues={[definedLeague]} />
      </section>

      {/* ---- Edit Roster Directly ---- */}
      <section className="space-y-3">
        <div className="border-b border-zinc-700 pb-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
            Edit Roster Directly
          </h2>
          <p className="mt-1 text-xs text-zinc-600">
            Inline editor for team-owner assignments. Use for fixes, mid-season transfers, or leagues without a formal draft.
          </p>
        </div>
        <RosterEditorPanel slug={slug} year={year} teams={teams} />
      </section>
    </main>
  );
}
