import { notFound } from 'next/navigation';

import LeagueDataPanel from '@/components/admin/LeagueDataPanel';
import { getLeague } from '@/lib/leagueRegistry';

export const dynamic = 'force-dynamic';

export default async function AdminLeagueDataPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const league = await getLeague(slug);

  if (!league) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <h1 className="text-2xl font-semibold text-zinc-100">
        {league.displayName} — Data
      </h1>
      <LeagueDataPanel slug={slug} year={league.year} />
    </main>
  );
}
