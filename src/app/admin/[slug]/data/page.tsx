import { notFound } from 'next/navigation';

import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import ViewMoreLink from '@/components/navigation/ViewMoreLink';
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
      <div className="space-y-1">
        <Breadcrumbs
          segments={[
            { label: 'Home', href: '/' },
            { label: 'Admin', href: '/admin' },
            { label: league.displayName, href: `/admin/${slug}` },
            { label: 'Data' },
          ]}
        />
        <h1 className="text-2xl font-semibold">{league.displayName} — Data</h1>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          Aliases have moved to the platform level.{' '}
          <ViewMoreLink href="/admin/aliases">Manage aliases</ViewMoreLink>
        </p>
        <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
          Schedule and scores are managed from{' '}
          <ViewMoreLink href="/admin/data/cache">Data Cache</ViewMoreLink>
        </p>
      </div>
    </main>
  );
}
