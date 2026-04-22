import Link from 'next/link';
import { notFound } from 'next/navigation';

import LeagueSettingsForm from '@/components/admin/LeagueSettingsForm';
import LeaguePasswordPanel from '@/components/admin/LeaguePasswordPanel';
import { getLeague } from '@/lib/leagueRegistry';
import { leagueHasPassword } from '@/lib/leagueAuth';

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
          className="text-sm text-blue-600 hover:text-blue-500 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← {league.displayName}
        </Link>
        <h1 className="text-2xl font-semibold">{league.displayName} — Settings</h1>
      </div>
      <LeagueSettingsForm
        slug={slug}
        initialDisplayName={league.displayName}
        initialYear={league.year}
        initialFoundedYear={league.foundedYear}
      />
      <LeaguePasswordPanel slug={slug} initialHasPassword={leagueHasPassword(league)} />
    </main>
  );
}
