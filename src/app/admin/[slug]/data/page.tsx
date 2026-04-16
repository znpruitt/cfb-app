import Link from 'next/link';
import { notFound } from 'next/navigation';

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
        <h1 className="text-2xl font-semibold">{league.displayName} — Data</h1>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-sm text-gray-500 dark:text-zinc-400">
          Aliases have moved to the platform level.{' '}
          <Link href="/admin/aliases" className="text-blue-600 hover:underline dark:text-blue-400">
            Manage aliases →
          </Link>
        </p>
        <p className="mt-2 text-sm text-gray-500 dark:text-zinc-400">
          Schedule and scores are managed from{' '}
          <Link
            href="/admin/data/cache"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Data Cache →
          </Link>
        </p>
      </div>
    </main>
  );
}
