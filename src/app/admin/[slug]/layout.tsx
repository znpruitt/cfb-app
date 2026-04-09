import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getLeague } from '@/lib/leagueRegistry';

export const dynamic = 'force-dynamic';

export default async function AdminLeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const league = await getLeague(slug);

  if (!league) notFound();

  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="flex items-center gap-3 border-b border-gray-200 px-6 py-4 dark:border-zinc-800">
        <Link href="/admin" className="text-sm text-blue-600 hover:text-blue-500 transition-colors dark:text-blue-400 dark:hover:text-blue-300">
          ← Admin
        </Link>
        <span className="text-gray-300 dark:text-zinc-700">/</span>
        <span className="text-sm font-medium">{league.displayName}</span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-500 dark:bg-zinc-800 dark:text-zinc-400">
          {league.slug}
        </span>
      </div>
      {children}
    </div>
  );
}
