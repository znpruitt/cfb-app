import { notFound } from 'next/navigation';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
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
        <Breadcrumbs
          segments={[
            { label: 'Home', href: '/' },
            { label: 'Admin', href: '/admin' },
            { label: league.displayName, href: `/admin/${slug}` },
            { label: 'Settings' },
          ]}
        />
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
