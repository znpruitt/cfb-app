import Link from 'next/link';
import { notFound } from 'next/navigation';

import LeagueSettingsForm from '@/components/admin/LeagueSettingsForm';
import { getLeague } from '@/lib/leagueRegistry';

export const dynamic = 'force-dynamic';

export default async function AdminLeagueSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const league = await getLeague(slug);

  if (!league) notFound();

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <div className="space-y-1">
        <Link
          href={`/admin/${slug}`}
          className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
        >
          ← {league.displayName}
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-100">
          {league.displayName} — Settings
        </h1>
      </div>
      <LeagueSettingsForm
        slug={slug}
        initialDisplayName={league.displayName}
        initialYear={league.year}
        initialFoundedYear={league.foundedYear}
      />
    </main>
  );
}
