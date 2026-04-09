import Link from 'next/link';
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
      <div className="space-y-1">
        <Link
          href={`/admin/${slug}`}
          className="text-sm text-blue-600 hover:text-blue-500 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
        >
          ← {league.displayName}
        </Link>
        <h1 className="text-2xl font-semibold">
          {league.displayName} — Data
        </h1>
      </div>
      <LeagueDataPanel slug={slug} year={league.year} />
    </main>
  );
}
