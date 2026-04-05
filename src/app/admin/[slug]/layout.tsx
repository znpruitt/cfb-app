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
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="flex items-center gap-3 border-b border-zinc-800 px-6 py-4">
        <Link href="/admin" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
          ← Admin
        </Link>
        <span className="text-zinc-700">/</span>
        <span className="text-sm font-medium text-zinc-100">{league.displayName}</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs text-zinc-400">
          {league.slug}
        </span>
      </div>
      {children}
    </div>
  );
}
