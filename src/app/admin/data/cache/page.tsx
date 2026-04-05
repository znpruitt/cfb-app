import Link from 'next/link';

import SpRatingsCachePanel from '@/components/SpRatingsCachePanel';
import HistoricalCachePanel from '@/components/admin/HistoricalCachePanel';
import { getLeagues } from '@/lib/leagueRegistry';

export const dynamic = 'force-dynamic';

export default async function AdminDataCachePage() {
  const leagues = await getLeagues();

  return (
    <main className="min-h-screen bg-zinc-950 px-6 py-10 text-zinc-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-zinc-100">Data Cache</h1>
          <Link href="/admin" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">
            ← Admin
          </Link>
        </div>

        <SpRatingsCachePanel />
        <HistoricalCachePanel leagues={leagues} />
      </div>
    </main>
  );
}
